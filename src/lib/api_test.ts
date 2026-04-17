/**
 * Unit tests for src/lib/api.ts.
 *
 * api.ts depends on `localStorage`, `fetch`, and the wallet module's
 * `getConnectedAddress` / `signMessage`. We stub the browser globals before
 * importing the module so it can run under Deno without crashing.
 *
 * Each test uses __resetApiForTests() to clear the cached token between
 * cases — that hook exists precisely to enable isolated tests.
 */
import { assertEquals, assertRejects } from "@std/assert";

// ─── Browser stubs ──────────────────────────────────────────
// Set up `window`, `localStorage`, and a placeholder fetch BEFORE importing
// the module under test. The module reads these lazily but we still need
// the symbols to exist so the import doesn't crash on the type-check pass.

// deno-lint-ignore no-explicit-any
const g = globalThis as any;
g.window = g.window ?? {};
g.window.__PAY_CONFIG__ = {
  payPlatformUrl: "https://pay-test.example.com",
  environment: "test",
  stellarNetwork: "testnet",
};

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
// Deno declares `localStorage` as a getter on globalThis (which throws without
// --location). Replace it with a plain data property pointing at our fake so
// the lazy `globalThis.localStorage` lookup in api.ts picks up the mock.
Object.defineProperty(globalThis, "localStorage", {
  value: fakeLocalStorage,
  writable: true,
  configurable: true,
});

// Module-level fetch stub — overwritten per test.
let lastRequest: { url: string; init?: RequestInit } | null = null;
let nextResponse: Response = new Response(null, { status: 200 });
g.fetch = (url: string, init?: RequestInit) => {
  lastRequest = { url, init };
  return Promise.resolve(nextResponse);
};

import {
  __resetApiForTests,
  clearPlatformAuth,
  createAccount,
  getMe,
  isPlatformAuthed,
  type PayAccount,
  SessionExpiredError,
  updateMe,
} from "./api.ts";

// We can't import wallet.ts (pulls in the wallets-kit DOM components),
// so we stub the wallet module's exports via a manual override of the
// underlying functions used by api.ts. The cleanest way is to test
// through the public surface and skip authenticate() (which depends on
// signMessage). For authenticate() we'd need a deeper rework — out of
// scope for these unit tests; the integration test in pay-platform
// already exercises that round-trip.

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function resetState() {
  fakeLocalStorage.clear();
  __resetApiForTests();
  lastRequest = null;
}

const SAMPLE_ACCOUNT: PayAccount = {
  walletPublicKey: "GAEILCNSC4ZTA63RK3ACSADVSWC47NRG7KFVYHZ4HKS265YEZVEHWMHG",
  email: "alice@example.com",
  jurisdictionCountryCode: "US",
  displayName: "Alice",
  opexPublicKey: null,
  feePct: null,
  lastSeenAt: "2026-04-09T12:00:00Z",
  createdAt: "2026-04-09T12:00:00Z",
  updatedAt: "2026-04-09T12:00:00Z",
};

Deno.test("isPlatformAuthed returns false when no token persisted", () => {
  resetState();
  assertEquals(isPlatformAuthed(), false);
});

Deno.test("isPlatformAuthed returns true when a token is in localStorage", () => {
  resetState();
  fakeLocalStorage.setItem("moonlight_pay_jwt", "stored-jwt");
  assertEquals(isPlatformAuthed(), true);
});

Deno.test("clearPlatformAuth removes the token from cache and storage", () => {
  resetState();
  fakeLocalStorage.setItem("moonlight_pay_jwt", "stored-jwt");
  // Force the module to load the token into its cache
  assertEquals(isPlatformAuthed(), true);
  clearPlatformAuth();
  assertEquals(isPlatformAuthed(), false);
  assertEquals(fakeLocalStorage.getItem("moonlight_pay_jwt"), null);
});

Deno.test("getMe sends Authorization header and returns the account", async () => {
  resetState();
  fakeLocalStorage.setItem("moonlight_pay_jwt", "test-token");
  nextResponse = jsonResponse(200, { data: SAMPLE_ACCOUNT });

  const account = await getMe();
  assertEquals(account, SAMPLE_ACCOUNT);
  assertEquals(
    lastRequest?.url,
    "https://pay-test.example.com/api/v1/account/me",
  );
  const headers = lastRequest!.init!.headers as Record<string, string>;
  assertEquals(headers["Authorization"], "Bearer test-token");
});

Deno.test("getMe returns null on 404 (no account yet)", async () => {
  resetState();
  fakeLocalStorage.setItem("moonlight_pay_jwt", "test-token");
  nextResponse = jsonResponse(404, { message: "Account not found" });

  const account = await getMe();
  assertEquals(account, null);
});

Deno.test("getMe throws SessionExpiredError on 401 and clears the local token", async () => {
  // The 401 path is the contract between api.ts and the view layer:
  // the API client clears local state and signals via a typed error,
  // and the view (not the API client) is responsible for navigating.
  resetState();
  fakeLocalStorage.setItem("moonlight_pay_jwt", "stale-token");
  nextResponse = jsonResponse(401, { message: "Unauthorized" });

  await assertRejects(() => getMe(), SessionExpiredError);
  assertEquals(isPlatformAuthed(), false);
  assertEquals(fakeLocalStorage.getItem("moonlight_pay_jwt"), null);
});

Deno.test("createAccount POSTs the body and unwraps the data envelope", async () => {
  resetState();
  fakeLocalStorage.setItem("moonlight_pay_jwt", "test-token");
  nextResponse = jsonResponse(201, { data: SAMPLE_ACCOUNT });

  const result = await createAccount({
    email: "alice@example.com",
    jurisdictionCountryCode: "US",
    displayName: "Alice",
  });
  assertEquals(result, SAMPLE_ACCOUNT);
  assertEquals(
    lastRequest?.url,
    "https://pay-test.example.com/api/v1/account",
  );
  assertEquals(lastRequest?.init?.method, "POST");
  const sentBody = JSON.parse(lastRequest!.init!.body as string);
  assertEquals(sentBody.email, "alice@example.com");
  assertEquals(sentBody.jurisdictionCountryCode, "US");
  assertEquals(sentBody.displayName, "Alice");
});

Deno.test("createAccount surfaces backend validation messages", async () => {
  resetState();
  fakeLocalStorage.setItem("moonlight_pay_jwt", "test-token");
  nextResponse = jsonResponse(400, {
    message: "email is not a valid format",
  });

  await assertRejects(
    () =>
      createAccount({
        email: "bad",
        jurisdictionCountryCode: "US",
      }),
    Error,
    "email is not a valid format",
  );
});

Deno.test("updateMe sends PATCH and returns the updated account", async () => {
  resetState();
  fakeLocalStorage.setItem("moonlight_pay_jwt", "test-token");
  nextResponse = jsonResponse(200, {
    data: { ...SAMPLE_ACCOUNT, jurisdictionCountryCode: "GB" },
  });

  const updated = await updateMe({ jurisdictionCountryCode: "GB" });
  assertEquals(updated.jurisdictionCountryCode, "GB");
  assertEquals(lastRequest?.init?.method, "PATCH");
});

Deno.test("payFetch (via getMe) throws if there's no auth token", async () => {
  resetState();
  // No token in storage
  await assertRejects(() => getMe(), Error, "Not authenticated");
});
