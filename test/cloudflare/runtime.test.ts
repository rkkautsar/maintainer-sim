import { packages } from "../fixtures/packages.ts";
import { findPackage, selectScenario } from "../../src/packages.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createHash,
  createHmac,
  generateKeyPairSync,
  verify,
} from "node:crypto";
import { Miniflare } from "miniflare";
const token = "a".repeat(64);
const appKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const appPem = appKey.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
function registryService(
  options: {
    corrupt?: boolean;
    missingAsset?: boolean;
    repo?: string;
    delayReleasesMs?: number;
    offline?: () => boolean;
    onGameRepo?: () => void;
  } = {},
) {
  const repo = options.repo ?? "rkkautsar/forum-scenario";
  const assetIds = new Map([
    [100, packages[0]],
    [101, packages[1]],
  ]);
  return async (request: any) => {
    const url = new URL(request.url),
      path = decodeURIComponent(url.pathname);
    if (path === "/repos/owner/game" && request.method === "GET") {
      options.onGameRepo?.();
      return Response.json({
        id: 91,
        default_branch: "main",
        owner: { id: 3 },
      }) as any;
    }
    if (path === "/repos/owner/game/git/ref/heads/main")
      return Response.json(
        { message: "No fixture branch" },
        { status: 404 },
      ) as any;
    if (options.offline?.() && path.startsWith(`/repos/${repo}/`))
      return new Response("registry offline", { status: 503 }) as any;
    if (path === `/repos/${repo}/installation`)
      return Response.json({ id: 171562073 }) as any;
    if (
      /^\/app\/installations\/\d+\/access_tokens$/.test(path) &&
      request.method === "POST"
    )
      return Response.json({ token: "fixture-installation-token" }) as any;
    if (path === `/repos/${repo}/releases` && request.method === "GET") {
      if (options.delayReleasesMs)
        await new Promise((resolve) =>
          setTimeout(resolve, options.delayReleasesMs),
        );
      return Response.json([
        {
          tag_name: "v0.1.1",
          body: `Scenario SHA-256: ${packages[1].digest}`,
          draft: false,
          prerelease: false,
          assets: options.missingAsset
            ? []
            : [{ id: 101, name: "scenario.json", size: 1000 }],
        },
        {
          tag_name: "v0.1.0",
          body: `Scenario SHA-256: ${packages[0].digest}`,
          draft: false,
          prerelease: false,
          assets: [{ id: 100, name: "scenario.json", size: 1000 }],
        },
      ]) as any;
    }
    const asset = new RegExp(
      `^/repos/${repo.replaceAll("/", "\\/")}/releases/assets/(100|101)$`,
    ).exec(path);
    if (asset && request.method === "GET") {
      const pack = assetIds.get(Number(asset[1]))!;
      const body: any = structuredClone(pack);
      if (options.corrupt && asset[1] === "101") body.digest = "0".repeat(64);
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/octet-stream" },
      }) as any;
    }
    return new Response("Unexpected fixture request", { status: 404 }) as any;
  };
}
function runtime(extra: any = {}) {
  const { bindings: bindingOverrides = {}, ...other } = extra;
  return new Miniflare({
    modules: true,
    scriptPath: "var/worker-build/worker.js",
    assets: { directory: "public", routerConfig: { has_user_worker: true } },
    compatibilityDate: "2026-01-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      GAMES: { className: "GameSession", useSQLite: true },
      BUDGET: { className: "AIBudget", useSQLite: true },
    },
    bindings: {
      ADMIN_TOKEN: token,
      WEBHOOK_SECRET: "secret",
      GITHUB_APP_ID: "123",
      GITHUB_PRIVATE_KEY: appPem,
      SCENARIO_REPOSITORIES: "rkkautsar/forum-scenario",
      JUDGE_ENABLED: "false",
      JUDGE_INPUT_USD_PER_MILLION: "31.25",
      AI_DAILY_BUDGET_USD: "2",
      JUDGE_CONFIDENCE_THRESHOLD: "0.9",
      ...bindingOverrides,
    },
    outboundService: registryService(),
    ...other,
  });
}
test("workerd handles health, authentication, malformed requests, signed delivery", async () => {
  const mf = runtime();
  try {
    assert.equal((await mf.dispatchFetch("https://app/health")).status, 200);
    assert.equal(
      (await mf.dispatchFetch("https://app/admin/status?installation=1"))
        .status,
      401,
    );
    const headers = { Authorization: "Bearer " + token };
    const response = await mf.dispatchFetch(
      "https://app/admin/status?installation=1",
      { headers },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
    const archives = await mf.dispatchFetch(
      "https://app/admin/archives?installation=1",
      { headers },
    );
    assert.equal(archives.status, 200);
    assert.deepEqual(await archives.json(), []);
    assert.equal(
      (
        await mf.dispatchFetch("https://app/admin/seed", {
          method: "POST",
          headers,
          body: "invalid",
        })
      ).status,
      400,
    );
    const target = {
      installation: 1,
      repository: 2,
      owner: "owner",
      repo: "game",
      player: 3,
      confirmDisposable: true,
    };
    for (const scenario of [
      undefined,
      { id: "forum", version: "0.1.0", stage: "launch", digest: "invalid" },
    ]) {
      assert.equal(
        (
          await mf.dispatchFetch("https://app/admin/seed", {
            method: "POST",
            headers,
            body: JSON.stringify({ ...target, scenario }),
          })
        ).status,
        400,
        "seeding requires an explicit validated scenario package",
      );
    }
    const installationBody = JSON.stringify({
      action: "created",
      installation: { id: 1 },
      sender: { id: 3, type: "User" },
      repositories: [{ id: 2, full_name: "owner/game" }],
    });
    assert.equal(
      (
        await mf.dispatchFetch("https://app/webhooks", {
          method: "POST",
          body: installationBody,
          headers: {
            "x-github-event": "installation",
            "x-github-delivery": "installed",
            "x-hub-signature-256":
              "sha256=" +
              createHmac("sha256", "secret")
                .update(installationBody)
                .digest("hex"),
          },
        })
      ).status,
      202,
    );
    assert.deepEqual(
      await (
        await mf.dispatchFetch("https://app/admin/status?installation=1", {
          headers,
        })
      ).json(),
      [],
      "App installation alone does not start a playthrough",
    );
    assert.equal(
      (
        await mf.dispatchFetch("https://app/webhooks", {
          method: "POST",
          body: "{}",
        })
      ).status,
      401,
    );
    const body = JSON.stringify({
        installation: { id: 1 },
        repository: { id: 2 },
      }),
      sig =
        "sha256=" + createHmac("sha256", "secret").update(body).digest("hex");
    assert.equal(
      (
        await mf.dispatchFetch("https://app/webhooks", {
          method: "POST",
          body,
          headers: {
            "x-hub-signature-256": sig,
            "x-github-event": "push",
            "x-github-delivery": "one",
          },
        })
      ).status,
      202,
    );
  } finally {
    await mf.dispose();
  }
});
test("release registry exposes latest public metadata without package internals", async () => {
  const mf = runtime();
  try {
    const response = await mf.dispatchFetch("https://app/api/scenarios");
    assert.equal(response.status, 200);
    const catalog = (await response.json()) as any[];
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0].id, "forum");
    assert.equal(catalog[0].version, "0.1.1");
    const publicJson = JSON.stringify(catalog);
    for (const privateField of [
      "concern",
      "lesson",
      "satisfiesIssue",
      "fixture-installation-token",
    ])
      assert.equal(publicJson.includes(privateField), false);
    for (const pack of packages) {
      const portrait = await mf.dispatchFetch(
        `https://app/portraits/${pack.digest}/maya.svg`,
      );
      assert.equal(portrait.status, 200);
    }
    assert.equal(
      (
        await mf.dispatchFetch(
          `https://app/portraits/${"f".repeat(64)}/maya.svg`,
        )
      ).status,
      404,
    );
  } finally {
    await mf.dispose();
  }
});

