import { connectAndAuth, isAuthenticated } from "../lib/wallet.ts";
import { setPassword, hasPassword } from "../lib/derivation.ts";
import { navigate } from "../lib/router.ts";
import { configure, setAuthToken } from "shared/api/client.ts";
import { identify, capture } from "shared/analytics/index.ts";
import { API_BASE_URL } from "../lib/config.ts";

export function loginView(): HTMLElement {
  if (isAuthenticated() && hasPassword()) {
    navigate("/dashboard");
    return document.createElement("div");
  }

  const container = document.createElement("div");
  container.className = "login-container";
  container.innerHTML = `
    <div class="login-card">
      <h1>Moonlight Pay</h1>
      <p>Self-custodial private payments on Stellar.</p>

      <div id="step-wallet">
        <p style="color:var(--text-muted);font-size:0.875rem;margin-bottom:1.5rem">
          Step 1: Connect your Freighter wallet for on-chain transactions.
        </p>
        <button id="connect-btn" class="btn-primary btn-wide">Connect Wallet</button>
      </div>

      <div id="step-password" hidden>
        <p style="color:var(--text-muted);font-size:0.875rem;margin-bottom:1rem">
          Step 2: Enter your UTXO password. This password derives your private
          UTXO addresses. <strong>If you lose it, you lose access to your funds.</strong>
        </p>
        <div class="form-group">
          <label for="utxo-password">UTXO Password</label>
          <input type="password" id="utxo-password" placeholder="Enter your UTXO password" autocomplete="off" />
        </div>
        <div class="form-group">
          <label for="utxo-password-confirm" id="confirm-label">Confirm Password <span style="color:var(--text-muted)">(first time only)</span></label>
          <input type="password" id="utxo-password-confirm" placeholder="Confirm password" autocomplete="off" />
        </div>
        <button id="unlock-btn" class="btn-primary btn-wide">Unlock</button>
      </div>

      <p id="login-status" class="hint-text" hidden></p>
      <p id="login-error" class="error-text" hidden></p>
    </div>
  `;

  const connectBtn = container.querySelector("#connect-btn") as HTMLButtonElement;
  const stepWallet = container.querySelector("#step-wallet") as HTMLDivElement;
  const stepPassword = container.querySelector("#step-password") as HTMLDivElement;
  const unlockBtn = container.querySelector("#unlock-btn") as HTMLButtonElement;
  const passwordInput = container.querySelector("#utxo-password") as HTMLInputElement;
  const confirmInput = container.querySelector("#utxo-password-confirm") as HTMLInputElement;
  const statusEl = container.querySelector("#login-status") as HTMLParagraphElement;
  const errorEl = container.querySelector("#login-error") as HTMLParagraphElement;

  // If already authenticated but no password, skip to step 2
  if (isAuthenticated() && !hasPassword()) {
    stepWallet.hidden = true;
    stepPassword.hidden = false;
  }

  connectBtn.addEventListener("click", async () => {
    connectBtn.disabled = true;
    errorEl.hidden = true;
    statusEl.textContent = "Connecting wallet...";
    statusEl.hidden = false;

    try {
      configure({ baseUrl: API_BASE_URL });
      const { address, token } = await connectAndAuth();

      setAuthToken(token);
      identify(address);
      capture("pay_self_wallet_connected", { address });

      statusEl.textContent = "Wallet connected!";
      stepWallet.hidden = true;
      stepPassword.hidden = false;
    } catch (error) {
      errorEl.textContent = error instanceof Error ? error.message : "Connection failed";
      errorEl.hidden = false;
      statusEl.hidden = true;
    } finally {
      connectBtn.disabled = false;
    }
  });

  unlockBtn.addEventListener("click", () => {
    const password = passwordInput.value;
    const confirm = confirmInput.value;

    if (!password) {
      errorEl.textContent = "Password is required";
      errorEl.hidden = false;
      return;
    }

    if (password.length < 8) {
      errorEl.textContent = "Password must be at least 8 characters";
      errorEl.hidden = false;
      return;
    }

    // If confirm field is visible and filled, validate match
    if (confirm && confirm !== password) {
      errorEl.textContent = "Passwords do not match";
      errorEl.hidden = false;
      return;
    }

    errorEl.hidden = true;
    setPassword(password);

    // Clear inputs
    passwordInput.value = "";
    confirmInput.value = "";

    capture("pay_self_unlocked");
    navigate("/dashboard");
  });

  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") unlockBtn.click();
  });
  confirmInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") unlockBtn.click();
  });

  return container;
}
