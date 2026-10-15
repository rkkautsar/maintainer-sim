import type { Post } from './model.ts';

// Shared ordering for board consumers: newest first, stable tie-break by ID.
export function byUpdatedAt(posts: Post[]): Post[] {
  const copy = [...posts];
  copy.sort((a, b) => {
    const timeDifference = b.updatedAt - a.updatedAt;
    if (timeDifference !== 0) return timeDifference;
    return a.id.localeCompare(b.id);
  });
  return copy;
}
