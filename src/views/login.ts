/**
 * Sign-in / sign-up view.
 *
 * Flow:
 *   1. Connect wallet (Freighter via Stellar Wallets Kit)
 *   2. Derive master seed from a single wallet signature
 *   3. Authenticate with pay-platform (wallet challenge → JWT)
 *   4. Check if account exists:
 *        - if yes → navigate to home
 *        - if no  → show signup form (email + jurisdiction)
 *   5. On signup submit → POST /account → navigate to home
 */
import {
  clearSession,
  connectWallet,
  getConnectedAddress,
  initMasterSeed,
  isAuthenticated,
  isMasterSeedReady,
  signMessage,
} from "../lib/wallet.ts";
import {
  authenticate,
  clearPlatformAuth,
  createAccount,
  getMe,
  isPlatformAuthed,
  SessionExpiredError,
  storeReceiveUtxos,
} from "../lib/api.ts";
import { deriveReceiveUtxos } from "../lib/utxo-derivation.ts";
import { getMasterSeed } from "../lib/wallet.ts";
import { navigate } from "../lib/router.ts";
import { COUNTRY_CODES } from "../lib/jurisdictions.ts";
import { escapeHtml, friendlyError, truncateAddress } from "../lib/dom.ts";
import { getPayPlatformUrl, isAllowed } from "../lib/config.ts";

export async function loginView(): Promise<HTMLElement> {
  const container = document.createElement("div");
  container.className = "login-container";

  // If everything is ready, see if there's already an account.
  if (isAuthenticated() && isMasterSeedReady() && isPlatformAuthed()) {
    const addr = getConnectedAddress();
    if (addr && !isAllowed(addr)) {
      // Already authed but not allowed — show invite screen
      return renderInviteOnly(container, addr);
    }
    try {
      const account = await getMe();
      if (account) {
        navigate("/");
        return container;
      }
      // Authed but no account — fall through to signup form
      return renderSignupForm(container);
    } catch (err) {
      // Only clear local auth on a confirmed expired session. Transient
      // errors (network down, platform 5xx) must NOT silently log the user
      // out — surface the error in the connect step instead.
      if (err instanceof SessionExpiredError) {
        clearPlatformAuth();
      } else {
        return renderConnectStep(container, friendlyError(err));
      }
    }
  }

  // Otherwise show the connect-wallet step
  return renderConnectStep(container);
}

function renderConnectStep(
  container: HTMLElement,
  initialError?: string,
): HTMLElement {
  container.innerHTML = `
    <div class="login-card">
      <h1>Moonlight Pay</h1>
      <p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:1.5rem">
        Sign in with your Stellar wallet to create or access your account.
      </p>

      <button id="connect-btn" class="btn-primary btn-wide">Connect Wallet</button>

      <p id="connect-error" class="error-text" hidden></p>
    </div>
  `;

  const connectBtn = container.querySelector(
    "#connect-btn",
  ) as HTMLButtonElement;
  const errorEl = container.querySelector(
    "#connect-error",
  ) as HTMLParagraphElement;

  if (initialError) {
    errorEl.hidden = false;
    errorEl.textContent = initialError;
  }

  connectBtn.addEventListener("click", async () => {
    const originalText = connectBtn.textContent;
    connectBtn.disabled = true;
    errorEl.hidden = true;

    try {
      // Step 1: connect
      connectBtn.textContent = "Connecting...";
      await connectWallet();

      // Step 2: derive master seed (single signature).
      connectBtn.textContent = "Setting up...";
      await initMasterSeed();

      // Freighter rejects consecutive signMessage calls without a delay
      // between them. initMasterSeed signs once, authenticate signs again.
      await new Promise((r) => setTimeout(r, 1000));

      // Step 3: authenticate with pay-platform (challenge-response).
      connectBtn.textContent = "Authenticating...";
      const publicKey = getConnectedAddress();
      if (!publicKey) throw new Error("Wallet not connected");
      await authenticate({ publicKey, sign: signMessage });

      if (publicKey && !isAllowed(publicKey)) {
        renderInviteOnly(container, publicKey);
        return;
      }

      // Step 4: check for existing account
      connectBtn.textContent = "Loading...";
      const account = await getMe();
      if (account) {
        navigate("/");
        return;
      }

      // No account yet — render signup form
      renderSignupForm(container);
    } catch (err) {
      connectBtn.textContent = originalText;
      connectBtn.disabled = false;
      errorEl.hidden = false;
      errorEl.textContent = friendlyError(err);
      // If we got partway through, clear so the user can retry cleanly
      clearSession();
      clearPlatformAuth();
    }
  });

  return container;
}

