import { z } from "zod";
import type { Env } from "../cloudflare/env.ts";
import { parse } from "../validation.ts";
import { hash, originFor, secret, sessionId } from "./security.ts";
export async function launchRoute(
  request: Request,
  env: Env,
): Promise<Response | undefined> {
  const url = new URL(request.url),
    path = url.pathname;
  if (
    ![
      "/auth/start",
      "/auth/callback",
      "/api/session",
      "/api/logout",
      "/api/launch",
      "/api/launch/status",
      "/api/launch/retry",
    ].includes(path)
  )
    return;
  if (!env.LAUNCHES)
    return Response.json(
      { error: "Launch service is not configured." },
      { status: 503 },
    );
  if (path === "/auth/start" && request.method === "GET") {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET)
      return Response.json(
        { error: "GitHub authorization is not configured yet." },
        { status: 503 },
      );
    const gate = env.LAUNCHES.get(
      env.LAUNCHES.idFromName(
        "auth-rate:" + hash(request.headers.get("cf-connecting-ip") ?? "local"),
      ),
    );
    const allowed = await gate.fetch("https://session/auth-limit", {
      method: "POST",
    });
    if (!allowed.ok) return allowed;
    const sid = sessionId(request) ?? secret(),
      stub = env.LAUNCHES.get(env.LAUNCHES.idFromName(hash(sid)));
    const result = await stub.fetch("https://session/start", {
      method: "POST",
      body: JSON.stringify({ origin: originFor(env, request) }),
    });
    const { location } = parse(
      z.object({ location: z.string() }),
      await result.json(),
    );
    return new Response(null, {
      status: 302,
      headers: {
        location,
        "set-cookie": `__Host-maintainer-session=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
        "cache-control": "no-store",
      },
    });
  }
  const sid = sessionId(request);
  if (!sid) {
    if (path === "/api/session")
      return Response.json({ ready: !!env.GITHUB_CLIENT_SECRET, user: null });
    return Response.json({ error: "Connect GitHub first." }, { status: 401 });
  }
  if (
    request.method === "POST" &&
    request.headers.get("origin") !== originFor(env, request)
  )
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 16000)
    return Response.json({ error: "Request too large." }, { status: 413 });
  let body: string | undefined;
  if (request.method === "POST") {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 16000) {
          await reader.cancel();
          return Response.json(
            { error: "Request too large." },
            { status: 413 },
          );
        }
        chunks.push(value);
      }
    body = Buffer.concat(chunks).toString("utf8");
  }
  if (body && body.length > 16000)
    return Response.json({ error: "Request too large." }, { status: 413 });
  return env.LAUNCHES.get(env.LAUNCHES.idFromName(hash(sid))).fetch(
    "https://session" + path + (path === "/auth/callback" ? url.search : ""),
    {
      method: request.method,
      redirect: "manual",
      headers: {
        "x-csrf-token": request.headers.get("x-csrf-token") ?? "",
        "content-type": "application/json",
      },
      body,
    },
  );
}
