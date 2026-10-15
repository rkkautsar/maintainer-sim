import type { Post } from './model.ts';
import { byUpdatedAt } from './order.ts';

export function feed(posts: Post[]): Post[] {
  return byUpdatedAt(posts);
}
