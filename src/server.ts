import { createServer } from "node:http";
import { validSignature } from "./security.ts";
import { Store } from "./store.ts";
import { Game } from "./game.ts";
const allowed = new Set([
  "installation",
  "installation_repositories",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "issue_comment",
  "issues",
  "push",
]);
export function server(store: Store, game: Game, secret: string) {
  if (!secret) throw new Error("WEBHOOK_SECRET is required");
  let working = false;
  const work = async () => {
    if (working) return;
    working = true;
    try {
      const row = store.db
        .prepare(
          "SELECT * FROM deliveries WHERE status='pending' AND next<=? ORDER BY rowid LIMIT 1",
        )
        .get(Date.now()) as any;
      if (!row) return;
      try {
        await game.process(row.event, JSON.parse(row.body));
        store.db
          .prepare("UPDATE deliveries SET status='done' WHERE id=?")
          .run(row.id);
      } catch {
        const attempts = row.attempts + 1;
        store.db
          .prepare(
            "UPDATE deliveries SET attempts=?,next=?,status=? WHERE id=?",
          )
          .run(
            attempts,
            Date.now() + Math.min(60000, 1000 * 2 ** attempts),
            attempts >= 5 ? "failed" : "pending",
            row.id,
          );
      }
    } finally {
      working = false;
    }
  };
  const timer = setInterval(() => void work(), 500);
  // Periodic reconciliation recovers missed webhooks; synthetic IDs are stable per minute.
  const reconcile = setInterval(() => {
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
      JSON.parse(raw.toString("utf8"));
      if (allowed.has(event)) store.enqueue(id, event, raw.toString("utf8"));
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
