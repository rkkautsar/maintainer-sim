import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { publishScenario } from "../src/authoring.ts";
import { authoringRepository } from "./helpers/authoring.ts";

const releaseScript = fileURLToPath(
  new URL("../scripts/release-scenario.ts", import.meta.url),
);

const fakeGh = `#!/bin/sh
set -eu
state=$GH_FAKE_STATE
group=$1
subcommand=$2
shift 2
[ "$group" = 'release' ] || exit 2
printf '%s\\n' "$subcommand" >> "$GH_FAKE_LOG"
case "$subcommand" in
  view)
    tag=$1
    if [ ! -f "$state/$tag/draft" ]; then exit 1; fi
    assets='['
    separator=''
    for name in scenario.json scenario-manifest.json; do
      if [ -f "$state/$tag/assets/$name" ]; then
        assets="$assets$separator{\\"name\\":\\"$name\\"}"
        separator=,
      fi
    done
    assets="$assets]"
    printf '{"isDraft":%s,"assets":%s}\\n' "$(cat "$state/$tag/draft")" "$assets"
    ;;
  create)
    tag=$1
    mkdir -p "$state/$tag/assets"
    printf true > "$state/$tag/draft"
    while [ "$#" -gt 0 ]; do
      if [ "$1" = '--notes' ]; then
        printf '%s' "$2" > "$state/$tag/notes"
        break
      fi
      shift
    done
    ;;
  upload)
    tag=$1
    file=$2
    cp "$file" "$state/$tag/assets/$(basename "$file")"
    ;;
  download)
    tag=$1
    shift
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --pattern) name=$2; shift 2 ;;
        --dir) dest=$2; shift 2 ;;
        *) shift ;;
      esac
    done
    cp "$state/$tag/assets/$name" "$dest/$name"
    ;;
  edit)
    tag=$1
    printf false > "$state/$tag/draft"
    ;;
  *) exit 2 ;;
esac
`;

function setup() {
  const { repo } = authoringRepository();
  const root = mkdtempSync(join(tmpdir(), "scenario-release-test-"));
  const bin = join(root, "bin");
  const state = join(root, "releases");
  const log = join(root, "gh.log");
  mkdirSync(bin);
  mkdirSync(state);
  const gh = join(bin, "gh");
  writeFileSync(gh, fakeGh);
  chmodSync(gh, 0o755);

  function run(tag = "v0.1.0") {
    return spawnSync(process.execPath, [releaseScript, repo, tag], {
      encoding: "utf8",
      env: {
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        GH_TOKEN: "test-only-token",
        GH_REPO: "fixture/scenario",
        GH_FAKE_STATE: state,
        GH_FAKE_LOG: log,
      },
    });
  }

  function operations() {
    try {
      return readFileSync(log, "utf8").trim().split("\n");
    } catch {
      return [];
    }
  }

  return { repo, root, state, run, operations };
}

test("release publishes compact assets and an identical retry reuses them", () => {
  const fixture = setup();
  try {
    const first = fixture.run();
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(fixture.operations(), [
      "view",
      "create",
      "upload",
      "upload",
      "edit",
    ]);
    assert.equal(
      readFileSync(join(fixture.state, "v0.1.0", "draft"), "utf8"),
      "false",
    );

    const pack = publishScenario(fixture.repo);
    const assetDir = join(fixture.state, "v0.1.0", "assets");
    const packageBytes = readFileSync(join(assetDir, "scenario.json"), "utf8");
    assert.equal(packageBytes, JSON.stringify(pack) + "\n");
    assert.deepEqual(
      JSON.parse(packageBytes),
      JSON.parse(JSON.stringify(pack)),
    );
    const manifest = JSON.parse(
      readFileSync(join(assetDir, "scenario-manifest.json"), "utf8"),
    );
    assert.deepEqual(manifest, {
      schema: 1,
      id: pack.id,
      version: pack.version,
      digest: pack.digest,
      asset: "scenario.json",
    });
    assert.match(
      readFileSync(join(fixture.state, "v0.1.0", "notes"), "utf8"),
      new RegExp(`Scenario SHA-256: ${pack.digest}`),
    );

    const retry = fixture.run();
    assert.equal(retry.status, 0, retry.stderr);
    assert.deepEqual(fixture.operations(), [
      "view",
      "create",
      "upload",
      "upload",
      "edit",
      "view",
      "download",
      "download",
    ]);
    assert.equal(
      readFileSync(join(assetDir, "scenario.json"), "utf8"),
      packageBytes,
    );
  } finally {
    rmSync(fixture.repo, { recursive: true, force: true });
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("release refuses to overwrite an asset whose bytes changed", () => {
  const fixture = setup();
  try {
    const first = fixture.run();
    assert.equal(first.status, 0, first.stderr);
    const asset = join(fixture.state, "v0.1.0", "assets", "scenario.json");
    writeFileSync(asset, "tampered package");

    const retry = fixture.run();
    assert.notEqual(retry.status, 0);
    assert.match(retry.stderr, /differs; refusing overwrite/);
    assert.deepEqual(fixture.operations(), [
      "view",
      "create",
      "upload",
      "upload",
      "edit",
      "view",
      "download",
    ]);
    assert.equal(readFileSync(asset, "utf8"), "tampered package");
  } finally {
    rmSync(fixture.repo, { recursive: true, force: true });
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("tag and scenario version mismatch fail before release API calls", () => {
  const fixture = setup();
  try {
    const scenarioFile = join(fixture.repo, "__scenario__", "scenario.yaml");
    const config = readFileSync(scenarioFile, "utf8").replace(
      "version: 0.1.0",
      "version: 0.2.0",
    );
    writeFileSync(scenarioFile, config);

    const result = fixture.run("v0.1.0");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Tag version does not match scenario.yaml/);
    assert.deepEqual(fixture.operations(), []);
  } finally {
    rmSync(fixture.repo, { recursive: true, force: true });
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
