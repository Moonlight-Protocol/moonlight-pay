import { onboardingPage } from "./layout.ts";
import { navigate } from "../../lib/router.ts";
import { getConnectedAddress, getMasterSeed } from "../../lib/wallet.ts";
import { createAccount, getMe, storeReceiveUtxos } from "../../lib/api.ts";
import { deriveReceiveUtxos } from "../../lib/utxo-derivation.ts";
import { COUNTRY_CODES } from "../../lib/jurisdictions.ts";
import { escapeHtml, friendlyError, truncateAddress } from "../../lib/dom.ts";

function renderStep(): HTMLElement {
  const el = document.createElement("div");
  const address = getConnectedAddress() ?? "";

  const countryOptions = COUNTRY_CODES
    .map(
      (c) =>
        `<option value="${escapeHtml(c.code)}">${escapeHtml(c.label)}</option>`,
    )
    .join("");

  el.innerHTML = `
    <h2>Create Your Account</h2>

    <div class="form-group">
      <label>Wallet</label>
      <input type="text" value="${
    escapeHtml(truncateAddress(address))
  }" disabled />
    </div>

    <div class="form-group">
      <label for="signup-email">Email</label>
      <input type="email" id="signup-email" placeholder="you@example.com" autocomplete="email" />
    </div>

    <div class="form-group">
      <label for="signup-jurisdiction">Jurisdiction</label>
      <select id="signup-jurisdiction">
        <option value="">Select your country...</option>
        ${countryOptions}
      </select>
    </div>

    <div class="form-group">
      <label for="signup-display-name">Display Name <span style="color:var(--text-muted);font-weight:normal">(optional)</span></label>
      <input type="text" id="signup-display-name" placeholder="How should we call you?" />
    </div>

    <button id="signup-btn" class="btn-primary btn-wide">Next</button>

    <p id="signup-status" class="hint-text" hidden></p>
    <p id="signup-error" class="error-text" hidden></p>
  `;

  const signupBtn = el.querySelector("#signup-btn") as HTMLButtonElement;
  const emailInput = el.querySelector("#signup-email") as HTMLInputElement;
  const jurisdictionSelect = el.querySelector(
    "#signup-jurisdiction",
  ) as HTMLSelectElement;
  const displayNameInput = el.querySelector(
    "#signup-display-name",
  ) as HTMLInputElement;
  const statusEl = el.querySelector("#signup-status") as HTMLParagraphElement;
  const errorEl = el.querySelector("#signup-error") as HTMLParagraphElement;

  // If account already exists, skip to next step
  getMe().then((account) => {
    if (account) navigate("/onboarding/treasury");
  }).catch(() => {});

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

      statusEl.textContent = "Generating receive addresses...";
      let seed: Uint8Array;
      try {
        seed = getMasterSeed();
      } catch {
        throw new Error("Master key was lost. Please sign in again.");
      }
      const utxos = await deriveReceiveUtxos(seed, email);
      await storeReceiveUtxos(utxos);

      navigate("/onboarding/treasury");
    } catch (err) {
      signupBtn.disabled = false;
      statusEl.hidden = true;
      errorEl.hidden = false;
      errorEl.textContent = friendlyError(err);
    }
  });

  return el;
}

export const accountView = onboardingPage("account", renderStep);
