import { defineMiddleware } from "astro:middleware";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Local-only boundary (spec section 13): refuse non-loopback Host headers to
 * block DNS rebinding, require a same-origin Origin on every mutation, and
 * send restrictive security headers. No CORS headers are ever added.
 */
export const onRequest = defineMiddleware(async ({ request, url }, next) => {
  const allowAnyHost = process.env.MOTION_STUDIO_ALLOW_ANY_HOST === "1";
  if (!allowAnyHost && !LOOPBACK_HOSTNAMES.has(url.hostname)) {
    return new Response("Motion Studio only accepts loopback requests.", { status: 421 });
  }

  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin !== url.origin) {
      return Response.json(
        { error: { code: "ORIGIN_REJECTED", message: "Cross-origin requests are not allowed." } },
        { status: 403 },
      );
    }
  }

  const response = await next();
  const headers = response.headers;
  // Endpoints may set a stricter policy of their own (served SVGs do).
  if (!headers.has("Content-Security-Policy"))
    headers.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        // Inline scripts and styles are required by Astro island hydration and
        // the Vite dev client. No remote origins are permitted.
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob: data:",
        "font-src 'self' data:",
        "connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  return response;
});
