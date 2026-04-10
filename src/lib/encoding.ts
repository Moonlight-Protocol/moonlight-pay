/**
 * Pure encoding helpers — no DOM, no storage, no globals.
 * Kept in their own module so they can be unit-tested under Deno without
 * mocking browser APIs.
 */

/**
 * Decode a base64url-encoded string to bytes.
 *
 * SEP-43 wallets sign payloads as base64url (RFC 4648 §5): `+` → `-`,
 * `/` → `_`, no `=` padding. Browser `atob` is lenient and accepts
 * unpadded input, but Deno's `atob` is strict per the WHATWG spec and
 * throws `InvalidCharacterError` on missing padding. This helper:
 *   1. translates the base64url alphabet back to standard base64,
 *   2. re-pads to a multiple of 4 chars,
 *   3. validates that the result is well-formed base64.
 */
export function base64UrlToBytes(input: string): Uint8Array {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("base64UrlToBytes: input must be a non-empty string");
  }
  const standard = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (standard.length % 4)) % 4;
  const padded = standard + "=".repeat(padLength);
  // Reject any character outside the base64 alphabet (atob would either
  // throw or silently mangle in some runtimes — we want a clear error).
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(padded)) {
    throw new Error("base64UrlToBytes: input contains invalid characters");
  }
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
