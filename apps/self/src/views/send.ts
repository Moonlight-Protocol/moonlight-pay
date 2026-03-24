import { page } from "../components/page.ts";
import { escapeHtml } from "../lib/dom.ts";
import { deriveUtxoKeypairs } from "../lib/derivation.ts";
import {
  getSelfBalance,
  submitBundle,
  getBundleStatus,
} from "shared/api/client.ts";
import { capture } from "shared/analytics/index.ts";
import { bytesToHex, hexToBytes } from "shared/utils/hex.ts";
import { parseStroops } from "shared/utils/amount.ts";
import {
  MoonlightOperation,
  getLatestLedger,
  getChannelContractId,
  createUtxoKeypair,
} from "../lib/channel.ts";

/** UTXO info with balance for the send flow */
interface UtxoSlot {
  index: number;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  publicKeyHex: string;
  balance: bigint;
}

function renderContent(): HTMLElement {
  const el = document.createElement("div");

  el.innerHTML = `
    <h2>Send</h2>
    <p style="color:var(--text-muted);margin-bottom:1.5rem">
      Send XLM privately. Your P256 keys sign SPEND operations client-side,
      then the bundle is submitted to the provider for on-chain execution.
    </p>

    <div class="form-group">
      <label for="send-to">Recipient UTXO Public Key (hex)</label>
      <input type="text" id="send-to" placeholder="04..." autocomplete="off" />
      <span style="color:var(--text-muted);font-size:0.75rem">The receiver's P256 public key in hex encoding.</span>
    </div>
    <div class="form-group">
      <label for="send-amount">Amount (XLM)</label>
      <input type="number" id="send-amount" placeholder="0.00" step="0.01" min="0.01" />
    </div>

    <div id="utxo-source-info" style="margin-bottom:1rem;color:var(--text-muted);font-size:0.875rem">
      <p>Loading UTXO balances...</p>
    </div>

    <button id="send-btn" class="btn-primary btn-wide" disabled>Send</button>
    <p id="send-status" class="hint-text" hidden></p>
    <p id="send-error" class="error-text" hidden></p>
  `;

  const sendBtn = el.querySelector("#send-btn") as HTMLButtonElement;
  const statusEl = el.querySelector("#send-status") as HTMLParagraphElement;
  const errorEl = el.querySelector("#send-error") as HTMLParagraphElement;
  const utxoSourceEl = el.querySelector("#utxo-source-info") as HTMLDivElement;

  // Track available UTXOs with funds
  let fundedUtxos: UtxoSlot[] = [];
  // Track free UTXOs for change
  let freeUtxos: UtxoSlot[] = [];

  // Derive keypairs and find funded slots
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

        // Categorize UTXOs
        for (const kp of keypairs) {
          const pkHex = bytesToHex(kp.publicKey);
          const balanceStr = balanceMap.get(pkHex) ?? "0";
          const balance = BigInt(balanceStr);

          const slot: UtxoSlot = {
            index: kp.index,
            publicKey: kp.publicKey,
            privateKey: kp.privateKey,
            publicKeyHex: pkHex,
            balance,
          };

          if (balance > 0n) {
            fundedUtxos.push(slot);
          } else {
            freeUtxos.push(slot);
          }
        }

        if (fundedUtxos.length > 0) {
          const totalBalance = fundedUtxos.reduce((sum, u) => sum + u.balance, 0n);
          const totalXlm = Number(totalBalance) / 10_000_000;
          utxoSourceEl.innerHTML = `
            <p>Available: <strong>${totalXlm.toFixed(2)} XLM</strong> across ${fundedUtxos.length} UTXO(s)</p>
          `;
          sendBtn.disabled = false;
        } else {
          utxoSourceEl.innerHTML = `<p class="error-text">No funded UTXOs found. Deposit first.</p>`;
        }
      });
    })
    .catch((err) => {
      utxoSourceEl.innerHTML = `<p class="error-text">Failed to load UTXOs: ${escapeHtml(err.message)}</p>`;
    });

  sendBtn.addEventListener("click", async () => {
    const toInput = el.querySelector("#send-to") as HTMLInputElement;
    const amountInput = el.querySelector("#send-amount") as HTMLInputElement;
    const toHex = toInput.value.trim();
    const amountStr = amountInput.value.trim();

    if (!toHex || !/^[0-9a-fA-F]+$/.test(toHex)) {
      errorEl.textContent = "Enter a valid hex-encoded P256 public key";
      errorEl.hidden = false;
      return;
    }
    // P256 compressed key = 66 hex chars, uncompressed = 130 hex chars
    if (toHex.length !== 66 && toHex.length !== 130) {
      errorEl.textContent = "Public key must be 66 (compressed) or 130 (uncompressed) hex characters";
      errorEl.hidden = false;
      return;
    }

    const amount = parseFloat(amountStr);
    if (!amount || amount <= 0) {
      errorEl.textContent = "Enter a valid amount";
      errorEl.hidden = false;
      return;
    }

    const amountStroops = parseStroops(amountStr);

    // Select UTXOs to cover the amount
    let remaining = amountStroops;
    const selectedUtxos: UtxoSlot[] = [];
    for (const utxo of fundedUtxos) {
      if (remaining <= 0n) break;
      selectedUtxos.push(utxo);
      remaining -= utxo.balance;
    }

    if (remaining > 0n) {
      errorEl.textContent = "Insufficient balance across UTXOs";
      errorEl.hidden = false;
      return;
    }

    sendBtn.disabled = true;
    errorEl.hidden = true;
    statusEl.textContent = "Building operations...";
    statusEl.hidden = false;

    capture("pay_self_send_start");

    try {
      const receiverPublicKey = hexToBytes(toHex);
      const channelContractId = getChannelContractId();
      const latestLedger = await getLatestLedger();
      // Signature valid for ~5 minutes (~60 ledgers)
      const expirationLedger = latestLedger + 60;

      // Build CREATE operation for the receiver
      const createOp = MoonlightOperation.create(receiverPublicKey, amountStroops);

      // Calculate total spend and change
      const totalSpend = selectedUtxos.reduce((sum, u) => sum + u.balance, 0n);
      const changeAmount = totalSpend - amountStroops;

      // If there is change, we need a CREATE for the change too
      let changeCreateOp: ReturnType<typeof MoonlightOperation.create> | null = null;
      if (changeAmount > 0n) {
        if (freeUtxos.length === 0) {
          throw new Error("No free UTXO slot available for change. Try sending the exact amount.");
        }
        const changeUtxo = freeUtxos[0];
        changeCreateOp = MoonlightOperation.create(changeUtxo.publicKey, changeAmount);
      }

      statusEl.textContent = "Signing SPEND operations...";

      // Build and sign SPEND operations for each selected UTXO
      const signedOps: Array<{ toMLXDR(): string }> = [createOp];
      if (changeCreateOp) signedOps.push(changeCreateOp);

      for (const utxoSlot of selectedUtxos) {
        let spendOp = MoonlightOperation.spend(utxoSlot.publicKey);
        // Add conditions: the receiver CREATE, and change CREATE if applicable
        spendOp = spendOp.addCondition(createOp.toCondition());
        if (changeCreateOp) {
          spendOp = spendOp.addCondition(changeCreateOp.toCondition());
        }

        // Create a UTXOKeypairBase for signing
        const keypairBase = createUtxoKeypair(utxoSlot.privateKey, utxoSlot.publicKey);

        // Sign the SPEND operation
        const signedSpend = await spendOp.signWithUTXO(
          keypairBase,
          channelContractId,
          expirationLedger,
        );

        signedOps.push(signedSpend);
      }

      // Zero private keys now that signing is complete
      for (const utxoSlot of selectedUtxos) utxoSlot.privateKey.fill(0);

      statusEl.textContent = "Submitting bundle...";

      // Serialize all operations to MLXDR
      const operationsMLXDR = signedOps.map((op) => op.toMLXDR());

      // Submit the bundle
      const { data } = await submitBundle(operationsMLXDR);

      capture("pay_self_send_submitted", {
        bundleId: data.operationsBundleId,
        utxoCount: selectedUtxos.length,
      });

      statusEl.textContent = `Bundle submitted! ID: ${escapeHtml(data.operationsBundleId.slice(0, 12))}... Checking status...`;

      // Poll for status briefly
      let finalStatus = "submitted";
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const statusRes = await getBundleStatus(data.operationsBundleId);
          finalStatus = statusRes.data.status;
          statusEl.textContent = `Bundle: ${escapeHtml(data.operationsBundleId.slice(0, 12))}... Status: ${escapeHtml(finalStatus)}`;
          if (finalStatus === "confirmed" || finalStatus === "failed") break;
        } catch {
          break;
        }
      }

      capture("pay_self_send_complete", {
        bundleId: data.operationsBundleId,
        status: finalStatus,
      });

      // Clear form and show success — keep button disabled to prevent double-submit
      toInput.value = "";
      amountInput.value = "";
      statusEl.textContent = "Transaction submitted";

      // Zero remaining private keys before refreshing
      for (const u of fundedUtxos) u.privateKey.fill(0);
      for (const u of freeUtxos) u.privateKey.fill(0);

      // Refresh UTXO data so the form reflects the new state
      fundedUtxos = [];
      freeUtxos = [];
      utxoSourceEl.innerHTML = `<p>Refreshing UTXO balances...</p>`;
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
              const balanceStr = balanceMap.get(pkHex) ?? "0";
              const balance = BigInt(balanceStr);
              const slot: UtxoSlot = {
                index: kp.index,
                publicKey: kp.publicKey,
                privateKey: kp.privateKey,
                publicKeyHex: pkHex,
                balance,
              };
              if (balance > 0n) {
                fundedUtxos.push(slot);
              } else {
                freeUtxos.push(slot);
              }
            }
            if (fundedUtxos.length > 0) {
              const totalBalance = fundedUtxos.reduce((sum, u) => sum + u.balance, 0n);
              const totalXlm = Number(totalBalance) / 10_000_000;
              utxoSourceEl.innerHTML = `<p>Available: <strong>${totalXlm.toFixed(2)} XLM</strong> across ${fundedUtxos.length} UTXO(s)</p>`;
              sendBtn.disabled = false;
            } else {
              utxoSourceEl.innerHTML = `<p class="error-text">No funded UTXOs found. Deposit first.</p>`;
            }
          });
        })
        .catch(() => {
          sendBtn.disabled = false;
        });
    } catch (error) {
      errorEl.textContent = error instanceof Error ? error.message : "Send failed";
      errorEl.hidden = false;
      statusEl.hidden = true;
      capture("pay_self_send_failed");
      sendBtn.disabled = false;
    }
  });

  return el;
}

export const sendView = page(renderContent);
