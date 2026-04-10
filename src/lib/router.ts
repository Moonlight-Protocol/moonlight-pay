/**
 * Minimal hash-based router for SPA navigation.
 * Routes are defined as hash paths: #/login, #/deploy, #/providers, etc.
 *
 * Concurrency: render() may be called from rapid hashchange events or from
 * navigate({force:true}) inside a handler. Each invocation gets a monotonic
 * token; any in-flight render whose token no longer matches the latest is
 * abandoned before mutating the DOM.
 */
import { friendlyError, renderError } from "./dom.ts";

type RouteHandler = () => HTMLElement | Promise<HTMLElement>;

/**
 * Thrown by a view (typically the page() wrapper after `navigate("/login")`)
 * to signal that the current render should be abandoned without showing an
 * error UI — the navigate() call has already queued the next render.
 *
 * The router's try/catch checks for this sentinel and exits silently.
 */
export class RedirectAbort extends Error {
  constructor() {
    super("redirect");
    this.name = "RedirectAbort";
  }
}

const routes = new Map<string, RouteHandler>();
const prefixRoutes: Array<{ prefix: string; handler: RouteHandler }> = [];
let renderToken = 0;

export function route(path: string, handler: RouteHandler): void {
  routes.set(path, handler);
}

/** Register a handler for all paths starting with `prefix`. */
export function routePrefix(prefix: string, handler: RouteHandler): void {
  prefixRoutes.push({ prefix, handler });
}

export function navigate(path: string, opts?: { force?: boolean }): void {
  const current = globalThis.location.hash.replace(/^#/, "");
  if (opts?.force && current === path) {
    render();
  } else {
    globalThis.location.hash = path;
  }
}

async function render(): Promise<void> {
  // Claim the next render token. Any previous render whose token != myToken
  // is now stale and must abandon its work before mutating the DOM.
  const myToken = ++renderToken;

  const hash = globalThis.location.hash || "#/";
  const path = hash.startsWith("#")
    ? hash.slice(1).split("?")[0]
    : hash.split("?")[0];

  let handler = routes.get(path);
  if (!handler) {
    for (const pr of prefixRoutes) {
      if (path.startsWith(pr.prefix)) {
        handler = pr.handler;
        break;
      }
    }
  }
  if (!handler) handler = routes.get("/404");
  if (!handler) return;

  const app = document.getElementById("app");
  if (!app) return;

  try {
    const element = await handler();
    if (myToken !== renderToken) return; // a newer render superseded us
    app.innerHTML = "";
    app.appendChild(element);
  } catch (error) {
    // The view aborted to redirect — don't render an error, the next
    // render call (queued via navigate()) will take over.
    if (error instanceof RedirectAbort) return;
    if (myToken !== renderToken) return;
    app.innerHTML = "";
    const container = document.createElement("main");
    container.className = "container";
    renderError(container, "Something went wrong", friendlyError(error));
    app.appendChild(container);
  }

  if (myToken === renderToken) {
    globalThis.scrollTo(0, 0);
  }
}

export function startRouter(): void {
  globalThis.addEventListener("hashchange", render);
  render();
}
