import {
  publishScenario,
  savePackage,
  exportBaseline,
} from "../src/authoring.ts";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { parse, stringify } from "yaml";
const [command, repoInput = ".", ...args] = process.argv.slice(2),
  repo = resolve(repoInput);
try {
  if (command === "case") {
    const [stage, id, character, issue] = args;
    if (![stage, id, character].every((s) => /^[a-z][a-z0-9-]*$/.test(s ?? "")))
      throw Error("case REPO STAGE CASE CHARACTER [ISSUE]");
    const dest = join(repo, "__scenario__", "stages", stage, "prs", id + ".md");
    if (existsSync(dest)) throw Error("Case already exists");
    mkdirSync(join(repo, "__scenario__", "stages", stage, "prs"), {
      recursive: true,
    });
    const meta = {
      id,
      title: "Describe the contribution",
      character,
      ...(issue ? { issue } : {}),
      revisions: 0,
      assessment: {
        initial: { sound: false, concern: "TODO", explanation: "TODO" },
      },
    };
    writeFileSync(
      dest,
      "---\n" +
        stringify(meta) +
        "---\n\nDescribe the contribution in the author’s voice.\n\n<!-- debrief -->\n\nExplain the specific takeaway and evidence.\n",
    );
    console.log(dest);
  } else if (command === "capture") {
    const [stage, id, revision = "initial"] = args;
    if (
      !/^[a-z][a-z0-9-]*$/.test(stage ?? "") ||
      !/^[a-z][a-z0-9-]*$/.test(id ?? "") ||
      !/^(initial|rev-[1-3])$/.test(revision)
    )
      throw Error("capture REPO STAGE CASE [initial|rev-N]");
    const config = parse(
      readFileSync(join(repo, "__scenario__", "scenario.yaml"), "utf8"),
    ) as { refPrefix?: string };
    const refPrefix = config.refPrefix ?? "";
    if (refPrefix && !/^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)+$/.test(refPrefix))
      throw Error("Invalid refPrefix in scenario.yaml");
    const ref = `${refPrefix}stage/${stage}/${id}/${revision}`;
    execFileSync("git", ["-C", repo, "branch", ref, "HEAD"], {
      stdio: "inherit",
    });
    console.log(`Captured ${ref} at current HEAD.`);
  } else if (command === "init") {
    const root = join(repo, "__scenario__");
    if (existsSync(root)) throw Error("__scenario__ already exists");
    mkdirSync(join(root, "stages", "launch", "issues"), { recursive: true });
    mkdirSync(join(root, "stages", "launch", "prs"), { recursive: true });
    mkdirSync(join(root, "characters"));
    writeFileSync(
      join(root, "scenario.yaml"),
      stringify({
        schema: 1,
        id: "my-scenario",
        version: "0.1.0",
        title: "My scenario",
        description: "Describe the project and its community.",
        characters: {},
        stages: ["launch"],
      }),
    );
    writeFileSync(
      join(root, "stages", "launch", "stage.md"),
      "---\ntitle: First release\nendings:\n  success: The release is ready.\n  incomplete: Some requirements still need work.\n  partial: Some changes need a manual assessment.\n---\nDescribe the community and why this release matters.\n",
    );
    console.log(
      "Created __scenario__. See docs/AUTHORING.md for the case and character formats.",
    );
  } else if (
    ["validate", "publish", "export", "preview"].includes(command ?? "")
  ) {
    const pack = publishScenario(repo);
    if (command === "publish")
      console.log(savePackage(pack, args[0] ?? "var/scenario-packages"));
    else if (command === "export")
      exportBaseline(
        pack,
        resolve(args[0] ?? "/tmp/scenario-baseline"),
        args[1],
      );
    else if (command === "preview") {
      const dest = resolve(args[0] ?? "/tmp/scenario-preview");
      exportBaseline(pack, dest, args[1]);
      const stage = pack.stages.find(
        (s) => s.id === (args[1] ?? pack.stages[0].id),
      )!;
      writeFileSync(
        dest + "/SCENARIO_PREVIEW.md",
        stage.intro +
          "\n\n" +
          stage.proposals
            .map(
              (p) =>
                "## " +
                p.title +
                "\n\n" +
                p.body +
                "\n\n" +
                Object.entries(p.variants[0].files)
                  .map(([path, c]) => "### " + path + "\n```\n" + c + "\n```")
                  .join("\n"),
            )
            .join("\n\n"),
      );
      console.log(
        "Local preview exported to " + dest + "; run the app using its README.",
      );
    } else
      console.log(
        `${pack.id}@${pack.version}: ${pack.stages.length} stage(s), ${pack.stages.reduce((n, s) => n + s.proposals.length, 0)} PRs. ${pack.digest}`,
      );
  } else
    throw Error(
      "Commands: init REPO, case REPO STAGE CASE CHARACTER [ISSUE], capture REPO STAGE CASE [initial|rev-N], validate REPO, publish REPO [DEST], export REPO DEST [STAGE], preview REPO DEST [STAGE]",
    );
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
