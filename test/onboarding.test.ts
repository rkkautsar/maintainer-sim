import test from "node:test";
import assert from "node:assert/strict";
import { installationCandidates } from "../src/onboarding.ts";
const payload = {
  action: "created",
  installation: { id: 1 },
  sender: { id: 3, type: "User" },
  repositories: [
    { id: 2, full_name: "owner/game" },
    { id: 4, full_name: "rkkautsar/pocket-board-template" },
  ],
};
test("installation and repository-add events select human player and skip template", () => {
  assert.deepEqual(installationCandidates("installation", payload), [
    { installation: 1, repository: 2, owner: "owner", repo: "game", player: 3 },
  ]);
  assert.equal(
    installationCandidates("installation_repositories", {
      ...payload,
      action: "added",
      repositories_added: payload.repositories,
    }).length,
    1,
  );
  assert.deepEqual(
    installationCandidates("installation", { ...payload, action: "deleted" }),
    [],
  );
  assert.deepEqual(
    installationCandidates("installation", {
      ...payload,
      sender: { id: 3, type: "Bot" },
    }),
    [],
  );
});
