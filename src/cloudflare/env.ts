export interface Env {
  ASSETS?: Fetcher;
  SCENARIO_REPOSITORIES?: string;
  LAUNCHES?: DurableObjectNamespace;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_APP_SLUG?: string;
  PUBLIC_ORIGIN?: string;
  GAMES: DurableObjectNamespace;
  BUDGET: DurableObjectNamespace;
  AI: Ai;
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
  WEBHOOK_SECRET: string;
  ADMIN_TOKEN: string;
  JUDGE_ENABLED: string;
  REVIEW_COACHING_ENABLED?: string;
  COACH_CONFIDENCE_THRESHOLD?: string;
  JUDGE_CONFIDENCE_THRESHOLD: string;
  JUDGE_INPUT_USD_PER_MILLION: string;
  AI_DAILY_BUDGET_USD: string;
}
