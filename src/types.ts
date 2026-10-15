export type Outcome = "open" | "merged" | "closed";
export type Phase =
  "seeding" | "active" | "paused" | "finishing" | "finished" | "inaccessible";
export type PRState = {
  number: number;
  revision: number;
  outcome: Outcome;
  head: string;
  reviews: Review[];
};
export type Review = {
  id: number;
  body: string;
  state: string;
  commit: string;
  submitted: string;
};
export type Finding = {
  reviewId: number;
  category: "absent" | "vague" | "identified" | "consequence";
  revision: number;
  reviewText?: string;
};
export type Run = {
  id: string;
  installation: number;
  repository: number;
  owner: string;
  repo: string;
  player: number;
  phase: Phase;
  reason?: string;
  baseline?: string;
  base?: string;
  milestone?: number;
  master?: number;
  issues: Record<string, number>;
  prs: Record<string, PRState>;
  tree?: string;
  contentHash?: string;
  findings: Record<string, Finding[]>;
  storySent?: Record<string, boolean>;
  result?: Assessment;
  finishEarly?: boolean;
};
export type Assessment = {
  complete: string[];
  total: number;
  points: number;
  maximum: number;
  success: boolean;
  harmful: string[];
  debt: string[];
  decisions: {
    id: string;
    outcome: string;
    points: number;
    explanation: string;
  }[];
  reasoning: string;
};
export type Variant = {
  files: Record<string, string>;
  sound: boolean;
  satisfiesIssue?: boolean;
  concern?: string;
  explanation: string;
  debt?: string;
  serious?: boolean;
};
export type Proposal = {
  id: string;
  title: string;
  body: string;
  issue?: string;
  group?: string;
  variants: Variant[];
};