function renderSignupForm(container: HTMLElement): HTMLElement {
  const address = getConnectedAddress() ?? "";

  const countryOptions = COUNTRY_CODES
    .map((c) =>
      `<option value="${escapeHtml(c.code)}">${escapeHtml(c.label)}</option>`
    )
    .join("");

  container.innerHTML = `
    <div class="login-card">
      <h1>Welcome to Moonlight Pay</h1>
      <p style="color:var(--text-muted);font-size:0.875rem;margin-bottom:1.5rem">
        Tell us a bit about yourself to create your account.
      </p>

      <div class="form-group">
        <label>Wallet</label>
        <input type="text" value="${
    escapeHtml(truncateAddress(address))
  }" disabled />
      </div>

      <div class="form-group">
        <label for="signup-email">Email <span style="color:var(--text-muted);font-weight:normal">(required)</span></label>
        <input type="email" id="signup-email" placeholder="you@example.com" autocomplete="email" />
      </div>

      <div class="form-group">
        <label for="signup-jurisdiction">Jurisdiction <span style="color:var(--text-muted);font-weight:normal">(required, self-reported)</span></label>
        <select id="signup-jurisdiction">
          <option value="">Select your country...</option>
          ${countryOptions}
        </select>
      </div>

      <div class="form-group">
        <label for="signup-display-name">Display Name <span style="color:var(--text-muted);font-weight:normal">(optional)</span></label>
        <input type="text" id="signup-display-name" placeholder="How should we call you?" />
      </div>

      <button id="signup-btn" class="btn-primary btn-wide">Create Account</button>

      <p id="signup-status" class="hint-text" hidden></p>
      <p id="signup-error" class="error-text" hidden></p>
    </div>
  `;

  const signupBtn = container.querySelector("#signup-btn") as HTMLButtonElement;
  const emailInput = container.querySelector(
    "#signup-email",
  ) as HTMLInputElement;
  const jurisdictionSelect = container.querySelector(
    "#signup-jurisdiction",
  ) as HTMLSelectElement;
  const displayNameInput = container.querySelector(
    "#signup-display-name",
  ) as HTMLInputElement;
  const statusEl = container.querySelector(
    "#signup-status",
  ) as HTMLParagraphElement;
  const errorEl = container.querySelector(
    "#signup-error",
  ) as HTMLParagraphElement;

  signupBtn.addEventListener("click", async () => {
    errorEl.hidden = true;

    const email = emailInput.value.trim();
    const jurisdictionCountryCode = jurisdictionSelect.value;
    const displayName = displayNameInput.value.trim();

    if (!email) {
      errorEl.hidden = false;
      errorEl.textContent = "Email is required";
      return;
    }
    if (!jurisdictionCountryCode) {
      errorEl.hidden = false;
      errorEl.textContent = "Jurisdiction is required";
      return;
    }

    signupBtn.disabled = true;
    statusEl.hidden = false;
    statusEl.textContent = "Creating your account...";

    try {
      await createAccount({
        email,
        jurisdictionCountryCode,
        displayName: displayName || undefined,
      });

      // Generate and store receive UTXOs — the "Setting up your account" step.
      // Uses the master seed (still in memory from the sign-in flow) + email
      // to derive 100 P256 receive addresses.
      statusEl.textContent = "Generating receive addresses...";
      let seed: Uint8Array;
      try {
        seed = getMasterSeed();
      } catch {
        throw new Error("Master key was lost. Please sign in again.");
      }
      const utxos = await deriveReceiveUtxos(seed, email);
      await storeReceiveUtxos(utxos);

      navigate("/");
    } catch (err) {
      signupBtn.disabled = false;
      statusEl.hidden = true;
      errorEl.hidden = false;
      errorEl.textContent = friendlyError(err);
    }
  });

  return container;
}

function renderInviteOnly(
  container: HTMLElement,
  address: string,
): HTMLElement {
  container.innerHTML = `
    <div class="login-card" style="text-align:center">
      <img src="/moonlight.png" alt="Moonlight" style="width:80px;margin-bottom:1rem" />
      <h2>Invite Only</h2>
      <p style="color:var(--text-muted);font-size:0.875rem;margin-bottom:0.5rem">
        This app is currently invite-only.
      </p>
      <p style="color:var(--text-muted);font-size:0.8rem;margin-bottom:1.5rem">
        ${escapeHtml(truncateAddress(address))}
      </p>

      <div class="form-group">
        <input type="email" id="waitlist-email" placeholder="your@email.com" autocomplete="email" />
      </div>

      <button id="waitlist-btn" class="btn-primary btn-wide">Join Waitlist</button>

      <p id="waitlist-status" class="hint-text" hidden></p>
      <p id="waitlist-error" class="error-text" hidden></p>

      <p style="margin-top:1.5rem">
        <a href="#" id="waitlist-disconnect" style="color:var(--text-muted);font-size:0.8rem">Disconnect</a>
      </p>
    </div>
  `;

  const emailInput = container.querySelector(
    "#waitlist-email",
  ) as HTMLInputElement;
  const btn = container.querySelector("#waitlist-btn") as HTMLButtonElement;
  const statusEl = container.querySelector(
    "#waitlist-status",
  ) as HTMLParagraphElement;
  const errorEl = container.querySelector(
    "#waitlist-error",
  ) as HTMLParagraphElement;
  const disconnectLink = container.querySelector(
    "#waitlist-disconnect",
  ) as HTMLAnchorElement;

  btn.addEventListener("click", async () => {
    errorEl.hidden = true;
    statusEl.hidden = true;

    const email = emailInput.value.trim();
    if (!email) {
      errorEl.hidden = false;
      errorEl.textContent = "Please enter your email.";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Submitting...";

    try {
      const res = await fetch(
        `${getPayPlatformUrl()}/api/v1/waitlist`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, walletPublicKey: address }),
        },
      );
      if (!res.ok) {
        throw new Error(`Server responded with ${res.status}`);
      }
      statusEl.hidden = false;
      statusEl.textContent = "You're on the list!";
      btn.textContent = "Join Waitlist";
      btn.disabled = true;
    } catch (err) {
      btn.textContent = "Join Waitlist";
      btn.disabled = false;
      errorEl.hidden = false;
      errorEl.textContent = friendlyError(err);
    }
  });

  disconnectLink.addEventListener("click", (e) => {
    e.preventDefault();
    clearSession();
    clearPlatformAuth();
    navigate("/login", { force: true });
  });

  return container;
}
