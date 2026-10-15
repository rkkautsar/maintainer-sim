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
function runtime(extra: any = {}) {
  return new Miniflare({
    modules: true,
    scriptPath: "var/worker-build/worker.js",
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
      GITHUB_PRIVATE_KEY: "invalid-test-key",
      JUDGE_ENABLED: "false",
      JUDGE_INPUT_USD_PER_MILLION: "31.25",
      AI_DAILY_BUDGET_USD: "2",
      JUDGE_CONFIDENCE_THRESHOLD: "0.9",
    },
    outboundService: async () =>
      new Response("External calls disabled", { status: 503 }) as any,
    ...extra,
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
      JUDGE_ENABLED: "false",
      JUDGE_INPUT_USD_PER_MILLION: "0.042",
      AI_DAILY_BUDGET_USD: "1",
      JUDGE_CONFIDENCE_THRESHOLD: "0.9",
    },
    outboundService: async (request: any) => {
      if (
        new URL(request.url).pathname === "/app/installations/1/access_tokens"
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
        return Response.json({
          token: "fixture-installation-token",
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        }) as any;
      }
      return new Response("Fixture denies all other GitHub calls", {
        status: 503,
      }) as any;
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
