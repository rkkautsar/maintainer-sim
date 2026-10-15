import { execFileSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import type { ScenarioPackage, Stage } from "./packages.ts";
import type { Variant, Proposal } from "./types.ts";
const idPattern = /^[a-z][a-z0-9-]{0,47}$/;
function need(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function text(v: unknown, name: string, max = 16000): asserts v is string {
  need(
    typeof v === "string" &&
      v.trim().length > 0 &&
      v.length <= max &&
      v.trim() !== "TODO",
    "Invalid " + name,
  );
}
function yaml(source: string): any {
  need(Buffer.byteLength(source) <= 32000, "Annotation exceeds 32KB");
  const doc = parseDocument(source, { uniqueKeys: true });
  need(!doc.errors.length, "Invalid YAML: " + doc.errors[0]?.message);
  return doc.toJS({ maxAliasCount: 0 });
}
export function markdown(source: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source);
  need(match, "Markdown needs YAML frontmatter");
  return { meta: yaml(match[1]), body: match[2].trim() };
}
function git(repo: string, ...args: string[]) {
  return execFileSync("git", ["-C", repo, ...args], {
    maxBuffer: 2000000,
    stdio: "pipe",
  });
}
function commit(repo: string, ref: string) {
  need(
    /^[A-Za-z0-9][A-Za-z0-9/._-]*$/.test(ref) && !ref.includes(".."),
    "Invalid ref",
  );
  const sha = git(repo, "rev-parse", "--verify", ref + "^{commit}")
    .toString()
    .trim();
  need(/^[0-9a-f]{40,64}$/.test(sha), "Invalid commit");
  return sha;
}
export function snapshot(repo: string, sha: string): Record<string, string> {
  const entries = git(repo, "ls-tree", "-rz", "--full-tree", sha)
    .toString()
    .split("\0")
    .filter(Boolean);
  const files: Record<string, string> = {};
  let total = 0;
  for (const entry of entries) {
    const match = /^(\d+) (\w+) ([0-9a-f]+)\t(.+)$/.exec(entry);
    need(match, "Unsupported Git tree");
    const [, mode, type, blob, path] = match;
    if (path.split("/").includes("__scenario__")) continue;
    need(
      path.length < 240 &&
        !path
          .split("/")
          .some((x) => ["..", ".git", "node_modules", "data"].includes(x)),
      "Unsafe or generated application path: " + path,
    );
    need(
      !/(^|\/)\.env($|\.)|\.(pem|sqlite|sqlite3)$|(^|\/)\.dev\.vars/.test(path),
      "Secret/runtime file in application: " + path,
    );
    need(
      mode === "100644" && type === "blob",
      "Only regular text files supported: " + path,
    );
    const raw = git(repo, "cat-file", "blob", blob);
    total += raw.length;
    need(
      raw.length <= 100000 &&
        total <= 400000 &&
        Object.keys(files).length < 120,
      "Scenario code exceeds publish limits",
    );
    const content = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    need(
      !content.includes("\0") &&
        !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}/.test(
          content,
        ),
      "Binary/credential content in " + path,
    );
    files[path] = content;
  }
  need(Object.keys(files).length > 0, "Empty starting tree");
  return files;
}
const docs = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort()
    : [];
