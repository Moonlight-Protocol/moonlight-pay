import { clearSession } from "../lib/wallet.ts";
import { clearPassword } from "../lib/derivation.ts";
import { navigate } from "../lib/router.ts";
import { escapeHtml } from "../lib/dom.ts";
import { resetAnalytics } from "shared/analytics/index.ts";

declare const __APP_VERSION__: string;
const appVersion: string = escapeHtml(__APP_VERSION__);

export function renderNav(): HTMLElement {
  const nav = document.createElement("nav");
  nav.innerHTML = `
    <div class="nav-inner">
      <a href="#/" class="nav-brand">Moonlight Pay <span class="version-badge">v${appVersion}</span></a>
      <div class="nav-links">
        <a href="#/dashboard">Dashboard</a>
        <a href="#/deposit">Deposit</a>
        <a href="#/send">Send</a>
        <a href="#/transactions">Transactions</a>
        <a href="#/demo">Demo</a>
        <a href="#/report">Report Issue</a>
        <button id="logout-btn" class="btn-link">Logout</button>
      </div>
    </div>
  `;

  nav.querySelector("#logout-btn")?.addEventListener("click", () => {
    clearSession();
    clearPassword();
    resetAnalytics();
    navigate("/login");
  });

  return nav;
}
