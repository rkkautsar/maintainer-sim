import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Env } from "../cloudflare/env.ts";
export const secret = () => randomBytes(32).toString("hex");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const same = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
export function sessionId(request: Request) {
  return /(?:^|;\s*)__Host-maintainer-session=([a-f0-9]{64})(?:;|$)/.exec(
    request.headers.get("cookie") ?? "",
  )?.[1];
}
export function originFor(env: Env, request: Request) {
  return env.PUBLIC_ORIGIN ?? new URL(request.url).origin;
}