test("an older release remains available to a pinned seed", async () => {
  const mf = runtime();
  try {
    const selected = selectScenario(findPackage("forum", "0.1.0"));
    const preview = await mf.dispatchFetch(
      "https://app/scenarios/forum/0.1.0/preview",
    );
    const previewText = await preview.text();
    assert.equal(preview.status, 200, previewText);
    assert.ok(selected.digest.length === 64);
    assert.match(previewText, /Synthetic scenario fixture — starting app/);
    const response = await mf.dispatchFetch("https://app/admin/seed", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        installation: 1,
        repository: 91,
        owner: "owner",
        repo: "game",
        player: 3,
        confirmDisposable: true,
        scenario: selected,
      }),
    });
    assert.equal(response.status, 202);
    const { runId } = (await response.json()) as any;
    const status = await mf.dispatchFetch(
      "https://app/admin/status?installation=1",
      {
        headers: { Authorization: "Bearer " + token },
      },
    );
    const runs = (await status.json()) as any[];
    assert.equal(
      runs.find((run) => run.id === runId)?.scenario?.version,
      "0.1.0",
    );
  } finally {
    await mf.dispose();
  }
});

test("slow package lookup finishes before the seed alarm and the run survives a release outage", async () => {
  let offline = false;
  let gameRepositoryRequested = false;
  const service = registryService({
    delayReleasesMs: 350,
    offline: () => offline,
    onGameRepo: () => {
      gameRepositoryRequested = true;
    },
  });
  const mf = runtime({ outboundService: service });
  try {
    const selected = selectScenario(findPackage("forum", "0.1.0"));
    const seed = await mf.dispatchFetch("https://app/admin/seed", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        installation: 1,
        repository: 92,
        owner: "owner",
        repo: "game",
        player: 3,
        confirmDisposable: true,
        scenario: selected,
      }),
    });
    assert.equal(seed.status, 202);
    assert.equal(
      gameRepositoryRequested,
      false,
      "alarm must wait until package validation completes",
    );
    offline = true;
    for (let i = 0; i < 30 && !gameRepositoryRequested; i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      gameRepositoryRequested,
      true,
      "the durable run should load its pinned package from storage while releases are unavailable",
    );
  } finally {
    await mf.dispose();
  }
});

