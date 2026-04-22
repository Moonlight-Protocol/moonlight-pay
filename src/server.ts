/**
 * Static file server for Moonlight Pay.
 * Serves files from public/ with security headers and path sanitization.
 */
import { normalize, resolve } from "@std/path";

function parsePort(raw: string | undefined): number {
  const value = raw ?? "3050";
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid PORT="${value}": must be an integer between 1 and 65535.`,
    );
  }
  return port;
}

const PORT = parsePort(Deno.env.get("PORT"));
const PUBLIC_ROOT = resolve(Deno.cwd(), "public");
const IS_PRODUCTION = Deno.env.get("MODE") === "production";

// HTTP-header security policies for the dev server. CSP is set per-response
// by getCSP() — only the dev server (this file) emits a CSP. Production
// goes through Tigris which doesn't run a proxy that could set headers
// (same gap as the council/provider consoles, accepted).
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function getCSP(): string {
  const connectSrc = [
    "'self'",
    "https://soroban-testnet.stellar.org",
    "https://horizon-testnet.stellar.org",
    "https://friendbot.stellar.org",
    "https://moonlight-beta-pay-platform.fly.dev",
  ];

  // In development, allow connections to local services
  if (Deno.env.get("MODE") === "development") {
    connectSrc.push("http://localhost:*");
    // Docker Compose: allow connections to service hostnames (e.g. http://pay:3025)
    const extraHosts = Deno.env.get("CSP_CONNECT_HOSTS");
    if (extraHosts) extraHosts.split(",").forEach((h) => connectSrc.push(h.trim()));
  }

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectSrc.join(" ")}`,
  ].join("; ");
}

const ASSET_EXTENSIONS = new Set([
  "html",
  "css",
  "js",
  "json",
  "map",
  "svg",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "ico",
  "webp",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "wasm",
]);

function addSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  headers.set("Content-Security-Policy", getCSP());
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

interface ResolvedPath {
  /** Decoded URL pathname (e.g. /foo.html — leading slash, never %XX). */
  decoded: string;
  /** Absolute filesystem path under PUBLIC_ROOT. */
  filePath: string;
}

/**
 * Decode and resolve `pathname` against PUBLIC_ROOT.
 * Returns null on:
 *   - malformed percent-encoding (URIError from decodeURIComponent),
 *   - traversal attempts (resolved path escapes PUBLIC_ROOT).
 *
 * Returns BOTH the decoded pathname and the absolute file path so callers
 * (cache-control selection, asset-vs-SPA heuristic) operate on the same
 * decoded form. Without this, /foo%2Ehtml would be decoded for filesystem
 * access but the raw form would be used by looksLikeAsset, leading to
 * inconsistent behavior.
 */
function safePath(pathname: string): ResolvedPath | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const resolved = resolve(PUBLIC_ROOT, "." + normalize("/" + decoded));
  if (!resolved.startsWith(PUBLIC_ROOT)) return null;
  return { decoded, filePath: resolved };
}

const contentTypes: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
};

/**
 * Pick a Cache-Control header for a request path. Three buckets:
 *   - HTML and config.js → no-cache. config.js holds the runtime
 *     payPlatformUrl; if we ever need to rotate it (URL compromised, etc.),
 *     a 1-hour stale cache means an hour of users hitting the old URL.
 *   - .map sourcemaps → no-cache. They're only served in dev.
 *   - everything else → 1-hour public cache.
 *
 * Note: app.js, styles.css and other long-lived assets are NOT
 * content-hashed (esbuild config doesn't do that yet) so this 1h cache is
 * a deliberate tradeoff between deploy freshness and bandwidth. Hashing
 * filenames is a future improvement.
 */
function cacheControlFor(pathname: string, ext: string): string {
  if (ext === "html" || pathname === "/config.js") {
    return "no-cache, no-store, must-revalidate";
  }
  if (ext === "map") {
    return "no-cache, no-store, must-revalidate";
  }
  return "public, max-age=3600";
}

/**
 * SPA fallback heuristic: a request looks like a file (not a route) when
 * its last segment ends in a known asset extension. Routes like
 * `/route.with.dot` keep falling through to the SPA shell.
 */
function looksLikeAsset(pathname: string): boolean {
  const lastSegment = pathname.split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = lastSegment.slice(dot + 1).toLowerCase();
  return ASSET_EXTENSIONS.has(ext);
}

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);
  let pathname = url.pathname;
  if (pathname === "/") pathname = "/index.html";

  const resolved = safePath(pathname);
  if (!resolved) {
    return addSecurityHeaders(new Response("Bad Request", { status: 400 }));
  }

  // Block sourcemaps in production. In dev they're useful for debugging
  // and esbuild is configured to emit them when MODE != production.
  // Use the decoded pathname so /foo%2Emap can't sneak past.
  if (IS_PRODUCTION && resolved.decoded.endsWith(".map")) {
    return addSecurityHeaders(new Response("Not Found", { status: 404 }));
  }

  try {
    const file = await Deno.readFile(resolved.filePath);
    const ext = resolved.filePath.split(".").pop() || "";
    return addSecurityHeaders(
      new Response(file, {
        headers: {
          "Content-Type": contentTypes[ext] || "application/octet-stream",
          "Cache-Control": cacheControlFor(resolved.decoded, ext),
        },
      }),
    );
  } catch {
    // Use the decoded pathname so /foo%2Ehtml is correctly classified
    // as an asset request (404), not a SPA route fallback.
    if (looksLikeAsset(resolved.decoded)) {
      return addSecurityHeaders(new Response("Not Found", { status: 404 }));
    }
    try {
      const index = await Deno.readFile(resolve(PUBLIC_ROOT, "index.html"));
      return addSecurityHeaders(
        new Response(index, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache, no-store, must-revalidate",
          },
        }),
      );
    } catch {
      return addSecurityHeaders(new Response("Not Found", { status: 404 }));
    }
  }
});

console.log(`Moonlight Pay running on http://localhost:${PORT}`);
