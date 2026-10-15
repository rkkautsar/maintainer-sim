import {
  reviewCriteria as criteria,
  reviewInstructions,
  validReviewProbabilities,
} from "./judge-prompt.ts";
import { createHash } from "node:crypto";
import type { Persistence } from "./persistence.ts";
import type { Finding } from "./types.ts";
export class Judge {
  store: Persistence & {
    reserve(key: string, cost: number, limit: number): boolean;
  };
  request: typeof fetch;
  constructor(
    store: Persistence & {
      reserve(key: string, cost: number, limit: number): boolean;
    },
    request = fetch,
  ) {
    this.store = store;
    this.request = request;
  }
  async evaluate(
    review: string,
    concern: string,
    files: Record<string, string>,
  ): Promise<Finding["category"] | undefined> {
    // Opt-in only after the operator has calibrated the classifier on labelled reviews.
    if (process.env.JEV_CALIBRATED !== "true" || !process.env.JEV_API_KEY)
      return;
    const rate = Number(process.env.JEV_INPUT_USD_PER_MILLION),
      limit = Number(process.env.AI_DAILY_BUDGET_USD ?? 1),
      threshold = Number(process.env.JEV_CONFIDENCE_THRESHOLD ?? 0.9);
    if (
      !Number.isFinite(rate) ||
      rate <= 0 ||
      !Number.isFinite(limit) ||
      limit < 0 ||
      !Number.isFinite(threshold) ||
      threshold < 0 ||
      threshold > 1
    )
      return;
    const body = JSON.stringify({
      model: process.env.JEV_MODEL ?? "jev-1.13.0",
      state: {
        review: review.slice(0, 12000),
        expectedConcern: concern,
        source: files,
      },
      questions: {
        identification: {
          type: "choice",
          instructions: reviewInstructions,
          criteria,
        },
      },
    });
    if (Buffer.byteLength(body) > 24000) return;
    const key = createHash("sha256")
      .update("judge-v1:" + threshold + ":" + body)
      .digest("hex");
    const cached = this.store.db
      .prepare("SELECT result FROM charges WHERE key=?")
      .get(key) as { result: string | null } | undefined;
    if (cached) return cached.result ? JSON.parse(cached.result) : undefined;
    // A conservative reservation of 32K input tokens covers this bounded request.
    if (!this.store.reserve(key, (32000 * rate) / 1000000, limit)) return;
    try {
      const response = await this.request(
        "https://api.typesafe.ai/v1/systemone",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + process.env.JEV_API_KEY,
            "Content-Type": "application/json",
          },
          body,
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) return;
      const data = (await response.json()) as any,
        a = data.answers?.identification;
      if (
        a?.type !== "choice" ||
        !Object.hasOwn(criteria, a.choice) ||
        !Number.isFinite(a.confidence) ||
        a.confidence < threshold ||
        a.confidence > 1
      )
        return;
      const probabilities = a.probabilities;
      if (!validReviewProbabilities(probabilities)) return;
      this.store.db
        .prepare("UPDATE charges SET result=? WHERE key=?")
        .run(JSON.stringify(a.choice), key);
      return a.choice;
    } catch {
      return;
    }
  }
}
