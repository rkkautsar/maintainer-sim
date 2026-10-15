import {
  storyBody,
  stageTitle,
  contributorNotes,
  followups,
  revisionReply,
  communityUpdate,
} from "./story.ts";
import { createHash } from "node:crypto";
import { baseline, issues, proposals, variant } from "./scenario.ts";
import { assess, debrief, expectedFiles } from "./engine.ts";
import { command } from "./security.ts";
import type { Persistence, Reviewer } from "./persistence.ts";
import { GitHub } from "./github.ts";
import { Judge } from "./judge.ts";
import type { Run } from "./types.ts";
const equal = (a: Record<string, string>, b: Record<string, string>) =>
  JSON.stringify(Object.entries(a).sort()) ===
  JSON.stringify(Object.entries(b).sort());
export class Game {
  store: Persistence;
  reviewer: Reviewer;
  judgeEnabled: boolean;
  connect: (r: Run) => Promise<GitHub>;
  constructor(
    store: Persistence,
    connect = (r: Run) => GitHub.installation(r.installation, r.repository),
    reviewer?: Reviewer,
    judgeEnabled = process.env.JEV_CALIBRATED === "true" &&
      !!process.env.JEV_API_KEY,
  ) {
    this.reviewer =
      reviewer ??
      new Judge(
        store as Persistence & {
          reserve(key: string, cost: number, limit: number): boolean;
        },
      );
    this.judgeEnabled = judgeEnabled;
    this.store = store;
    this.connect = connect;
  }
  root(r: Run) {
    return "/repos/" + r.owner + "/" + r.repo;
  }
  marker(r: Run, id: string) {
    return `<!-- maintainer-sim:${r.id}:${id} -->`;
  }
  async seed(r: Run) {
    const gh = await this.connect(r),
      root = this.root(r);
    const repository = await gh.get(root);
    if (
      repository.id !== r.repository ||
      repository.archived ||
      repository.disabled
    )
      throw new Error("Invalid target repository");
    if (r.phase !== "seeding") throw new Error("Run is not seeding");
    if (!r.baseline) {
      r.base = repository.default_branch;
      const ref = await gh.get(root + "/git/ref/heads/" + r.base);
      if (!equal(await gh.tree(root, ref.object.sha), baseline))
        throw new Error(
          "Target does not exactly match scenario/public baseline",
        );
      if ((await gh.list(root + "/issues?state=all")).length)
        throw new Error("Start in a fresh repository without issues or PRs");
      r.baseline = ref.object.sha;
      this.store.save(r);
    }
    if (!r.milestone) {
      const title = "Pocket Board — " + r.id;
      const existing = (await gh.list(root + "/milestones?state=all")).find(
        (x) => x.title === title,
      );
      r.milestone = (
        existing ??
        (await gh.post(root + "/milestones", {
          title,
          description:
            "Deliver safe likes, owner-only edits, and bounded pagination.",
        }))
      ).number;
      this.store.save(r);
    }
    const all = await gh.list(root + "/issues?state=all");
    if (!r.master) {
      const body = storyBody(r) + "\n\n" + this.marker(r, "master");
      r.master = (
        all.find((x) => x.body?.includes(this.marker(r, "master"))) ??
        (await gh.post(root + "/issues", {
          title: "Game Master — " + stageTitle,
          body,
        }))
      ).number;
      this.store.save(r);
    }
    if (r.master !== 1)
      throw new Error(
        "Game Master must be issue #1; start in a fresh repository with no previous issues or PRs",
      );
    for (const issue of issues) {
      if (!r.issues[issue.id]) {
        const body = issue.body + "\n\n" + this.marker(r, issue.id);
        r.issues[issue.id] = (
          all.find((x) => x.body?.includes(this.marker(r, issue.id))) ??
          (await gh.post(root + "/issues", {
            title: issue.title,
            body,
            milestone: r.milestone,
          }))
        ).number;
        this.store.save(r);
      }
    }
    const prs = await gh.list(root + "/pulls?state=all");
    for (const p of proposals) {
      if (r.prs[p.id]) continue;
      const branch = `game/${r.id}/${p.id}`;
      let head: string;
      try {
        head = (await gh.get(root + "/git/ref/heads/" + branch)).object.sha;
      } catch (e: any) {
        if (e.status !== 404) throw e;
        head = (
          await gh.commit(
            root,
            r.baseline!,
            p.variants[0].files,
            "Community contribution",
          )
        ).sha;
        await gh.post(root + "/git/refs", {
          ref: "refs/heads/" + branch,
          sha: head,
        });
      }
      if (
        !equal(await gh.tree(root, head), {
          ...baseline,
          ...p.variants[0].files,
        })
      )
        throw new Error("Unexpected seeded branch");
      const body =
        contributorNotes[p.id] +
        "\n\n" +
        p.body +
        (p.issue ? "\n\nCloses #" + r.issues[p.issue] : "") +
        "\n\n" +
        this.marker(r, p.id);
      const pr =
        prs.find((x) => x.body?.includes(this.marker(r, p.id))) ??
        (await gh.post(root + "/pulls", {
          title: p.title,
          body,
          head: branch,
          base: r.base,
        }));
      r.prs[p.id] = {
        number: pr.number,
        revision: 0,
        outcome: "open",
        head,
        reviews: [],
      };
      this.store.save(r);
    }
    await gh.patch(root + "/issues/" + r.master, {
      body: storyBody(r) + "\n\n" + this.marker(r, "master"),
    });
    await this.humanTouches(r, gh);
    r.phase = "active";
    this.store.save(r);
  }
  async reconcile(r: Run, gh: GitHub) {
    const root = this.root(r),
      snapshot: Record<string, any> = {};
    const before = (await gh.get(root + "/git/ref/heads/" + r.base)).object.sha;
    for (const p of proposals) {
      const state = r.prs[p.id],
        pr = await gh.get(root + "/pulls/" + state.number);
      snapshot[p.id] = pr;
      if (
        pr.head.sha !== state.head ||
        pr.base.ref !== r.base ||
        pr.head.repo?.id !== r.repository
      )
        throw new Error("Unexpected PR head or target");
      // Seeded/prepared commit IDs are immutable and their content was authored here.
      if (pr.merged_by && pr.merged_by.id !== r.player)
        throw new Error("Unexpected collaborator merge");
      state.outcome = pr.merged
        ? "merged"
        : pr.state === "closed"
          ? "closed"
          : "open";
      const reviews = await gh.list(
        root + "/pulls/" + state.number + "/reviews",
      );
      state.reviews = reviews
        .filter(
          (x) =>
            x.user?.id === r.player &&
            x.state !== "DISMISSED" &&
            x.submitted_at,
        )
        .map((x) => ({
          id: x.id,
          body: (x.body ?? "").slice(0, 12000),
          state: x.state,
          commit: x.commit_id,
          submitted: x.submitted_at,
        }));
    }
    const groups = new Set<string>();
    for (const p of proposals) {
      if (r.prs[p.id].outcome === "merged" && p.group) {
        if (groups.has(p.group))
          throw new Error("Both competing implementations merged");
        groups.add(p.group);
      }
    }
    const expected = expectedFiles(r);
    const hash = createHash("sha256")
      .update(JSON.stringify(Object.entries(expected).sort()))
      .digest("hex");
    if (
      (before !== r.tree || hash !== r.contentHash) &&
      !equal(await gh.tree(root, before), expected)
    )
      throw new Error("Unexpected default-branch edits or reversion");
    const after = (await gh.get(root + "/git/ref/heads/" + r.base)).object.sha;
    if (before !== after)
      throw new Error("Repository changed during assessment");
    for (const [id, pr] of Object.entries(snapshot)) {
      const latest = await gh.get(root + "/pulls/" + pr.number);
      if (
        latest.head.sha !== pr.head.sha ||
        latest.state !== pr.state ||
        latest.merged !== pr.merged
      )
        throw new Error("PR changed during assessment");
    }
    r.tree = before;
    r.contentHash = hash;
    this.store.save(r);
  }
  async humanTouches(r: Run, gh: GitHub) {
    r.storySent ??= {};
    for (const [id, state] of Object.entries(r.prs)) {
      const key =
        state.revision > 0 ? `reply-${id}-${state.revision}` : `context-${id}`;
      const body = state.revision > 0 ? revisionReply(r, id) : followups[id];
      if (!body || r.storySent[key]) continue;
      const marker = this.marker(r, key),
        path = this.root(r) + "/issues/" + state.number + "/comments";
      const comments = await gh.list(path);
      if (
        !comments.some(
          (x) => x.body?.includes(marker) && x.user?.type === "Bot",
        )
      )
        await gh.post(path, { body: body + "\n\n" + marker });
      r.storySent[key] = true;
      this.store.save(r);
    }
  }
  async notice(r: Run, gh: GitHub, id: string, body: string) {
    const marker = this.marker(r, id),
      root = this.root(r);
    const comments = await gh.list(root + "/issues/" + r.master + "/comments");
    if (
      !comments.some((x) => x.body?.includes(marker) && x.user?.type === "Bot")
    )
      await gh.post(root + "/issues/" + r.master + "/comments", {
        body: body + "\n\n" + marker,
      });
  }
  async revise(r: Run, number: number, gh: GitHub) {
    const p = proposals.find((p) => r.prs[p.id].number === number);
    if (!p) throw new Error("Not a scenario PR");
    const state = r.prs[p.id];
    if (state.outcome !== "open") return;
    const next = p.variants[state.revision + 1];
    if (!next) {
      await this.notice(
        r,
        gh,
        "limit-" + p.id,
        "No further prepared revision is available for PR #" +
          number +
          ". You can still merge, close, or finish early.",
      );
      return;
    }
    const branch = `game/${r.id}/${p.id}`,
      root = this.root(r);
    // Record the intended head before mutation: a retry can recover a failed response.
    const commit = await gh.commit(
      root,
      state.head,
      next.files,
      "Community revision",
    );
    this.store.db
      .prepare(
        "INSERT OR REPLACE INTO deliveries(id,event,body,status) VALUES(?,?,?,?)",
      )
      .run(
        "revision:" + r.id + ":" + p.id,
        "revision",
        JSON.stringify({
          run: r.id,
          id: p.id,
          old: state.head,
          head: commit.sha,
          revision: state.revision + 1,
        }),
        "intent",
      );
    await gh.patch(root + "/git/refs/heads/" + branch, {
      sha: commit.sha,
      force: false,
    });
    state.head = commit.sha;
    state.revision++;
    this.store.save(r);
    await this.humanTouches(r, gh);
    this.store.db
      .prepare("DELETE FROM deliveries WHERE id=?")
      .run("revision:" + r.id + ":" + p.id);
  }
  async recoverRevision(r: Run, gh: GitHub) {
    const rows = this.store.db
      .prepare(
        "SELECT id,body FROM deliveries WHERE event='revision' AND status='intent'",
      )
      .all() as { id: string; body: string }[];
    for (const row of rows) {
      const intent = JSON.parse(row.body);
      if (intent.run !== r.id) continue;
      const branch = `game/${r.id}/${intent.id}`,
        root = this.root(r),
        head = (await gh.get(root + "/git/ref/heads/" + branch)).object.sha;
      if (head !== intent.head && head !== intent.old)
        throw new Error("Unexpected revision branch");
      if (head === intent.old)
        await gh.patch(root + "/git/refs/heads/" + branch, {
          sha: intent.head,
          force: false,
        });
      r.prs[intent.id].head = intent.head;
      r.prs[intent.id].revision = intent.revision;
      this.store.save(r);
      this.store.db.prepare("DELETE FROM deliveries WHERE id=?").run(row.id);
    }
  }
  async finish(r: Run, gh: GitHub) {
    r.phase = "finishing";
    r.result = assess(r);
    this.store.save(r);
    await this.publish(r, gh);
  }
  async publish(r: Run, gh: GitHub) {
    const root = this.root(r),
      marker = this.marker(r, "result");
    const comments = await gh.list(root + "/issues/" + r.master + "/comments");
    if (
      !comments.some((x) => x.body?.includes(marker) && x.user?.type === "Bot")
    )
      await gh.post(root + "/issues/" + r.master + "/comments", {
        body: debrief(r) + "\n\n" + communityUpdate(r) + "\n\n" + marker,
      });
    r.phase = "finished";
    this.store.save(r);
  }
  async process(event: string, payload: any) {
    for (const r of this.store.all()) {
      if (payload.installation?.id !== r.installation) continue;
      if (
        (event === "installation" &&
          ["deleted", "suspend"].includes(payload.action)) ||
        (event === "installation_repositories" &&
          payload.repositories_removed?.some((x: any) => x.id === r.repository))
      ) {
        r.phase = "inaccessible";
        this.store.save(r);
        continue;
      }
      if (
        payload.repository?.id !== r.repository ||
        ["finished", "paused", "inaccessible", "seeding"].includes(r.phase)
      )
        continue;
      const gh = await this.connect(r);
      if (r.phase === "finishing") {
        await this.publish(r, gh);
        continue;
      }
      try {
        await this.recoverRevision(r, gh);
        await this.humanTouches(r, gh);
        await this.reconcile(r, gh);
        const cmd =
          event === "issue_comment" &&
          payload.action === "created" &&
          payload.issue?.number === r.master &&
          payload.comment?.user?.id === r.player
            ? command(payload.comment.body)
            : undefined;
        const judge = this.reviewer;
        for (const p of proposals) {
          if (!this.judgeEnabled) break;
          const state = r.prs[p.id],
            v = variant(p.id, state.revision);
          if (!v.concern) continue;
          const review = state.reviews
            .filter((x) => x.commit === state.head)
            .at(-1);
          if (!review) continue;
          const inline = await gh.list(
            this.root(r) + "/pulls/" + state.number + "/comments",
          );
          const text =
            review.body +
            "\n" +
            inline
              .filter(
                (x) =>
                  x.user?.id === r.player &&
                  x.pull_request_review_id === review.id,
              )
              .map((x) => x.body)
              .join("\n");
          const category = await judge.evaluate(text, v.concern, v.files);
          if (category) {
            r.findings[p.id] ??= [];
            if (!r.findings[p.id].some((f) => f.reviewId === review.id))
              r.findings[p.id].push({
                reviewId: review.id,
                category,
                revision: state.revision,
                reviewText: text.slice(0, 1000),
              });
            this.store.save(r);
          }
          if (
            cmd?.kind !== "finish" &&
            review.state === "CHANGES_REQUESTED" &&
            state.outcome === "open" &&
            (category === "identified" || category === "consequence")
          )
            await this.revise(r, state.number, gh);
        }
        if (cmd?.kind === "revise") {
          if (proposals.some((p) => r.prs[p.id].number === cmd.number))
            await this.revise(r, cmd.number, gh);
          else
            await this.notice(
              r,
              gh,
              "unknown-pr",
              "Use /game revise with a scenario PR number.",
            );
        }
        if (
          cmd?.kind === "finish" ||
          proposals.every((p) => r.prs[p.id].outcome !== "open")
        ) {
          await this.reconcile(r, gh);
          r.finishEarly = cmd?.kind === "finish";
          await this.finish(r, gh);
        }
      } catch (e: any) {
        if (
          e.status === 403 ||
          e.status === 429 ||
          e.status >= 500 ||
          e.name === "HttpError" ||
          e.name === "TypeError"
        )
          throw e;
        r.phase = "paused";
        r.reason = e.message;
        this.store.save(r);
        await this.notice(
          r,
          gh,
          "paused",
          "Assessment paused because the repository no longer matches a supported scenario state. Your work is preserved. Ask the operator to inspect the run and restart in a fresh repository.",
        );
      }
    }
  }
}
