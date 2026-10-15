import { publishedPackages } from "./generated/packages.ts";
import type { Run, Proposal, Variant } from "./types.ts";
export type Character = { name: string; role: string; avatar: string };
export type Stage = {
  id: string;
  title: string;
  intro: string;
  baseline: Record<string, string>;
  issues: { id: string; title: string; body: string }[];
  proposals: Proposal[];
  endings: { success: string; incomplete: string; partial: string };
  next?: string;
};
export type ScenarioPackage = {
  schema: 1;
  id: string;
  version: string;
  title: string;
  description: string;
  digest: string;
  characters: Record<string, Character>;
  stages: Stage[];
};
export const catalog = () => publishedPackages;
export function findPackage(id: string, version?: string): ScenarioPackage {
  const candidates = publishedPackages.filter(
    (p) => p.id === id && (!version || p.version === version),
  );
  if (candidates.length !== 1)
    throw new Error("Unknown or ambiguous scenario package");
  return candidates[0];
}
export function scenarioFor(run: Run): Stage & { pack: ScenarioPackage } {
  const pack = findPackage(run.scenario.id, run.scenario.version);
  if (pack.digest !== run.scenario.digest)
    throw new Error("Scenario package digest mismatch");
  const stage = pack.stages.find((s) => s.id === run.scenario.stage);
  if (!stage) throw new Error("Unknown scenario stage");
  return { ...stage, pack };
}
export function selectScenario(
  pack: ScenarioPackage,
  stage = pack.stages[0].id,
): NonNullable<Run["scenario"]> {
  if (!pack.stages.some((s) => s.id === stage))
    throw new Error("Unknown scenario stage");
  return { id: pack.id, version: pack.version, digest: pack.digest, stage };
}
export function authoredVariant(
  run: Run,
  id: string,
  revision: number,
): Variant {
  const p = scenarioFor(run).proposals.find((p) => p.id === id);
  if (!p || !Number.isInteger(revision) || !p.variants[revision])
    throw new Error("Unknown authored revision");
  return p.variants[revision];
}
export function applyVariant(files: Record<string, string>, v: Variant) {
  Object.assign(files, v.files);
  for (const path of v.deletes ?? []) delete files[path];
  return files;
}
export function publicCharacter(run: Run, id?: string): string {
  const { pack } = scenarioFor(run),
    c = id ? pack.characters[id] : undefined;
  if (!c) return "";
  const origin =
    process.env.PUBLIC_ORIGIN ?? "https://maintainer-sim.rkkautsar.workers.dev";
  return `<img src="${origin}/portraits/${pack.digest}/${id}.svg" width="56" height="56" alt="${c.name}" />\n\n**${c.name} · ${c.role}**\n\n`;
}
export function renderLinks(text: string, run: Run) {
  return text.replace(/\{\{(issue|pr):([a-z0-9-]+)\}\}/g, (_, kind, id) => {
    const number = kind === "issue" ? run.issues[id] : run.prs[id]?.number;
    return number ? "#" + number : "(pending " + id + ")";
  });
}
