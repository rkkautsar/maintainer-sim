import type { Proposal } from "./types.ts";
export const version = "pocket-board-v1";
export { baseline } from "./baseline.ts";
export const issues = [
  {
    id: "likes",
    title: "Add idempotent likes",
    body: "A user may like a post once. Repeating the same user must not increase the count. Do not mutate the input; an unchanged post may be returned when the user already liked it.",
  },
  {
    id: "edit",
    title: "Allow only owners to edit posts",
    body: "Editing must require the actor to match post.ownerId. A forbidden edit throws. Preserve the original post.",
  },
  {
    id: "page",
    title: "Add bounded pagination",
    body: "Return up to limit items starting at offset. Require integer offset >= 0 and integer limit between 1 and 50; reject invalid values.",
  },
];
const likes = `import type { Post } from './model.ts';
export function like(post: Post, userId: string): Post {
  if (post.likedBy.includes(userId)) return post;
  return { ...post, likedBy: [...post.likedBy, userId] };
}
`;
const edit = `import type { Post } from './model.ts';
export function edit(post: Post, actor: string, title: string): Post {
  if (actor !== post.ownerId) throw new Error('Forbidden');
  return { ...post, title };
}
`;
const page = `export function page<T>(items: T[], offset: number, limit: number): T[] {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid pagination');
  return items.slice(offset, offset + limit);
}
`;
export const proposals: Proposal[] = [
  {
    id: "a",
    title: "Add like support",
    body: "Adds an immutable like operation.",
    issue: "likes",
    group: "likes",
    variants: [
      {
        files: { "src/likes.ts": likes },
        sound: true,
        explanation:
          "Idempotent likes satisfy the issue without extra machinery.",
      },
    ],
  },
  {
    id: "b",
    title: "Add an extensible reaction pipeline",
    body: "Adds like support through a reaction pipeline.",
    issue: "likes",
    group: "likes",
    variants: [
      {
        files: {
          "src/likes.ts": `import type { Post } from './model.ts';
type Step = (p: Post) => Post;
class ReactionPipeline {
  private steps: Step[] = [];
  use(step: Step) { this.steps.push(step); return this; }
  run(p: Post) { return this.steps.reduce((value, step) => step(value), p); }
}
export function like(post: Post, userId: string): Post {
 return new ReactionPipeline().use(p => p.likedBy.includes(userId) ? p : { ...p, likedBy: [...p.likedBy, userId] }).run(post);
}
`,
        },
        sound: false,
        satisfiesIssue: true,
        debt: "Unneeded reaction pipeline",
        concern:
          "The reaction pipeline and step registry add indirection for one fixed like operation. No extension requirement exists; a direct immutable function is easier to maintain.",
        explanation:
          "Behavior works, but the framework adds avoidable maintenance cost.",
      },
      {
        files: { "src/likes.ts": likes },
        sound: true,
        explanation: "The prepared revision removes the unnecessary pipeline.",
      },
    ],
  },
  {
    id: "c",
    title: "Add post editing",
    body: "Supports editing a title without mutating the original.",
    issue: "edit",
    variants: [
      {
        files: {
          "src/edit.ts": `import type { Post } from './model.ts';
export function edit(post: Post, actor: string, title: string): Post {
 return { ...post, title };
}
`,
        },
        sound: false,
        serious: true,
        concern:
          "actor is unused; there is no ownership check, so another user can edit a post.",
        explanation: "Merging permits unauthorized edits.",
      },
      {
        files: { "src/edit.ts": edit },
        sound: true,
        explanation: "The revision checks ownership before applying the edit.",
      },
    ],
  },
  {
    id: "d",
    title: "Add pagination helper",
    body: "Adds a bounded pagination helper.",
    issue: "page",
    variants: [
      {
        files: {
          "src/page.ts": `export function page<T>(items: T[], offset: number, limit: number): T[] {
  if (offset < 0 || limit < 1 || limit > 50) throw new Error('Invalid pagination');
  return items.slice(offset, offset + limit);
}
`,
        },
        sound: false,
        concern:
          "Range comparisons do not reject NaN or fractional values. NaN makes every comparison false, and slice coerces these inputs instead of rejecting them. The issue requires integer offset and limit.",
        explanation:
          "Ordinary pages work, but malformed numeric inputs silently produce unintended pages. The prepared fix must validate integers before applying bounds.",
      },
      {
        files: { "src/page.ts": page },
        sound: true,
        explanation:
          "Validates bounds and uses offset + limit for the end index.",
      },
    ],
  },
  {
    id: "e",
    title: "Normalize whitespace in titles",
    body: "Community fix: strip leading and trailing whitespace.",
    variants: [
      {
        files: {
          "src/title.ts": `export function normalizeTitle(title: string): string { return title.trim(); }
`,
        },
        sound: true,
        explanation:
          "A small useful improvement. Merging or deferring it is reasonable.",
      },
    ],
  },
  {
    id: "f",
    title: "Sort posts by recent update",
    body: "Community improvement: return posts ordered by update time.",
    variants: [
      {
        files: {
          "src/sort.ts":
            "import type { Post } from './model.ts';\n\n// Shared ordering for board consumers: newest first, stable tie-break by ID.\nexport function newest(posts: Post[]): Post[] {\n  const copy = [...posts];\n  copy.sort((a, b) => {\n    const timeDifference = b.updatedAt - a.updatedAt;\n    if (timeDifference !== 0) return timeDifference;\n    return a.id.localeCompare(b.id);\n  });\n  return copy;\n}\n",
        },
        sound: false,
        debt: "Duplicated post-ordering algorithm",
        concern:
          "newest duplicates byUpdatedAt in src/order.ts, already used by src/feed.ts. Delegate to that shared helper rather than maintaining a second copy of the sorting and ID tie-break logic.",
        explanation:
          "The diff behaves correctly in isolation, but duplicates a shared algorithm. Future ordering fixes could diverge between feed and newest.",
      },
      {
        files: {
          "src/sort.ts": `import type { Post } from './model.ts';
import { byUpdatedAt } from './order.ts';
export function newest(posts: Post[]): Post[] { return byUpdatedAt(posts); }
`,
        },
        sound: true,
        explanation:
          "The revision reuses the existing ordering helper, preserving immutable sorting and its tie-break policy.",
      },
    ],
  },
];
export function variant(id: string, revision: number) {
  const proposal = proposals.find((p) => p.id === id);
  if (!proposal || !Number.isInteger(revision) || !proposal.variants[revision])
    throw new Error("Unknown authored revision");
  return proposal.variants[revision];
}
