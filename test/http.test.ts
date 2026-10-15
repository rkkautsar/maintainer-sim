import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import { Game } from "../src/game.ts";
import { server } from "../src/server.ts";
test("HTTP endpoint rejects unsigned data, accepts signed duplicates once", async () => {
  const s = new Store(":memory:"),
    http = server(s, new Game(s), "secret");
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address() as { port: number },
    url = "http://127.0.0.1:" + address.port + "/webhooks",
    body = JSON.stringify({ installation: { id: 9 }, repository: { id: 10 } });
  const headers = {
    "x-github-delivery": "one",
    "x-github-event": "push",
    "x-hub-signature-256":
      "sha256=" + createHmac("sha256", "secret").update(body).digest("hex"),
  };
  try {
    assert.equal((await fetch(url, { method: "POST", body })).status, 401);
    assert.equal(
      (await fetch(url, { method: "POST", headers, body })).status,
      202,
    );
    assert.equal(
      (await fetch(url, { method: "POST", headers, body })).status,
      202,
    );
    assert.equal(
      (
        s.db.prepare("SELECT COUNT(*) AS n FROM deliveries").get() as {
          n: number;
        }
      ).n,
      1,
    );
    assert.equal(
      (await fetch(url.replace("/webhooks", "/health"))).status,
      200,
    );
  } finally {
    await new Promise<void>((resolve) => http.close(() => resolve()));
    s.close();
  }
});
test("queue survives database close and reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "maintainer-"));
  const path = join(dir, "game.sqlite");
  try {
    const s = new Store(path);
    s.enqueue("one", "push", "{}");
    s.close();
    const reopened = new Store(path);
    assert.equal(
      (
        reopened.db
          .prepare("SELECT status FROM deliveries WHERE id=?")
          .get("one") as { status: string }
      ).status,
      "pending",
    );
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
