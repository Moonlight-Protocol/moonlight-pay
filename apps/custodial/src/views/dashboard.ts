import { page } from "../components/page.ts";
import { escapeHtml } from "../lib/dom.ts";
import { getUsername } from "../lib/auth.ts";
import { getCustodialAccount } from "shared/api/client.ts";
import { formatAmount } from "shared/components/transaction-list.ts";

function loadAccountData(el: HTMLElement): void {
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
    .catch(() => {
      const cards = el.querySelector("#account-cards");
      if (cards) {
        cards.innerHTML = `
          <div class="stat-card"><span class="stat-value error-text" style="font-size:0.875rem">(failed to load)</span><span class="stat-label">Balance</span></div>
          <div class="stat-card"><span class="stat-value error-text" style="font-size:0.875rem">(failed to load)</span><span class="stat-label">Deposit Address</span></div>
          <div class="stat-card"><span class="stat-value error-text" style="font-size:0.875rem">(failed to load)</span><span class="stat-label">Status</span></div>
        `;
      }
    });
}

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
      <button id="refresh-btn" class="btn-primary" style="background:var(--border)">Refresh</button>
    </div>
  `;

  // Load account data on initial render
  loadAccountData(el);

  // Refresh button
  const refreshBtn = el.querySelector("#refresh-btn") as HTMLButtonElement;
  refreshBtn.addEventListener("click", () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Refreshing...";
    loadAccountData(el);
    setTimeout(() => {
      refreshBtn.disabled = false;
      refreshBtn.textContent = "Refresh";
    }, 2000);
  });

  return el;
}

export const dashboardView = page(renderContent);
