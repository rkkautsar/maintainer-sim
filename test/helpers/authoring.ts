import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

export function authoringRepository() {
  const repo = mkdtempSync(join(tmpdir(), "author-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  };
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  write("src/value.ts", "export const value=0;");
  write("obsolete.ts", "old");
  git("add", ".");
  git("commit", "-m", "Base");
  git("branch", "stage/launch/base");
  const baseSha = git("rev-parse", "stage/launch/base").toString().trim();
  rmSync(join(repo, "obsolete.ts"));
  write("src/value.ts", "export const value=1;");
  git("add", ".");
  git("commit", "-m", "Initial");
  git("branch", "stage/launch/example/initial");
  const initialSha = git("rev-parse", "stage/launch/example/initial")
    .toString()
    .trim();
  git("branch", "-D", "stage/launch/base");
  git("branch", "-D", "stage/launch/example/initial");
  git("update-ref", "refs/remotes/origin/review/stage/launch/base", baseSha);
  git(
    "update-ref",
    "refs/remotes/origin/review/stage/launch/example/initial",
    initialSha,
  );
  write(
    "__scenario__/scenario.yaml",
    "schema: 1\nid: example\nversion: 0.1.0\ntitle: Example\ndescription: Example scenario\nrefPrefix: review/\ncharacters:\n  sam:\n    name: Sam\n    role: Contributor\nstages: [launch]\n",
  );
  write(
    "__scenario__/characters/sam.svg",
    '<svg xmlns="http://www.w3.org/2000/svg"><circle r="20" /></svg>',
  );
  write(
    "__scenario__/stages/launch/stage.md",
    "---\ntitle: Launch\nendings:\n  success: Ready\n  incomplete: Missing work\n  partial: Needs a check\n---\nA community needs this release.",
  );
  write(
    "__scenario__/stages/launch/issues/value.md",
    "---\nid: value\ntitle: Set the value\n---\nThe value should be one.",
  );
  write(
    "__scenario__/stages/launch/prs/example.md",
    "---\nid: example\ntitle: Set the value\ncharacter: sam\nissue: value\nrevisions: 0\nassessment:\n  initial:\n    explanation: Meets the requirement\n    sound: true\n---\nHere is the change.\n\n<!-- debrief -->\n\nTrace the requirement.",
  );
  return { repo, git };
}
