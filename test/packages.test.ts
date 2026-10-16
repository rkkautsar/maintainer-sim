import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { catalog, findPackage, packageScope } from "../src/packages.ts";
import { milestonePackage, packages } from "./fixtures/packages.ts";
import {
  GitHubPackageRegistry,
  publicRequest,
  validatePackage,
} from "../src/package-registry.ts";

test("public package requests survive an unavailable edge cache", async () => {
  let sourceRequests = 0;
  const edge = {
    async match() {
      throw new Error("Cache unavailable");
    },
    async put() {
      throw new Error("Cache unavailable");
    },
  } as unknown as Cache;

  const response = await publicRequest(
    "https://api.github.com/repos/example/scenario",
    undefined,
    edge,
    async () => {
      sourceRequests++;
      return Response.json({ private: false });
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { private: false });
  assert.equal(sourceRequests, 1);
});

test("package lookups stay isolated across concurrent async scopes", async () => {
  const observed = await Promise.all(
    packages.map((pack) =>
      packageScope.run([pack], async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        assert.equal(findPackage("forum").version, pack.version);
        assert.equal(catalog()[0].version, pack.version);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return findPackage("forum", pack.version).digest;
      }),
    ),
  );
  assert.deepEqual(
    observed,
    packages.map((pack) => pack.digest),
  );
  assert.deepEqual(packageScope.run([], catalog), []);
  assert.throws(() => packageScope.run([], () => findPackage("forum")));
});

test("milestone packages require a seeded protected workflow and empty prepared work", () => {
  const { digest: _fixtureDigest, ...content } = milestonePackage;
  const pack = {
    ...content,
    digest: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
  };
  assert.equal(validatePackage(pack).stages[0].mode, "milestone");
  assert.throws(
    () =>
      validatePackage({
        ...pack,
        stages: [
          {
            ...pack.stages[0],
            workflowPath: ".github/workflows/untrusted.yml",
          },
        ],
      }),
    /Invalid milestone stage configuration/,
  );
});

test("a cold registry resolves a persisted pinned package without source credentials", async () => {
  const pack = packages[0];
  const registry = new GitHubPackageRegistry({
    GITHUB_APP_ID: "not-used",
    GITHUB_PRIVATE_KEY: "not-used",
  });
  const storage = {
    async get<T>(key: string) {
      assert.equal(key, `scenario:${pack.digest}`);
      return structuredClone(pack) as T;
    },
    async put() {
      throw new Error("No write is needed for a cached package");
    },
  };
  const selection = { id: pack.id, version: pack.version, digest: pack.digest };
  assert.equal((await registry.pinned(selection, storage)).digest, pack.digest);
  await assert.rejects(
    registry.pinned({ ...selection, version: "9.9.9" }, storage),
    /identity mismatch/,
  );
});
