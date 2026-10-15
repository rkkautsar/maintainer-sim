import { Octokit } from "@octokit/rest";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
export class GitHub {
  api: Octokit;
  constructor(token: string) {
    this.api = new Octokit({ auth: token, request: { timeout: 15000 } });
  }
  static async installation(id: number, repository: number) {
    const app = process.env.GITHUB_APP_ID,
      path = process.env.GITHUB_PRIVATE_KEY_PATH;
    if (!app || !path)
      throw new Error("Set GITHUB_APP_ID and GITHUB_PRIVATE_KEY_PATH");
    return this.fromKey(id, repository, app, readFileSync(path, "utf8"));
  }
  static async fromKey(
    id: number,
    repository: number,
    app: string,
    key: string,
  ) {
    const now = Math.floor(Date.now() / 1000),
      encode = (v: unknown) =>
        Buffer.from(JSON.stringify(v)).toString("base64url");
    const body =
      encode({ alg: "RS256", typ: "JWT" }) +
      "." +
      encode({ iat: now - 60, exp: now + 540, iss: app });
    const signature = createSign("RSA-SHA256")
      .update(body)
      .sign(key)
      .toString("base64url");
    const api = new Octokit({ auth: body + "." + signature });
    const { data } = await api.apps.createInstallationAccessToken({
      installation_id: id,
      repository_ids: [repository],
    });
    return new GitHub(data.token);
  }
  async get(path: string) {
    return (await this.api.request("GET " + path)).data as any;
  }
  async post(path: string, body: any) {
    return (await this.api.request("POST " + path, body)).data as any;
  }
  async patch(path: string, body: any) {
    return (await this.api.request("PATCH " + path, body)).data as any;
  }
  async list(path: string) {
    return (await this.api.paginate("GET " + path, { per_page: 100 })) as any[];
  }
  async tree(root: string, sha: string) {
    const data = await this.get(root + "/git/trees/" + sha + "?recursive=1");
    if (data.truncated) throw new Error("Unsupported truncated tree");
    const files: Record<string, string> = {};
    for (const entry of data.tree) {
      if (entry.type === "tree") continue;
      if (entry.type !== "blob" || entry.mode !== "100644")
        throw new Error("Unsupported file type");
      const blob = await this.get(root + "/git/blobs/" + entry.sha);
      if (blob.size > 100000) throw new Error("Oversized file");
      files[entry.path] = Buffer.from(blob.content, "base64").toString("utf8");
    }
    return files;
  }
  async commit(
    root: string,
    parent: string,
    files: Record<string, string>,
    message: string,
  ) {
    const base = await this.get(root + "/git/commits/" + parent);
    const tree = await this.post(root + "/git/trees", {
      base_tree: base.tree.sha,
      tree: Object.entries(files).map(([path, content]) => ({
        path,
        mode: "100644",
        type: "blob",
        content,
      })),
    });
    return await this.post(root + "/git/commits", {
      message,
      tree: tree.sha,
      parents: [parent],
    });
  }
}
