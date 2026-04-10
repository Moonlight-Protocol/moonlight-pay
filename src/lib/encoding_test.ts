import { assertEquals, assertThrows } from "@std/assert";
import { base64UrlToBytes } from "./encoding.ts";

Deno.test("base64UrlToBytes decodes a normal padded base64 string", () => {
  // "hello" → aGVsbG8=
  assertEquals(
    Array.from(base64UrlToBytes("aGVsbG8=")),
    [104, 101, 108, 108, 111],
  );
});

Deno.test("base64UrlToBytes adds missing padding for unpadded base64url", () => {
  // SEP-43 path: wallets emit unpadded base64url. Deno's strict atob
  // throws on unpadded input — this helper must re-pad transparently.
  // "hi" → aGk (unpadded) / aGk= (padded)
  assertEquals(Array.from(base64UrlToBytes("aGk")), [104, 105]);
  // "Man" → TWFu (no padding needed)
  assertEquals(Array.from(base64UrlToBytes("TWFu")), [77, 97, 110]);
  // "any carnal pleasur" → YW55IGNhcm5hbCBwbGVhc3Vy (no pad needed)
  // "any carnal pleasure" → ...lYQ== (2 padding)
  // "any carnal pleasures" → ...lcw== - wait need to fix: 20 chars % 3 = 2, so 1 pad
  // Just stick with simpler vectors above.
});

Deno.test("base64UrlToBytes translates base64url alphabet (- and _)", () => {
  // Standard base64 of bytes [251, 255, 191] is +/+/ (wait, let me compute)
  // [251, 255] → +/8=
  // base64url: -_8=  (and unpadded: -_8)
  assertEquals(Array.from(base64UrlToBytes("+/8=")), [251, 255]);
  assertEquals(Array.from(base64UrlToBytes("-_8")), [251, 255]);
});

Deno.test("base64UrlToBytes rejects empty input", () => {
  assertThrows(
    () => base64UrlToBytes(""),
    Error,
    "non-empty string",
  );
});

Deno.test("base64UrlToBytes rejects invalid characters", () => {
  assertThrows(
    () => base64UrlToBytes("not!base64@"),
    Error,
    "invalid characters",
  );
});

Deno.test("base64UrlToBytes round-trips a 64-byte Stellar Ed25519 signature", () => {
  // Ed25519 sigs are 64 bytes — this is the size moonlight-pay actually
  // hands off to SHA-256 for the master seed. Use a deterministic byte
  // pattern so the test is reproducible.
  const original = new Uint8Array(64);
  for (let i = 0; i < 64; i++) original[i] = i;
  // Encode as base64url (without padding) and decode back.
  let binary = "";
  for (const b of original) binary += String.fromCharCode(b);
  const stdB64 = btoa(binary);
  const b64url = stdB64.replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
  const decoded = base64UrlToBytes(b64url);
  assertEquals(decoded.length, 64);
  for (let i = 0; i < 64; i++) {
    assertEquals(decoded[i], original[i]);
  }
});
