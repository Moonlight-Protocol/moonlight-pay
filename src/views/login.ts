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
import { renderInviteWaitlist } from "@moonlight/ui/invite-waitlist";
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
import { friendlyError } from "../lib/dom.ts";
import { getPayPlatformUrl, isAllowed } from "../lib/config.ts";
import { startTrace, withSpan } from "../lib/tracer.ts";

function inviteWaitlistView(address: string): HTMLElement {
  return renderInviteWaitlist({
    address,
    platformUrl: getPayPlatformUrl(),
    logoSrc: "/moonlight.png",
    ids: { emailInput: "waitlist-email" },
    onDisconnect: () => {
      clearSession();
      clearPlatformAuth();
      navigate("/login", { force: true });
    },
  });
}

export async function loginView(): Promise<HTMLElement> {
  const container = document.createElement("div");
  container.className = "login-container";

  // If fully authenticated, check onboarding state and redirect
  if (isAuthenticated() && isMasterSeedReady() && isPlatformAuthed()) {
    const addr = getConnectedAddress();
    if (addr && !isAllowed(addr)) {
      return inviteWaitlistView(addr);
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
      const { traceId } = startTrace();
      const publicKey = await withSpan("pay.login", traceId, async () => {
        connectBtn.textContent = "Connecting...";
        await connectWallet();

        connectBtn.textContent = "Setting up...";
        await initMasterSeed();

        // Freighter rejects consecutive signMessage calls without a delay
        await new Promise((r) => setTimeout(r, 1000));

        connectBtn.textContent = "Authenticating...";
        const pk = getConnectedAddress();
        if (!pk) throw new Error("Wallet not connected");
        await authenticate({ publicKey: pk, sign: signMessage });
        return pk;
      });

      if (publicKey && !isAllowed(publicKey)) {
        container.replaceWith(inviteWaitlistView(publicKey));
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
