import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { like } from "./likes.ts";
import { edit } from "./edit.ts";
import { page } from "./page.ts";
import { normalizeTitle } from "./title.ts";
import { newest } from "./sort.ts";
import { feed } from "./feed.ts";
import type { Post } from "./model.ts";
const users = [
  { id: "maya", name: "Maya" },
  { id: "lina", name: "Lina" },
  { id: "priya", name: "Priya" },
];
export function createBoardServer(databasePath = "data/board.sqlite") {
  if (databasePath !== ":memory:")
    mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(
    "CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY,ownerId TEXT NOT NULL,title TEXT NOT NULL,likedBy TEXT NOT NULL,updatedAt INTEGER NOT NULL)",
  );
  const save = (p: Post) =>
    db
      .prepare(
        "INSERT INTO posts VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,likedBy=excluded.likedBy,updatedAt=excluded.updatedAt",
      )
      .run(p.id, p.ownerId, p.title, JSON.stringify(p.likedBy), p.updatedAt);
  if (
    (db.prepare("SELECT COUNT(*) AS n FROM posts").get() as { n: number }).n ===
    0
  ) {
    save({
      id: "repair",
      ownerId: "lina",
      title: "Repair café opens Saturday — bring your broken toaster",
      likedBy: [],
      updatedAt: 3,
    });
    save({
      id: "tools",
      ownerId: "maya",
      title: "Can anyone lend a small screwdriver set?",
      likedBy: [],
      updatedAt: 2,
    });
    save({
      id: "welcome",
      ownerId: "priya",
      title: "Welcome to the neighborhood board",
      likedBy: [],
      updatedAt: 1,
    });
  }
  const posts = () =>
    (db.prepare("SELECT * FROM posts").all() as any[]).map((p) => ({
      ...p,
      likedBy: JSON.parse(p.likedBy),
    })) as Post[];
  const demo: Post = {
    id: "probe",
    ownerId: "maya",
    title: "Probe",
    likedBy: [],
    updatedAt: 0,
  };
  const available = (f: () => unknown) => {
    try {
      f();
      return true;
    } catch (e: any) {
      return e.message !== "Not implemented";
    }
  };
  const http = createServer(async (req, res) => {
    const send = (status: number, value: any) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (
        req.method === "GET" &&
        (url.pathname === "/" || url.pathname === "/app.js")
      ) {
        res.writeHead(200, {
          "Content-Type":
            url.pathname === "/"
              ? "text/html; charset=utf-8"
              : "text/javascript; charset=utf-8",
          "Content-Security-Policy":
            "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
        });
        res.end(
          readFileSync(
            new URL(
              "../web/" + (url.pathname === "/" ? "index.html" : "app.js"),
              import.meta.url,
            ),
          ),
        );
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/users") {
        send(200, users);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/features") {
        send(200, {
          likes: available(() => like(demo, "lina")),
          editing: available(() => edit(demo, "maya", "Probe")),
          pagination: available(() => page([], 0, 10)),
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/posts") {
        let result = feed(posts());
        if (url.searchParams.get("sort") === "newest") result = newest(result);
        if (url.searchParams.has("offset") || url.searchParams.has("limit"))
          result = page(
            result,
            Number(url.searchParams.get("offset") ?? 0),
            Number(url.searchParams.get("limit") ?? 10),
          );
        send(200, result);
        return;
      }
      const actor = req.headers["x-demo-user"];
      if (typeof actor !== "string" || !users.some((u) => u.id === actor)) {
        send(401, { error: "Choose a demo user" });
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16000) {
          send(413, { error: "Request too large" });
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      if (req.method === "POST" && url.pathname === "/api/posts") {
        if (
          typeof body.title !== "string" ||
          !body.title.trim() ||
          body.title.length > 200
        ) {
          send(400, { error: "Use a title of 1–200 characters" });
          return;
        }
        const post = {
          id: crypto.randomUUID(),
          ownerId: actor,
          title: normalizeTitle(body.title),
          likedBy: [],
          updatedAt: Date.now(),
        };
        save(post);
        send(201, post);
        return;
      }
      const match = /^\/api\/posts\/([a-zA-Z0-9-]+)(\/likes)?$/.exec(
        url.pathname,
      );
      const post = match ? posts().find((p) => p.id === match[1]) : undefined;
      if (!post) {
        send(404, { error: "Post not found" });
        return;
      }
      if (req.method === "POST" && match?.[2]) {
        const changed = like(post, actor);
        save(changed);
        send(200, changed);
        return;
      }
      if (req.method === "PATCH" && !match?.[2]) {
        if (
          typeof body.title !== "string" ||
          !body.title.trim() ||
          body.title.length > 200
        ) {
          send(400, { error: "Use a title of 1–200 characters" });
          return;
        }
        const changed = edit(post, actor, normalizeTitle(body.title));
        save({ ...changed, updatedAt: Date.now() });
        send(200, changed);
        return;
      }
      send(405, { error: "Method not allowed" });
    } catch (e: any) {
      const status =
        e.message === "Not implemented"
          ? 501
          : e.message === "Forbidden"
            ? 403
            : e.message === "Invalid pagination" || e instanceof SyntaxError
              ? 400
              : 500;
      send(status, {
        error: status === 500 ? "Unexpected server error" : e.message,
      });
    }
  });
  http.on("close", () => db.close());
  return http;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = createBoardServer(process.env.BOARD_DATABASE);
  server.listen(Number(process.env.PORT ?? 3001), "127.0.0.1", () =>
    console.log("Pocket Board: http://localhost:" + (process.env.PORT ?? 3001)),
  );
  process.once("SIGINT", () => server.close());
}
