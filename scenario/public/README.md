# Pocket Board

A small, runnable neighborhood noticeboard: vanilla browser UI, Node.js API, and SQLite persistence. No package dependencies or external services.

Requires Node.js 24 or newer. From this repository:

```bash
npm start
```

Open http://localhost:3001. Select a demo user, read seeded notices, and create a post. Data persists in `data/board.sqlite`, which is ignored by Git. Set `PORT` or `BOARD_DATABASE` to override defaults.

The starting app works before the milestone. Likes, owner-only editing, and pagination are pending contributions; the UI marks them unavailable until their helper is implemented. Restart after merging a PR to load the changed code. Review from GitHub and use the Game Master issue for the story and prepared revisions.

Demo users are a local role-switching aid, not production authentication. The API identifies them with `x-demo-user`. The server binds localhost; do not deploy this demo as a public authenticated service.

The source is small enough to explore beyond a diff. Inspect existing consumers and helpers before adding new logic. Ordinary output can look correct even when requirements, input boundaries, or maintenance costs are wrong.
