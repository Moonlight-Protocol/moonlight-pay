/**
 * Sign-in view.
 *
 * Flow:
 *   1. Connect wallet (Freighter via Stellar Wallets Kit)
 *   2. Derive master seed from a single wallet signature
 *   3. Authenticate with pay-platform (wallet challenge -> JWT)
 *   4. Check if account exists:
 *        - if yes + OpEx set up -> navigate to home
 *        - if yes + no OpEx     -> navigate to /onboarding/treasury
 *        - if no                -> navigate to /onboarding/account
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
  getMe,
  isPlatformAuthed,
  SessionExpiredError,
} from "../lib/api.ts";
import { navigate } from "../lib/router.ts";
import { escapeHtml, friendlyError, truncateAddress } from "../lib/dom.ts";
import { getPayPlatformUrl, isAllowed } from "../lib/config.ts";

export async function loginView(): Promise<HTMLElement> {
  const container = document.createElement("div");
  container.className = "login-container";

  // If fully authenticated, check onboarding state and redirect
  if (isAuthenticated() && isMasterSeedReady() && isPlatformAuthed()) {
    const addr = getConnectedAddress();
    if (addr && !isAllowed(addr)) {
      return renderInviteOnly(container, addr);
    }
    try {
      const account = await getMe();
      if (account) {
        if (account.opexPublicKey) {
          navigate("/");
        } else {
          navigate("/onboarding/treasury");
        }
        return container;
      }
      navigate("/onboarding/account");
      return container;
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        clearPlatformAuth();
      } else {
        return renderConnectStep(container, friendlyError(err));
      }
    }
  }

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
      connectBtn.textContent = "Connecting...";
      await connectWallet();

      connectBtn.textContent = "Setting up...";
      await initMasterSeed();

      // Freighter rejects consecutive signMessage calls without a delay
      await new Promise((r) => setTimeout(r, 1000));

      connectBtn.textContent = "Authenticating...";
      const publicKey = getConnectedAddress();
      if (!publicKey) throw new Error("Wallet not connected");
      await authenticate({ publicKey, sign: signMessage });

      if (publicKey && !isAllowed(publicKey)) {
        renderInviteOnly(container, publicKey);
        return;
      }

      connectBtn.textContent = "Loading...";
      const account = await getMe();
      if (account) {
        if (account.opexPublicKey) {
          navigate("/");
        } else {
          navigate("/onboarding/treasury");
        }
        return;
      }

      navigate("/onboarding/account");
    } catch (err) {
      connectBtn.textContent = originalText;
      connectBtn.disabled = false;
      errorEl.hidden = false;
      errorEl.textContent = friendlyError(err);
      clearSession();
      clearPlatformAuth();
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
