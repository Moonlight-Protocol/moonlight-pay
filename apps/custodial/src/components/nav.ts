import { clearSession, getUsername } from "../lib/auth.ts";
import { navigate } from "../lib/router.ts";
import { escapeHtml } from "../lib/dom.ts";
import { resetAnalytics } from "shared/analytics/index.ts";

declare const __APP_VERSION__: string;
const appVersion: string = escapeHtml(__APP_VERSION__);

export function renderNav(): HTMLElement {
  const nav = document.createElement("nav");
  const user = getUsername() ?? "";

  nav.innerHTML = `
    <div class="nav-inner">
      <a href="#/" class="nav-brand">Moonlight Pay <span class="version-badge">v${appVersion}</span></a>
      <div class="nav-links">
        <a href="#/dashboard">Dashboard</a>
        <a href="#/send">Send</a>
        <a href="#/transactions">Transactions</a>
        <a href="#/demo">Demo</a>
        <a href="#/report">Report Issue</a>
        <span style="color:var(--text-muted);font-size:0.8rem">${escapeHtml(user)}</span>
        <button id="logout-btn" class="btn-link">Logout</button>
      </div>
    </div>
  `;

  nav.querySelector("#logout-btn")?.addEventListener("click", () => {
    clearSession();
    resetAnalytics();
    navigate("/login");
  });

  return nav;
}
