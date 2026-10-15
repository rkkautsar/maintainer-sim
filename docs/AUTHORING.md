# Author a scenario repository

A scenario is a runnable application in Git, with `__scenario__` on its default authoring branch. Authors and agents edit normal source files and Markdown. No source GitHub issues or PRs are needed. The publisher creates player content from the annotations and code branches.

```text
__scenario__/
  scenario.yaml
  characters/maya.svg
  stages/launch/
    stage.md
    issues/voting.md
    prs/voting-simple.md
```

Code branches use this convention:

```text
stage/launch/base
stage/launch/voting-simple/initial
stage/launch/voting-framework/initial
stage/launch/voting-framework/rev-1
stage/growing/base
```

Never create a branch named `stage/launch`: Git cannot store that ref alongside its nested names. Keep the base fixed while authoring contributions. Each initial contribution descends from its stage base; each revision descends from the previous captured revision. Normal working branches can have any other names. An agent can implement code on a working branch, commit, then capture the revision with the CLI.

From the maintainer-sim checkout:

```sh
npm run scenario -- init /path/to/scenario
npm run scenario -- case /path/to/scenario launch voting-simple maya voting
npm run scenario -- capture /path/to/scenario launch voting-simple initial
npm run scenario -- validate /path/to/scenario
npm run scenario -- preview /path/to/scenario /tmp/forum-preview
npm run scenario -- publish /path/to/scenario scenario-packages
npm run bundle:packages
```

`capture` creates a named branch at the working checkout's current HEAD. It refuses to replace existing captures. To revise a capture while drafting, move the branch explicitly using Git and validate again. Published versions are immutable: increment `version` for changes. Keep previously deployed package JSON files so active runs can resolve their pinned version.

The preview command exports a runnable clean baseline and a Markdown review of initial contributions. Run the exported app using its README. It does not create GitHub objects; the launch page is the end-to-end GitHub preview. Publishing validates content without executing repository scripts. Run trusted authored app tests separately, including defect witnesses and a canonical successful set of contributions.

`scenario.yaml`:

```yaml
schema: 1
id: forum
version: 0.1.0
title: Forum
description: Maintain a growing community forum.
characters:
  maya:
    name: Maya
    role: Regular contributor
stages: [launch, growing]
```

Provide one simple text SVG portrait at `__scenario__/characters/<character-id>.svg`. The publisher rejects scripting, embedded images, links, event handlers, styles, entities and external references. Names/roles are plain display text. The service hosts portraits under an immutable package digest; the player sees them inside App-authored Markdown. No GitHub identity is impersonated.

`stages/launch/stage.md`:

```markdown
---
title: The group chat is moving
endings:
  success: The release is ready for the community.
  incomplete: Some promises or accepted concerns still need attention.
  partial: Some changes need a manual check before release.
---

The community's problem, the release motivation, and the maintainer's brief.
```

`issues/voting.md`:

```markdown
---
id: voting
title: Vote once on useful threads
---

A member can vote once per thread. Repeated clicks must be idempotent.
Describe observable acceptance criteria rather than revealing an implementation.
```

`prs/voting-framework.md`:

```markdown
---
id: voting-framework
title: Add voting with an extensible pipeline
character: maya
issue: voting
group: voting
revisions: 1
assessment:
  initial:
    sound: false
    satisfiesIssue: true
    concern: The pipeline adds indirection without a current extension requirement.
    debt: Unnecessary voting pipeline
    explanation: Voting works, but the abstraction increases maintenance cost.
  rev-1:
    sound: true
    satisfiesIssue: true
    explanation: The revision uses a direct idempotent write.
    reply: I removed the pipeline. Reactions can wait for a concrete request.
---

Write a natural PR description with motivation, implementation scope, tests,
and any uncertainty the contributor would reasonably mention.

<!-- debrief -->

Explain the concrete review takeaway, evidence, and consequences.
```

`issue` and `group` are optional. An unsolicited PR omits `issue`; it still belongs to the stage. A competing implementation uses the same issue/group with a different case ID. There can be 0–3 prepared revisions. Initial assessment facts and each `rev-N` must be explicit; every flawed revision needs a concern, every revision needs an explanation, and fixed revisions need a contributor reply. Optional `followup` adds one initial contributor comment. `{{issue:some-id}}` and `{{pr:some-id}}` render destination numbers after creation; use stable IDs, not assumed GitHub numbers.

The Markdown separator is a publishing boundary, not secrecy. Everything after it and all YAML assessment data stay in the server package until debrief. `__scenario__` is excluded from every exported code tree and player commit. The player repository is created from fresh application commits, never forked from the authoring repository. Keep the authoring repository private if its answers should be hidden.

The v1 publisher deliberately supports regular UTF-8 files, at most 120 files / 400KB per snapshot, 100KB per file, 15 PRs per stage, 12 issues, 8 stages, and three prepared revisions. It rejects committed credentials, runtime data, binaries, symlinks and submodules. Deletions are represented explicitly; renames are delete/add. Independent contributions may not edit the same files; declared alternatives may. This gives agents actionable validation failures instead of introducing an arbitrary dependency graph.

A stage's next entry is the next item in `scenario.yaml`. After debrief the player can comment `/game next`. A new branch starts from the next authored snapshot, preserving previous history and frozen results. The same Game Master issue #1 is updated with the next brief. All pending prepared revisions and scoring stay deterministic. Jev remains an optional classifier of review text against the authored concern, with the same global budget.

A useful agent checklist: make the starting app genuinely usable; create changes across the natural UI/API/test boundaries; demonstrate each deliberate defect with an executable witness or reproduction; keep tests plausible rather than revealing the answer; check the canonical sound path; read the rendered story and descriptions; validate and publish. Prefer a few credible characters with specific motivations over a generic greeting on every PR.
