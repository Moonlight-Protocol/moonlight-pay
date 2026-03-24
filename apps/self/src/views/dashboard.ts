import { page } from "../components/page.ts";
import { escapeHtml } from "../lib/dom.ts";
import { getConnectedAddress } from "../lib/wallet.ts";
import { deriveUtxoKeypairs } from "../lib/derivation.ts";
import { getSelfBalance, getEscrowSummary } from "shared/api/client.ts";
import { formatAmount } from "shared/components/transaction-list.ts";
import { bytesToHex } from "shared/utils/hex.ts";

function loadBalances(el: HTMLElement): void {
  const utxoList = el.querySelector("#utxo-list");
  if (utxoList) utxoList.innerHTML = `<p>Deriving...</p>`;

  deriveUtxoKeypairs(0, 5)
    .then((keypairs) => {
      const publicKeysHex = keypairs.map((kp) => bytesToHex(kp.publicKey));

      getSelfBalance(publicKeysHex)
        .then(({ data }) => {
          const cards = el.querySelector("#balance-cards");
          if (!cards) return;
          const balanceCard = cards.children[0];
          const slotsCard = cards.children[1];
          if (balanceCard) balanceCard.innerHTML = `<span class="stat-value">${escapeHtml(formatAmount(data.totalBalance))} XLM</span><span class="stat-label">Private Balance</span>`;
          if (slotsCard) slotsCard.innerHTML = `<span class="stat-value">${data.utxoCount} / ${data.freeSlots + data.utxoCount}</span><span class="stat-label">UTXO Slots Used</span>`;

          const balanceMap = new Map<string, string>();
          if (data.utxos) {
            for (const utxo of data.utxos) {
              balanceMap.set(utxo.publicKey, utxo.balance);
            }
          }

          renderUtxoTable(el, keypairs, balanceMap);
          // Zero private keys — dashboard only needs public keys for display
          for (const kp of keypairs) kp.privateKey.fill(0);
        })
        .catch(() => {
          const cards = el.querySelector("#balance-cards");
          if (cards) {
            const balanceCard = cards.children[0];
            if (balanceCard) balanceCard.innerHTML = `<span class="stat-value error-text" style="font-size:0.875rem">(failed to load)</span><span class="stat-label">Private Balance</span>`;
          }
          renderUtxoTable(el, keypairs, new Map());
          // Zero private keys — dashboard only needs public keys for display
          for (const kp of keypairs) kp.privateKey.fill(0);
        });
    })
    .catch((err) => {
      if (utxoList) {
        utxoList.innerHTML = `<p class="error-text">Failed to derive keys: ${escapeHtml(err.message)}</p>`;
      }
    });
}

function renderContent(): HTMLElement {
  const el = document.createElement("div");
  const address = getConnectedAddress() ?? "Unknown";

  el.innerHTML = `
    <h2>Dashboard</h2>
    <div class="stats-row">
      <div class="stat-card">
        <span class="stat-label">Stellar Address</span>
        <span class="stat-value mono" style="font-size:0.7rem">${escapeHtml(address)}</span>
      </div>
    </div>
    <div class="stats-row" id="balance-cards">
      <div class="stat-card"><span class="stat-value">—</span><span class="stat-label">Private Balance</span></div>
      <div class="stat-card"><span class="stat-value">—</span><span class="stat-label">UTXO Slots</span></div>
      <div class="stat-card" id="escrow-card" hidden><span class="stat-value">—</span><span class="stat-label">Pending Escrow</span></div>
    </div>

    <h3>Derived UTXO Addresses</h3>
    <p style="color:var(--text-muted);font-size:0.875rem;margin-bottom:1rem">
      These P256 addresses are derived from your password. They hold your private balance.
    </p>
    <div id="utxo-list"><p>Deriving...</p></div>

    <div style="margin-top:1.5rem;display:flex;gap:0.5rem">
      <a href="#/deposit" class="btn-primary" style="display:inline-block">Deposit</a>
      <a href="#/send" class="btn-primary" style="display:inline-block">Send</a>
      <a href="#/transactions" class="btn-primary" style="display:inline-block;background:var(--border)">Transactions</a>
      <button id="refresh-btn" class="btn-primary" style="background:var(--border)">Refresh</button>
    </div>
  `;

  // Load balances on initial render
  loadBalances(el);

  // Refresh button
  const refreshBtn = el.querySelector("#refresh-btn") as HTMLButtonElement;
  refreshBtn.addEventListener("click", () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Refreshing...";
    loadBalances(el);
    setTimeout(() => {
      refreshBtn.disabled = false;
      refreshBtn.textContent = "Refresh";
    }, 2000);
  });

  // Fetch escrow summary
  if (address !== "Unknown") {
    getEscrowSummary(address)
      .then(({ data }) => {
        if (data.count > 0) {
          const card = el.querySelector("#escrow-card") as HTMLElement;
          if (card) {
            card.innerHTML = `<span class="stat-value">${escapeHtml(formatAmount(data.totalAmount))} XLM</span><span class="stat-label">${data.count} pending escrow${data.count > 1 ? "s" : ""}</span>`;
            card.hidden = false;
          }
        }
      })
      .catch(() => {
        const card = el.querySelector("#escrow-card") as HTMLElement;
        if (card) {
          card.innerHTML = `<span class="stat-value error-text" style="font-size:0.875rem">(failed to load)</span><span class="stat-label">Pending Escrow</span>`;
          card.hidden = false;
        }
      });
  }

  return el;
}

function renderUtxoTable(
  el: HTMLElement,
  keypairs: Array<{ index: number; publicKey: Uint8Array; privateKey: Uint8Array }>,
  balanceMap: Map<string, string>,
): void {
  const utxoList = el.querySelector("#utxo-list");
  if (!utxoList) return;

  const rows = keypairs.map((kp) => {
    const pkHex = bytesToHex(kp.publicKey);
    const balance = balanceMap.get(pkHex);
    const balanceDisplay = balance !== undefined
      ? `${escapeHtml(formatAmount(balance))} XLM`
      : `<span style="color:var(--text-muted)">—</span>`;

    return `
      <tr>
        <td>${escapeHtml(String(kp.index))}</td>
        <td class="mono" style="font-size:0.7rem">${escapeHtml(pkHex.slice(0, 32))}...</td>
        <td>${balanceDisplay}</td>
      </tr>
    `;
  }).join("");

  utxoList.innerHTML = `
    <table>
      <thead><tr><th>Index</th><th>P256 Public Key</th><th>Balance</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:var(--text-muted);font-size:0.8rem;margin-top:0.5rem">
      Showing first 5 of up to 300 UTXO slots.
    </p>
  `;
}

export const dashboardView = page(renderContent);
