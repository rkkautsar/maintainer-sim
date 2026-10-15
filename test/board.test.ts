import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { baseline, proposals } from "../src/scenario.ts";
async function board(revised: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "pocket-board-")),
    files = { ...baseline };
  if (revised)
    for (const p of proposals) Object.assign(files, p.variants.at(-1)!.files);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  const { createBoardServer } = await import(
    pathToFileURL(join(dir, "src/server.ts")).href
  );
  const db = join(dir, "board.sqlite");
  const start = async () => {
    const server = createBoardServer(db);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    return { server, url: "http://127.0.0.1:" + server.address().port };
  };
  const state = await start();
  return { dir, start, ...state };
}
const close = (server: any) =>
  new Promise<void>((resolve) => server.close(() => resolve()));
test("baseline is a runnable app with seeded posts, creation and durable storage", async () => {
  const b = await board(false);
  let active = b.server;
  try {
    const html = await (await fetch(b.url)).text();
    assert.match(html, /Pocket Board/);
    assert.match(html, /app.js/);
    const features = await (await fetch(b.url + "/api/features")).json();
    assert.deepEqual(features, {
      likes: false,
      editing: false,
      pagination: false,
    });
    assert.equal(
      ((await (await fetch(b.url + "/api/posts")).json()) as any[]).length,
      3,
    );
    const create = await fetch(b.url + "/api/posts", {
      method: "POST",
      headers: { "x-demo-user": "maya", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Bring your spare cables" }),
    });
    assert.equal(create.status, 201);
    const post: any = await create.json();
    const like = await fetch(b.url + "/api/posts/" + post.id + "/likes", {
      method: "POST",
      headers: { "x-demo-user": "maya" },
      body: "{}",
    });
    assert.equal(like.status, 501);
    await close(active);
    active = null;
    const reopened = await b.start();
    active = reopened.server;
    const posts = (await (
      await fetch(reopened.url + "/api/posts")
    ).json()) as any[];
    assert.equal(posts.length, 4);
    assert.ok(posts.some((p: any) => p.id === post.id));
  } finally {
    if (active) await close(active);
    rmSync(b.dir, { recursive: true, force: true });
  }
});
test("authored PR fixes enable end-to-end likes, owner edits and validated pagination", async () => {
  const b = await board(true);
  try {
    assert.deepEqual(await (await fetch(b.url + "/api/features")).json(), {
      likes: true,
      editing: true,
      pagination: true,
    });
    const request = (path: string, method: string, user: string, body: any) =>
      fetch(b.url + path, {
        method,
        headers: { "x-demo-user": user, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await request("/api/posts/repair/likes", "POST", "maya", {})).status,
      200,
    );
    const repeated: any = await (
      await request("/api/posts/repair/likes", "POST", "maya", {})
    ).json();
    assert.deepEqual(repeated.likedBy, ["maya"]);
    assert.equal(
      (
        await request("/api/posts/repair", "PATCH", "maya", {
          title: "Not my notice",
        })
      ).status,
      403,
    );
    const edited = await request("/api/posts/repair", "PATCH", "lina", {
      title: "  Repair café starts at ten  ",
    });
    assert.equal(edited.status, 200);
    assert.equal(
      ((await edited.json()) as any).title,
      "Repair café starts at ten",
    );
    const list = (await (
      await fetch(b.url + "/api/posts?offset=0&limit=2")
    ).json()) as any[];
    assert.equal(list.length, 2);
    for (const params of [
      "offset=NaN&limit=2",
      "offset=0&limit=1.5",
      "offset=-1&limit=2",
    ])
      assert.equal((await fetch(b.url + "/api/posts?" + params)).status, 400);
    const malicious = await request("/api/posts", "POST", "maya", {
      title: "<script>alert(1)</script>",
    });
    assert.equal(malicious.status, 201);
    // UI uses textContent for titles, rather than injecting API content as HTML.
    const script = await (await fetch(b.url + "/app.js")).text();
    assert.match(script, /title.textContent = post.title/);
    assert.doesNotMatch(script, /innerHTML/);
  } finally {
    await close(b.server);
    rmSync(b.dir, { recursive: true, force: true });
  }
});
