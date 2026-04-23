/**
 * Admin view — CRUD for councils, channels, and privacy providers.
 *
 * Route: /#/admin
 * Access: wallet must be in config.adminWallets.
 */
import { getConnectedAddress } from "../lib/wallet.ts";
import { isAdmin } from "../lib/config.ts";
import { escapeHtml, friendlyError } from "../lib/dom.ts";
import {
  type AdminCouncil,
  adminCreateChannel,
  adminCreateCouncil,
  adminCreatePp,
  adminDeleteChannel,
  adminDeleteCouncil,
  adminDeletePp,
  adminDiscoverCouncil,
  adminGetCouncil,
  adminListCouncils,
  adminUpdateCouncil,
  adminUpdatePp,
} from "../lib/api.ts";

export async function adminView(): Promise<HTMLElement> {
  const container = document.createElement("div");
  container.className = "admin-container";

  const address = getConnectedAddress();
  if (!address || !isAdmin(address)) {
    container.innerHTML =
      `<div class="login-card"><h2>Access Denied</h2><p>Your wallet is not authorized for admin access.</p><a href="#/">Back</a></div>`;
    return container;
  }

  container.innerHTML = `
    <div style="max-width:900px;margin:0 auto;padding:1.5rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
        <h1 style="margin:0">Admin</h1>
        <a href="#/" style="color:var(--text-muted);font-size:0.85rem">Back to Home</a>
      </div>

      <div id="admin-content">
        <p style="color:var(--text-muted)">Loading...</p>
      </div>
    </div>
  `;

  await renderCouncilList(container.querySelector("#admin-content")!);
  return container;
}

