import {
  reviewCriteria as criteria,
  reviewInstructions,
  validReviewProbabilities,
} from "../judge-prompt.ts";
import { createHash } from "node:crypto";
import type { Env } from "./env.ts";
import type { Reviewer } from "../persistence.ts";
import type { Finding } from "../types.ts";
export function unwrapJevResponse(data: any) {
  // The live AI binding returns a completion envelope; some adapters return the result directly.
  if (data?.state === "Completed") return data.result;
  if (typeof data?.state === "string") return undefined;
  return data;
}
export class CloudJudge implements Reviewer {
  env: Env;
  constructor(env: Env) {
    this.env = env;
  }
  async evaluate(
    review: string,
    concern: string,
    files: Record<string, string>,
  ): Promise<Finding["category"] | undefined> {
    if (this.env.JEV_CALIBRATED !== "true") return;
    const threshold = Number(this.env.JEV_CONFIDENCE_THRESHOLD);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) return;
    const input = {
      state: { review, expectedConcern: concern, source: files },
      questions: {
        identification: {
          type: "choice",
          instructions: reviewInstructions,
          criteria,
        },
      },
    };
    const serialized = JSON.stringify(input);
    if (Buffer.byteLength(serialized) > 24000) return;
    const key = createHash("sha256")
      .update("cf-judge-v1:typesafe/jev:" + threshold + ":" + serialized)
      .digest("hex");
    const budget = this.env.BUDGET.get(this.env.BUDGET.idFromName("global"));
    try {
      const claim = (await (
        await budget.fetch("https://budget/claim", {
          method: "POST",
          body: JSON.stringify({ action: "claim", key }),
        })
      ).json()) as any;
      if (!claim.claimed)
        return Object.hasOwn(criteria, claim.result) ? claim.result : undefined;
      const options = this.env.AI_GATEWAY_ID
        ? {
            gateway: {
              id: this.env.AI_GATEWAY_ID,
              skipCache: true,
              collectLog: false,
              retries: { maxAttempts: 1 },
              requestTimeoutMs: 10000,
            },
          }
        : undefined;
      const raw = await (this.env.AI.run as any)(
        "typesafe/jev",
        input,
        options,
      );
      const data = unwrapJevResponse(raw);
      const a = data?.answers?.identification;
      let result: Finding["category"] | undefined;
      const probs = a?.probabilities;
      if (
        a?.type === "choice" &&
        Object.hasOwn(criteria, a.choice) &&
        Number.isFinite(a.confidence) &&
        a.confidence >= threshold &&
        a.confidence <= 1 &&
        validReviewProbabilities(probs)
      )
        result = a.choice;
      const tokens = data?.usage?.input_tokens;
      if (Number.isSafeInteger(tokens) && tokens >= 0 && tokens <= 32000)
        await budget.fetch("https://budget/complete", {
          method: "POST",
          body: JSON.stringify({
            action: "complete",
            key,
            result: result ?? null,
            inputTokens: tokens,
          }),
        });
      return result;
    } catch {
      return;
    }
  }
}
