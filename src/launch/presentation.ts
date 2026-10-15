import type { Job } from "./types.ts";
export function publicLaunch(job: Job | undefined, slug = "pr-flood") {
  if (!job) return {};
  const labels: Record<string, [string, string]> = {
    creating: [
      "Creating your repository",
      "Preparing a new home for this playthrough.",
    ],
    connecting: [
      "Connecting the game master",
      "Checking GitHub App access to your new repository.",
    ],
    seeding: [
      "Contributors are arriving",
      "Adding the release brief, issues, and pull requests. This can take a minute or two.",
    ],
    ready: [
      "Your project is ready",
      "The release brief is waiting in Game Master issue #1.",
    ],
    "waiting-access": [
      "Connect the game master",
      job.repository
        ? "Install or update PR Flood, select your new repository, then return and try again."
        : "Install PR Flood on your personal GitHub account, then return and try again to create your repository.",
    ],
    failed: [
      "Setup needs another try",
      job.error ?? "Your repository is preserved. Retry to continue setup.",
    ],
  };
  return {
    id: job.id,
    scenario: job.scenario,
    state: job.state,
    title: labels[job.state]?.[0],
    message: labels[job.state]?.[1],
    url: job.url
      ? job.state === "ready"
        ? job.url + "/issues/1"
        : job.url
      : undefined,
    installUrl:
      job.state === "waiting-access"
        ? `https://github.com/apps/${slug}/installations/new`
        : undefined,
  };
}
