/**
 * Shared transaction list component.
 * Renders a table of transactions from the provider-platform API.
 */
import { listTransactions } from "../api/client.ts";
import { escapeHtml } from "../utils/dom.ts";

export { escapeHtml };

export function formatAmount(stroops: string): string {
  try {
    const bi = BigInt(stroops || "0");
    const whole = bi / 10_000_000n;
    const frac = (bi % 10_000_000n).toString().padStart(7, "0").slice(0, 2);
    return `${whole.toLocaleString()}.${frac}`;
  } catch {
    return "0.00";
  }
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    completed: "var(--active)",
    pending: "var(--pending)",
    failed: "var(--inactive)",
    expired: "var(--text-muted)",
  };
  const color = colors[status] || "var(--text-muted)";
  return `<span style="color:${escapeHtml(color)};text-transform:uppercase;font-size:0.75rem;font-weight:600">${escapeHtml(status)}</span>`;
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function renderTransactionList(container: HTMLElement): void {
  container.innerHTML = `<h2>Transactions</h2><p>Loading...</p>`;

  listTransactions({ limit: 50 })
    .then(({ data }) => {
      const txs = data.transactions;

      if (txs.length === 0) {
        container.innerHTML = `
          <h2>Transactions</h2>
          <div class="empty-state"><p>No transactions yet.</p></div>
        `;
        return;
      }

      const rows = txs.map((tx) => `
        <tr>
          <td>${escapeHtml(tx.type)}</td>
          <td>${statusBadge(tx.status)}</td>
          <td>${escapeHtml(formatAmount(tx.amount))} XLM</td>
          <td class="mono">${tx.from ? escapeHtml(truncateAddress(tx.from)) : "—"}</td>
          <td class="mono">${tx.to ? escapeHtml(truncateAddress(tx.to)) : "—"}</td>
          <td>${tx.jurisdiction?.from ? escapeHtml(tx.jurisdiction.from) : "—"} → ${tx.jurisdiction?.to ? escapeHtml(tx.jurisdiction.to) : "—"}</td>
          <td>${escapeHtml(timeAgo(tx.createdAt))}</td>
        </tr>
      `).join("");

      container.innerHTML = `
        <h2>Transactions</h2>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Status</th>
              <th>Amount</th>
              <th>From</th>
              <th>To</th>
              <th>Jurisdiction</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    })
    .catch((err) => {
      container.innerHTML = `<h2>Transactions</h2><p class="error-text">Failed to load transactions.</p>`;
      console.warn("[transaction-list]", err);
    });
}