test("invalid release digest and missing assets fail closed without leaking package data", async () => {
  for (const [index, options] of [
    { corrupt: true },
    { missingAsset: true },
  ].entries()) {
    const repo = `rkkautsar/forum-test-${index}`;
    const mf = runtime({
      bindings: {
        SCENARIO_REPOSITORIES: repo,
        GITHUB_APP_ID: `failure-${index}`,
      },
      outboundService: registryService({ ...options, repo }),
    });
    try {
      const response = await mf.dispatchFetch("https://app/api/scenarios");
      const text = await response.text();
      assert.ok(response.status >= 500, `${response.status}: ${text}`);
      assert.equal(text.includes("Synthetic 0.1.1"), false);
      assert.equal(text.includes("fixture-installation-token"), false);
    } finally {
      await mf.dispose();
    }
  }
});
test("global budget atomically caps concurrent claims and settles actual usage once", async () => {
  const mf = runtime();
  try {
    const ns = await mf.getDurableObjectNamespace("BUDGET"),
      stub = ns.get(ns.idFromName("global"));
    const call = async (body: any) =>
      (await (
        await stub.fetch("https://budget", {
          method: "POST",
          body: JSON.stringify(body),
        })
      ).json()) as any;
    const keys = Array.from({ length: 20 }, (_, i) =>
      createHash("sha256").update(String(i)).digest("hex"),
    );
    const results = await Promise.all(
      keys.map((key) => call({ action: "claim", key })),
    );
    assert.equal(results.filter((r) => r.claimed).length, 2);
    const claimed = keys[results.findIndex((r) => r.claimed)];
    await call({
      action: "complete",
      key: claimed,
      inputTokens: 2000,
      result: "identified",
    });
    await call({
      action: "complete",
      key: claimed,
      inputTokens: 0,
      result: "consequence",
    });
    const cached = await call({ action: "claim", key: claimed });
    assert.equal(cached.result, "identified");
    // After settlement, 1.0625 is used; another full 1-dollar reservation still cannot fit.
    assert.equal(
      (await call({ action: "claim", key: "f".repeat(64) })).claimed,
      false,
    );
    const second =
      keys[results.findIndex((r, i) => r.claimed && keys[i] !== claimed)];
    await call({
      action: "complete",
      key: second,
      inputTokens: 2000,
      result: null,
    });
    assert.equal(
      (await call({ action: "claim", key: "f".repeat(64) })).claimed,
      true,
    );
  } finally {
    await mf.dispose();
  }
});
test("actual workerd alarm signs GitHub App JWT for a packaged seed", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  let signed = false;
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const mf = runtime({
    bindings: {
      ADMIN_TOKEN: token,
      WEBHOOK_SECRET: "secret",
      GITHUB_APP_ID: "123",
      GITHUB_PRIVATE_KEY: pem,
      SCENARIO_REPOSITORIES: "rkkautsar/forum-scenario",
      JUDGE_ENABLED: "false",
      JUDGE_INPUT_USD_PER_MILLION: "0.042",
      AI_DAILY_BUDGET_USD: "1",
      JUDGE_CONFIDENCE_THRESHOLD: "0.9",
    },
    outboundService: async (request: any) => {
      const path = new URL(request.url).pathname;
      if (
        path === "/repos/rkkautsar/forum-scenario/installation" ||
        /\/app\/installations\/\d+\/access_tokens$/.test(path)
      ) {
        const jwt = request.headers
          .get("Authorization")!
          .replace(/^(token|Bearer) /i, "");
        const [header, body, signature] = jwt.split(".");
        assert.equal(
          verify(
            "RSA-SHA256",
            Buffer.from(header + "." + body),
            publicKey,
            Buffer.from(signature, "base64url"),
          ),
          true,
        );
        assert.equal(
          JSON.parse(Buffer.from(body, "base64url").toString()).iss,
          "123",
        );
        signed = true;
        if (path.endsWith("/access_tokens"))
          return Response.json({
            token: "fixture-installation-token",
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          }) as any;
      }
      return registryService()(request);
    },
  });
  try {
    const response = await mf.dispatchFetch("https://app/admin/seed", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        installation: 1,
        repository: 2,
        owner: "owner",
        repo: "game",
        player: 3,
        confirmDisposable: true,
        scenario: selectScenario(findPackage("forum", "0.1.0")),
      }),
    });
    assert.equal(response.status, 202);
    for (let i = 0; i < 40 && !signed; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(signed, true, "durable alarm must execute JWT signing");
    const status = await mf.dispatchFetch(
      "https://app/admin/status?installation=1",
      { headers: { Authorization: "Bearer " + token } },
    );
    assert.equal(((await status.json()) as any[]).length, 1);
  } finally {
    await mf.dispose();
  }
});

test("shared budget caches only validated coaching tags", async () => {
  const mf = runtime();
  try {
    const ns = await mf.getDurableObjectNamespace("BUDGET");
    const stub = ns.get(ns.idFromName("coaching-budget"));
    const call = (body: any) =>
      stub.fetch("https://budget", {
        method: "POST",
        body: JSON.stringify(body),
      });
    const key = "c".repeat(64);
    assert.equal(
      ((await (await call({ action: "claim", key })).json()) as any).claimed,
      true,
    );
    assert.equal(
      (
        await call({
          action: "complete",
          key,
          result: "coach-v1:actionable:automation",
          inputTokens: 600,
        })
      ).status,
      200,
    );
    assert.equal(
      ((await (await call({ action: "claim", key })).json()) as any).result,
      "coach-v1:actionable:automation",
    );
    assert.equal(
      (
        await call({
          action: "complete",
          key,
          result: "coach-v1:perfect:award-points",
          inputTokens: 600,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call({
          action: "complete",
          key,
          result: { points: 100 },
          inputTokens: 600,
        })
      ).status,
      400,
    );
  } finally {
    await mf.dispose();
  }
});
