/**
 * Hash-based SPA router with cleanup support.
 */
type RouteHandler = () => HTMLElement | Promise<HTMLElement>;

const routes = new Map<string, RouteHandler>();
let cleanups: (() => void)[] = [];

export function route(path: string, handler: RouteHandler): void {
  routes.set(path, handler);
}

export function navigate(path: string, opts?: { force?: boolean }): void {
  const current = window.location.hash.replace(/^#/, "");
  if (opts?.force && current === path) {
    render();
  } else {
    window.location.hash = path;
  }
}

export function onCleanup(fn: () => void): void {
  cleanups.push(fn);
}

async function render(): Promise<void> {
  const hash = window.location.hash || "#/";
  const path = hash.startsWith("#") ? hash.slice(1).split("?")[0] : hash.split("?")[0];

  const handler = routes.get(path) || routes.get("/404");
  if (!handler) return;

  for (const fn of cleanups) fn();
  cleanups = [];

  const app = document.getElementById("app");
  if (!app) return;

  try {
    const element = await handler();
    app.innerHTML = "";
    app.appendChild(element);
  } catch (error) {
    console.warn("[router] View render failed:", error);
    app.innerHTML = "";
    const container = document.createElement("main");
    container.className = "container";
    const h2 = document.createElement("h2");
    h2.textContent = "Something went wrong";
    const p = document.createElement("p");
    p.className = "error-text";
    p.textContent = "Failed to load this page. Please try again.";
    container.append(h2, p);
    app.appendChild(container);
  }

  window.scrollTo(0, 0);
}

export function startRouter(): void {
  window.addEventListener("hashchange", render);
  render();
}
