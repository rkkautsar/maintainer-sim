# Scenario authoring and launch implementation

1. Introduce immutable scenario packages and run selection; require explicit package selection for every run.
2. Build a CLI for scenario repos: `__scenario__` Markdown/YAML, hierarchical branch captures, validation, publishing, baseline export and preview.
3. Create a real runnable forum authoring repository with a substantial first stage, prepared revisions, evidence tests and contributor portraits.
4. Add a small Cloudflare-hosted scenario launch page, GitHub App OAuth, secure sessions and durable resumable repository creation/seeding.
5. Add campaign advancement from authored stage snapshots while preserving prior decisions.
6. Test authoring, content, scoring, auth and launch failure/retry paths; run browser QA and reviewer audit.
7. Deploy, publish source/scenario, verify the canonical launch page and report any remaining App configuration required.

Defaults: personal GitHub accounts first; private player repositories by default with a visibility choice; enable Jev only after calibration and keep the existing $1/day cap; export clean application history only; published packages are immutable and selected from a server registry.

Completed: explicit package selection; agent authoring CLI; real Forum repo and immutable package; OAuth/launch UI and durable setup; preserved stage transitions; 60 passing tests and browser QA; reviewer blockers resolved.

Published the private forum-scenario repository with all authoring branches and v0.1.0. Deployed Worker version b17ef10c-0322-4881-8977-f5869537c962. Canonical launch page, health, public catalog, preview/about pages and portraits return 200. The user configured the GitHub App and supplied the client secret through ignored .env. Uploaded it to Worker secrets. Verified App and installation have repository-creation write permission; live session readiness is true and sign-in redirects to GitHub with the expected client ID, callback, PKCE and secure cookie. Completing browser authorization and creating a real playthrough remain the final live checks.

Removed the unused template setup, Pocket Board content, unversioned scenario fallback, paused-run migration, and superseded handoff/review documents. The launcher and authored Forum package are the supported flow.

Jev trial: clearer mutually exclusive review levels reduced abstention from 13/20 to 2/20 without lowering the 0.9 threshold. A fresh 12-review set accepted 10, abstained on two, and awarded no false credit. Enabled the trial with the shared $1/day cap; deterministic fallback remains available.

Clef-flash trial: replaced the deployed Jev judge with standard Workers AI Clef-flash. Added separate advisory review coaching in debriefs, capped at four attempts per PR, with no changes to deterministic scores or revision triggers from coaching. The shared inference cap remains $1/day. Current settings and measured calibration results are in docs/JUDGE.md.
