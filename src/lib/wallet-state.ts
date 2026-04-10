/**
 * Wallet auth state for Moonlight Pay — split out from wallet.ts so it has
 * NO compile-time dependency on the stellar-wallets-kit (which loads broken
 * transitive packages at module-evaluation time and crashes Deno tests).
 *
 * This file owns:
 *   - the cached connected address (lazy localStorage)
 *   - the in-memory master seed (never persisted)
 *   - the seed-derivation pipeline: signature → SHA-256 → 32 bytes
 *   - cross-tab seed sharing via BroadcastChannel
 *
 * Security model:
 * - Master seed lives in module-scope memory only. It is NEVER persisted
 *   anywhere (no localStorage, no sessionStorage). Page refresh requires
 *   re-derivation. This is the right tradeoff: the seed is the user's
 *   identity-derivation root, and putting it in JS-readable storage would
 *   expose it to any XSS on the same origin.
 * - clearWalletState() zeros the underlying buffer before dropping the
 *   reference, so a heap snapshot taken after logout doesn't recover it.
 * - Cross-tab share uses BroadcastChannel — same-origin tabs can request
 *   the seed from each other in memory, never via storage. The channel is
 *   torn down on logout in every tab.
 *
 * Storage reads are lazy — both for testability (mocked localStorage on
 * globalThis) and for safe import in non-browser contexts.
 */
import { base64UrlToBytes } from "./encoding.ts";

const ADDRESS_KEY = "moonlight_pay_wallet_address";
const SEED_CHANNEL = "moonlight_pay_seed_v1";

let cachedAddress: string | null | undefined = undefined;
let masterSeed: Uint8Array | null = null;
let channel: BroadcastChannel | null = null;
let channelInstalled = false;
// Reference held so the test reset hook can removeEventListener; without
// it, repeated install/reset cycles would attach duplicate listeners.
let addressStorageListener: ((event: StorageEvent) => void) | null = null;

/** Resolve `localStorage` lazily via globalThis. */
function getLocalStorage(): Storage | undefined {
  // deno-lint-ignore no-explicit-any
  return (globalThis as any).localStorage;
}

/**
 * Cross-tab address sync: when another tab logs out (or in) and changes
 * `ADDRESS_KEY` in localStorage, this tab's cached copy is invalidated so
 * the next getConnectedAddress() re-reads from storage. Without this,
 * `cachedAddress` would hold the old value forever and the nav would
 * briefly show a stale address before the page() guard redirects.
 */
function ensureAddressStorageListener(): void {
  if (addressStorageListener) return;
  // deno-lint-ignore no-explicit-any
  const w = (globalThis as any).window;
  if (!w || typeof w.addEventListener !== "function") return;
  addressStorageListener = (event: StorageEvent) => {
    if (event.key === null || event.key === ADDRESS_KEY) {
      cachedAddress = undefined;
    }
  };
  w.addEventListener("storage", addressStorageListener);
}

/**
 * Set up (idempotently) a same-origin BroadcastChannel for the master seed.
 * Other tabs that already hold the seed reply with `seed`; tabs that just
 * received `clear` zero their copy. Channel is only created in browser
 * contexts (ignored in tests / Deno without --location).
 */
function ensureChannel(): void {
  if (channelInstalled) return;
  channelInstalled = true;
  // deno-lint-ignore no-explicit-any
  const BC: typeof BroadcastChannel | undefined = (globalThis as any)
    .BroadcastChannel;
  if (!BC) return;
  channel = new BC(SEED_CHANNEL);
  channel.onmessage = (event: MessageEvent) => {
    const msg = event.data as { type?: string; seed?: number[] } | undefined;
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "request" && masterSeed) {
      // Another tab is asking for the seed.
      channel?.postMessage({ type: "seed", seed: Array.from(masterSeed) });
      return;
    }
    if (msg.type === "seed" && !masterSeed && Array.isArray(msg.seed)) {
      // Adopt a seed received from another tab.
      const adopted = new Uint8Array(msg.seed);
      masterSeed = adopted;
      return;
    }
    if (msg.type === "clear") {
      if (masterSeed) {
        masterSeed.fill(0);
        masterSeed = null;
      }
    }
  };
}