async function renderCouncilList(target: Element): Promise<void> {
  try {
    const councils = await adminListCouncils();
    target.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <h2 style="margin:0">Councils</h2>
        <button id="add-council-btn" class="btn-primary" style="padding:0.4rem 1rem;font-size:0.85rem">+ Add Council</button>
      </div>
      <div id="council-list"></div>
      <div id="council-form" hidden></div>
    `;

    const listEl = target.querySelector("#council-list")!;
    if (councils.length === 0) {
      listEl.innerHTML =
        `<p style="color:var(--text-muted)">No councils yet.</p>`;
    } else {
      listEl.innerHTML = councils.map((c) => `
        <div class="stat-card" style="margin-bottom:0.75rem;cursor:pointer" data-id="${
        escapeHtml(c.id)
      }">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <strong>${escapeHtml(c.name)}</strong>
              <span style="color:var(--text-muted);font-size:0.8rem;margin-left:0.5rem">${
        c.active ? "Active" : "Inactive"
      }</span>
            </div>
            <span style="color:var(--text-muted);font-size:0.75rem">${
        escapeHtml(c.id.substring(0, 8))
      }...</span>
          </div>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.25rem">
            Auth: ${escapeHtml((c.channelAuthId ?? "").substring(0, 12))}...
          </div>
        </div>
      `).join("");
    }

    // Click council to view details
    listEl.querySelectorAll("[data-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = (el as HTMLElement).dataset.id!;
        renderCouncilDetail(target, id);
      });
    });

    // Add council button
    target.querySelector("#add-council-btn")?.addEventListener("click", () => {
      renderCouncilForm(target);
    });
  } catch (err) {
    target.innerHTML = `<p class="error-text">${
      escapeHtml(friendlyError(err))
    }</p>`;
  }
}

function renderCouncilForm(
  target: Element,
  existing?: AdminCouncil,
): void {
  const isEdit = !!existing;
  const formEl = target.querySelector("#council-form") as HTMLDivElement;
  formEl.hidden = false;

  if (isEdit) {
    formEl.innerHTML = `
      <div class="stat-card" style="margin-top:1rem">
        <h3 style="margin-top:0">Edit Council</h3>
        <div class="form-group">
          <label>Name</label>
          <input type="text" id="cf-name" value="${
      escapeHtml(existing?.name ?? "")
    }" />
        </div>
        <div class="form-group">
          <label>Jurisdictions <span style="color:var(--text-muted);font-weight:normal">(comma-separated ISO codes)</span></label>
          <input type="text" id="cf-jurisdictions" value="${
      escapeHtml(
        Array.isArray(existing?.jurisdictions)
          ? existing.jurisdictions.join(", ")
          : "",
      )
    }" />
        </div>
        <div style="display:flex;gap:0.5rem">
          <button id="cf-save" class="btn-primary" style="padding:0.4rem 1.5rem">Save</button>
          <button id="cf-cancel" class="btn-secondary" style="padding:0.4rem 1rem">Cancel</button>
        </div>
        <p id="cf-error" class="error-text" hidden></p>
      </div>
    `;

    formEl.querySelector("#cf-cancel")?.addEventListener("click", () => {
      formEl.hidden = true;
    });
    formEl.querySelector("#cf-save")?.addEventListener("click", async () => {
      const errorEl = formEl.querySelector("#cf-error") as HTMLParagraphElement;
      errorEl.hidden = true;
      try {
        await adminUpdateCouncil(existing!.id, {
          name: (formEl.querySelector("#cf-name") as HTMLInputElement).value
            .trim(),
          jurisdictions:
            (formEl.querySelector("#cf-jurisdictions") as HTMLInputElement)
              .value
              .split(",").map((s) => s.trim()).filter(Boolean),
        });
        await renderCouncilList(target);
      } catch (err) {
        errorEl.textContent = friendlyError(err);
        errorEl.hidden = false;
      }
    });
    return;
  }

  // Create mode — fetch from council-platform URL
  formEl.innerHTML = `
    <div class="stat-card" style="margin-top:1rem">
      <h3 style="margin-top:0">Add Council</h3>
      <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:1rem">
        Enter the council-platform URL to import its configuration.
      </p>
      <div class="form-group">
        <label>Council Platform URL</label>
        <input type="text" id="cf-url" placeholder="http://localhost:3015" />
      </div>
      <div style="display:flex;gap:0.5rem;margin-bottom:1rem">
        <button id="cf-fetch" class="btn-primary" style="padding:0.4rem 1.5rem">Fetch</button>
        <button id="cf-cancel" class="btn-secondary" style="padding:0.4rem 1rem">Cancel</button>
      </div>
      <div id="cf-preview" hidden></div>
      <p id="cf-error" class="error-text" hidden></p>
    </div>
  `;

  formEl.querySelector("#cf-cancel")?.addEventListener("click", () => {
    formEl.hidden = true;
  });

  formEl.querySelector("#cf-fetch")?.addEventListener("click", async () => {
    const errorEl = formEl.querySelector("#cf-error") as HTMLParagraphElement;
    const previewEl = formEl.querySelector("#cf-preview") as HTMLDivElement;
    errorEl.hidden = true;
    previewEl.hidden = true;

    const url = (formEl.querySelector("#cf-url") as HTMLInputElement).value
      .trim().replace(/\/$/, "");

    if (!url) {
      errorEl.textContent = "URL is required";
      errorEl.hidden = false;
      return;
    }

    const fetchBtn = formEl.querySelector("#cf-fetch") as HTMLButtonElement;
    fetchBtn.disabled = true;
    fetchBtn.textContent = "Fetching...";

    try {
      const data = await adminDiscoverCouncil(url);
      if (!data?.council) {
        throw new Error("Invalid response from council-platform");
      }

      const name = data.council.name ?? "Unnamed Council";
      const channelAuthId = data.council.channelAuthId;
      const jurisdictions = (data.jurisdictions ?? []).map(
        (j: { countryCode: string }) => j.countryCode,
      );
      const channels = (data.channels ?? []).map(
        (ch: {
          assetCode: string;
          assetContractId: string;
          channelContractId: string;
        }) => ({
          assetCode: ch.assetCode,
          assetContractId: ch.assetContractId,
          privacyChannelId: ch.channelContractId,
        }),
      );
      const providers = (data.providers ?? []).map(
        (p: { publicKey: string; label?: string; providerUrl?: string }) => ({
          publicKey: p.publicKey,
          label: p.label,
          providerUrl: p.providerUrl,
        }),
      );

      previewEl.hidden = false;
      previewEl.innerHTML = `
        <div style="font-size:0.85rem;margin-bottom:1rem">
          <div><strong>Name:</strong> ${escapeHtml(name)}</div>
          <div><strong>Auth:</strong> ${escapeHtml(channelAuthId)}</div>
          <div><strong>Jurisdictions:</strong> ${
        jurisdictions.length > 0
          ? escapeHtml(jurisdictions.join(", "))
          : "<em>none</em>"
      }</div>
          <div><strong>Channels:</strong> ${
        channels.length > 0
          ? channels.map(
            (ch: { assetCode: string }) => escapeHtml(ch.assetCode),
          ).join(", ")
          : "<em>none</em>"
      }</div>
          <div><strong>Providers:</strong> ${
        providers.length > 0
          ? providers.map(
            (p: { label?: string; publicKey: string }) =>
              escapeHtml(p.label || p.publicKey.substring(0, 8)),
          ).join(", ")
          : "<em>none</em>"
      }</div>
        </div>
        <button id="cf-confirm" class="btn-primary" style="padding:0.4rem 1.5rem">Add Council</button>
      `;

      previewEl.querySelector("#cf-confirm")?.addEventListener(
        "click",
        async () => {
          const confirmBtn = previewEl.querySelector(
            "#cf-confirm",
          ) as HTMLButtonElement;
          confirmBtn.disabled = true;
          confirmBtn.textContent = "Creating...";
          try {
            await adminCreateCouncil({
              name,
              channelAuthId,
              jurisdictions,
              channels,
              providers,
              active: true,
            });
            await renderCouncilList(target);
          } catch (err) {
            errorEl.textContent = friendlyError(err);
            errorEl.hidden = false;
            confirmBtn.disabled = false;
            confirmBtn.textContent = "Add Council";
          }
        },
      );
    } catch (err) {
      errorEl.textContent = friendlyError(err);
      errorEl.hidden = false;
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.textContent = "Fetch";
    }
  });
}

async function renderCouncilDetail(
  target: Element,
  councilId: string,
): Promise<void> {
  try {
    const council = await adminGetCouncil(councilId);
    const channels = council.channels ?? [];
    const pps = council.pps ?? [];
    const jurisdictions = council.jurisdictions ?? [];

    target.innerHTML = `
      <div style="margin-bottom:1rem">
        <button id="back-btn" class="btn-secondary" style="padding:0.3rem 0.75rem;font-size:0.85rem">&larr; Back</button>
      </div>

      <div class="stat-card" style="margin-bottom:1rem">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h2 style="margin:0">${escapeHtml(council.name)}</h2>
          <div style="display:flex;gap:0.5rem">
            <button id="edit-council-btn" class="btn-secondary" style="padding:0.3rem 0.75rem;font-size:0.8rem">Edit</button>
            <button id="delete-council-btn" style="padding:0.3rem 0.75rem;font-size:0.8rem;background:var(--error);color:white;border:none;border-radius:4px;cursor:pointer">Delete</button>
          </div>
        </div>
        <div style="font-size:0.85rem;color:var(--text-muted);margin-top:0.5rem">
          <div>ID: ${escapeHtml(council.id)}</div>
          <div>Auth: ${escapeHtml(council.channelAuthId)}</div>
          <div>Network: ${escapeHtml(council.networkPassphrase)}</div>
          <div>Jurisdictions: ${
      jurisdictions.length > 0
        ? escapeHtml(jurisdictions.join(", "))
        : "<em>none</em>"
    }</div>
          <div>Status: ${council.active ? "Active" : "Inactive"}</div>
        </div>
      </div>

      <!-- Channels -->
      <div style="margin-bottom:1.5rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
          <h3 style="margin:0">Channels</h3>
          <button id="add-channel-btn" class="btn-primary" style="padding:0.3rem 0.75rem;font-size:0.8rem">+ Add</button>
        </div>
        <div id="channel-list">
          ${
      channels.length === 0
        ? '<p style="color:var(--text-muted);font-size:0.85rem">No channels. Add one to enable payments for an asset.</p>'
        : channels.map((ch: Record<string, string>) => `
            <div class="stat-card" style="margin-bottom:0.5rem;padding:0.75rem">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <strong>${escapeHtml(ch.assetCode)}</strong>
                <button class="delete-channel" data-id="${
          escapeHtml(ch.id)
        }" style="padding:0.2rem 0.5rem;font-size:0.75rem;background:var(--error);color:white;border:none;border-radius:4px;cursor:pointer">Delete</button>
              </div>
              <div style="font-size:0.8rem;color:var(--text-muted)">
                SAC: ${escapeHtml(ch.assetContractId)}<br/>
                Channel: ${escapeHtml(ch.privacyChannelId)}
              </div>
            </div>
          `).join("")
    }
        </div>
        <div id="channel-form" hidden></div>
      </div>

      <!-- PPs -->
      <div style="margin-bottom:1.5rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
          <h3 style="margin:0">Privacy Providers</h3>
          <button id="add-pp-btn" class="btn-primary" style="padding:0.3rem 0.75rem;font-size:0.8rem">+ Add</button>
        </div>
        <div id="pp-list">
          ${
      pps.length === 0
        ? '<p style="color:var(--text-muted);font-size:0.85rem">No providers. Add one to route payments.</p>'
        : pps.map((pp: Record<string, string | boolean>) => `
            <div class="stat-card" style="margin-bottom:0.5rem;padding:0.75rem">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <strong>${escapeHtml(String(pp.name))}</strong>
                <div style="display:flex;gap:0.25rem">
                  <button class="toggle-pp" data-id="${
          escapeHtml(String(pp.id))
        }" data-active="${pp.active}" style="padding:0.2rem 0.5rem;font-size:0.75rem;border:1px solid var(--border);border-radius:4px;cursor:pointer;background:transparent;color:var(--text)">${
          pp.active ? "Deactivate" : "Activate"
        }</button>
                  <button class="delete-pp" data-id="${
          escapeHtml(String(pp.id))
        }" style="padding:0.2rem 0.5rem;font-size:0.75rem;background:var(--error);color:white;border:none;border-radius:4px;cursor:pointer">Delete</button>
                </div>
              </div>
              <div style="font-size:0.8rem;color:var(--text-muted)">
                URL: ${escapeHtml(String(pp.url))}<br/>
                Key: ${escapeHtml(String(pp.publicKey))}
                ${
          pp.active ? "" : ' <span style="color:var(--error)">(inactive)</span>'
        }
              </div>
            </div>
          `).join("")
    }
        </div>
        <div id="pp-form" hidden></div>
      </div>
    `;

    // Back
    target.querySelector("#back-btn")?.addEventListener(
      "click",
      () => renderCouncilList(target),
    );

    // Edit council
    target.querySelector("#edit-council-btn")?.addEventListener("click", () => {
      const formTarget = document.createElement("div");
      formTarget.innerHTML = '<div id="council-form"></div>';
      target.appendChild(formTarget);
      renderCouncilForm(formTarget, council);
    });

    // Delete council
    target.querySelector("#delete-council-btn")?.addEventListener(
      "click",
      async () => {
        if (
          !confirm(`Delete council "${council.name}"? This cannot be undone.`)
        ) return;
        await adminDeleteCouncil(councilId);
        await renderCouncilList(target);
      },
    );

    // Delete channel
    target.querySelectorAll(".delete-channel").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const chId = (btn as HTMLElement).dataset.id!;
        await adminDeleteChannel(councilId, chId);
        await renderCouncilDetail(target, councilId);
      });
    });

    // Add channel
    target.querySelector("#add-channel-btn")?.addEventListener("click", () => {
      const formEl = target.querySelector("#channel-form") as HTMLDivElement;
      formEl.hidden = false;
      formEl.innerHTML = `
        <div class="stat-card" style="margin-top:0.5rem;padding:0.75rem">
          <div class="form-group" style="margin-bottom:0.5rem">
            <label style="font-size:0.85rem">Asset Code</label>
            <input type="text" id="ch-asset" placeholder="XLM" style="font-size:0.85rem" />
          </div>
          <div class="form-group" style="margin-bottom:0.5rem">
            <label style="font-size:0.85rem">Asset Contract ID <span style="color:var(--text-muted);font-weight:normal">(SAC address)</span></label>
            <input type="text" id="ch-sac" placeholder="CABC..." style="font-size:0.85rem" />
          </div>
          <div class="form-group" style="margin-bottom:0.5rem">
            <label style="font-size:0.85rem">Privacy Channel ID</label>
            <input type="text" id="ch-channel" placeholder="CABC..." style="font-size:0.85rem" />
          </div>
          <div style="display:flex;gap:0.5rem">
            <button id="ch-save" class="btn-primary" style="padding:0.3rem 1rem;font-size:0.85rem">Add</button>
            <button id="ch-cancel" class="btn-secondary" style="padding:0.3rem 0.75rem;font-size:0.85rem">Cancel</button>
          </div>
          <p id="ch-error" class="error-text" hidden></p>
        </div>
      `;
      formEl.querySelector("#ch-cancel")?.addEventListener("click", () => {
        formEl.hidden = true;
      });
      formEl.querySelector("#ch-save")?.addEventListener("click", async () => {
        const errEl = formEl.querySelector("#ch-error") as HTMLParagraphElement;
        errEl.hidden = true;
        try {
          await adminCreateChannel(councilId, {
            assetCode: (formEl.querySelector("#ch-asset") as HTMLInputElement)
              .value.trim(),
            assetContractId:
              (formEl.querySelector("#ch-sac") as HTMLInputElement).value
                .trim(),
            privacyChannelId:
              (formEl.querySelector("#ch-channel") as HTMLInputElement).value
                .trim(),
          });
          await renderCouncilDetail(target, councilId);
        } catch (err) {
          errEl.textContent = friendlyError(err);
          errEl.hidden = false;
        }
      });
    });

    // Toggle PP active
    target.querySelectorAll(".toggle-pp").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ppId = (btn as HTMLElement).dataset.id!;
        const isActive = (btn as HTMLElement).dataset.active === "true";
        await adminUpdatePp(councilId, ppId, { active: !isActive });
        await renderCouncilDetail(target, councilId);
      });
    });

    // Delete PP
    target.querySelectorAll(".delete-pp").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ppId = (btn as HTMLElement).dataset.id!;
        await adminDeletePp(councilId, ppId);
        await renderCouncilDetail(target, councilId);
      });
    });

    // Add PP
    target.querySelector("#add-pp-btn")?.addEventListener("click", () => {
      const formEl = target.querySelector("#pp-form") as HTMLDivElement;
      formEl.hidden = false;
      formEl.innerHTML = `
        <div class="stat-card" style="margin-top:0.5rem;padding:0.75rem">
          <div class="form-group" style="margin-bottom:0.5rem">
            <label style="font-size:0.85rem">Name</label>
            <input type="text" id="pp-name" placeholder="e.g. Acme Provider" style="font-size:0.85rem" />
          </div>
          <div class="form-group" style="margin-bottom:0.5rem">
            <label style="font-size:0.85rem">URL <span style="color:var(--text-muted);font-weight:normal">(provider-platform base URL)</span></label>
            <input type="text" id="pp-url" placeholder="https://provider.example.com" style="font-size:0.85rem" />
          </div>
          <div class="form-group" style="margin-bottom:0.5rem">
            <label style="font-size:0.85rem">Public Key <span style="color:var(--text-muted);font-weight:normal">(Stellar G-address)</span></label>
            <input type="text" id="pp-pk" placeholder="GABC..." style="font-size:0.85rem" />
          </div>
          <div style="display:flex;gap:0.5rem">
            <button id="pp-save" class="btn-primary" style="padding:0.3rem 1rem;font-size:0.85rem">Add</button>
            <button id="pp-cancel" class="btn-secondary" style="padding:0.3rem 0.75rem;font-size:0.85rem">Cancel</button>
          </div>
          <p id="pp-error" class="error-text" hidden></p>
        </div>
      `;
      formEl.querySelector("#pp-cancel")?.addEventListener("click", () => {
        formEl.hidden = true;
      });
      formEl.querySelector("#pp-save")?.addEventListener("click", async () => {
        const errEl = formEl.querySelector("#pp-error") as HTMLParagraphElement;
        errEl.hidden = true;
        try {
          await adminCreatePp(councilId, {
            name: (formEl.querySelector("#pp-name") as HTMLInputElement).value
              .trim(),
            url: (formEl.querySelector("#pp-url") as HTMLInputElement).value
              .trim(),
            publicKey: (formEl.querySelector("#pp-pk") as HTMLInputElement)
              .value.trim(),
          });
          await renderCouncilDetail(target, councilId);
        } catch (err) {
          errEl.textContent = friendlyError(err);
          errEl.hidden = false;
        }
      });
    });
  } catch (err) {
    target.innerHTML = `<p class="error-text">${
      escapeHtml(friendlyError(err))
    }</p>`;
  }
}
