import { findPackage } from "../../src/packages.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash } from "node:crypto";
import { Miniflare } from "miniflare";
const token = "a".repeat(64);
function fixture(
  options: {
    existing?: boolean;
    installed?: boolean;
    createStatus?: number;
    loseCreateResponse?: boolean;
  } = {},
) {
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ format: "pem", type: "pkcs8" })
    .toString();
  const files = new Map<string, Record<string, string>>(),
    commits = new Map<string, any>(),
    blobs = new Map<string, string>(),
    refs = new Map<string, string>();
  let seq = 0,
    commentSequence = 0,
    number = 0,
    created = !!options.existing,
    createCalls = 0;
  const issues: any[] = [],
    prs: any[] = [],
    milestones: any[] = [],
    comments = new Map<number, any[]>();
  const sha = () => createHash("sha1").update(String(++seq)).digest("hex");
  function record(content: Record<string, string>, parents: string[] = []) {
    const tree = sha(),
      id = sha();
    files.set(tree, { ...content });
    commits.set(id, {
      sha: id,
      tree: { sha: tree },
      parents: parents.map((sha) => ({ sha })),
    });
    return id;
  }
  refs.set("main", record({ "README.md": "# sim-forum\n" }));
  const repo = () => ({
    id: 2,
    name: "sim-forum",
    owner: { id: 3, login: "player" },
    default_branch: "main",
    html_url: "https://github.com/player/sim-forum",
    description: options.existing ? "An unrelated repository" : description,
    created_at: new Date().toISOString(),
    archived: false,
    disabled: false,
  });
  let description = "";
  const outbound = async (request: any) => {
    const url = new URL(request.url),
      path = decodeURIComponent(url.pathname),
      method = request.method;
    const body = ["POST", "PUT", "PATCH"].includes(method)
      ? await request.json()
      : {};
    const response = (data: any, status = 200) =>
      Response.json(data, { status }) as any;
    if (url.hostname === "github.com" && path === "/login/oauth/access_token") {
      assert.ok(body.code_verifier);
      return response({ access_token: "fixture-user-token", expires_in: 3600 });
    }
    if (path === "/user")
      return response({ id: 3, login: "player", type: "User" });
    if (path === "/user/installations")
      return response({
        installations:
          options.installed === false
            ? []
            : [{ id: 1, app_id: 123, account: { id: 3 }, suspended_at: null }],
      });
    if (path === "/app/installations/1/access_tokens")
      return response({
        token: "fixture-installation-token",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      });
    if (path === "/user/repos" && method === "POST") {
      createCalls++;
      if (options.createStatus)
        return response({ message: "Denied" }, options.createStatus);
      created = true;
      description = body.description;
      assert.equal(body.private, true);
      assert.equal(body.auto_init, true);
      if (options.loseCreateResponse) {
        options.loseCreateResponse = false;
        return response({ message: "Lost response" }, 503);
      }
      return response(repo(), 201);
    }
    if (!path.startsWith("/repos/player/sim-forum"))
      return response({ message: "Unexpected fixture request" }, 404);
    if (!created) return response({ message: "Not found" }, 404);
    const p = path.slice("/repos/player/sim-forum".length);
    if (!p && method === "GET") return response(repo());
    if (p.startsWith("/git/ref/heads/") && method === "GET") {
      const id = refs.get(p.slice(15));
      return id
        ? response({ object: { sha: id } })
        : response({ message: "Missing ref" }, 404);
    }
    if (p === "/git/refs" && method === "POST") {
      const branch = body.ref.replace("refs/heads/", "");
      if (refs.has(branch)) return response({ message: "exists" }, 422);
      refs.set(branch, body.sha);
      return response({ object: { sha: body.sha } }, 201);
    }
    if (p.startsWith("/git/refs/heads/") && method === "PATCH") {
      refs.set(p.slice(16), body.sha);
      return response({ object: { sha: body.sha } });
    }
    if (p.startsWith("/git/commits/") && method === "GET")
      return response(commits.get(p.split("/").at(-1)!));
    if (p === "/git/trees" && method === "POST") {
      const tree = { ...files.get(body.base_tree) };
      for (const entry of body.tree) {
        if (entry.sha === null) delete tree[entry.path];
        else tree[entry.path] = entry.content ?? blobs.get(entry.sha)!;
      }
      const id = sha();
      files.set(id, tree);
      return response({ sha: id }, 201);
    }
    if (p === "/git/commits" && method === "POST") {
      const id = sha();
      commits.set(id, {
        sha: id,
        tree: { sha: body.tree },
        parents: body.parents.map((sha: string) => ({ sha })),
      });
      return response({ sha: id }, 201);
    }
    if (p.startsWith("/git/trees/") && method === "GET") {
      const tree =
        files.get(p.split("/").at(-1)!) ??
        files.get(commits.get(p.split("/").at(-1)!)?.tree.sha);
      assert.ok(tree, "tree exists");
      return response({
        truncated: false,
        tree: Object.entries(tree).map(([path, content]) => {
          const id = createHash("sha1").update(content).digest("hex");
          blobs.set(id, content);
          return { path, mode: "100644", type: "blob", sha: id };
        }),
      });
    }
    if (p.startsWith("/git/blobs/") && method === "GET") {
      const content = blobs.get(p.split("/").at(-1)!)!;
      return response({
        size: Buffer.byteLength(content),
        content: Buffer.from(content).toString("base64"),
      });
    }
    if (p === "/issues" && method === "GET")
      return response([...issues, ...prs]);
    if (p === "/issues" && method === "POST") {
      const issue = { ...body, number: ++number };
      issues.push(issue);
      return response(issue, 201);
    }
    if (/^\/issues\/\d+$/.test(p) && method === "PATCH") {
      const issue = issues.find(
        (x) => x.number === Number(p.split("/").at(-1)),
      );
      Object.assign(issue, body);
      return response(issue);
    }
    if (/^\/issues\/\d+\/comments$/.test(p)) {
      const number = Number(p.split("/")[2]),
        list = comments.get(number) ?? [];
      if (method === "POST") {
        list.push({ ...body, id: ++commentSequence, user: { type: "Bot" } });
        comments.set(number, list);
        return response(list.at(-1), 201);
      }
      return response(list);
    }
    if (p === "/milestones") {
      if (method === "GET") return response(milestones);
      const m = { ...body, number: milestones.length + 1 };
      milestones.push(m);
      return response(m, 201);
    }
    if (p === "/pulls" && method === "GET") return response(prs);
    if (p === "/pulls" && method === "POST") {
      const pr = {
        ...body,
        number: ++number,
        state: "open",
        merged: false,
        head: { sha: refs.get(body.head), ref: body.head, repo: { id: 2 } },
        base: { ref: body.base },
      };
      prs.push(pr);
      return response(pr, 201);
    }
    if (/^\/pulls\/\d+$/.test(p))
      return response(
        prs.find((x) => x.number === Number(p.split("/").at(-1))),
      );
    if (/^\/pulls\/\d+\/(reviews|comments)$/.test(p)) return response([]);
    return response({ message: "Unhandled " + method + " " + p }, 404);
  };
  const mf = new Miniflare({
    modules: true,
    scriptPath: "var/worker-build/worker.js",
    assets: { directory: "public", routerConfig: { has_user_worker: true } },
    compatibilityDate: "2026-01-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      GAMES: { className: "GameSession", useSQLite: true },
      BUDGET: { className: "AIBudget", useSQLite: true },
      LAUNCHES: { className: "LaunchSession", useSQLite: true },
    },
    bindings: {
      ADMIN_TOKEN: token,
      WEBHOOK_SECRET: "secret",
      GITHUB_APP_ID: "123",
      GITHUB_PRIVATE_KEY: key,
      GITHUB_CLIENT_ID: "fixture-client",
      GITHUB_CLIENT_SECRET: "fixture-client-secret",
      PUBLIC_ORIGIN: "https://app",
      JUDGE_ENABLED: "false",
      JUDGE_INPUT_USD_PER_MILLION: "0.042",
      AI_DAILY_BUDGET_USD: "1",
      JUDGE_CONFIDENCE_THRESHOLD: "0.9",
    },
    outboundService: outbound,
  });
  return { mf, options, issues, prs, createCalls: () => createCalls };
}
async function login(mf: Miniflare) {
  const start = await mf.dispatchFetch("https://app/auth/start", {
    redirect: "manual",
  });
  assert.equal(start.status, 302);
  const cookie = start.headers.get("set-cookie")!.split(";")[0],
    location = new URL(start.headers.get("location")!);
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.ok(start.headers.get("set-cookie")!.includes("HttpOnly"));
  const callback =
    "https://app/auth/callback?code=fixture-code&state=" +
    location.searchParams.get("state");
  const done = await mf.dispatchFetch(callback, {
    headers: { cookie },
    redirect: "manual",
  });
  assert.equal(done.status, 302);
  const replay = await mf.dispatchFetch(callback, {
    headers: { cookie },
    redirect: "manual",
  });
  assert.equal(replay.status, 400);
  const session = (await (
    await mf.dispatchFetch("https://app/api/session", { headers: { cookie } })
  ).json()) as any;
  assert.equal(session.user.id, 3);
  assert.ok(session.csrf);
  assert.equal(JSON.stringify(session).includes("fixture-user-token"), false);
  return { cookie, csrf: session.csrf };
}
async function waitJob(
  mf: Miniflare,
  cookie: string,
  predicate: (job: any) => boolean,
) {
  for (let n = 0; n < 160; n++) {
    const job = (await (
      await mf.dispatchFetch("https://app/api/launch/status", {
        headers: { cookie },
      })
    ).json()) as any;
    if (predicate(job)) return job;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Launch did not settle");
}
test("launch page exposes public catalog only and rejects unauthenticated writes", async () => {
  const { mf } = fixture();
  try {
    const html = await mf.dispatchFetch("https://app/");
    assert.equal(html.status, 200);
    const markup = await html.text();
    assert.match(markup, /Someone has to/);
    assert.match(markup, /src="\/app\.js"/);
    assert.match(markup, /href="\/style\.css"/);
    assert.ok(!markup.includes("<style>"));
    assert.ok(!markup.includes("<script>"));
    assert.match(
      html.headers.get("content-security-policy") ?? "",
      /style-src 'self';/,
    );
    for (const [path, type] of [
      ["/app.js", "javascript"],
      ["/style.css", "css"],
    ]) {
      const asset = await mf.dispatchFetch("https://app" + path);
      assert.equal(asset.status, 200);
      assert.ok(asset.headers.get("content-type")?.includes(type));
      assert.equal(asset.headers.get("x-content-type-options"), "nosniff");
      assert.equal(asset.headers.get("cache-control"), "no-cache");
      assert.ok((await asset.text()).length > 100);
    }
    assert.equal(
      (await mf.dispatchFetch("https://app/missing.js")).status,
      404,
    );
    assert.equal(
      (
        await mf.dispatchFetch("https://app/api/missing", {
          headers: { "sec-fetch-mode": "navigate" },
        })
      ).status,
      404,
    );
    const catalog = (await (
      await mf.dispatchFetch("https://app/api/scenarios")
    ).json()) as any[];
    assert.equal(catalog[0].id, "forum");
    assert.equal(catalog[0].version, "0.1.1");
    assert.equal(catalog.length, 1);
    for (const version of ["0.1.0", "0.1.1"]) {
      const pack = findPackage("forum", version);
      const portrait = await mf.dispatchFetch(
        `https://app/portraits/${pack.digest}/maya.svg`,
      );
      assert.equal(portrait.status, 200, "Portrait retained for " + version);
      assert.match(portrait.headers.get("content-type") ?? "", /image\/svg/);
    }
    assert.equal(JSON.stringify(catalog).includes("concern"), false);
    assert.equal(
      (
        await mf.dispatchFetch("https://app/api/launch", {
          method: "POST",
          body: "{}",
        })
      ).status,
      401,
    );
  } finally {
    await mf.dispose();
  }
});
test("OAuth state and PKCE are one-use and launch requires same-origin CSRF", async () => {
  const { mf } = fixture();
  try {
    const { cookie, csrf } = await login(mf);
    const cross = await mf.dispatchFetch("https://app/api/launch", {
      method: "POST",
      headers: { cookie, origin: "https://evil.invalid", "x-csrf-token": csrf },
      body: "{}",
    });
    assert.equal(cross.status, 403);
    const missing = await mf.dispatchFetch("https://app/api/launch", {
      method: "POST",
      headers: { cookie, origin: "https://app" },
      body: "{}",
    });
    assert.equal(missing.status, 403);
  } finally {
    await mf.dispose();
  }
});
test("launch creates one clean player repository and seeds ten package-selected PRs", async () => {
  const fixtureState = fixture(),
    { mf, issues, prs } = fixtureState;
  try {
    const { cookie, csrf } = await login(mf),
      headers = {
        cookie,
        origin: "https://app",
        "x-csrf-token": csrf,
        "content-type": "application/json",
      };
    const body = JSON.stringify({
      scenario: "forum",
      version: "0.1.1",
      name: "sim-forum",
      private: true,
    });
    const responses = await Promise.all([
      mf.dispatchFetch("https://app/api/launch", {
        method: "POST",
        headers,
        body,
      }),
      mf.dispatchFetch("https://app/api/launch", {
        method: "POST",
        headers,
        body,
      }),
    ]);
    assert.ok(responses.every((r) => r.status === 202));
    const job = await waitJob(mf, cookie, (j) =>
      ["ready", "failed"].includes(j.state),
    );
    assert.equal(job.state, "ready", JSON.stringify(job));
    assert.equal(fixtureState.createCalls(), 1);
    assert.equal(prs.length, 10);
    assert.equal(issues[0].number, 1);
    assert.match(issues[0].body, /group chat/);
    assert.ok(prs.some((p) => p.body.includes("/portraits/")));
    const status = (await (
      await mf.dispatchFetch("https://app/admin/status?installation=1", {
        headers: { Authorization: "Bearer " + token },
      })
    ).json()) as any[];
    assert.equal(status[0].scenario.id, "forum");
    assert.equal(status[0].phase, "active");
    assert.ok(
      !Object.keys(status[0].baselineFiles).some((p) =>
        p.includes("__scenario__"),
      ),
    );
  } finally {
    await mf.dispose();
  }
});
test("existing repository names are refused without any creation or seeding", async () => {
  const f = fixture({ existing: true });
  try {
    const { cookie, csrf } = await login(f.mf);
    await f.mf.dispatchFetch("https://app/api/launch", {
      method: "POST",
      headers: { cookie, origin: "https://app", "x-csrf-token": csrf },
      body: JSON.stringify({
        scenario: "forum",
        version: "0.1.1",
        name: "sim-forum",
        private: true,
      }),
    });
    const job = await waitJob(f.mf, cookie, (j) => j.state === "failed");
    assert.match(job.message, /name/);
    assert.equal(f.createCalls(), 0);
    assert.equal(f.prs.length, 0);
  } finally {
    await f.mf.dispose();
  }
});
test("missing installation is actionable before any repository is created", async () => {
  const f = fixture({ installed: false });
  try {
    const { cookie, csrf } = await login(f.mf);
    await f.mf.dispatchFetch("https://app/api/launch", {
      method: "POST",
      headers: { cookie, origin: "https://app", "x-csrf-token": csrf },
      body: JSON.stringify({
        scenario: "forum",
        version: "0.1.1",
        name: "sim-forum",
        private: true,
      }),
    });
    const job = await waitJob(
      f.mf,
      cookie,
      (j) => j.state === "waiting-access",
    );
    assert.equal(f.createCalls(), 0);
    assert.match(job.message, /personal GitHub account/);
    assert.ok(job.installUrl);
  } finally {
    await f.mf.dispose();
  }
});

test("definitive create denial can be retried after permission is corrected", async () => {
  const f = fixture({ createStatus: 403 });
  try {
    const { cookie, csrf } = await login(f.mf),
      headers = { cookie, origin: "https://app", "x-csrf-token": csrf };
    await f.mf.dispatchFetch("https://app/api/launch", {
      method: "POST",
      headers,
      body: JSON.stringify({
        scenario: "forum",
        version: "0.1.1",
        name: "sim-forum",
        private: true,
      }),
    });
    await waitJob(f.mf, cookie, (j) => j.state === "failed");
    assert.equal(f.createCalls(), 1);
    f.options.createStatus = undefined;
    await f.mf.dispatchFetch("https://app/api/launch/retry", {
      method: "POST",
      headers,
      body: "{}",
    });
    const job = await waitJob(f.mf, cookie, (j) =>
      ["ready", "failed"].includes(j.state),
    );
    assert.equal(job.state, "ready");
    assert.equal(f.createCalls(), 2);
  } finally {
    await f.mf.dispose();
  }
});
test("a lost creation response recovers the marked repository without duplicate creation", async () => {
  const f = fixture({ loseCreateResponse: true });
  try {
    const { cookie, csrf } = await login(f.mf),
      headers = { cookie, origin: "https://app", "x-csrf-token": csrf };
    await f.mf.dispatchFetch("https://app/api/launch", {
      method: "POST",
      headers,
      body: JSON.stringify({
        scenario: "forum",
        version: "0.1.1",
        name: "sim-forum",
        private: true,
      }),
    });
    const job = await waitJob(f.mf, cookie, (j) =>
      ["ready", "failed"].includes(j.state),
    );
    assert.equal(job.state, "ready");
    assert.equal(f.createCalls(), 1);
  } finally {
    await f.mf.dispose();
  }
});
test("daily launch quota cannot be bypassed through retry", async () => {
  const f = fixture();
  try {
    const { cookie, csrf } = await login(f.mf),
      headers = { cookie, origin: "https://app", "x-csrf-token": csrf };
    const ns = await f.mf.getDurableObjectNamespace("LAUNCHES"),
      quota = ns.get(ns.idFromName("quota:3"));
    for (let n = 0; n < 5; n++)
      assert.equal(
        (
          await quota.fetch("https://session/quota", {
            method: "POST",
            body: JSON.stringify({ id: "used-" + n }),
          })
        ).status,
        200,
      );
    assert.equal(
      (
        await f.mf.dispatchFetch("https://app/api/launch", {
          method: "POST",
          headers,
          body: JSON.stringify({
            scenario: "forum",
            version: "0.1.1",
            name: "sim-forum",
            private: true,
          }),
        })
      ).status,
      429,
    );
    assert.equal(
      (
        await f.mf.dispatchFetch("https://app/api/launch/retry", {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
      429,
    );
    assert.equal(f.createCalls(), 0);
  } finally {
    await f.mf.dispose();
  }
});
