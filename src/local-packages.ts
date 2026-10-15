import { readFileSync } from "node:fs";
import { registry } from "./package-registry.ts";

export function localRegistry() {
  const app = process.env.GITHUB_APP_ID;
  const path = process.env.GITHUB_PRIVATE_KEY_PATH;
  if (!app || !path)
    throw new Error(
      "Set GITHUB_APP_ID and GITHUB_PRIVATE_KEY_PATH to read scenario releases",
    );
  return registry({
    SCENARIO_REPOSITORIES:
      process.env.SCENARIO_REPOSITORIES ?? "rkkautsar/forum-scenario",
    GITHUB_APP_ID: app,
    GITHUB_PRIVATE_KEY: readFileSync(path, "utf8"),
  });
}
