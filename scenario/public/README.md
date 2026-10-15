# Pocket Board

A small, runnable neighborhood noticeboard: vanilla browser UI, Node.js API, and SQLite persistence. No package dependencies or external services.

## Play Maintainer Sim

1. Select **Use this template → Create a new repository** on [the template repository](https://github.com/rkkautsar/pocket-board-template). Create it under your own account.
2. [Install the Maintainer Sim GitHub App](https://github.com/apps/maintainer-sim/installations/new). Choose **Only select repositories**, select your new repository, and install. If the App is already installed, open its **Configure** page and add the new repository to its access list.
3. Wait for **Game Master issue #1** to appear in your new repository. The App automatically creates the stage milestone, issues, and pull requests. Follow that issue for the story and game instructions.

Start with a fresh repository: leave its files unchanged and avoid creating issues or pull requests until setup finishes. Your role is to review contributions and decide what to merge, close, or request changes on; you do not need to write code. Installing the App on the template itself does not start a game.

## Run Pocket Board locally

Requires Node.js 24 or newer. From this repository:

```bash
npm start
```

Open http://localhost:3001. Select a demo user, read seeded notices, and create a post. Data persists in `data/board.sqlite`, which is ignored by Git. Set `PORT` or `BOARD_DATABASE` to override defaults.

The starting app works before the milestone. Likes, owner-only editing, and pagination are pending contributions; the UI marks them unavailable until their helper is implemented. Restart after merging a PR to load the changed code. Review from GitHub and use the Game Master issue for the story and prepared revisions.

Demo users are a local role-switching aid, not production authentication. The API identifies them with `x-demo-user`. The server binds localhost; do not deploy this demo as a public authenticated service.

The source is small enough to explore beyond a diff. Inspect existing consumers and helpers before adding new logic. Ordinary output can look correct even when requirements, input boundaries, or maintenance costs are wrong.
