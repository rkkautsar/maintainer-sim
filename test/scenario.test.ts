import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { findPackage, selectScenario, applyVariant } from "../src/packages.ts";
import { initialRun, assess } from "../src/engine.ts";
import { publishScenario, savePackage } from "../src/authoring.ts";
const pack = findPackage("forum", "0.1.0"),
  stage = pack.stages[0];
function exportFiles(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "forum-evidence-"));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  return dir;
}
async function exercise(
  id: string,
  revision: number,
  fn: (request: (path: string, opts?: any) => Promise<any>) => Promise<void>,
  stageId = "launch",
) {
  const selected = pack.stages.find((s) => s.id === stageId)!;
  const p = selected.proposals.find((p) => p.id === id)!,
    dir = exportFiles(
      applyVariant({ ...selected.baseline }, p.variants[revision]),
    );
  const { createForum } = await import(
    pathToFileURL(join(dir, "src/server.ts")).href
  );
  const server = await createForum(":memory:");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    await fn(async (path, opts = {}) => {
      const response = await fetch(
        "http://127.0.0.1:" + server.address().port + path,
        {
          ...opts,
          headers: {
            "content-type": "application/json",
            "x-demo-user": "maya",
            ...opts.headers,
          },
        },
      );
      return { status: response.status, data: await response.json() };
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
}
test("every published launch revision runs with its contributed tests", () => {
  for (const p of stage.proposals)
    for (const v of p.variants) {
      const dir = exportFiles(applyVariant({ ...stage.baseline }, v));
      try {
        execFileSync(
          process.execPath,
          [
            "--test",
            ...Object.keys(v.files)
              .filter((p) => /^test\/.*\.test\.ts$/.test(p))
              .map((p) => join(dir, p)),
            join(dir, "test/api.test.ts"),
          ],
          { cwd: dir, timeout: 15000, stdio: "pipe" },
        );
      } catch (error: any) {
        throw Error(
          p.id + ": " + error.stdout?.toString() + error.stderr?.toString(),
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
});
test("ownership witness distinguishes submitted and fixed endpoint", async () => {
  for (const rev of [0, 1])
    await exercise("comment-edit", rev, async (request) => {
      const response = await request("/api/comments/1", {
        method: "PATCH",
        headers: { "x-demo-user": "sam" },
        body: JSON.stringify({
          authorId: "sam",
          body: "Changed by another member",
        }),
      });
      assert.equal(response.status, rev ? 403 : 200);
    });
});
test("pagination witness rejects NaN and fractions only after revision", async () => {
  for (const rev of [0, 1])
    await exercise("pagination", rev, async (request) => {
      for (const query of ["offset=NaN", "limit=1.5"])
        assert.equal(
          (await request("/api/posts?" + query)).status,
          rev ? 400 : 200,
        );
    });
});
test("personal saved-list witness catches missing user scope", async () => {
  for (const rev of [0, 1])
    await exercise("bookmarks", rev, async (request) => {
      await request("/api/posts/1/bookmark", { method: "POST" });
      const response = await request("/api/posts?saved=1", {
        headers: { "x-demo-user": "sam" },
      });
      assert.equal(response.data.length, rev ? 0 : 1);
    });
});
test("literal-search witness catches regex semantics", async () => {
  for (const rev of [0, 1])
    await exercise("search-regex", rev, async (request) =>
      assert.equal((await request("/api/posts?q=%5B")).status, rev ? 200 : 400),
    );
});
test("forum outcome scoring is driven by the selected package", () => {
  const run = initialRun({
    id: "forum-test",
    installation: 1,
    repository: 2,
    owner: "a",
    repo: "b",
    player: 3,
    scenario: selectScenario(pack),
  });
  for (const [n, p] of stage.proposals.entries())
    run.prs[p.id] = {
      number: n + 1,
      revision: p.variants.length - 1,
      outcome: ["voting-framework", "search-regex"].includes(p.id)
        ? "closed"
        : "merged",
      head: "fixture",
      reviews: [],
    };
  const score = assess(run);
  assert.equal(score.complete.length, 5);
  assert.equal(score.points, 20);
  assert.equal(score.success, true);
});
test("published package never includes annotations in player snapshots", () => {
  for (const s of pack.stages) {
    assert.ok(s.baseline["src/server.ts"]);
    assert.ok(
      Object.keys(s.baseline).every((p) => !p.includes("__scenario__")),
    );
    for (const p of s.proposals)
      for (const v of p.variants)
        assert.ok(
          Object.keys(v.files).every((p) => !p.includes("__scenario__")),
        );
  }
});
test("publisher validates real refs, deletions and immutable release versions", () => {
  const repo = mkdtempSync(join(tmpdir(), "author-repo-")),
    dest = mkdtempSync(join(tmpdir(), "package-version-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  };
  try {
    git("init", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    write("src/value.ts", "export const value=0;");
    write("obsolete.ts", "old");
    git("add", ".");
    git("commit", "-m", "Base");
    git("branch", "stage/launch/base");
    rmSync(join(repo, "obsolete.ts"));
    write("src/value.ts", "export const value=1;");
    git("add", ".");
    git("commit", "-m", "Initial");
    git("branch", "stage/launch/example/initial");
    write(
      "__scenario__/scenario.yaml",
      "schema: 1\nid: example\nversion: 0.1.0\ntitle: Example\ndescription: Example scenario\ncharacters:\n  sam:\n    name: Sam\n    role: Contributor\nstages: [launch]\n",
    );
    write(
      "__scenario__/characters/sam.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"><circle r="20" /></svg>',
    );
    write(
      "__scenario__/stages/launch/stage.md",
      "---\ntitle: Launch\nendings:\n  success: Ready\n  incomplete: Missing work\n  partial: Needs a check\n---\nA community needs this release.",
    );
    write(
      "__scenario__/stages/launch/issues/value.md",
      "---\nid: value\ntitle: Set the value\n---\nThe value should be one.",
    );
    write(
      "__scenario__/stages/launch/prs/example.md",
      "---\nid: example\ntitle: Set the value\ncharacter: sam\nissue: value\nrevisions: 0\nassessment:\n  initial:\n    sound: true\n    explanation: Meets the requirement\n---\nHere is the change.\n\n<!-- debrief -->\n\nTrace the requirement.",
    );
    const fresh = publishScenario(repo);
    assert.deepEqual(fresh.stages[0].proposals[0].variants[0].deletes, [
      "obsolete.ts",
    ]);
    assert.ok(
      !Object.keys(fresh.stages[0].baseline).some((p) =>
        p.includes("__scenario__"),
      ),
    );
    savePackage(fresh, dest);
    savePackage(fresh, dest);
    assert.throws(
      () => savePackage({ ...fresh, title: "Mutated" }, dest),
      /immutable/,
    );
    git("branch", "-D", "stage/launch/example/initial");
    assert.throws(() => publishScenario(repo));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  }
});

test("notification witness scopes activity to the current thread owner", async () => {
  for (const rev of [0, 1])
    await exercise(
      "notifications",
      rev,
      async (request) => {
        const response = await request("/api/notifications", {
          headers: { "x-demo-user": "sam" },
        });
        assert.equal(response.status, 200);
        assert.equal(response.data.length, rev ? 0 : 1);
      },
      "growing",
    );
});
