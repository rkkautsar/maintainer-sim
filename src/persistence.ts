import type { Finding, ReviewCoaching, Run } from "./types.ts";
export type RevisionIntent = {
  run: string;
  id: string;
  old: string;
  head: string;
  revision: number;
};
export interface Persistence {
  save(run: Run): void;
  get(id: string): Run;
  all(): Run[];
  forRepository(repository: number): Run[];
  recordRevision(intent: RevisionIntent): void;
  revisionIntents(run: string): RevisionIntent[];
  clearRevision(run: string, id: string): void;
}
export interface Reviewer {
  coach?(
    review: string,
    files: Record<string, string>,
  ): Promise<ReviewCoaching | undefined>;
  evaluate(
    review: string,
    concern: string,
    files: Record<string, string>,
  ): Promise<Finding["category"] | undefined>;
}
