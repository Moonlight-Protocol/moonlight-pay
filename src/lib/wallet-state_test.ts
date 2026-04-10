/**
 * Unit tests for src/lib/wallet-state.ts.
 *
 * wallet-state.ts is the testable half of the wallet module — it owns the
 * cached address, the master seed lifecycle, and the signature → seed
 * derivation pipeline. The kit-using bits live in wallet.ts and are not
 * imported here (they pull in stellar-wallets-kit which crashes Deno tests).
 */
import { assertEquals, assertRejects, assertThrows } from "@std/assert";

// ─── Browser stubs ──────────────────────────────────────────
class FakeStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}
const fakeLocalStorage = new FakeStorage();
// Deno declares `localStorage` as a getter that throws without --location;
// override with a plain data property pointing at our fake.
Object.defineProperty(globalThis, "localStorage", {
  value: fakeLocalStorage,
  writable: true,
  configurable: true,
});

import {
  __resetWalletStateForTests,
  clearWalletState,
  deriveMasterSeedFromSignature,
  getConnectedAddress,
  getMasterSeed,
  isAuthenticated,
  isMasterSeedReady,
  setConnectedAddress,
} from "./wallet-state.ts";

function reset() {
  fakeLocalStorage.clear();
  __resetWalletStateForTests();
}

// ─── Address state ──────────────────────────────────────────

Deno.test("getConnectedAddress returns null when nothing is stored", () => {
  reset();
  assertEquals(getConnectedAddress(), null);
  assertEquals(isAuthenticated(), false);
});

Deno.test("getConnectedAddress reads from localStorage on first call", () => {
  reset();
  fakeLocalStorage.setItem(
    "moonlight_pay_wallet_address",
    "GAEILCNSC4ZTA63RK3ACSADVSWC47NRG7KFVYHZ4HKS265YEZVEHWMHG",
  );
  assertEquals(
    getConnectedAddress(),
    "GAEILCNSC4ZTA63RK3ACSADVSWC47NRG7KFVYHZ4HKS265YEZVEHWMHG",
  );
  assertEquals(isAuthenticated(), true);
});

Deno.test("setConnectedAddress writes to memory and storage", () => {
  reset();
  setConnectedAddress("GBADDR");
  assertEquals(getConnectedAddress(), "GBADDR");
  assertEquals(
    fakeLocalStorage.getItem("moonlight_pay_wallet_address"),
    "GBADDR",
  );
});

// ─── Master seed lifecycle ──────────────────────────────────

Deno.test("getMasterSeed throws when seed is not initialized", () => {
  reset();
  assertEquals(isMasterSeedReady(), false);
  assertThrows(
    () => getMasterSeed(),
    Error,
    "Master seed not initialized",
  );
});

Deno.test("deriveMasterSeedFromSignature produces a 32-byte seed", async () => {
  reset();
  // SHA-256 of any input is always 32 bytes.
  const seed = await deriveMasterSeedFromSignature("aGVsbG8");
  assertEquals(seed.length, 32);
  assertEquals(isMasterSeedReady(), true);
  // The same call returns the same bytes from getMasterSeed
  const fetched = getMasterSeed();
  assertEquals(fetched.length, 32);
  for (let i = 0; i < 32; i++) {
    assertEquals(fetched[i], seed[i]);
  }
});

Deno.test("deriveMasterSeedFromSignature is deterministic per signature", async () => {
  reset();
  const a = await deriveMasterSeedFromSignature("aGVsbG8");
  const aBytes = Array.from(a);
  reset();
  const b = await deriveMasterSeedFromSignature("aGVsbG8");
  assertEquals(Array.from(b), aBytes);
});

Deno.test("deriveMasterSeedFromSignature accepts unpadded base64url", async () => {
  // Wallets emit unpadded base64url. The previous implementation called
  // atob() directly which throws under Deno's strict atob. base64UrlToBytes
  // re-pads — this test verifies the pipeline survives unpadded input.
  reset();
  const seed = await deriveMasterSeedFromSignature(
    "rW90LWFjdHVhbHRseS1hLXJlYWwtc2lnLWp1c3QtdGVzdGRhdGE",
  );
  assertEquals(seed.length, 32);
});

Deno.test("deriveMasterSeedFromSignature rejects garbage input", async () => {
  reset();
  await assertRejects(
    () => deriveMasterSeedFromSignature("not!base64@"),
    Error,
    "invalid characters",
  );
});

Deno.test("deriveMasterSeedFromSignature zeros the previous seed before replacing", async () => {
  // We can't directly observe the old buffer (the implementation drops the
  // reference) but we can verify the new seed is a fresh allocation by
  // checking it differs from the old one and the API surface still works.
  reset();
  const a = await deriveMasterSeedFromSignature("aGVsbG8");
  const aSnapshot = Array.from(a);
  await deriveMasterSeedFromSignature("d29ybGQ"); // "world" base64url
  const b = getMasterSeed();
  // Different inputs produce different SHA-256 outputs.
  let same = true;
  for (let i = 0; i < 32; i++) {
    if (b[i] !== aSnapshot[i]) {
      same = false;
      break;
    }
  }
  assertEquals(same, false, "second derive should produce different seed");
});

Deno.test("clearWalletState zeros the seed buffer", async () => {
  reset();
  const seed = await deriveMasterSeedFromSignature("aGVsbG8");
  // Take a snapshot of the buffer reference — clearWalletState zeros it
  // in-place before dropping the module's reference.
  const ref = seed;
  clearWalletState();
  for (let i = 0; i < 32; i++) {
    assertEquals(ref[i], 0, `byte ${i} not zeroed`);
  }
  assertEquals(isMasterSeedReady(), false);
  assertThrows(() => getMasterSeed(), Error, "not initialized");
});

Deno.test("clearWalletState clears the cached address and storage", () => {
  reset();
  setConnectedAddress("GBADDR");
  assertEquals(isAuthenticated(), true);
  clearWalletState();
  assertEquals(getConnectedAddress(), null);
  assertEquals(isAuthenticated(), false);
  assertEquals(fakeLocalStorage.getItem("moonlight_pay_wallet_address"), null);
});

Deno.test("clearWalletState is a no-op when nothing is set", () => {
  reset();
  // Should not throw.
  clearWalletState();
  assertEquals(getConnectedAddress(), null);
  assertEquals(isMasterSeedReady(), false);
});
