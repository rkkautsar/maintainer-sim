# Configure the GitHub launch page

The existing Cloudflare Worker serves `/`, the scenario catalog, portrait assets, GitHub App OAuth, and durable launch jobs. No template repository is required. Player-owned repositories start private by default; the player can select public before creation. Personal accounts are supported first. Each authenticated account can create at most five playthroughs per UTC day.

Configure the existing Maintainer Sim GitHub App:

- Homepage: `https://maintainer-sim.rkkautsar.workers.dev/`
- Callback URL: `https://maintainer-sim.rkkautsar.workers.dev/auth/callback`
- Setup URL: `https://maintainer-sim.rkkautsar.workers.dev/setup`
- Leave automatic OAuth-during-installation disabled: the launcher initiates its own state/PKCE flow.
- Permit installation on any account if inviting other players.
- Keep Contents, Issues and Pull requests write access, Metadata read, and the existing webhook subscriptions.
- Add **Repository creation: write** if available. GitHub's create-repository API also accepts **Administration: write**, but prefer the narrower creation permission. If GitHub offers only Administration, review that broader permission before changing the registration.
- Existing installations must approve newly requested permissions.

Create an App client secret. Save it locally in ignored `.env` as `GITHUB_CLIENT_SECRET=...`; never paste it into a tracked file, URL, or browser code. Add it to Worker secrets through stdin (`wrangler secret put GITHUB_CLIENT_SECRET`). `GITHUB_CLIENT_ID` is a public Wrangler variable and is distinct from the numeric App ID. The App private key and webhook secret remain existing Worker secrets.

Installation and user authorization are separate. The launcher checks the GitHub user, verifies the personal-account installation, creates a new repository with a per-launch marker, verifies installation-token access to that exact repository, initializes public-only code, and queues game seeding. When installation/access is missing, the page provides a GitHub link and explicit retry. Newly App-created repositories are documented to receive App access automatically, but the implementation verifies this rather than assuming it.

OAuth uses one-use expiring state and PKCE. Access tokens stay in server-side Durable Object storage for at most one hour; refresh tokens are discarded. The opaque session cookie is Secure, HttpOnly and SameSite=Lax. Creation uses POST, an origin check and a CSRF token. Launch intent is persisted before GitHub mutation; uncertain creation responses are recovered using repository owner, random launch marker, and creation time. Existing unrelated names are refused. Setup errors preserve the repository and support retries. The browser receives only public job status, never private assessment state or tokens.

Required live verification after registration changes: sign in, choose Forum, create a disposable private repository, verify one Game Master issue and ten initial PRs, inspect portraits, retry a reload during preparation, and finish/advance a stage. Runtime tests intercept external GitHub calls and verify the same flow without creating real repositories or paid AI calls. Those tests cannot prove the App registration has the required grants.

References: [repository creation](https://docs.github.com/en/rest/repos/repos#create-a-repository-for-the-authenticated-user), [App-created repository access](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party), [OAuth and PKCE](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app), [setup URL validation](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url).
