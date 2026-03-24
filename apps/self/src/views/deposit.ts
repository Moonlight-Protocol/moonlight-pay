import { page } from "../components/page.ts";
import { escapeHtml } from "../lib/dom.ts";
import { deriveUtxoKeypairs } from "../lib/derivation.ts";
import { getSelfBalance, demoDeposit } from "shared/api/client.ts";
import { capture } from "shared/analytics/index.ts";
import { bytesToHex } from "shared/utils/hex.ts";
import { parseStroops } from "shared/utils/amount.ts";

function renderContent(): HTMLElement {
  const el = document.createElement("div");

  el.innerHTML = `
    <h2>Deposit</h2>
    <p style="color:var(--text-muted);margin-bottom:1.5rem">
      Deposit XLM into your private balance. The provider will create a UTXO for one of your free P256 addresses.
    </p>

    <div class="form-group">
      <label for="deposit-amount">Amount (XLM)</label>
      <input type="number" id="deposit-amount" placeholder="0.00" step="0.01" min="0.01" />
    </div>

    <div id="deposit-utxo-info" style="margin-bottom:1rem;color:var(--text-muted);font-size:0.875rem">
      <p>Finding a free UTXO slot...</p>
    </div>

    <button id="deposit-btn" class="btn-primary btn-wide" disabled>Deposit</button>
    <p id="deposit-status" class="hint-text" hidden></p>
    <p id="deposit-error" class="error-text" hidden></p>
  `;

  const depositBtn = el.querySelector("#deposit-btn") as HTMLButtonElement;
  const statusEl = el.querySelector("#deposit-status") as HTMLParagraphElement;
  const errorEl = el.querySelector("#deposit-error") as HTMLParagraphElement;
  const utxoInfoEl = el.querySelector("#deposit-utxo-info") as HTMLDivElement;

  // Track which public key will receive the deposit
  let selectedPublicKeyHex: string | null = null;

  // Derive keypairs and find a free slot
  deriveUtxoKeypairs(0, 10)
    .then((keypairs) => {
      const publicKeysHex = keypairs.map((kp) => bytesToHex(kp.publicKey));

      return getSelfBalance(publicKeysHex).then(({ data }) => {
        // Build balance map
        const balanceMap = new Map<string, string>();
        if (data.utxos) {
          for (const utxo of data.utxos) {
            balanceMap.set(utxo.publicKey, utxo.balance);
          }
        }

        // Find the first free slot (no balance or balance "0")
        for (const kp of keypairs) {
          const pkHex = bytesToHex(kp.publicKey);
          const balance = balanceMap.get(pkHex);
          if (balance === undefined || balance === "0") {
            selectedPublicKeyHex = pkHex;
            break;
          }
        }

        if (selectedPublicKeyHex) {
          utxoInfoEl.innerHTML = `<p>Deposit to UTXO: <span class="mono" style="font-size:0.7rem">${escapeHtml(selectedPublicKeyHex.slice(0, 32))}...</span></p>`;
          depositBtn.disabled = false;
        } else {
          utxoInfoEl.innerHTML = `<p class="error-text">No free UTXO slots available in the first 10 slots.</p>`;
        }
      });
    })
    .catch((err) => {
      utxoInfoEl.innerHTML = `<p class="error-text">Failed to find UTXO slot: ${escapeHtml(err.message)}</p>`;
    });

  depositBtn.addEventListener("click", async () => {
    if (!selectedPublicKeyHex) return;

    const amountStr = (el.querySelector("#deposit-amount") as HTMLInputElement).value.trim();
    const amount = parseFloat(amountStr);

    if (!amount || amount <= 0) {
      errorEl.textContent = "Enter a valid amount";
      errorEl.hidden = false;
      return;
    }

    // Convert to stroops using string-based parsing to avoid floating-point errors
    const stroops = String(parseStroops(amountStr));

    depositBtn.disabled = true;
    errorEl.hidden = true;
    statusEl.textContent = "Submitting deposit...";
    statusEl.hidden = false;

    capture("pay_self_deposit_start");

    try {
      const { data } = await demoDeposit(selectedPublicKeyHex, stroops);

      capture("pay_self_deposit_success", {
        bundleId: data.bundleId,
        status: data.status,
      });

      statusEl.textContent = `Deposit submitted! Bundle: ${escapeHtml(data.bundleId.slice(0, 12))}... Status: ${escapeHtml(data.status)}`;

      // Refresh slot data after a short delay to allow on-chain settlement
      setTimeout(() => {
        selectedPublicKeyHex = null;
        utxoInfoEl.innerHTML = `<p>Refreshing UTXO slots...</p>`;
        depositBtn.disabled = true;
        deriveUtxoKeypairs(0, 10)
          .then((keypairs) => {
            const publicKeysHex = keypairs.map((kp) => bytesToHex(kp.publicKey));
            return getSelfBalance(publicKeysHex).then(({ data: balData }) => {
              const balanceMap = new Map<string, string>();
              if (balData.utxos) {
                for (const utxo of balData.utxos) {
                  balanceMap.set(utxo.publicKey, utxo.balance);
                }
              }
              for (const kp of keypairs) {
                const pkHex = bytesToHex(kp.publicKey);
                const balance = balanceMap.get(pkHex);
                if (balance === undefined || balance === "0") {
                  selectedPublicKeyHex = pkHex;
                  break;
                }
              }
              if (selectedPublicKeyHex) {
                utxoInfoEl.innerHTML = `<p>Deposit to UTXO: <span class="mono" style="font-size:0.7rem">${escapeHtml(selectedPublicKeyHex.slice(0, 32))}...</span></p>`;
                depositBtn.disabled = false;
              } else {
                utxoInfoEl.innerHTML = `<p class="error-text">No free UTXO slots available in the first 10 slots.</p>`;
              }
            });
          })
          .catch(() => {
            depositBtn.disabled = false;
          });
      }, 3000);
    } catch (error) {
      errorEl.textContent = error instanceof Error ? error.message : "Deposit failed";
      errorEl.hidden = false;
      statusEl.hidden = true;
      capture("pay_self_deposit_failed");
      depositBtn.disabled = false;
    }
  });

  return el;
}

export const depositView = page(renderContent);
