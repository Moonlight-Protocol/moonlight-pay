import { assertEquals, assertThrows } from "jsr:@std/assert";
import { hexToBytes } from "shared/utils/hex.ts";

/**
 * Validation logic extracted from apps/self/src/views/send.ts.
 * These tests verify the hex + P256 key length rules used in the send form.
 */

const HEX_REGEX = /^[0-9a-fA-F]+$/;

function isValidRecipientKey(hex: string): { valid: boolean; error?: string } {
  if (!hex || !HEX_REGEX.test(hex)) {
    return { valid: false, error: "Enter a valid hex-encoded P256 public key" };
  }
  if (hex.length !== 66 && hex.length !== 130) {
    return {
      valid: false,
      error: "Public key must be 66 (compressed) or 130 (uncompressed) hex characters",
    };
  }
  return { valid: true };
}

Deno.test("valid compressed P256 key (66 hex chars) passes", () => {
  // Compressed P256 key starts with 02 or 03, 33 bytes = 66 hex chars
  const compressedKey = "02" + "a".repeat(64);
  const result = isValidRecipientKey(compressedKey);
  assertEquals(result.valid, true);
  assertEquals(result.error, undefined);
});

Deno.test("valid uncompressed P256 key (130 hex chars) passes", () => {
  // Uncompressed P256 key starts with 04, 65 bytes = 130 hex chars
  const uncompressedKey = "04" + "b".repeat(128);
  const result = isValidRecipientKey(uncompressedKey);
  assertEquals(result.valid, true);
  assertEquals(result.error, undefined);
});

Deno.test("too short hex string fails", () => {
  const shortKey = "02" + "aa".repeat(10); // only 22 hex chars
  const result = isValidRecipientKey(shortKey);
  assertEquals(result.valid, false);
  assertEquals(result.error, "Public key must be 66 (compressed) or 130 (uncompressed) hex characters");
});

Deno.test("too long hex string fails", () => {
  const longKey = "04" + "cc".repeat(70); // 144 hex chars
  const result = isValidRecipientKey(longKey);
  assertEquals(result.valid, false);
});

Deno.test("non-hex characters fail", () => {
  const badKey = "zz" + "a".repeat(64);
  const result = isValidRecipientKey(badKey);
  assertEquals(result.valid, false);
  assertEquals(result.error, "Enter a valid hex-encoded P256 public key");
});

Deno.test("empty string fails", () => {
  const result = isValidRecipientKey("");
  assertEquals(result.valid, false);
  assertEquals(result.error, "Enter a valid hex-encoded P256 public key");
});

Deno.test("correct length but non-hex chars fails on hex check first", () => {
  // 66 chars but contains 'g'
  const badHex = "02" + "g".repeat(64);
  const result = isValidRecipientKey(badHex);
  assertEquals(result.valid, false);
  assertEquals(result.error, "Enter a valid hex-encoded P256 public key");
});

Deno.test("hexToBytes works on valid compressed key hex", () => {
  const compressedKey = "02" + "ab".repeat(32);
  const bytes = hexToBytes(compressedKey);
  assertEquals(bytes.length, 33); // 33 bytes for compressed P256
  assertEquals(bytes[0], 0x02);
});

Deno.test("hexToBytes works on valid uncompressed key hex", () => {
  const uncompressedKey = "04" + "cd".repeat(64);
  const bytes = hexToBytes(uncompressedKey);
  assertEquals(bytes.length, 65); // 65 bytes for uncompressed P256
  assertEquals(bytes[0], 0x04);
});

Deno.test("hexToBytes rejects odd-length key input", () => {
  const oddKey = "04" + "a".repeat(127); // 129 chars, odd
  assertThrows(
    () => hexToBytes(oddKey),
    Error,
    "odd length",
  );
});
