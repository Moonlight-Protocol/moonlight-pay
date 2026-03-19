import { page } from "../components/page.ts";
import { escapeHtml } from "../lib/dom.ts";
import { custodialSend } from "shared/api/client.ts";
import { capture } from "shared/analytics/index.ts";

function renderContent(): HTMLElement {
  const el = document.createElement("div");

  el.innerHTML = `
    <h2>Send</h2>
    <p style="color:var(--text-muted);margin-bottom:1.5rem">
      Send XLM privately to any Stellar address. The Privacy Provider handles
      the transaction on your behalf.
    </p>

    <div class="form-group">
      <label for="send-to">Recipient Address</label>
      <input type="text" id="send-to" placeholder="G..." autocomplete="off" />
    </div>
    <div class="form-group">
      <label for="send-amount">Amount (XLM)</label>
      <input type="number" id="send-amount" placeholder="0.00" step="0.01" min="0.01" />
    </div>

    <button id="send-btn" class="btn-primary btn-wide">Send</button>
    <p id="send-status" class="hint-text" hidden></p>
    <p id="send-error" class="error-text" hidden></p>
  `;

  const sendBtn = el.querySelector("#send-btn") as HTMLButtonElement;
  const statusEl = el.querySelector("#send-status") as HTMLParagraphElement;
  const errorEl = el.querySelector("#send-error") as HTMLParagraphElement;

  sendBtn.addEventListener("click", async () => {
    const to = (el.querySelector("#send-to") as HTMLInputElement).value.trim();
    const amountStr = (el.querySelector("#send-amount") as HTMLInputElement).value.trim();

    if (!to || !to.startsWith("G")) {
      errorEl.textContent = "Enter a valid Stellar address";
      errorEl.hidden = false;
      return;
    }

    const amount = parseFloat(amountStr);
    if (!amount || amount <= 0) {
      errorEl.textContent = "Enter a valid amount";
      errorEl.hidden = false;
      return;
    }

    const stroops = String(Math.round(amount * 10_000_000));

    sendBtn.disabled = true;
    errorEl.hidden = true;
    statusEl.textContent = "Submitting...";
    statusEl.hidden = false;

    try {
      const { data } = await custodialSend(to, stroops);

      capture("pay_custodial_send", { to: to.slice(0, 8), amount: stroops });
      statusEl.textContent = `Sent! Bundle: ${escapeHtml(data.bundleId.slice(0, 12))}... Status: ${escapeHtml(data.status)}`;
    } catch (error) {
      errorEl.textContent = error instanceof Error ? error.message : "Send failed";
      errorEl.hidden = false;
      statusEl.hidden = true;
      capture("pay_custodial_send_failed");
    } finally {
      sendBtn.disabled = false;
    }
  });

  return el;
}

export const sendView = page(renderContent);
