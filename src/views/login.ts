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
} from "../lib/api.ts";
import { navigate } from "../lib/router.ts";
import { COUNTRY_CODES } from "../lib/jurisdictions.ts";
import { escapeHtml, friendlyError, truncateAddress } from "../lib/dom.ts";

/**
 * Conservative retry list for wallet calls. We only retry on errors whose
 * message *clearly* indicates a transient condition — never on unknown or
 * cancellation errors. The earlier "retry on anything that doesn't look
 * like a cancel" approach was too aggressive: any unknown wording would
 * pop the wallet UI 3 times before failing.
 */
const RETRYABLE_PATTERNS = [
  /\btimeout\b/i,
  /\btimed out\b/i,
  /\bnetwork\b/i,
  /\bbusy\b/i,
  /\btoo many requests\b/i,
  /\bnot ready\b/i,
];

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return RETRYABLE_PATTERNS.some((re) => re.test(msg));
}

/**
 * Retry a wallet call only on known transient conditions (network blip,
 * "wallet busy", timeout). Any other error — including user rejection —
 * propagates immediately so we don't pop a wallet prompt three times for
 * a permanent failure.
 */
async function withWalletRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 400,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === attempts - 1) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }
  throw lastErr;
}

export async function loginView(): Promise<HTMLElement> {
  const container = document.createElement("div");
  container.className = "login-container";

  // If everything is ready, see if there's already an account.
  if (isAuthenticated() && isMasterSeedReady() && isPlatformAuthed()) {
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

      <p id="connect-status" class="hint-text" hidden></p>
      <p id="connect-error" class="error-text" hidden></p>
    </div>
  `;

  const connectBtn = container.querySelector(
    "#connect-btn",
  ) as HTMLButtonElement;
  const statusEl = container.querySelector(
    "#connect-status",
  ) as HTMLParagraphElement;
  const errorEl = container.querySelector(
    "#connect-error",
  ) as HTMLParagraphElement;

  if (initialError) {
    errorEl.hidden = false;
    errorEl.textContent = initialError;
  }

  connectBtn.addEventListener("click", async () => {
    connectBtn.disabled = true;
    errorEl.hidden = true;
    statusEl.hidden = false;

    try {
      // Step 1: connect
      statusEl.textContent = "Connecting to wallet...";
      await connectWallet();

      // Step 2: derive master seed (single signature). Wrapped in
      // withWalletRetry because Freighter occasionally fails the first
      // signMessage right after the connect handshake.
      statusEl.textContent = "Deriving master key...";
      await withWalletRetry(() => initMasterSeed());

      // Step 3: authenticate with pay-platform (challenge-response).
      // Same retry: two consecutive signMessage calls can race the wallet.
      statusEl.textContent = "Signing in to Moonlight Pay...";
      const publicKey = getConnectedAddress();
      if (!publicKey) throw new Error("Wallet not connected");
      await withWalletRetry(() =>
        authenticate({ publicKey, sign: signMessage })
      );

      // Step 4: check for existing account
      statusEl.textContent = "Loading account...";
      const account = await getMe();
      if (account) {
        navigate("/");
        return;
      }

      // No account yet — render signup form
      renderSignupForm(container);
    } catch (err) {
      connectBtn.disabled = false;
      statusEl.hidden = true;
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
