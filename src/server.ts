import { createServer } from "node:http";
import { failureCode, report } from "./diagnostics.ts";
import { Game } from "./game.ts";
import { validSignature } from "./security.ts";
import { Store } from "./store.ts";
import { parseWebhook, webhookEvents } from "./webhooks.ts";
export function server(store: Store, game: Game, secret: string) {
  if (!secret) throw new Error("WEBHOOK_SECRET is required");
  let working = false;
  const work = async () => {
    if (working) return;
    working = true;
    try {
      const row = store.nextDelivery();
      if (!row) return;
      try {
        await game.process(row.event, JSON.parse(row.body));
        store.completeDelivery(row.id);
      } catch (error) {
        store.failDelivery(row, error);
        report({
          component: "game",
          event: "delivery_failed",
          reason: failureCode(error),
          delivery: row.id,
        });
      }
    } finally {
      working = false;
    }
  };
  const timer = setInterval(() => void work(), 500);
  // Periodic reconciliation recovers missed webhooks; synthetic IDs are stable per minute.
  const reconcile = setInterval(() => {
    store.prune();
    for (const r of store.all())
      if (["active", "finishing"].includes(r.phase))
        store.enqueue(
          "reconcile:" + r.id + ":" + Math.floor(Date.now() / 60000),
          "push",
          JSON.stringify({
            installation: { id: r.installation },
            repository: { id: r.repository },
          }),
        );
  }, 60000);
  const http = createServer(async (req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200);
      res.end("ok");
      return;
    }
    if (req.url !== "/webhooks" || req.method !== "POST") {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 1000000) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      const signature = req.headers["x-hub-signature-256"];
      if (
        !validSignature(
          raw,
          typeof signature === "string" ? signature : undefined,
          secret,
        )
      ) {
        res.writeHead(401);
        res.end();
        return;
      }
      const id = req.headers["x-github-delivery"],
        event = req.headers["x-github-event"];
      if (
        typeof id !== "string" ||
        id.length > 100 ||
        typeof event !== "string"
      ) {
        res.writeHead(400);
        res.end();
        return;
      }
      if (webhookEvents.has(event)) {
        const payload = parseWebhook(JSON.parse(raw.toString("utf8")));
        store.enqueue(id, event, JSON.stringify(payload));
      }
      res.writeHead(202);
      res.end();
    } catch {
      res.writeHead(400);
      res.end();
    }
  });
  http.on("close", () => {
    clearInterval(timer);
    clearInterval(reconcile);
  });
  return http;
}
