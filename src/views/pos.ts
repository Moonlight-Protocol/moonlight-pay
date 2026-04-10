/**
 * POS (point-of-sale) view — public checkout page.
 *
 * Route: /pay/{walletPublicKey}?amount=X&description=Y
 *
 * Anyone can open this link — no auth required. Shows the merchant info,
 * amount, description, and 4 payment method options:
 *   - Bank transfer (disabled — future)
 *   - Debit card (disabled — future)
 *   - Crypto instant (active — customer sends XLM to PP)
 *   - Crypto self-custodial (active — customer manages UTXOs via SDK)
 *
 * The customer connects their wallet and pays through the selected method.
 */
import { escapeHtml } from "../lib/dom.ts";
import { getPayPlatformUrl } from "../lib/config.ts";

interface MerchantInfo {
  walletPublicKey: string;
  displayName: string | null;
  jurisdictionCountryCode: string;
}

interface PosParams {
  merchantWallet: string;
  amount: string | null;
  description: string | null;
  jurisdiction: string | null;
}

function parsePosParams(): PosParams {
  const hash = globalThis.location.hash || "";
  // Expected: #/pay/G.../...?amount=X&description=Y
  const match = hash.match(/#\/pay\/([A-Z0-9]+)/);
  const merchantWallet = match?.[1] ?? "";
  const qsIndex = hash.indexOf("?");
  const params = qsIndex >= 0
    ? new URLSearchParams(hash.slice(qsIndex))
    : new URLSearchParams();
  return {
    merchantWallet,
    amount: params.get("amount"),
    description: params.get("description"),
    jurisdiction: params.get("jurisdiction"),
  };
}

async function fetchMerchantInfo(
  walletPublicKey: string,
): Promise<MerchantInfo | null> {
  try {
    const res = await fetch(
      `${getPayPlatformUrl()}/api/v1/utxo/receive/${walletPublicKey}/available?count=1`,
    );
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data?.merchant ?? null;
  } catch {
    return null;
  }
}

export async function posView(): Promise<HTMLElement> {
  const container = document.createElement("div");
  container.className = "pos-container";

  const params = parsePosParams();
  if (!params.merchantWallet) {
    container.innerHTML =
      `<div class="pos-card"><h2>Invalid payment link</h2><p>No merchant specified.</p></div>`;
    return container;
  }

  // Fetch merchant info
  const merchant = await fetchMerchantInfo(params.merchantWallet);
  if (!merchant) {
    container.innerHTML =
      `<div class="pos-card"><h2>Merchant not found</h2><p>This payment link is invalid or the merchant has no receive addresses.</p></div>`;
    return container;
  }

  const merchantName = merchant.displayName ?? "Moonlight Pay Merchant";
  const amountDisplay = params.amount ? `${escapeHtml(params.amount)} XLM` : "";
  const descDisplay = params.description ? escapeHtml(params.description) : "";

  container.innerHTML = `
    <div class="pos-card">
      <h2>Pay ${escapeHtml(merchantName)}</h2>
      ${descDisplay ? `<p class="pos-description">${descDisplay}</p>` : ""}

      <div class="pos-amount-section">
        ${
    params.amount ? `<div class="pos-amount">${amountDisplay}</div>` : `
          <label for="pos-amount-input">Amount (XLM)</label>
          <input type="number" id="pos-amount-input" min="0.0000001" step="any" placeholder="0.00" />
        `
  }
      </div>

      <div class="pos-methods">
        <h3>Payment method</h3>

        <button class="pos-method-btn" disabled>
          <span class="pos-method-name">Bank transfer</span>
          <span class="pos-method-badge">Coming soon</span>
        </button>

        <button class="pos-method-btn" disabled>
          <span class="pos-method-name">Debit card</span>
          <span class="pos-method-badge">Coming soon</span>
        </button>

        <button class="pos-method-btn pos-method-active" id="pay-instant-btn">
          <span class="pos-method-name">Crypto — Instant</span>
          <span class="pos-method-desc">Connect wallet, pay in one step</span>
        </button>

        <button class="pos-method-btn pos-method-active" id="pay-selfcustodial-btn">
          <span class="pos-method-name">Crypto — Self-custodial</span>
          <span class="pos-method-desc">Manage your own keys</span>
        </button>
      </div>

      <p id="pos-status" class="hint-text" hidden></p>
      <p id="pos-error" class="error-text" hidden></p>
    </div>
  `;

  const statusEl = container.querySelector(
    "#pos-status",
  ) as HTMLParagraphElement;
  const errorEl = container.querySelector("#pos-error") as HTMLParagraphElement;

  function getAmount(): number | null {
    if (params.amount) return parseFloat(params.amount);
    const input = container.querySelector(
      "#pos-amount-input",
    ) as HTMLInputElement | null;
    if (!input) return null;
    const val = parseFloat(input.value);
    return isNaN(val) || val <= 0 ? null : val;
  }

  // Crypto Instant
  container
    .querySelector("#pay-instant-btn")
    ?.addEventListener("click", () => {
      const amount = getAmount();
      if (!amount) {
        errorEl.hidden = false;
        errorEl.textContent = "Enter an amount";
        return;
      }
      errorEl.hidden = true;
      statusEl.hidden = false;
      // TODO: implement instant payment flow
      // 1. Connect customer's wallet
      // 2. Build simple XLM payment to PP address
      // 3. Customer signs via Freighter
      // 4. PP handles deposit + send to merchant's receive UTXOs
      statusEl.textContent =
        "Instant payment flow — implementation in progress";
    });

  // Crypto Self-custodial
  container
    .querySelector("#pay-selfcustodial-btn")
    ?.addEventListener("click", () => {
      const amount = getAmount();
      if (!amount) {
        errorEl.hidden = false;
        errorEl.textContent = "Enter an amount";
        return;
      }
      errorEl.hidden = true;
      statusEl.hidden = false;
      // TODO: implement self-custodial payment flow
      // 1. Connect customer's wallet
      // 2. Derive master seed + UTXO keys
      // 3. Check channel balance, deposit if needed
      // 4. Build send bundle (SPEND → merchant's receive UTXOs)
      // 5. Submit to PP
      statusEl.textContent =
        "Self-custodial payment flow — implementation in progress";
    });

  return container;
}
