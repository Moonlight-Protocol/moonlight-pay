/**
 * Home view — shows the authenticated user's account and lets them edit
 * jurisdiction, email, and display name. Wallet address is immutable.
 */
import { page } from "../components/page.ts";
import {
  getBalance,
  getMe,
  listTransactions,
  type PayAccount,
  SessionExpiredError,
  updateMe,
} from "../lib/api.ts";
import { COUNTRY_CODES } from "../lib/jurisdictions.ts";
import { escapeHtml, friendlyError } from "../lib/dom.ts";
import { navigate } from "../lib/router.ts";
import { clearSession } from "../lib/wallet.ts";

function findCountryLabel(code: string): string {
  return COUNTRY_CODES.find((c) => c.code === code)?.label ?? code;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function renderContent(): Promise<HTMLElement> {
  const el = document.createElement("div");

  let account: PayAccount | null;
  try {
    account = await getMe();
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      clearSession();
      navigate("/login");
      return el;
    }
    const message = document.createElement("p");
    message.className = "error-text";
    message.textContent = friendlyError(err);
    el.appendChild(message);
    return el;
  }

  if (!account) {
    // No account but we're authed — kick back to login (signup form will render)
    navigate("/login");
    return el;
  }

  const countryOptions = COUNTRY_CODES
    .map((c) =>
      `<option value="${escapeHtml(c.code)}"${
        c.code === account!.jurisdictionCountryCode ? " selected" : ""
      }>${escapeHtml(c.label)}</option>`
    )
    .join("");

  el.innerHTML = `
    <div class="page-header">
      <h2>My Account</h2>
    </div>

    <div class="account-card" style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1.5rem;max-width:600px">
      <div class="form-group">
        <label>Wallet Address</label>
        <div style="display:flex;align-items:center;gap:0.5rem">
          <input type="text" value="${
    escapeHtml(account.walletPublicKey)
  }" disabled style="font-family:var(--font-mono);font-size:0.8rem" />
          <button id="copy-address-btn" class="icon-btn" title="Copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 16H8"/><path d="M14 8H8"/><path d="M16 12H8"/><path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"/></svg></button>
        </div>
      </div>

      <div class="form-group">
        <label for="email-input">Email</label>
        <input type="email" id="email-input" value="${
    escapeHtml(account.email)
  }" />
      </div>

      <div class="form-group">
        <label for="jurisdiction-select">Jurisdiction</label>
        <select id="jurisdiction-select">
          ${countryOptions}
        </select>
      </div>

      <div class="form-group">
        <label for="display-name-input">Display Name</label>
        <input type="text" id="display-name-input" value="${
    escapeHtml(account.displayName ?? "")
  }" placeholder="(optional)" />
      </div>

      <button id="save-btn" class="btn-primary">Save Changes</button>
      <p id="save-status" class="hint-text" hidden></p>
      <p id="save-error" class="error-text" hidden></p>

      <hr style="margin:1.5rem 0;border:0;border-top:1px solid var(--border)" />

      <div style="font-size:0.8rem;color:var(--text-muted);display:flex;flex-direction:column;gap:0.25rem">
        <div><strong>Created:</strong> ${
    escapeHtml(formatDate(account.createdAt))
  }</div>
        <div><strong>Last seen:</strong> ${
    escapeHtml(formatDate(account.lastSeenAt))
  }</div>
      </div>
    </div>

    <div id="balance-section" style="margin-top:1.5rem;max-width:600px">
      <h3>Balance</h3>
      <p id="balance-display" class="hint-text">Loading...</p>
    </div>

    <div id="pos-link-section" style="margin-top:1rem;max-width:600px">
      <h3>Your POS Link</h3>
      <p style="font-size:0.85rem;color:var(--text-muted)">Share this link to receive payments:</p>
      <code id="pos-link" style="display:block;padding:0.5rem;background:var(--surface);border:1px solid var(--border);border-radius:4px;font-size:0.8rem;word-break:break-all"></code>
    </div>

    <div id="tx-section" style="margin-top:1.5rem;max-width:600px">
      <h3>Recent Transactions</h3>
      <div id="tx-list" class="hint-text">Loading...</div>
    </div>
  `;

  // POS link
  const posLinkEl = el.querySelector("#pos-link")!;
  const baseUrl = globalThis.location.origin;
  posLinkEl.textContent = `${baseUrl}/#/pay/${account.walletPublicKey}`;

  // Load balance
  getBalance()
    .then((b) => {
      const balanceEl = el.querySelector("#balance-display")!;
      balanceEl.textContent = `${b.balanceXlm} XLM`;
    })
    .catch(() => {
      const balanceEl = el.querySelector("#balance-display")!;
      balanceEl.textContent = "Could not load balance";
    });

  // Load recent transactions
  listTransactions({ limit: 10 })
    .then((txs) => {
      const txListEl = el.querySelector("#tx-list")!;
      if (txs.length === 0) {
        txListEl.textContent = "No transactions yet";
        return;
      }
      txListEl.innerHTML = "";
      for (const tx of txs) {
        const row = document.createElement("div");
        row.style.cssText =
          "display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.85rem";
        const sign = tx.direction === "IN" ? "+" : "-";
        const color = tx.direction === "IN"
          ? "var(--success, green)"
          : "var(--inactive, red)";
        row.innerHTML = `
        <div>
          <span style="color:${color};font-weight:600">${sign}${
          escapeHtml(tx.amountXlm)
        } XLM</span>
          <span style="color:var(--text-muted);margin-left:0.5rem">${
          escapeHtml(tx.method)
        }</span>
          ${
          tx.description
            ? `<span style="color:var(--text-muted);margin-left:0.5rem">${
              escapeHtml(tx.description)
            }</span>`
            : ""
        }
        </div>
        <div style="color:var(--text-muted)">${
          escapeHtml(formatDate(tx.createdAt))
        }</div>
      `;
        txListEl.appendChild(row);
      }
    })
    .catch(() => {
      const txListEl = el.querySelector("#tx-list")!;
      txListEl.textContent = "Could not load transactions";
    });

  // Copy address — clipboard API can fail (insecure context, permissions,
  // browser policy). Surface failure to the user instead of silently no-oping.
  const copyBtn = el.querySelector("#copy-address-btn") as
    | HTMLButtonElement
    | null;
  copyBtn?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(account!.walletPublicKey);
      const original = copyBtn.title;
      copyBtn.title = "Copied!";
      setTimeout(() => {
        copyBtn.title = original;
      }, 1500);
    } catch {
      copyBtn.title = "Copy failed — select the address manually";
    }
  });

  // Save changes
  const saveBtn = el.querySelector("#save-btn") as HTMLButtonElement;
  const emailInput = el.querySelector("#email-input") as HTMLInputElement;
  const jurisdictionSelect = el.querySelector(
    "#jurisdiction-select",
  ) as HTMLSelectElement;
  const displayNameInput = el.querySelector(
    "#display-name-input",
  ) as HTMLInputElement;
  const statusEl = el.querySelector("#save-status") as HTMLParagraphElement;
  const errorEl = el.querySelector("#save-error") as HTMLParagraphElement;

  saveBtn.addEventListener("click", async () => {
    errorEl.hidden = true;
    statusEl.hidden = false;
    statusEl.textContent = "Saving...";
    saveBtn.disabled = true;

    const updates: Record<string, string | null> = {};
    const newEmail = emailInput.value.trim();
    const newJurisdiction = jurisdictionSelect.value;
    const newDisplayName = displayNameInput.value.trim();

    if (newEmail !== account!.email) updates.email = newEmail;
    if (newJurisdiction !== account!.jurisdictionCountryCode) {
      updates.jurisdictionCountryCode = newJurisdiction;
    }
    if (newDisplayName !== (account!.displayName ?? "")) {
      updates.displayName = newDisplayName === "" ? null : newDisplayName;
    }

    if (Object.keys(updates).length === 0) {
      statusEl.textContent = "No changes to save";
      saveBtn.disabled = false;
      return;
    }

    try {
      const updated = await updateMe(updates);
      account = updated;
      statusEl.textContent = `Saved (${
        findCountryLabel(updated.jurisdictionCountryCode)
      })`;
      saveBtn.disabled = false;
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        clearSession();
        navigate("/login");
        return;
      }
      saveBtn.disabled = false;
      statusEl.hidden = true;
      errorEl.hidden = false;
      errorEl.textContent = friendlyError(err);
    }
  });

  return el;
}

export const homeView = page(renderContent);
