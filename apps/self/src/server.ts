import { resolve, normalize } from "jsr:@std/path";

const PORT = Number(Deno.env.get("PORT") || "3050");
const PUBLIC_ROOT = resolve(Deno.cwd(), "public");

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function getCSP(): string {
  const apiUrl = Deno.env.get("API_BASE_URL") || "http://localhost:3010";
  return [
    "default-src 'self'",
    "script-src 'self' https://us-assets.i.posthog.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https://stellar.creit.tech",
    `connect-src 'self' ${apiUrl} https://us.i.posthog.com`,
  ].join("; ");
}

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

function safePath(pathname: string): string | null {
  try {
    const decoded = decodeURIComponent(pathname);
    const resolved = resolve(PUBLIC_ROOT, "." + normalize("/" + decoded));
    if (!resolved.startsWith(PUBLIC_ROOT)) return null;
    return resolved;
  } catch {
    return null;
  }
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

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);
  let pathname = url.pathname;
  if (pathname === "/") pathname = "/index.html";

  if (pathname.endsWith(".map")) {
    return addSecurityHeaders(new Response("Not Found", { status: 404 }));
  }

  const filePath = safePath(pathname);
  if (!filePath) {
    return addSecurityHeaders(new Response("Forbidden", { status: 403 }));
  }

  try {
    const file = await Deno.readFile(filePath);
    const ext = filePath.split(".").pop() || "";
    const cacheControl = ext === "html"
      ? "no-cache, no-store, must-revalidate"
      : "public, max-age=3600";
    return addSecurityHeaders(new Response(file, {
      headers: {
        "Content-Type": contentTypes[ext] || "application/octet-stream",
        "Cache-Control": cacheControl,
      },
    }));
  } catch {
    const ext = pathname.split("/").pop()?.includes(".") ?? false;
    if (ext) {
      return addSecurityHeaders(new Response("Not Found", { status: 404 }));
    }
    try {
      const index = await Deno.readFile(resolve(PUBLIC_ROOT, "index.html"));
      return addSecurityHeaders(new Response(index, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      }));
    } catch {
      return addSecurityHeaders(new Response("Not Found", { status: 404 }));
    }
  }
});

console.log(`Moonlight Pay (Self) running on http://localhost:${PORT}`);
