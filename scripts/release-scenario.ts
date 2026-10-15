import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { parse } from "yaml";
import { publishScenario } from "../src/authoring.ts";

function gh(...args: string[]) {
  return spawnSync("gh", args, { encoding: "utf8", stdio: "pipe" });
}

function runGh(...args: string[]) {
  const result = gh(...args);
  if (result.status !== 0)
    throw new Error(`gh ${args[0]} failed with status ${result.status}`);
  return result.stdout;
}

const [repoInput, tag] = process.argv.slice(2);
const repo = resolve(repoInput ?? "..");
const match = /^v(\d+\.\d+\.\d+)$/.exec(tag ?? "");
if (!match) throw new Error("Release tag must be vMAJOR.MINOR.PATCH");

const config = parse(
  readFileSync(resolve(repo, "__scenario__/scenario.yaml"), "utf8"),
) as { version?: unknown };
if (config.version !== match[1])
  throw new Error("Tag version does not match scenario.yaml version");

if (!process.env.GH_TOKEN)
  throw new Error("GH_TOKEN is required to publish a GitHub Release");
if (!process.env.GH_REPO)
  throw new Error("GH_REPO must identify the scenario repository");

const pack = publishScenario(repo);
if (pack.version !== match[1])
  throw new Error("Published package version does not match release tag");

const dir = mkdtempSync(join(tmpdir(), "scenario-release-"));
try {
  const packageFile = join(dir, "scenario.json");
  const manifestFile = join(dir, "scenario-manifest.json");
  const packageBytes = JSON.stringify(pack) + "\n";
  if (Buffer.byteLength(packageBytes) > 1900000)
    throw new Error("Serialized scenario release exceeds 1.9MB");
  writeFileSync(packageFile, packageBytes);
  writeFileSync(
    manifestFile,
    JSON.stringify(
      {
        schema: 1,
        id: pack.id,
        version: pack.version,
        digest: pack.digest,
        asset: "scenario.json",
      },
      null,
      2,
    ) + "\n",
  );

  const view = gh("release", "view", tag!, "--json", "isDraft,assets");
  let isDraft = true;
  let assets: { name: string }[] = [];
  if (view.status === 0) {
    const release = JSON.parse(view.stdout) as {
      isDraft: boolean;
      assets: { name: string }[];
    };
    isDraft = release.isDraft;
    assets = release.assets;
  } else {
    runGh(
      "release",
      "create",
      tag!,
      "--verify-tag",
      "--draft",
      "--title",
      `${pack.title} ${pack.version}`,
      "--notes",
      `Immutable scenario package ${pack.id}@${pack.version}.\n\nScenario SHA-256: ${pack.digest}`,
    );
  }

  for (const file of [packageFile, manifestFile]) {
    const name = file.slice(file.lastIndexOf("/") + 1);
    if (assets.some((asset) => asset.name === name)) {
      const downloadDir = join(dir, "existing");
      mkdirSync(downloadDir, { recursive: true });
      runGh(
        "release",
        "download",
        tag!,
        "--pattern",
        name,
        "--dir",
        downloadDir,
      );
      const actual = readFileSync(join(downloadDir, name));
      const expected = readFileSync(file);
      if (!actual.equals(expected))
        throw new Error(
          `Published release asset ${name} differs; refusing overwrite`,
        );
    } else {
      if (!isDraft)
        throw new Error(`Published release is missing immutable asset ${name}`);
      runGh("release", "upload", tag!, file);
      assets.push({ name });
    }
  }

  if (isDraft) runGh("release", "edit", tag!, "--draft=false");
  console.log(`${pack.id}@${pack.version} (${pack.digest}) released as ${tag}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
