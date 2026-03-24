/**
 * Demo tab component.
 * Add addresses with simulated KYC data and trigger "simulate KYC complete".
 */
import { simulateKyc } from "../api/client.ts";
import { escapeHtml } from "../utils/dom.ts";

interface DemoAddress {
  address: string;
  jurisdiction: string;
  kycStatus: "none" | "pending" | "verified";
}

const DEMO_STORAGE_KEY = "moonlight_pay_demo_addresses";

function loadDemoAddresses(): DemoAddress[] {
  try {
    return JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveDemoAddresses(addresses: DemoAddress[]): void {
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(addresses));
}

export function renderDemoTab(container: HTMLElement, onRefresh?: () => void): void {
  const addresses = loadDemoAddresses();

  const rows = addresses.length > 0
    ? addresses.map((a, i) => `
        <tr>
          <td class="mono" style="font-size:0.8rem">${escapeHtml(a.address.slice(0, 10))}...${escapeHtml(a.address.slice(-4))}</td>
          <td>${escapeHtml(a.jurisdiction)}</td>
          <td>${escapeHtml(a.kycStatus)}</td>
          <td>
            ${a.kycStatus !== "verified"
              ? `<button class="btn-link simulate-kyc" data-index="${i}">Simulate KYC</button>`
              : `<span style="color:var(--active)">Verified</span>`
            }
            <button class="btn-link remove-addr" data-index="${i}" style="color:var(--inactive);margin-left:0.5rem">Remove</button>
          </td>
        </tr>
      `).join("")
    : `<tr><td colspan="4" style="color:var(--text-muted)">No demo addresses. Add one below.</td></tr>`;

  container.innerHTML = `
    <h2>Demo</h2>
    <p style="color:var(--text-muted);margin-bottom:1rem">
      Add test addresses with simulated KYC data. Use "Simulate KYC" to trigger the
      escrow claim flow for unknown receivers.
    </p>

    <table>
      <thead><tr><th>Address</th><th>Jurisdiction</th><th>KYC Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <h3 style="margin-top:1.5rem">Add Demo Address</h3>
    <div class="form-group">
      <label for="demo-address">Stellar Address</label>
      <input type="text" id="demo-address" placeholder="G..." autocomplete="off" />
    </div>
    <div class="form-group">
      <label for="demo-jurisdiction">Jurisdiction</label>
      <input type="text" id="demo-jurisdiction" placeholder="e.g. US, BR, EU" />
    </div>
    <button id="add-demo-btn" class="btn-primary">Add Address</button>
    <p id="demo-status" class="hint-text" hidden></p>
    <p id="demo-error" class="error-text" hidden></p>
  `;

  const statusEl = container.querySelector("#demo-status") as HTMLParagraphElement;
  const errorEl = container.querySelector("#demo-error") as HTMLParagraphElement;

  // Add address
  container.querySelector("#add-demo-btn")?.addEventListener("click", () => {
    const addr = (container.querySelector("#demo-address") as HTMLInputElement).value.trim();
    const jurisdiction = (container.querySelector("#demo-jurisdiction") as HTMLInputElement).value.trim();

    if (!addr || !addr.startsWith("G")) {
      errorEl.textContent = "Enter a valid Stellar address (G...)";
      errorEl.hidden = false;
      return;
    }
    if (!jurisdiction) {
      errorEl.textContent = "Enter a jurisdiction code";
      errorEl.hidden = false;
      return;
    }

    const current = loadDemoAddresses();
    if (current.some((a) => a.address === addr)) {
      errorEl.textContent = "Address already added";
      errorEl.hidden = false;
      return;
    }

    current.push({ address: addr, jurisdiction, kycStatus: "none" });
    saveDemoAddresses(current);
    errorEl.hidden = true;
    renderDemoTab(container, onRefresh);
  });

  // Simulate KYC
  container.querySelectorAll(".simulate-kyc").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number((btn as HTMLElement).dataset.index);
      const addr = addresses[idx];
      if (!addr) return;

      (btn as HTMLButtonElement).disabled = true;
      (btn as HTMLButtonElement).textContent = "Simulating...";

      try {
        await simulateKyc(addr.address, addr.jurisdiction);
        const current = loadDemoAddresses();
        current[idx].kycStatus = "verified";
        saveDemoAddresses(current);
        statusEl.textContent = `KYC simulated for ${addr.address.slice(0, 8)}...`;
        statusEl.hidden = false;
        if (onRefresh) onRefresh();
        renderDemoTab(container, onRefresh);
      } catch (err) {
        errorEl.textContent = err instanceof Error ? err.message : "Simulation failed";
        errorEl.hidden = false;
      }
    });
  });

  // Remove address
  container.querySelectorAll(".remove-addr").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number((btn as HTMLElement).dataset.index);
      const current = loadDemoAddresses();
      current.splice(idx, 1);
      saveDemoAddresses(current);
      renderDemoTab(container, onRefresh);
    });
  });
}
