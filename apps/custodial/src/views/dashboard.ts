import { page } from "../components/page.ts";
import { escapeHtml } from "../lib/dom.ts";
import { getUsername } from "../lib/auth.ts";
import { getCustodialAccount } from "shared/api/client.ts";
import { formatAmount } from "shared/components/transaction-list.ts";

function renderContent(): HTMLElement {
  const el = document.createElement("div");
  const user = getUsername() ?? "Unknown";

  el.innerHTML = `
    <h2>Dashboard</h2>
    <div class="stats-row">
      <div class="stat-card">
        <span class="stat-label">Account</span>
        <span class="stat-value">${escapeHtml(user)}</span>
      </div>
    </div>
    <div class="stats-row" id="account-cards">
      <div class="stat-card"><span class="stat-value">—</span><span class="stat-label">Balance</span></div>
      <div class="stat-card"><span class="stat-value">—</span><span class="stat-label">Deposit Address</span></div>
      <div class="stat-card"><span class="stat-value">—</span><span class="stat-label">Status</span></div>
    </div>
    <div style="margin-top:1.5rem;display:flex;gap:0.5rem">
      <a href="#/send" class="btn-primary" style="display:inline-block">Send</a>
      <a href="#/transactions" class="btn-primary" style="display:inline-block;background:var(--border)">Transactions</a>
    </div>
  `;

  getCustodialAccount()
    .then(({ data }) => {
      const cards = el.querySelector("#account-cards");
      if (cards) {
        cards.innerHTML = `
          <div class="stat-card"><span class="stat-value">${escapeHtml(formatAmount(data.balance))} XLM</span><span class="stat-label">Balance</span></div>
          <div class="stat-card">
            <span class="stat-value mono" style="font-size:0.65rem">${escapeHtml(data.depositAddress)}</span>
            <span class="stat-label">Deposit Address</span>
          </div>
          <div class="stat-card"><span class="stat-value">${escapeHtml(data.status)}</span><span class="stat-label">Status</span></div>
        `;
      }
    })
    .catch(() => {});

  return el;
}

export const dashboardView = page(renderContent);