/**
 * Ask other open tabs whether any of them already have the master seed.
 * If a tab replies, the onmessage handler above adopts the seed in this
 * tab's memory. The promise resolves after a short window even if no
 * other tab answers — the caller (initMasterSeed) then signs fresh.
 */
export function requestSeedFromOtherTabs(timeoutMs = 250): Promise<boolean> {
  ensureChannel();
  if (!channel) return Promise.resolve(false);
  if (masterSeed) return Promise.resolve(true);
  return new Promise((resolve) => {
    channel?.postMessage({ type: "request" });
    const start = Date.now();
    const tick = () => {
      if (masterSeed) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(tick, 25);
    };
    setTimeout(tick, 25);
  });
}

export function getConnectedAddress(): string | null {
  ensureAddressStorageListener();
  if (cachedAddress === undefined) {
    const storage = getLocalStorage();
    cachedAddress = storage ? storage.getItem(ADDRESS_KEY) : null;
  }
  return cachedAddress;
}

export function setConnectedAddress(address: string): void {
  cachedAddress = address;
  const storage = getLocalStorage();
  if (storage) storage.setItem(ADDRESS_KEY, address);
}

export function isAuthenticated(): boolean {
  return !!getConnectedAddress();
}

export function isMasterSeedReady(): boolean {
  return masterSeed !== null;
}

export function getMasterSeed(): Uint8Array {
  if (!masterSeed) {
    throw new Error("Master seed not initialized. Sign in first.");
  }
  return masterSeed;
}

/**
 * Derive the master seed from a base64url-encoded wallet signature.
 *
 * Pipeline: signature (base64url) → bytes → SHA-256 → 32-byte seed.
 * Wallets emit base64url without padding; base64UrlToBytes handles the
 * re-padding and alphabet translation that Deno's strict atob refuses.
 *
 * Exposed as a standalone function (rather than only via initMasterSeed)
 * so unit tests can drive it without instantiating a wallet kit.
 */
export async function deriveMasterSeedFromSignature(
  signature: string,
): Promise<Uint8Array> {
  const sigBytes = base64UrlToBytes(signature);
  // Copy into a fresh ArrayBuffer-backed Uint8Array so the type matches
  // BufferSource exactly (Deno's strict TS rejects ArrayBufferLike here).
  const buf = new ArrayBuffer(sigBytes.length);
  new Uint8Array(buf).set(sigBytes);
  const seed = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  // Zero any pre-existing seed before replacing — see clearWalletState().
  if (masterSeed) masterSeed.fill(0);
  masterSeed = seed;
  return seed;
}

/**
 * Logs the user out: zeros the master seed buffer, clears the in-memory
 * cache and any persisted address. The seed is wiped before its reference
 * is dropped so the bytes don't linger in heap. A `clear` message is also
 * broadcast so any other open tabs zero their copies of the seed.
 */
export function clearWalletState(): void {
  if (masterSeed) {
    masterSeed.fill(0);
    masterSeed = null;
  }
  cachedAddress = null;
  const storage = getLocalStorage();
  if (storage) storage.removeItem(ADDRESS_KEY);
  // Only broadcast if a channel was already opened (i.e. another tab
  // requested the seed earlier). Don't create one just to send a clear —
  // tests that never touched cross-tab share would leak the resource.
  channel?.postMessage({ type: "clear" });
}

/** Test hook — clears in-memory caches without touching storage. */
export function __resetWalletStateForTests(): void {
  if (masterSeed) {
    masterSeed.fill(0);
    masterSeed = null;
  }
  cachedAddress = undefined;
  if (channel) {
    channel.close();
    channel = null;
  }
  channelInstalled = false;
  if (addressStorageListener) {
    // deno-lint-ignore no-explicit-any
    const w = (globalThis as any).window;
    if (w && typeof w.removeEventListener === "function") {
      w.removeEventListener("storage", addressStorageListener);
    }
    addressStorageListener = null;
  }
}
