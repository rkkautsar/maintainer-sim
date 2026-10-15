import { readFileSync } from "node:fs";
import { registry } from "./package-registry.ts";

export function localRegistry() {
  const app = process.env.GITHUB_APP_ID;
  const path = process.env.GITHUB_PRIVATE_KEY_PATH;
  return registry({
    SCENARIO_REPOSITORIES:
      process.env.SCENARIO_REPOSITORIES ?? "rkkautsar/forum-scenario",
    GITHUB_APP_ID: app ?? "",
    GITHUB_PRIVATE_KEY: path ? readFileSync(path, "utf8") : "",
  });
}
