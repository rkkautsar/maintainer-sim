import {
  storyBody,
  contributorNote,
  followup,
  revisionReply,
  communityUpdate,
} from "./story.ts";
import { createHash } from "node:crypto";
import {
  scenarioFor,
  authoredVariant,
  applyVariant,
  renderLinks,
  selectScenario,
} from "./packages.ts";
import { assess, debrief, expectedFiles } from "./engine.ts";
import { command } from "./security.ts";
import type { Persistence, Reviewer } from "./persistence.ts";
import { GitHub } from "./github.ts";
import { Judge } from "./judge.ts";
import type { Run } from "./types.ts";
const equal = (a: Record<string, string>, b: Record<string, string>) =>
  JSON.stringify(Object.entries(a).sort()) ===
  JSON.stringify(Object.entries(b).sort());
class SnapshotChanged extends Error {}
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
    const { baseline, issues, proposals, pack, title } = scenarioFor(r);
    const variant = (id: string, revision: number) =>
      authoredVariant(r, id, revision);
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
          "Target does not exactly match selected scenario baseline",
        );
      if ((await gh.list(root + "/issues?state=all")).length)
        throw new Error("Start in a fresh repository without issues or PRs");
      r.baseline = ref.object.sha;
      this.store.save(r);
    }
    await this.pinBaseline(r, gh);
    if (!r.milestone) {
      const title = pack.title + " — " + r.id;
      const existing = (await gh.list(root + "/milestones?state=all")).find(
        (x) => x.title === title,
      );
      r.milestone = (
        existing ??
        (await gh.post(root + "/milestones", {
          title,
          description: issues.map((i) => i.title).join("; "),
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
          title: "Game Master — " + title,
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
            p.variants[0].deletes,
          )
        ).sha;
        await gh.post(root + "/git/refs", {
          ref: "refs/heads/" + branch,
          sha: head,
        });
      }
      if (
        !equal(await gh.tree(root, head), {
          ...applyVariant({ ...r.baselineFiles }, p.variants[0]),
        })
      )
        throw new Error("Unexpected seeded branch");
      const body =
        contributorNote(r, p.id) +
        "\n\n" +
        renderLinks(p.body, r) +
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
    for (const p of proposals.filter((p) => p.body.includes("{{pr:"))) {
      const body =
        contributorNote(r, p.id) +
        "\n\n" +
        renderLinks(p.body, r) +
        (p.issue ? "\n\nCloses #" + r.issues[p.issue] : "") +
        "\n\n" +
        this.marker(r, p.id);
      const pr = await gh.get(root + "/pulls/" + r.prs[p.id].number);
      if (pr.body !== body)
        await gh.patch(root + "/pulls/" + r.prs[p.id].number, { body });
    }
    await gh.patch(root + "/issues/" + r.master, {
      body: storyBody(r) + "\n\n" + this.marker(r, "master"),
    });
    await this.humanTouches(r, gh);
    r.phase = "active";
    this.store.save(r);
  }
  async pinBaseline(r: Run, gh: GitHub) {
    if (!r.baselineFiles) {
      if (!r.baseline) throw new Error("Run has no validated baseline commit");
      // Existing runs were validated when created. Read their immutable commit,
      // never the current default branch or the latest published template.
      r.baselineFiles = await gh.tree(this.root(r), r.baseline);
      this.store.save(r);
    }
  }
  async reconcile(r: Run, gh: GitHub) {
    const { baseline, issues, proposals, pack, title } = scenarioFor(r);
    const variant = (id: string, revision: number) =>
      authoredVariant(r, id, revision);
    await this.pinBaseline(r, gh);
    const root = this.root(r),
      snapshot: Record<string, any> = {};
    r.warnings = [];
    r.unverifiedIssues = [];
    const before = (await gh.get(root + "/git/ref/heads/" + r.base)).object.sha;
    for (const p of proposals) {
      const state = r.prs[p.id],
        pr = await gh.get(root + "/pulls/" + state.number);
      snapshot[p.id] = pr;
      delete state.unscored;
      if (
        pr.head.sha !== state.head ||
        pr.base.ref !== r.base ||
        pr.head.repo?.id !== r.repository
      )
        state.unscored =
          "The PR branch or target differs from its prepared revision.";
      // Seeded/prepared commit IDs are immutable and their content was authored here.
      if (pr.merged_by && pr.merged_by.id !== r.player)
        state.unscored =
          "Another collaborator merged this PR; the player decision was not assessed.";
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
    const groups = new Map<string, string[]>();
    for (const p of proposals) {
      if (r.prs[p.id].outcome === "merged" && p.group)
        groups.set(p.group, [...(groups.get(p.group) ?? []), p.id]);
    }
    for (const ids of groups.values())
      if (ids.length > 1)
        for (const id of ids)
          r.prs[id].unscored =
            "Both competing implementations were merged; their combined behavior is not covered by the rubric.";
    const expected = expectedFiles(r);
    const hash = createHash("sha256")
      .update(JSON.stringify(Object.entries(expected).sort()))
      .digest("hex");
    let files: Record<string, string> | undefined;
    try {
      files =
        before === r.tree && r.observedFiles
          ? r.observedFiles
          : await gh.tree(root, before);
    } catch (error: any) {
      if (
        !/^(Unsupported file type|Unsupported truncated tree|Oversized file)$/.test(
          error.message,
        )
      )
        throw error;
      r.warnings.push(
        "Repository content could not be compared within the exercise limits.",
      );
      for (const p of proposals)
        if (r.prs[p.id].outcome === "merged")
          r.prs[p.id].unscored =
            "Merged content could not be verified within the exercise limits.";
      r.unverifiedIssues = issues.map((i) => i.id);
    }
    const after = (await gh.get(root + "/git/ref/heads/" + r.base)).object.sha;
    if (before !== after)
      throw new SnapshotChanged("Repository changed during assessment");
    for (const [id, pr] of Object.entries(snapshot)) {
      const latest = await gh.get(root + "/pulls/" + pr.number);
      if (
        latest.head.sha !== pr.head.sha ||
        latest.state !== pr.state ||
        latest.merged !== pr.merged
      )
        throw new SnapshotChanged("PR changed during assessment");
    }
    if (files) {
      const changed = [
        ...new Set([...Object.keys(files), ...Object.keys(expected)]),
      ].filter((path) => files![path] !== expected[path]);
      if (changed.length)
        r.warnings.push(
          "Default-branch changes outside the prepared contributions were detected.",
        );
      for (const path of changed) {
        const owners = proposals.filter(
          (p) => path in variant(p.id, r.prs[p.id].revision).files,
        );
        for (const p of owners) {
          if (p.issue) r.unverifiedIssues.push(p.issue);
          if (r.prs[p.id].outcome === "merged")
            r.prs[p.id].unscored =
              "The resulting file differs from the prepared contribution.";
        }
        // Shared code/configuration can affect every feature. Documentation alone cannot.
        if (!owners.length && !/\.(md|txt)$/.test(path) && path !== "LICENSE") {
          r.unverifiedIssues.push(...issues.map((i) => i.id));
          for (const p of proposals)
            if (r.prs[p.id].outcome === "merged")
              r.prs[p.id].unscored =
                "Changes outside the prepared contributions may affect the merged behavior.";
        }
      }
    }
    for (const p of proposals)
      if (r.prs[p.id].unscored) {
        r.warnings.push(`PR #${r.prs[p.id].number}: ${r.prs[p.id].unscored}`);
        if (p.issue && r.prs[p.id].outcome === "merged")
          r.unverifiedIssues.push(p.issue);
      }
    r.unverifiedIssues = [...new Set(r.unverifiedIssues)];
    r.observedFiles = files;
    r.tree = before;
    r.contentHash = hash;
    this.store.save(r);
  }
  async humanTouches(r: Run, gh: GitHub) {
    r.storySent ??= {};
    for (const [id, state] of Object.entries(r.prs)) {
      const key =
        state.revision > 0 ? `reply-${id}-${state.revision}` : `context-${id}`;
      const body = state.revision > 0 ? revisionReply(r, id) : followup(r, id);
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
    const { baseline, issues, proposals, pack, title } = scenarioFor(r);
    const variant = (id: string, revision: number) =>
      authoredVariant(r, id, revision);
    const p = proposals.find((p) => r.prs[p.id].number === number);
    if (!p) throw new Error("Not a scenario PR");
    const state = r.prs[p.id];
    if (state.outcome !== "open") return;
    if (state.unscored) {
      await this.notice(
        r,
        gh,
        "revision-skipped-" + p.id,
        "The branch for PR #" +
          number +
          " differs from the prepared exercise. Automatic revisions are unavailable for it, but you can still merge, close, or finish the stage. Its assessment will be marked unscored.",
      );
      return;
    }
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
    const previous = applyVariant(
      { ...r.baselineFiles },
      p.variants[state.revision],
    );
    const target = applyVariant({ ...r.baselineFiles }, next);
    const files = Object.fromEntries(
      Object.entries(target).filter(
        ([path, content]) => previous[path] !== content,
      ),
    );
    const deletes = Object.keys(previous).filter((path) => !(path in target));
    const commit = await gh.commit(
      root,
      state.head,
      files,
      "Community revision",
      deletes,
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
      if (head !== intent.head && head !== intent.old) {
        this.store.db.prepare("DELETE FROM deliveries WHERE id=?").run(row.id);
        continue; // Preserve external edits; reconcile marks this PR unscored.
      }
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
        body:
          debrief(r) +
          "\n\n" +
          communityUpdate(r) +
          (scenarioFor(r).next
            ? "\n\nComment `/game next` here to start the next stage from its authored snapshot. This stage remains on its current branch and its result is frozen."
            : "") +
          "\n\n" +
          marker,
      });
    // GitHub closing keywords only close issues on the default branch. Later
    // authored stages use their own branches, so reflect verified delivery here.
    if (r.scenario) {
      for (const id of r.result!.complete)
        await gh.patch(root + "/issues/" + r.issues[id], { state: "closed" });
      if (r.result!.success)
        await gh.patch(root + "/milestones/" + r.milestone, {
          state: "closed",
        });
    }
    r.phase = "finished";
    this.store.save(r);
  }
  async nextStage(r: Run, gh: GitHub) {
    const stage = scenarioFor(r);
    if (!stage.next) {
      await this.notice(
        r,
        gh,
        "campaign-complete",
        "You have reached the end of this scenario. Your decisions and debriefs are preserved. Start a fresh playthrough from the launch page to try another approach.",
      );
      return;
    }
    const existing = this.store.all().find((x) => x.previousRun === r.id);
    if (existing) {
      if (existing.phase === "seeding") await this.seed(existing);
      return;
    }
    const target = stage.pack.stages.find((s) => s.id === stage.next)!;
    const root = this.root(r),
      branch = `play/${r.id}/${target.id}`;
    let sha: string;
    try {
      sha = (await gh.get(root + "/git/ref/heads/" + branch)).object.sha;
    } catch (error: any) {
      if (error.status !== 404) throw error;
      const parent = (await gh.get(root + "/git/ref/heads/" + r.base)).object
        .sha;
      const files = await gh.tree(root, parent);
      const commit = await gh.commit(
        root,
        parent,
        target.baseline,
        "Begin " + target.title,
        Object.keys(files).filter((path) => !(path in target.baseline)),
      );
      await gh.post(root + "/git/refs", {
        ref: "refs/heads/" + branch,
        sha: commit.sha,
      });
      sha = commit.sha;
    }
    if (!equal(await gh.tree(root, sha), target.baseline))
      throw Error("Next-stage branch was changed before setup");
    const next: Run = {
      id: r.id + "-" + target.id,
      installation: r.installation,
      repository: r.repository,
      owner: r.owner,
      repo: r.repo,
      player: r.player,
      phase: "seeding",
      issues: {},
      prs: {},
      findings: {},
      previousRun: r.id,
      master: r.master,
      base: branch,
      baseline: sha,
      scenario: selectScenario(stage.pack, target.id),
    };
    this.store.save(next);
    await this.seed(next);
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
        if (["finished", "inaccessible"].includes(r.phase)) continue;
        r.phaseBeforeAccessLoss = r.phase;
        r.phase = "inaccessible";
        this.store.save(r);
        continue;
      }
      if (
        r.phase === "finished" &&
        event === "issue_comment" &&
        payload.action === "created" &&
        payload.repository?.id === r.repository &&
        payload.issue?.number === r.master &&
        payload.comment?.user?.id === r.player &&
        command(payload.comment.body)?.kind === "next"
      ) {
        // Only the latest stage responds; old stages share the same story hub.
        const child = this.store.all().find((x) => x.previousRun === r.id);
        if (!child || child.phase === "seeding")
          await this.nextStage(r, await this.connect(r));
        continue;
      }
      const accessRestored =
        (event === "installation" &&
          ["created", "unsuspend"].includes(payload.action)) ||
        (event === "installation_repositories" &&
          payload.action === "added" &&
          payload.repositories_added?.some((x: any) => x.id === r.repository));
      if (r.phase === "inaccessible" && accessRestored) {
        r.phase = r.phaseBeforeAccessLoss ?? "active";
        delete r.phaseBeforeAccessLoss;
        this.store.save(r);
      }
      if (
        payload.repository?.id !== r.repository ||
        ["finished", "inaccessible", "seeding"].includes(r.phase)
      )
        continue;
      const gh = await this.connect(r);
      if (r.phase === "finishing") {
        await this.publish(r, gh);
        continue;
      }
      const { proposals } = scenarioFor(r);
      const variant = (id: string, revision: number) =>
        authoredVariant(r, id, revision);
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
        if (state.unscored) continue;
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
        if (!text.trim()) continue;
        const category = v.concern
          ? await judge.evaluate(text, v.concern, v.files)
          : undefined;
        // Coaching has no path into assess(), concern credit, or revision decisions.
        if (judge.coach && text.trim()) {
          r.coaching ??= {};
          const attempts = (r.coaching[p.id] ??= []);
          const fingerprint = createHash("sha256")
            .update(review.id + ":" + state.head + ":" + text)
            .digest("hex");
          if (
            attempts.length < 4 &&
            !attempts.some((a) => a.fingerprint === fingerprint)
          ) {
            const attempt = {
              reviewId: review.id,
              revision: state.revision,
              fingerprint,
            } as import("./types.ts").CoachingAttempt;
            attempts.push(attempt);
            this.store.save(r);
            try {
              attempt.feedback = await judge.coach(text, v.files);
            } catch {
              /* Advisory failure never blocks gameplay. */
            }
            this.store.save(r);
          }
        }
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
    }
  }
}
