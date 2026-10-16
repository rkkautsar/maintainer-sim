import type { Finding, ReviewCoaching, Run } from "./types.ts";
export type RevisionIntent = {
  run: string;
  id: string;
  old: string;
  head: string;
  revision: number;
};
export type MilestoneJudgement = {
  objective: string;
  evaluation?: {
    issueBreakdown: string;
    issueClarity: string;
    pullRequestQuality: string;
    reviewQuality: string;
  };
  testStatus: "passed" | "failed" | "pending" | "missing";
  clarificationRounds: number;
  issues: {
    number: number;
    title: string;
    body: string;
    conversation: string[];
  }[];
  pullRequests: {
    number: number;
    title: string;
    body: string;
    merged: boolean;
    diff: string;
    reviews: string[];
  }[];
};
export type MilestoneQuality = {
  issueBreakdown: number | null;
  issueClarity: number | null;
  pullRequestQuality: number | null;
  reviewQuality: number | null;
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
  gradeMilestone?(
    input: MilestoneJudgement,
  ): Promise<MilestoneQuality | undefined>;
}
