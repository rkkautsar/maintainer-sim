import { createHash } from "node:crypto";
import { z } from "zod";
import { failureCode, report, type FailureCode } from "../diagnostics.ts";
import {
  reviewCriteria as criteria,
  readChoice,
  reviewInstructions,
} from "../judge-prompt.ts";
import type { Reviewer } from "../persistence.ts";
import {
  coachingQuestions,
  constructiveCriteria,
  decodeCoaching,
  encodeCoaching,
  focusCriteria,
} from "../review-coaching.ts";
import type { Finding, ReviewCoaching } from "../types.ts";
import { asRecord, parse } from "../validation.ts";
import type { Env } from "./env.ts";
type JudgeFallback =
  | FailureCode
  | "disabled"
  | "configuration"
  | "context_too_large"
  | "budget_exhausted"
  | "cached_unassessed"
  | "in_flight"
  | "unassessed_output";
export function unwrapJudgeResponse(input: unknown) {
  const data = asRecord(input);
  if (data.state === "Completed") return data.result;
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
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
      return this.fallback("configuration");
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
      (data) =>
        readChoice(
          asRecord(asRecord(data).answers).identification,
          criteria,
          threshold,
        ),
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
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
      return this.fallback("configuration");
    const result = await this.request(
      {
        state: { review, source: files },
        questions: coachingQuestions,
      },
      "coaching:" + threshold,
      (data) => {
        const feedback = {
          constructiveness: readChoice(
            asRecord(asRecord(data).answers).constructiveness,
            constructiveCriteria,
            threshold,
          ),
          focus: readChoice(
            asRecord(asRecord(data).answers).focus,
            focusCriteria,
            threshold,
          ),
        };
        return feedback.constructiveness || feedback.focus
          ? encodeCoaching(feedback)
          : undefined;
      },
      (value) => !!decodeCoaching(value),
    );
    return decodeCoaching(result);
  }
  private fallback(reason: JudgeFallback): undefined {
    report({ component: "judge", event: "fallback", reason });
    return undefined;
  }

  private async request(
    input: Record<string, unknown>,
    purpose: string,
    decode: (data: unknown) => string | undefined,
    valid: (result: unknown) => boolean,
  ): Promise<string | undefined> {
    if (this.env.JUDGE_ENABLED !== "true") return this.fallback("disabled");
    const payload = { ...input, model: "clef-flash" };
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized) > 20000)
      return this.fallback("context_too_large");
    const key = createHash("sha256")
      .update(
        "cf-review-v2:@cf/cloudflare/clef-flash:" + purpose + ":" + serialized,
      )
      .digest("hex");
    const budget = this.env.BUDGET.get(this.env.BUDGET.idFromName("global"));
    try {
      const claim = parse(
        z.object({
          claimed: z.boolean(),
          result: z.unknown().optional(),
          reason: z
            .enum([
              "configuration",
              "budget_exhausted",
              "cached_unassessed",
              "in_flight",
            ])
            .optional(),
        }),
        await (
          await budget.fetch("https://budget/claim", {
            method: "POST",
            body: JSON.stringify({ action: "claim", key }),
          })
        ).json(),
      );
      if (!claim.claimed)
        return valid(claim.result)
          ? (claim.result as string)
          : this.fallback(claim.reason ?? "cached_unassessed");
      // No gateway override: use standard Workers AI billing and its Neuron allowance.
      // The binding SDK lags this model's structured-choice API. Keep its
      // extension at the adapter boundary and validate the unknown result below.
      const infer = this.env.AI.run.bind(this.env.AI) as (
        model: string,
        input: Record<string, unknown>,
      ) => Promise<unknown>;
      const data = unwrapJudgeResponse(
        await infer("@cf/cloudflare/clef-flash", payload),
      );
      const result = decode(data);
      const tokens = asRecord(asRecord(data).usage).input_tokens;
      if (
        typeof tokens === "number" &&
        Number.isSafeInteger(tokens) &&
        tokens >= 0 &&
        tokens <= 32000
      )
        await budget.fetch("https://budget/complete", {
          method: "POST",
          body: JSON.stringify({
            action: "complete",
            key,
            result: result ?? null,
            inputTokens: tokens,
          }),
        });
      return result ?? this.fallback("unassessed_output");
    } catch (error) {
      return this.fallback(failureCode(error));
    }
  }
}
