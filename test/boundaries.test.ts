import assert from "node:assert/strict";
import test from "node:test";
import { GitHub } from "../src/github.ts";
import { parseWebhook } from "../src/webhooks.ts";

class MockGitHub extends GitHub {
  private readonly responses: Record<string, unknown>;
  private readonly lists: Record<string, unknown[]>;

  constructor(
    responses: Record<string, unknown> = {},
    lists: Record<string, unknown[]> = {},
  ) {
    super("test-token-that-is-not-a-real-secret");
    this.responses = responses;
    this.lists = lists;
  }

  override async get(path: string): Promise<unknown> {
    return this.responses[path];
  }

  override async list(path: string): Promise<unknown[]> {
    return this.lists[path] ?? [];
  }
}

test("webhook boundary validates identifiers and nested fields", () => {
  for (const input of [
    { installation: { id: "12" } },
    { installation: { id: -1 } },
    { installation: { id: 12 }, repository: { id: "34" } },
    { installation: { id: 12 }, issue: { number: -4 } },
    {
      installation: { id: 12 },
      comment: { body: "hello", user: { id: "56" } },
    },
  ]) {
    assert.throws(() => parseWebhook(input), /Invalid boundary data/);
  }
});

test("webhook boundary accepts partial event data and drops unrelated payload fields", () => {
  const parsed = parseWebhook({
    installation: { id: 12, token: "private" },
    repository: { id: 34, name: "example" },
    action: "opened",
    pull_request: { number: 56, title: "Example" },
    sender: { id: 78, login: "maintainer" },
    credential: "must not escape the schema",
  });

  assert.deepEqual(parsed, {
    installation: { id: 12 },
    repository: { id: 34 },
    action: "opened",
    pull_request: { number: 56 },
  });
});

test("repository and pull wrappers reject malformed API responses", async () => {
  const client = new MockGitHub({
    "/repos/acme/example": {
      id: "101",
      default_branch: "main",
      owner: { id: 202 },
    },
    "/repos/acme/example/pulls/7": {
      number: 7,
      state: "open",
      merged: false,
      head: { sha: "abc", repo: { id: -303 } },
      base: { ref: "main" },
    },
  });

  await assert.rejects(
    client.repository("/repos/acme/example"),
    /Invalid boundary data/,
  );
  await assert.rejects(
    client.pull("/repos/acme/example", 7),
    /Invalid boundary data/,
  );
});

test("review and comment list wrappers reject malformed nested API data", async () => {
  const client = new MockGitHub(
    {},
    {
      "/repos/acme/example/pulls/7/reviews": [
        {
          id: 1,
          body: "Looks good",
          user: { id: "2" },
          state: "APPROVED",
          commit_id: "abc",
        },
      ],
      "/repos/acme/example/issues/7/comments": [
        { id: 3, body: "Comment", user: { id: -4 } },
      ],
    },
  );

  await assert.rejects(
    client.listReviews("/repos/acme/example", 7),
    /Invalid boundary data/,
  );
  await assert.rejects(
    client.listComments("/repos/acme/example/issues/7/comments"),
    /Invalid boundary data/,
  );
});

test("malformed API errors do not expose response bodies or credential fields", async () => {
  const responseBody = "private-response-body-should-not-appear";
  const credential = "ghp_fakecredentialthatmustnotappear";
  const client = new MockGitHub({
    "/repos/acme/example": {
      id: "not-an-id",
      default_branch: "main",
      owner: { id: 2 },
      message: responseBody,
      token: credential,
    },
  });

  await assert.rejects(
    client.repository("/repos/acme/example"),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.match(error.message, /Invalid boundary data/);
      assert.equal(error.message.includes(responseBody), false);
      assert.equal(error.message.includes(credential), false);
      return true;
    },
  );
});
