import { page } from "../components/page.ts";
import { escapeHtml } from "../lib/dom.ts";
import { getConnectedAddress } from "../lib/wallet.ts";
import { deriveUtxoKeypairs } from "../lib/derivation.ts";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
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

    <h3>Derived UTXO Addresses</h3>
    <p style="color:var(--text-muted);font-size:0.875rem;margin-bottom:1rem">
      These P256 addresses are derived from your password. They hold your private balance.
    </p>
    <div id="utxo-list"><p>Deriving...</p></div>

    <div style="margin-top:1.5rem;display:flex;gap:0.5rem">
      <a href="#/send" class="btn-primary" style="display:inline-block">Send</a>
      <a href="#/transactions" class="btn-primary" style="display:inline-block;background:var(--border)">Transactions</a>
    </div>
  `;

  // Derive first 5 UTXO addresses to show
  deriveUtxoKeypairs(0, 5)
    .then((keypairs) => {
      const utxoList = el.querySelector("#utxo-list");
      if (!utxoList) return;

      const rows = keypairs.map((kp) => `
        <tr>
          <td>${escapeHtml(String(kp.index))}</td>
          <td class="mono" style="font-size:0.7rem">${escapeHtml(bytesToHex(kp.publicKey).slice(0, 32))}...</td>
          <td style="color:var(--text-muted)">—</td>
        </tr>
      `).join("");

      utxoList.innerHTML = `
        <table>
          <thead><tr><th>Index</th><th>P256 Public Key</th><th>Balance</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="color:var(--text-muted);font-size:0.8rem;margin-top:0.5rem">
          Showing first 5 of up to 300 UTXO slots.
        </p>
      `;
    })
    .catch((err) => {
      const utxoList = el.querySelector("#utxo-list");
      if (utxoList) {
        utxoList.innerHTML = `<p class="error-text">Failed to derive keys: ${escapeHtml(err.message)}</p>`;
      }
    });

  return el;
}

export const dashboardView = page(renderContent);
