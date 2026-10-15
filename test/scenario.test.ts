import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishScenario, savePackage } from "../src/authoring.ts";
import { authoringRepository } from "./helpers/authoring.ts";

test("publisher derives a package from real refs and preserves deletions", () => {
  const { repo, git } = authoringRepository();
  try {
    const fresh = publishScenario(repo);
    assert.deepEqual(
      Object.keys(fresh.stages[0].proposals[0].variants[0]).slice(0, 2),
      ["explanation", "sound"],
    );
    assert.deepEqual(fresh.stages[0].proposals[0].variants[0].deletes, [
      "obsolete.ts",
    ]);
    assert.ok(
      !Object.keys(fresh.stages[0].baseline).some((p) =>
        p.includes("__scenario__"),
      ),
    );
    git(
      "update-ref",
      "-d",
      "refs/remotes/origin/review/stage/launch/example/initial",
    );
    assert.throws(() => publishScenario(repo));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("published package versions are immutable", () => {
  const { repo } = authoringRepository();
  const dest = mkdtempSync(join(tmpdir(), "package-version-"));
  try {
    const fresh = publishScenario(repo);
    savePackage(fresh, dest);
    savePackage(fresh, dest);
    assert.throws(
      () => savePackage({ ...fresh, title: "Mutated" }, dest),
      /immutable/,
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  }
});
