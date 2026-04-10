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
import { escapeHtml, friendlyError } from "../lib/dom.ts";
import { getPayPlatformUrl } from "../lib/config.ts";
import { executeInstantPayment } from "../lib/instant-payment.ts";
import { executeSelfCustodialPayment } from "../lib/selfcustodial-payment.ts";
import {
  connectWallet,
  getConnectedAddress,
  signMessage,
} from "../lib/wallet.ts";
import { createWalletSigner } from "../lib/wallet-signer.ts";

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
    ?.addEventListener("click", async () => {
      const amount = getAmount();
      if (!amount) {
        errorEl.hidden = false;
        errorEl.textContent = "Enter an amount";
        return;
      }
      errorEl.hidden = true;
      statusEl.hidden = false;

      try {
        // Connect customer's wallet if not already connected
        statusEl.textContent = "Connect your wallet...";
        let customerWallet = getConnectedAddress();
        if (!customerWallet) {
          customerWallet = await connectWallet();
        }

        // Get the wallets-kit instance for the Signer adapter
        // deno-lint-ignore no-explicit-any
        const kit = (globalThis as any).__moonlightWalletKit;
        if (!kit) {
          throw new Error(
            "Wallet kit not initialized. Please refresh and try again.",
          );
        }
        const signer = createWalletSigner(kit);

        const result = await executeInstantPayment({
          customerWallet,
          merchantWallet: params.merchantWallet,
          amountXlm: amount.toString(),
          description: params.description ?? undefined,
          signer,
          signMessage,
          payerJurisdiction: params.jurisdiction ?? undefined,
          onStatus: (msg) => {
            statusEl.textContent = msg;
          },
        });

        statusEl.textContent = `Payment complete! TX: ${result.transactionId}`;
      } catch (err) {
        statusEl.hidden = true;
        errorEl.hidden = false;
        errorEl.textContent = friendlyError(err);
      }
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

      // Show password input for UTXO derivation key
      const methodsDiv = container.querySelector(".pos-methods")!;
      methodsDiv.innerHTML = `
        <h3>Self-custodial — Enter your password</h3>
        <p style="font-size:0.85rem;color:var(--text-muted)">
          Your password controls your UTXO derivation. Same wallet + same
          password = same keys every time.
        </p>
        <div class="form-group">
          <input type="password" id="sc-password" placeholder="Your UTXO password" autocomplete="off" />
        </div>
        <button id="sc-pay-btn" class="btn-primary btn-wide">Pay ${amount} XLM</button>
      `;

      container
        .querySelector("#sc-pay-btn")
        ?.addEventListener("click", async () => {
          const passwordInput = container.querySelector(
            "#sc-password",
          ) as HTMLInputElement;
          const pw = passwordInput?.value;
          if (!pw) {
            errorEl.hidden = false;
            errorEl.textContent = "Password is required";
            return;
          }
          errorEl.hidden = true;
          statusEl.hidden = false;

          try {
            let customerWallet = getConnectedAddress();
            if (!customerWallet) {
              statusEl.textContent = "Connect your wallet...";
              customerWallet = await connectWallet();
            }

            // deno-lint-ignore no-explicit-any
            const kit = (globalThis as any).__moonlightWalletKit;
            if (!kit) {
              throw new Error(
                "Wallet kit not initialized. Please refresh and try again.",
              );
            }
            const signer = createWalletSigner(kit);

            const result = await executeSelfCustodialPayment({
              customerWallet,
              merchantWallet: params.merchantWallet,
              amountXlm: amount!.toString(),
              password: pw,
              description: params.description ?? undefined,
              signer,
              signMessage,
              payerJurisdiction: params.jurisdiction ?? undefined,
              onStatus: (msg) => {
                statusEl.textContent = msg;
              },
            });

            statusEl.textContent =
              `Payment complete! TX: ${result.transactionId}`;
          } catch (err) {
            statusEl.hidden = true;
            errorEl.hidden = false;
            errorEl.textContent = friendlyError(err);
          }
        });
    });

  return container;
}
