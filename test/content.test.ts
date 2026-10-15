import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { baseline, proposals } from "../src/scenario.ts";
test("authored sound implementations satisfy observable milestone requirements", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scenario-"));
  try {
    const files = { ...baseline };
    for (const p of proposals) Object.assign(files, p.variants.at(-1)!.files);
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), body);
    }
    const load = (file: string) =>
      import(pathToFileURL(join(dir, "src", file)).href);
    const { like } = await load("likes.ts"),
      { edit } = await load("edit.ts"),
      { page } = await load("page.ts"),
      { newest } = await load("sort.ts");
    const post = {
      id: "1",
      ownerId: "owner",
      title: "hello",
      likedBy: [],
      updatedAt: 1,
    };
    const liked = like(post, "alice");
    assert.equal(like(liked, "alice").likedBy.length, 1);
    assert.equal(post.likedBy.length, 0);
    assert.throws(() => edit(post, "other", "bad"), /Forbidden/);
    assert.equal(edit(post, "owner", "new").title, "new");
    assert.equal(post.title, "hello");
    assert.deepEqual(page([1, 2, 3, 4], 1, 2), [2, 3]);
    for (const [offset, limit] of [
      [-1, 1],
      [0, 0],
      [0, 51],
      [0.5, 1],
      [0, 1.5],
      [NaN, 2],
      [0, NaN],
      [Infinity, 2],
    ])
      assert.throws(() => page([], offset, limit));
    const posts = [post, { ...post, id: "2", updatedAt: 2 }];
    assert.equal(newest(posts)[0].id, "2");
    assert.equal(posts[0].id, "1");
    const tied = [
      { ...post, id: "b" },
      { ...post, id: "a" },
    ];
    assert.deepEqual(
      newest(tied).map((p: { id: string }) => p.id),
      ["a", "b"],
    );
    const initialPage = proposals.find((p) => p.id === "d")!.variants[0].files[
      "src/page.ts"
    ];
    writeFileSync(join(dir, "src", "initial-page.ts"), initialPage);
    const flawed = await load("initial-page.ts");
    assert.doesNotThrow(() => flawed.page([1, 2, 3], NaN, 2));
    assert.doesNotThrow(() => flawed.page([1, 2, 3], 0, 1.5));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
