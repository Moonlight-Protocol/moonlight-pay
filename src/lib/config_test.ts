/**
 * Unit tests for src/lib/config.ts.
 *
 * config.ts reads from window.__PAY_CONFIG__. We stub a fake window in the
 * Deno test environment and reset the memoized config between tests so each
 * one sees the value it set up.
 */
import { assertEquals, assertThrows } from "@std/assert";

// Stub `window` so the module can be imported in Deno without crashing.
// Test cases overwrite `(globalThis as any).window.__PAY_CONFIG__` directly.
// deno-lint-ignore no-explicit-any
(globalThis as any).window = (globalThis as any).window ?? {};

import {
  __resetConfigForTests,
  getEnvironment,
  getNetworkPassphrase,
  getPayPlatformUrl,
  getStellarNetwork,
  isProduction,
} from "./config.ts";

// deno-lint-ignore no-explicit-any
function setConfig(cfg: any): void {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).window.__PAY_CONFIG__ = cfg;
  __resetConfigForTests();
}

Deno.test("getPayPlatformUrl returns the configured URL", () => {
  setConfig({
    payPlatformUrl: "https://pay.example.com",
    environment: "production",
    stellarNetwork: "testnet",
  });
  assertEquals(getPayPlatformUrl(), "https://pay.example.com");
});

Deno.test("getPayPlatformUrl throws when payPlatformUrl is missing — no silent fallback", () => {
  // Critical: a misconfigured deploy must fail loudly. The previous
  // version defaulted to the testnet URL, which would have silently pointed
  // a production build at testnet on a missing config.
  setConfig({ environment: "production" });
  assertThrows(
    () => getPayPlatformUrl(),
    Error,
    "payPlatformUrl is required",
  );
});

Deno.test("getPayPlatformUrl throws when window.__PAY_CONFIG__ is missing entirely", () => {
  setConfig(undefined);
  assertThrows(
    () => getPayPlatformUrl(),
    Error,
    "payPlatformUrl is required",
  );
});

Deno.test("getEnvironment defaults to 'production' when only payPlatformUrl is set", () => {
  setConfig({ payPlatformUrl: "https://pay.example.com" });
  assertEquals(getEnvironment(), "production");
  assertEquals(isProduction(), true);
});

Deno.test("getEnvironment honors an explicit 'development' value", () => {
  setConfig({
    payPlatformUrl: "http://localhost:3025",
    environment: "development",
  });
  assertEquals(getEnvironment(), "development");
  assertEquals(isProduction(), false);
});

Deno.test("getStellarNetwork defaults to testnet", () => {
  setConfig({ payPlatformUrl: "https://pay.example.com" });
  assertEquals(getStellarNetwork(), "testnet");
});

Deno.test("getNetworkPassphrase returns the right passphrase per network", () => {
  setConfig({
    payPlatformUrl: "https://pay.example.com",
    stellarNetwork: "mainnet",
  });
  assertEquals(
    getNetworkPassphrase(),
    "Public Global Stellar Network ; September 2015",
  );

  setConfig({
    payPlatformUrl: "https://pay.example.com",
    stellarNetwork: "standalone",
  });
  assertEquals(getNetworkPassphrase(), "Standalone Network ; February 2017");

  setConfig({
    payPlatformUrl: "https://pay.example.com",
    stellarNetwork: "testnet",
  });
  assertEquals(getNetworkPassphrase(), "Test SDF Network ; September 2015");
});
