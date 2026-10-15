import { createHash } from "node:crypto";
import { z } from "zod";
import type { Env } from "../cloudflare/env.ts";
import { parse } from "../validation.ts";
import { LaunchError } from "./errors.ts";
import { same, secret } from "./security.ts";
import type { Job, Login, OAuthState } from "./types.ts";
import { userRequest, userSchema } from "./user-api.ts";
export async function authorize(
  request: Request,
  env: Env,
  storage: DurableObjectStorage,
): Promise<Response | undefined> {
  const url = new URL(request.url),
    path = url.pathname;
  if (path === "/start") {
    const { origin } = parse(
        z.object({ origin: z.string().url() }),
        await request.json(),
      ),
      state = secret(),
      verifier = secret();
    await storage.put("oauth", {
      state,
      verifier,
      expires: Date.now() + 600000,
      origin,
    });
    const due = await storage.getAlarm();
    if (!due || due > Date.now() + 600000)
      await storage.setAlarm(Date.now() + 600000);
    const target = new URL("https://github.com/login/oauth/authorize");
    target.search = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID!,
      redirect_uri: origin + "/auth/callback",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      scope: "offline_access",
    }).toString();
    return Response.json({ location: target.href });
  }
  if (path === "/auth/callback") {
    const oauth = await storage.transaction(async (txn) => {
      const value = await txn.get<OAuthState>("oauth");
      await txn.delete("oauth");
      return value;
    });
    if (
      !oauth ||
      oauth.expires < Date.now() ||
      !same(url.searchParams.get("state") ?? "", oauth.state) ||
      !url.searchParams.get("code")
    )
      throw new LaunchError("GitHub sign-in expired. Start again.", 400);
    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code: url.searchParams.get("code"),
          redirect_uri: oauth.origin + "/auth/callback",
          code_verifier: oauth.verifier,
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    const data = parse(
      z.object({
        access_token: z.string().optional(),
        expires_in: z.number().positive().optional(),
      }),
      await response.json(),
    );
    if (!response.ok || !data.access_token)
      throw new LaunchError(
        "GitHub authorization failed. Try connecting again.",
        401,
      );
    const user = await userRequest(
      data.access_token,
      "GET",
      "/user",
      userSchema,
    );
    if (
      !Number.isSafeInteger(user.id) ||
      !/^[A-Za-z0-9-]+$/.test(user.login) ||
      user.type !== "User"
    )
      throw new LaunchError(
        "Use a personal GitHub account for this preview.",
        400,
      );
    const previousJob = await storage.get<Job>("job");
    if (previousJob && previousJob.owner !== user.id)
      await storage.delete("job");
    const login: Login = {
      user: { id: user.id, login: user.login },
      token: data.access_token,
      csrf: secret(),
      expires:
        Date.now() + Math.min(Number(data.expires_in ?? 3600), 3600) * 1000,
      origin: oauth.origin,
    };
    await storage.put("login", login);
    const job = await storage.get<Job>("job");
    await storage.setAlarm(
      job && !["ready", "failed", "waiting-access"].includes(job.state)
        ? Date.now() + 100
        : login.expires,
    );
    return new Response(null, {
      status: 302,
      headers: {
        location: oauth.origin + "/",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  }
}
