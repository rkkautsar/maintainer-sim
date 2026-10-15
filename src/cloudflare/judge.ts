import {
  reviewCriteria as criteria,
  reviewInstructions,
  readChoice,
} from "../judge-prompt.ts";
import {
  coachingQuestions,
  constructiveCriteria,
  focusCriteria,
  encodeCoaching,
  decodeCoaching,
} from "../review-coaching.ts";
import { createHash } from "node:crypto";
import type { Env } from "./env.ts";
import type { Reviewer } from "../persistence.ts";
import type { Finding, ReviewCoaching } from "../types.ts";
export function unwrapJevResponse(data: any) {
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
    const threshold = Number(this.env.JUDGE_CONFIDENCE_THRESHOLD);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) return;
    const result = await this.request(
      {
        state: { review, expectedConcern: concern, source: files },
        questions: {
          identification: {
            type: "choice",
            instructions: reviewInstructions,
            criteria,
          },
        },
      },
      "identification:" + threshold,
      (data) => readChoice(data?.answers?.identification, criteria, threshold),
      (value) => typeof value === "string" && Object.hasOwn(criteria, value),
    );
    return result as Finding["category"] | undefined;
  }
  async coach(
    review: string,
    files: Record<string, string>,
  ): Promise<ReviewCoaching | undefined> {
    if (this.env.REVIEW_COACHING_ENABLED !== "true" || !review.trim()) return;
    const threshold = Number(this.env.COACH_CONFIDENCE_THRESHOLD ?? 0.3);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) return;
    const result = await this.request(
      {
        state: { review, source: files },
        questions: coachingQuestions,
      },
      "coaching:" + threshold,
      (data) => {
        const feedback = {
          constructiveness: readChoice(
            data?.answers?.constructiveness,
            constructiveCriteria,
            threshold,
          ),
          focus: readChoice(data?.answers?.focus, focusCriteria, threshold),
        } as ReviewCoaching;
        return feedback.constructiveness || feedback.focus
          ? encodeCoaching(feedback)
          : undefined;
      },
      (value) => !!decodeCoaching(value),
    );
    return decodeCoaching(result);
  }
  private async request(
    input: Record<string, unknown>,
    purpose: string,
    parse: (data: any) => string | undefined,
    valid: (result: unknown) => boolean,
  ): Promise<string | undefined> {
    if (this.env.JUDGE_ENABLED !== "true") return;
    const payload = { ...input, model: "clef-flash" };
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized) > 20000) return;
    const key = createHash("sha256")
      .update(
        "cf-review-v2:@cf/cloudflare/clef-flash:" + purpose + ":" + serialized,
      )
      .digest("hex");
    const budget = this.env.BUDGET.get(this.env.BUDGET.idFromName("global"));
    try {
      const claim = (await (
        await budget.fetch("https://budget/claim", {
          method: "POST",
          body: JSON.stringify({ action: "claim", key }),
        })
      ).json()) as any;
      if (!claim.claimed) return valid(claim.result) ? claim.result : undefined;
      // No gateway override: use standard Workers AI billing and its Neuron allowance.
      const data = unwrapJevResponse(
        await (this.env.AI.run as any)("@cf/cloudflare/clef-flash", payload),
      );
      const result = parse(data);
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
