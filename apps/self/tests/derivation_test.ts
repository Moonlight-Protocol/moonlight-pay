import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { setPassword, clearPassword, deriveUtxoKeypair, deriveUtxoKeypairs, hasPassword } from "../src/lib/derivation.ts";

// Mock config — needs to be importable without DOM
// The derivation module imports config.ts which reads window.__PAY_CONFIG__
// We need to set up the globals before importing

Deno.test("derivation is deterministic", async () => {
  setPassword("test-password-123");
  const kp1 = await deriveUtxoKeypair(0);
  const kp2 = await deriveUtxoKeypair(0);

  assertEquals(kp1.publicKey, kp2.publicKey);
  assertEquals(kp1.privateKey, kp2.privateKey);
  clearPassword();
});

Deno.test("different indices produce different keys", async () => {
  setPassword("test-password-123");
  const kp0 = await deriveUtxoKeypair(0);
  const kp1 = await deriveUtxoKeypair(1);

  assertNotEquals(
    Array.from(kp0.publicKey),
    Array.from(kp1.publicKey),
  );
  clearPassword();
});

Deno.test("different passwords produce different keys", async () => {
  setPassword("password-A");
  const kpA = await deriveUtxoKeypair(0);

  setPassword("password-B");
  const kpB = await deriveUtxoKeypair(0);

  assertNotEquals(
    Array.from(kpA.publicKey),
    Array.from(kpB.publicKey),
  );
  clearPassword();
});

Deno.test("deriveUtxoKeypairs returns correct count", async () => {
  setPassword("test-password");
  const keypairs = await deriveUtxoKeypairs(0, 5);
  assertEquals(keypairs.length, 5);
  assertEquals(keypairs[0].index, 0);
  assertEquals(keypairs[4].index, 4);
  clearPassword();
});

Deno.test("public key is 65 bytes (uncompressed P256)", async () => {
  setPassword("test-password");
  const kp = await deriveUtxoKeypair(0);
  assertEquals(kp.publicKey.length, 65);
  assertEquals(kp.publicKey[0], 0x04); // uncompressed point prefix
  clearPassword();
});

Deno.test("clearPassword works", () => {
  setPassword("test");
  assertEquals(hasPassword(), true);
  clearPassword();
  assertEquals(hasPassword(), false);
});