function change(base: Record<string, string>, next: Record<string, string>) {
  return {
    files: Object.fromEntries(
      Object.entries(next).filter(([p, c]) => base[p] !== c),
    ),
    deletes: Object.keys(base).filter((p) => !(p in next)),
  };
}
function allowedKeys(value: any, keys: string[], where: string) {
  need(
    value && typeof value === "object" && !Array.isArray(value),
    "Invalid " + where,
  );
  need(
    Object.keys(value).every((k) => keys.includes(k)),
    "Unknown field in " + where,
  );
}
export function publishScenario(repoInput: string): ScenarioPackage {
  const repo = resolve(repoInput),
    root = join(repo, "__scenario__"),
    config = yaml(readFileSync(join(root, "scenario.yaml"), "utf8"));
  allowedKeys(
    config,
    ["schema", "id", "version", "title", "description", "characters", "stages"],
    "scenario",
  );
  need(
    config.schema === 1 && idPattern.test(config.id),
    "Invalid scenario schema/id",
  );
  need(/^\d+\.\d+\.\d+$/.test(config.version), "Version must be x.y.z");
  text(config.title, "title", 100);
  text(config.description, "description", 1000);
  need(
    Array.isArray(config.stages) &&
      config.stages.length > 0 &&
      config.stages.length <= 8 &&
      new Set(config.stages).size === config.stages.length,
    "Invalid/duplicate stages",
  );
  const characters: ScenarioPackage["characters"] = {};
  for (const [id, raw] of Object.entries(config.characters ?? {})) {
    need(idPattern.test(id), "Invalid character ID");
    const c = raw as any;
    allowedKeys(c, ["name", "role", "avatar"], "character");
    text(c.name, "character name", 60);
    text(c.role, "character role", 100);
    const avatar = readFileSync(join(root, "characters", id + ".svg"), "utf8");
    // Portraits are deliberately restricted to simple locally-authored vector shapes.
    need(
      avatar.length < 20000 &&
        /^<svg\s/.test(avatar) &&
        !/<(?:script|foreignObject|image|use|style|a)\b|\bon\w+\s*=|(?:href|url\s*\()|<!|&/i.test(
          avatar,
        ),
      "Unsafe SVG portrait",
    );
    need(
      /^[\w .'-]+$/.test(c.name) && /^[\w .'-]+$/.test(c.role),
      "Invalid character display text",
    );
    characters[id] = { name: c.name, role: c.role, avatar };
  }
  const stages: Stage[] = [];
  for (const stageId of config.stages) {
    need(idPattern.test(stageId), "Invalid stage ID");
    const dir = join(root, "stages", stageId),
      doc = markdown(readFileSync(join(dir, "stage.md"), "utf8"));
    allowedKeys(doc.meta, ["title", "endings"], "stage");
    text(doc.meta.title, "stage title", 150);
    text(doc.body, "stage brief");
    allowedKeys(
      doc.meta.endings,
      ["success", "incomplete", "partial"],
      "endings",
    );
    for (const value of Object.values(doc.meta.endings))
      text(value, "stage ending");
    need(
      Object.keys(doc.meta.endings).length === 3,
      "All three endings required",
    );
    const baseSha = commit(repo, `stage/${stageId}/base`),
      baseline = snapshot(repo, baseSha);
    const issues = docs(join(dir, "issues")).map((file) => {
      const { meta, body } = markdown(
        readFileSync(join(dir, "issues", file), "utf8"),
      );
      allowedKeys(meta, ["id", "title"], "issue");
      need(idPattern.test(meta.id), "Invalid issue ID");
      text(meta.title, "issue title", 150);
      text(body, "issue body");
      return { id: meta.id, title: meta.title, body };
    });
    need(
      issues.length > 0 &&
        issues.length <= 12 &&
        new Set(issues.map((i) => i.id)).size === issues.length,
      "Invalid/duplicate issues",
    );
    const proposals: Proposal[] = docs(join(dir, "prs")).map((file) => {
      const { meta, body } = markdown(
        readFileSync(join(dir, "prs", file), "utf8"),
      );
      allowedKeys(
        meta,
        [
          "id",
          "title",
          "character",
          "issue",
          "group",
          "revisions",
          "assessment",
          "followup",
        ],
        "PR",
      );
      need(idPattern.test(meta.id), "Invalid PR ID");
      text(meta.title, "PR title", 150);
      need(characters[meta.character], "Unknown character");
      need(
        !meta.issue || issues.some((i) => i.id === meta.issue),
        "Unknown issue",
      );
      need(!meta.group || idPattern.test(meta.group), "Invalid group");
      need(
        Number.isInteger(meta.revisions) &&
          meta.revisions >= 0 &&
          meta.revisions <= 3,
        "revisions must be 0..3",
      );
      const parts = body.split("<!-- debrief -->");
      need(parts.length === 2, "PR needs one <!-- debrief --> separator");
      text(parts[0], "PR description");
      text(parts[1], "PR debrief");
      need(
        meta.assessment && typeof meta.assessment === "object",
        "Missing assessment",
      );
      const variants: Variant[] = [];
      let previous = baseSha;
      for (let n = 0; n <= meta.revisions; n++) {
        const label = n ? "rev-" + n : "initial",
          ref = `stage/${stageId}/${meta.id}/${label}`,
          sha = commit(repo, ref);
        git(repo, "merge-base", "--is-ancestor", previous, sha);
        const facts = meta.assessment[label];
        allowedKeys(
          facts,
          [
            "sound",
            "satisfiesIssue",
            "concern",
            "debt",
            "explanation",
            "reply",
          ],
          "assessment " + label,
        );
        need(typeof facts.sound === "boolean", "sound must be boolean");
        text(facts.explanation, "explanation");
        if (facts.satisfiesIssue !== undefined)
          need(
            typeof facts.satisfiesIssue === "boolean",
            "satisfiesIssue must be boolean",
          );
        if (!facts.sound) text(facts.concern, "concern");
        if (facts.sound)
          need(
            !facts.concern && !facts.debt,
            "Sound revisions cannot retain concerns/debt",
          );
        if (n) text(facts.reply, "revision reply");
        const changes = change(baseline, snapshot(repo, sha));
        need(
          Object.keys(changes.files).length + changes.deletes.length > 0,
          "Empty PR revision",
        );
        variants.push({ ...facts, ...changes });
        previous = sha;
      }
      need(
        Object.keys(meta.assessment).length === variants.length,
        "Unexpected/missing assessment revision",
      );
      return {
        id: meta.id,
        title: meta.title,
        body: parts[0].trim(),
        lesson: parts[1].trim(),
        character: meta.character,
        issue: meta.issue,
        group: meta.group,
        followup: meta.followup,
        variants,
      };
    });
    need(
      proposals.length > 0 &&
        proposals.length <= 15 &&
        new Set(proposals.map((p) => p.id)).size === proposals.length,
      "Invalid/duplicate PRs",
    );
    for (const issue of issues)
      need(
        proposals.some((p) => p.issue === issue.id),
        "Issue has no contribution: " + issue.id,
      );
    // Prevent accidental overlap between independent contributions; alternatives may share files.
    for (let a = 0; a < proposals.length; a++)
      for (let b = a + 1; b < proposals.length; b++) {
        const x = proposals[a],
          y = proposals[b];
        if (x.group && x.group === y.group) continue;
        const paths = (p: Proposal) =>
          new Set(
            p.variants.flatMap((v) => [
              ...Object.keys(v.files),
              ...(v.deletes ?? []),
            ]),
          );
        need(
          ![...paths(x)].some((path) => paths(y).has(path)),
          "Independent PRs overlap: " + x.id + " and " + y.id,
        );
      }
    for (const content of [
      doc.body,
      ...issues.map((i) => i.body),
      ...proposals.map((p) => p.body),
    ])
      for (const match of content.matchAll(/\{\{(issue|pr):([a-z0-9-]+)\}\}/g))
        need(
          match[1] === "issue"
            ? issues.some((i) => i.id === match[2])
            : proposals.some((p) => p.id === match[2]),
          "Unknown reference " + match[0],
        );
    for (const group of new Set(
      proposals.map((p) => p.group).filter(Boolean),
    )) {
      const members = proposals.filter((p) => p.group === group);
      need(
        members.length >= 2 && new Set(members.map((p) => p.issue)).size === 1,
        "Competing group must contain alternatives for the same issue",
      );
    }
    const stage = {
      id: stageId,
      title: doc.meta.title,
      intro: doc.body,
      baseline,
      issues,
      proposals,
      endings: doc.meta.endings,
    };
    stages.push(stage);
  }
  for (let i = 0; i < stages.length - 1; i++) stages[i].next = stages[i + 1].id;
  const data = {
    schema: 1 as const,
    id: config.id,
    version: config.version,
    title: config.title,
    description: config.description,
    characters,
    stages,
  };
  const serialized = JSON.stringify(data);
  need(
    Buffer.byteLength(serialized) <= 1800000,
    "Published package exceeds 1.8MB",
  );
  return {
    ...data,
    digest: createHash("sha256").update(serialized).digest("hex"),
  };
}
export function savePackage(pack: ScenarioPackage, dest: string) {
  mkdirSync(dest, { recursive: true });
  const file = join(dest, `${pack.id}-${pack.version}.json`),
    content = JSON.stringify(pack, null, 2) + "\n";
  if (existsSync(file))
    need(
      JSON.stringify(JSON.parse(readFileSync(file, "utf8"))) ===
        JSON.stringify(pack),
      "Published version is immutable; increment version",
    );
  else writeFileSync(file, content);
  return file;
}
export function exportBaseline(
  pack: ScenarioPackage,
  dest: string,
  stageId = pack.stages[0].id,
) {
  need(!existsSync(dest), "Destination must not exist");
  const stage = pack.stages.find((s) => s.id === stageId);
  need(stage, "Unknown stage");
  for (const [path, content] of Object.entries(stage.baseline)) {
    const file = join(dest, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}
