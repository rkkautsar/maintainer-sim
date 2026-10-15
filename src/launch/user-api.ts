import { z } from "zod";
import { parse, positiveId } from "../validation.ts";
export { createdRepositorySchema, userSchema } from "../github-schemas.ts";
export const installationsSchema = z.object({
  installations: z.array(
    z.object({
      id: positiveId,
      app_id: positiveId,
      account: z.object({ id: positiveId }),
      suspended_at: z.string().nullable().optional(),
    }),
  ),
});
export async function userRequest<T>(
  token: string,
  method: string,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const response = await fetch("https://api.github.com" + path, {
    method,
    headers: {
      authorization: "Bearer " + token,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "pr-flood",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw Object.assign(Error("GitHub request failed"), {
      status: response.status,
    });
  return parse(schema, await response.json());
}
