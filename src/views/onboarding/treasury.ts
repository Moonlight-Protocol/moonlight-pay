import { onboardingPage } from "./layout.ts";
import { navigate } from "../../lib/router.ts";
import { deriveOpExKeypair, getConnectedAddress } from "../../lib/wallet.ts";
import { getMe, registerOpex } from "../../lib/api.ts";
import { friendlyError } from "../../lib/dom.ts";
import {
  buildFundOpexTx,
  getAccountBalance,
  submitHorizonTx,
} from "../../lib/stellar.ts";
import { createWalletSigner } from "../../lib/wallet-signer.ts";

function renderStep(): HTMLElement {
  const el = document.createElement("div");

  el.innerHTML = `
    <h2>Set Up Treasury</h2>
    <p style="color:var(--text-muted);font-size:0.875rem;margin-bottom:1.5rem">
      Your treasury account receives instant payments from customers.
    </p>

    <div id="opex-loading">
      <p style="color:var(--text-muted)">Deriving treasury account...</p>
    </div>

    <div id="opex-content" hidden>
      <div class="stat-card" style="margin-bottom:1rem">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="stat-label">Treasury</span>
          <button id="opex-refresh-btn" class="btn-secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem">Refresh</button>
        </div>
        <div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.25rem;word-break:break-all" id="opex-address"></div>
        <span id="opex-balance" class="stat-value" style="font-size:1.25rem;display:block;margin-top:0.5rem">0.00 XLM</span>
      </div>

      <div id="opex-fund-card" class="stat-card" style="margin-bottom:1rem">
        <span class="stat-label">Fund the treasury to operate</span>
        <div style="display:flex;gap:0.5rem;align-items:flex-end;margin-top:0.75rem">
          <div class="form-group" style="margin:0;flex:1">
            <label for="opex-fund-amount">Amount (XLM)</label>
            <input type="number" id="opex-fund-amount" value="100" min="1" step="1" />
          </div>
          <button id="opex-fund-btn" class="btn-primary" style="padding:0.6rem 1.5rem">Fund</button>
        </div>
      </div>

      <div class="form-group" style="margin-top:1rem">
        <label for="opex-fee">Fee (%)</label>
        <input type="number" id="opex-fee" value="1" min="0" max="100" step="0.01" />
        <p style="color:var(--text-muted);font-size:0.8rem;margin-top:0.25rem">
          Percentage kept from each instant payment.
        </p>
      </div>

      <button id="opex-complete-btn" class="btn-primary btn-wide" disabled style="margin-top:1rem">Complete Setup</button>
    </div>

    <p id="opex-error" class="error-text" hidden></p>
  `;

  const loadingEl = el.querySelector("#opex-loading") as HTMLDivElement;
  const contentEl = el.querySelector("#opex-content") as HTMLDivElement;
  const addressEl = el.querySelector("#opex-address") as HTMLDivElement;
  const balanceEl = el.querySelector("#opex-balance") as HTMLSpanElement;
  const fundCard = el.querySelector("#opex-fund-card") as HTMLDivElement;
  const completeBtn = el.querySelector(
    "#opex-complete-btn",
  ) as HTMLButtonElement;
  const errorEl = el.querySelector("#opex-error") as HTMLParagraphElement;

  let opexPublicKey = "";
  let opexSecretKey = "";

  async function checkBalance() {
    if (!opexPublicKey) return;
    const { xlm, funded } = await getAccountBalance(opexPublicKey);
    const balance = funded ? parseFloat(xlm) : 0;
    balanceEl.textContent = `${balance.toFixed(2)} XLM`;

    if (balance > 0) {
      balanceEl.style.color = "var(--active)";
      fundCard.hidden = true;
      completeBtn.disabled = false;
    } else {
      balanceEl.style.color = "var(--text-muted)";
      fundCard.hidden = false;
      completeBtn.disabled = true;
    }
  }

  // Auto-derive on load
  (async () => {
    try {
      // If already set up, skip
      const account = await getMe();
      if (account?.opexPublicKey) {
        navigate("/");
        return;
      }

      const kp = await deriveOpExKeypair();
      opexPublicKey = kp.publicKey;
      opexSecretKey = kp.secretKey;

      addressEl.textContent = opexPublicKey;
      loadingEl.hidden = true;
      contentEl.hidden = false;
      await checkBalance();
    } catch (err) {
      loadingEl.innerHTML = "";
      errorEl.hidden = false;
      errorEl.textContent = friendlyError(err);
    }
  })();

  // Refresh
  el.querySelector("#opex-refresh-btn")?.addEventListener(
    "click",
    () => checkBalance(),
  );

  // Fund
  el.querySelector("#opex-fund-btn")?.addEventListener("click", async () => {
    const fundBtn = el.querySelector("#opex-fund-btn") as HTMLButtonElement;
    const amountInput = el.querySelector(
      "#opex-fund-amount",
    ) as HTMLInputElement;
    const amount = amountInput.value.trim();

    if (!amount || parseFloat(amount) <= 0) {
      errorEl.textContent = "Enter a valid amount";
      errorEl.hidden = false;
      return;
    }

    fundBtn.disabled = true;
    fundBtn.textContent = "Building...";
    errorEl.hidden = true;

    try {
      const sourceAddress = getConnectedAddress();
      if (!sourceAddress) throw new Error("Wallet not connected");

      const txXdr = await buildFundOpexTx(
        sourceAddress,
        opexPublicKey,
        amount,
      );
      fundBtn.textContent = "Sign in wallet...";
      const signer = createWalletSigner();
      const { signedTxXdr } = await signer.signTransaction(txXdr);
      fundBtn.textContent = "Submitting...";
      await submitHorizonTx(signedTxXdr);

      fundBtn.textContent = "Funded!";
      await checkBalance();
    } catch (err) {
      fundBtn.textContent = "Fund";
      fundBtn.disabled = false;
      errorEl.hidden = false;
      errorEl.textContent = friendlyError(err);
    }
  });

  // Complete
  completeBtn.addEventListener("click", async () => {
    completeBtn.disabled = true;
    completeBtn.textContent = "Saving...";
    errorEl.hidden = true;

    try {
      const feeInput = el.querySelector("#opex-fee") as HTMLInputElement;
      const feePct = parseFloat(feeInput.value);
      if (isNaN(feePct) || feePct < 0 || feePct > 100) {
        throw new Error("Fee must be between 0 and 100");
      }

      await registerOpex({
        secretKey: opexSecretKey,
        publicKey: opexPublicKey,
        feePct,
      });

      navigate("/");
    } catch (err) {
      completeBtn.disabled = false;
      completeBtn.textContent = "Complete Setup";
      errorEl.hidden = false;
      errorEl.textContent = friendlyError(err);
    }
  });

  return el;
}

export const treasuryView = onboardingPage("treasury", renderStep);
