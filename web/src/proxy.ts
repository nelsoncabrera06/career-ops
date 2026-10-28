import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  checkRequest,
  corsHeaders,
  parseAllowedHosts,
  parseAllowedOrigins,
} from "@/lib/origin-guard.mjs";

// Single choke point over the API surface. Every /api request is gated on the
// same-origin + loopback guard before it can reach a route handler (which may
// spawn a child process or write the user's files). See origin-guard.mjs for
// the two-layer rationale (F1 drive-by CSRF, F2 LAN reachability).
//
// Opt in to extra hosts (e.g. a trusted LAN box) with a comma/space separated
// CAREER_OPS_WEB_ALLOWED_HOSTS; unset means loopback only.
//
// Opt in to extra *origins* the same way with CAREER_OPS_ALLOWED_ORIGINS;
// unset means none, which is the default and leaves the guard as strict as it
// was. It is what a local companion client needs: a browser extension calls
// from a chrome-extension:// origin, which Fetch Metadata always reports as
// "cross-site", so every one of its requests is refused otherwise.
//
// An allowlisted origin also gets CORS headers and its preflight answered here.
// Both are required for the browser to expose the response at all: the guard
// deciding "yes" is invisible to script that never receives the reply.
export function proxy(req: NextRequest) {
  const allowedOrigins = parseAllowedOrigins(process.env.CAREER_OPS_ALLOWED_ORIGINS);
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin, allowedOrigins);

  // Preflight: the browser asks before the real request, with no route to run.
  // Answering 204 here (instead of letting it fall through to a 405) is what
  // turns "the extension works" into something other than a CORS error.
  if (req.method === "OPTIONS" && cors) {
    return new NextResponse(null, { status: 204, headers: cors });
  }

  const decision = checkRequest({
    secFetchSite: req.headers.get("sec-fetch-site"),
    origin,
    host: req.headers.get("host"),
    allowedHosts: parseAllowedHosts(process.env.CAREER_OPS_WEB_ALLOWED_HOSTS),
    allowedOrigins,
  });
  if (!decision.ok) {
    return NextResponse.json({ error: decision.reason }, { status: decision.status, headers: cors ?? undefined });
  }
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(cors ?? {})) res.headers.set(k, v);
  return res;
}

export const config = { matcher: "/api/:path*" };
