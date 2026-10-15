export interface Env {
  GAMES: DurableObjectNamespace;
  BUDGET: DurableObjectNamespace;
  AI: Ai;
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
  WEBHOOK_SECRET: string;
  ADMIN_TOKEN: string;
  JEV_CALIBRATED: string;
  JEV_CONFIDENCE_THRESHOLD: string;
  JEV_INPUT_USD_PER_MILLION: string;
  AI_DAILY_BUDGET_USD: string;
  AI_GATEWAY_ID?: string;
}
