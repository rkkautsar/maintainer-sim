# Scenario authoring and launch implementation

1. Introduce immutable scenario packages and run selection; preserve the existing Pocket Board package for old runs.
2. Build a CLI for scenario repos: `__scenario__` Markdown/YAML, hierarchical branch captures, validation, publishing, baseline export and preview.
3. Create a real runnable forum authoring repository with a substantial first stage, prepared revisions, evidence tests and contributor portraits.
4. Add a small Cloudflare-hosted scenario launch page, GitHub App OAuth, secure sessions and durable resumable repository creation/seeding.
5. Add campaign advancement from authored stage snapshots while preserving prior decisions.
6. Test authoring, content, scoring, auth and launch failure/retry paths; run browser QA and reviewer audit.
7. Deploy, publish source/scenario, verify the canonical launch page and report any remaining App configuration required.

Defaults: personal GitHub accounts first; private player repositories by default with a visibility choice; keep Jev off and the existing $1/day cap; export clean application history only; published packages are immutable and selected from a server registry.

Completed: package selection with legacy compatibility; agent authoring CLI; real Forum repo and immutable package; OAuth/launch UI and durable setup; preserved stage transitions; 70 passing tests and browser QA; reviewer blockers resolved.

Published the private forum-scenario repository with all authoring branches and v0.1.0. Deployed Worker version 41cc8b47-95ff-42f5-8950-e82bc7b4b764. Canonical launch page, health, public catalog, preview/about pages and portraits return 200. The legacy playthrough remains finished at 12/12. Live GitHub OAuth intentionally remains disabled until the user adds the client secret and configures callback, installation setup URL and repository-creation permission.
