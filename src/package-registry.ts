import { createHash } from "node:crypto";
import { z } from "zod";
import { GitHub } from "./github.ts";
import { packageScope, type ScenarioPackage } from "./packages.ts";
import { parse } from "./validation.ts";

const id = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const files = z.record(z.string(), z.string());
const variant = z
  .object({
    files,
    deletes: z.array(z.string()).optional(),
    sound: z.boolean(),
    satisfiesIssue: z.boolean().optional(),
    concern: z.string().optional(),
    explanation: z.string(),
    debt: z.string().optional(),
    serious: z.boolean().optional(),
    reply: z.string().optional(),
  })
  .strict();
const packageSchema = z
  .object({
    schema: z.literal(1),
    id,
    version,
    title: z.string(),
    description: z.string(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    characters: z.record(
      id,
      z
        .object({ name: z.string(), role: z.string(), avatar: z.string() })
        .strict(),
    ),
    stages: z
      .array(
        z
          .object({
            id,
            title: z.string(),
            intro: z.string(),
            baseline: files,
            issues: z
              .array(
                z.object({ id, title: z.string(), body: z.string() }).strict(),
              )
              .max(12),
            proposals: z
              .array(
                z
                  .object({
                    id,
                    title: z.string(),
                    body: z.string(),
                    issue: z.string().optional(),
                    group: z.string().optional(),
                    character: z.string().optional(),
                    followup: z.string().optional(),
                    lesson: z.string(),
                    variants: z.array(variant).min(1).max(4),
                  })
                  .strict(),
              )
              .max(15),
            endings: z
              .object({
                success: z.string(),
                incomplete: z.string(),
                partial: z.string(),
              })
              .strict(),
            next: z.string().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();

export function validatePackage(value: unknown): ScenarioPackage {
  // Validate without reordering fields: historical package hashes cover authored
  // field order. A JSON parse/stringify round trip preserves that order.
  parse(packageSchema, value);
  const pack = value as ScenarioPackage;
  const { digest, ...content } = pack;
  const bytes = JSON.stringify(content);
  if (
    Buffer.byteLength(bytes) > 1800000 ||
    createHash("sha256").update(bytes).digest("hex") !== digest
  )
    throw new Error("Invalid scenario package digest or size");
  for (const character of Object.values(pack.characters)) {
    if (
      !/^<svg\s/.test(character.avatar) ||
      character.avatar.length > 20000 ||
      /<(?:script|foreignObject|image|use|style|a)\b|\bon\w+\s*=|(?:href|url\s*\()|<!|&/i.test(
        character.avatar,
      )
    )
      throw new Error("Unsafe scenario portrait");
  }
  return pack;
}

const releaseSchema = z.array(
  z.object({
    tag_name: z.string(),
    body: z.string().nullable().optional(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    assets: z.array(
      z.object({
        id: z.number().int().positive(),
        name: z.string(),
        size: z.number(),
      }),
    ),
  }),
);
type Release = z.infer<typeof releaseSchema>[number];
export interface RegistryConfig {
  SCENARIO_REPOSITORIES?: string;
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
}
export interface PackagePersistence {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<unknown>;
}

export class GitHubPackageRegistry {
  private metadata?: {
    until: number;
    releases: { repo: string; release: Release }[];
  };
  private tokens = new Map<string, { until: number; api: GitHub }>();
  private packages = new Map<string, ScenarioPackage>();
  private config: RegistryConfig;
  constructor(config: RegistryConfig) {
    this.config = config;
  }

  private repositories() {
    const repos = (this.config.SCENARIO_REPOSITORIES ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      !repos.length ||
      repos.length > 20 ||
      repos.some(
        (repo) =>
          !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repo),
      )
    )
      throw new Error("Configure trusted SCENARIO_REPOSITORIES");
    return repos;
  }

  private async api(repo: string) {
    const cached = this.tokens.get(repo);
    if (cached && cached.until > Date.now()) return cached.api;
    const app = GitHub.app(
      this.config.GITHUB_APP_ID,
      this.config.GITHUB_PRIVATE_KEY,
    );
    const installation = parse(
      z.object({ id: z.number().int().positive() }),
      await app.get(`/repos/${repo}/installation`),
    );
    const token = parse(
      z.object({ token: z.string() }),
      await app.post(`/app/installations/${installation.id}/access_tokens`, {
        repositories: [repo.split("/")[1]],
        permissions: { contents: "read" },
      }),
    );
    const api = new GitHub(token.token);
    this.tokens.set(repo, { until: Date.now() + 50 * 60000, api });
    return api;
  }

  private async releases() {
    if (this.metadata && this.metadata.until > Date.now())
      return this.metadata.releases;
    const releases: { repo: string; release: Release }[] = [];
    for (const repo of this.repositories()) {
      const api = await this.api(repo);
      for (let page = 1; page <= 10; page++) {
        const values = parse(
          releaseSchema,
          await api.get(`/repos/${repo}/releases?per_page=100&page=${page}`),
        );
        for (const release of values) {
          if (
            !release.draft &&
            !release.prerelease &&
            /^v\d+\.\d+\.\d+$/.test(release.tag_name)
          )
            releases.push({ repo, release });
        }
        if (values.length < 100) break;
        if (page === 10)
          throw new Error("Scenario registry release limit exceeded");
      }
    }
    this.metadata = { until: Date.now() + 60000, releases };
    return releases;
  }

  private async load(repo: string, release: Release) {
    const assets = release.assets.filter((a) => a.name === "scenario.json");
    if (assets.length !== 1 || assets[0].size > 1900000)
      throw new Error("Missing or oversized scenario release asset");
    const key = `${repo}:${assets[0].id}`;
    const cached = this.packages.get(key);
    if (cached) return cached;
    const api = await this.api(repo);
    const response = await api.api.request(
      "GET /repos/{owner}/{repo}/releases/assets/{asset_id}",
      {
        owner: repo.split("/")[0],
        repo: repo.split("/")[1],
        asset_id: assets[0].id,
        headers: { accept: "application/octet-stream" },
      },
    );
    const raw: unknown = response.data;
    const value =
      typeof raw === "string"
        ? JSON.parse(raw)
        : raw instanceof ArrayBuffer
          ? JSON.parse(new TextDecoder().decode(raw))
          : ArrayBuffer.isView(raw)
            ? JSON.parse(new TextDecoder().decode(raw))
            : raw;
    const pack = validatePackage(value);
    if (`v${pack.version}` !== release.tag_name)
      throw new Error("Scenario release tag does not match package");
    const advertisedDigest = release.body?.match(
      /^Scenario SHA-256: ([a-f0-9]{64})$/m,
    )?.[1];
    if (advertisedDigest !== pack.digest)
      throw new Error(
        "Scenario release digest metadata does not match package",
      );
    if (this.packages.size >= 24)
      this.packages.delete(this.packages.keys().next().value!);
    this.packages.set(key, pack);
    return pack;
  }

  async latest() {
    const latest = new Map<string, { repo: string; release: Release }>();
    for (const item of await this.releases()) {
      const previous = latest.get(item.repo);
      if (
        !previous ||
        item.release.tag_name
          .slice(1)
          .localeCompare(previous.release.tag_name.slice(1), undefined, {
            numeric: true,
          }) > 0
      )
        latest.set(item.repo, item);
    }
    const packages = await Promise.all(
      [...latest.values()].map((item) => this.load(item.repo, item.release)),
    );
    if (new Set(packages.map((p) => p.id)).size !== packages.length)
      throw new Error("Duplicate scenario IDs in registry");
    return packages;
  }

  async byDigest(digest: string) {
    const cached = [...this.packages.values()].find((p) => p.digest === digest);
    if (cached) return cached;
    const entry = (await this.releases()).find(
      ({ release }) =>
        release.body?.match(/^Scenario SHA-256: ([a-f0-9]{64})$/m)?.[1] ===
        digest,
    );
    if (entry) {
      const pack = await this.load(entry.repo, entry.release);
      if (pack.digest !== digest)
        throw new Error("Release digest metadata mismatch");
      return pack;
    }
    return undefined;
  }

  async pinned(
    selection: { id: string; version: string; digest?: string },
    storage?: PackagePersistence,
  ) {
    const cacheKey = selection.digest
      ? `scenario:${selection.digest}`
      : undefined;
    const saved =
      cacheKey && storage
        ? await storage.get<ScenarioPackage>(cacheKey)
        : undefined;
    if (saved) {
      const pack = validatePackage(saved);
      if (
        pack.id !== selection.id ||
        pack.version !== selection.version ||
        pack.digest !== selection.digest
      )
        throw new Error("Cached scenario identity mismatch");
      return pack;
    }
    for (const { repo, release } of await this.releases()) {
      if (release.tag_name !== `v${selection.version}`) continue;
      const pack = await this.load(repo, release);
      if (pack.id !== selection.id) continue;
      if (selection.digest && pack.digest !== selection.digest)
        throw new Error("Pinned scenario release changed");
      if (storage) await storage.put(`scenario:${pack.digest}`, pack);
      return pack;
    }
    throw new Error("Scenario release is unavailable");
  }

  async scope<T>(
    selections: { id: string; version: string; digest?: string }[],
    storage: PackagePersistence | undefined,
    action: () => T,
  ): Promise<Awaited<T>> {
    const unique = [
      ...new Map(
        selections.map((s) => [`${s.id}:${s.version}:${s.digest ?? ""}`, s]),
      ).values(),
    ];
    const packages = await Promise.all(
      unique.map((s) => this.pinned(s, storage)),
    );
    return await packageScope.run(packages, action);
  }
}

// One bounded cache per configured source set; immutable packages are separately
// persisted by each Durable Object so in-progress games survive source outages.
let cached: { key: string; registry: GitHubPackageRegistry } | undefined;
export function registry(config: RegistryConfig) {
  const key = [
    config.SCENARIO_REPOSITORIES,
    config.GITHUB_APP_ID,
    createHash("sha256")
      .update(config.GITHUB_PRIVATE_KEY ?? "")
      .digest("hex"),
  ].join(":");
  if (!cached || cached.key !== key)
    cached = { key, registry: new GitHubPackageRegistry(config) };
  return cached.registry;
}
