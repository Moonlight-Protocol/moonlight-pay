/**
 * P256 UTXO key derivation from a user-provided password.
 *
 * The user chooses a password that, combined with the network passphrase,
 * contract ID, and UTXO index, deterministically derives P256 keypairs
 * for their privacy UTXOs.
 *
 * Pipeline: SHA-256(context + password + index) → HKDF-SHA256 (48 bytes) → P256 field reduction
 *
 * Uses the same cryptographic primitives as the moonlight-sdk but with the
 * user's password as the root instead of a Stellar secret key.
 *
 * The password is kept in memory only — never stored, never sent to the server.
 * Losing the password = losing access to all derived UTXOs.
 */

import { getNetworkPassphrase, CHANNEL_CONTRACT_ID } from "./config.ts";

let currentPassword: string | null = null;

// Lazy-loaded crypto modules
let p256: typeof import("@noble/curves/p256").p256 | null = null;
let hkdf: typeof import("@noble/hashes/hkdf").hkdf | null = null;
let sha256: typeof import("@noble/hashes/sha256").sha256 | null = null;

async function loadCrypto() {
  if (!p256) {
    const curves = await import("@noble/curves/p256");
    const hkdfMod = await import("@noble/hashes/hkdf");
    const sha256Mod = await import("@noble/hashes/sha256");
    p256 = curves.p256;
    hkdf = hkdfMod.hkdf;
    sha256 = sha256Mod.sha256;
  }
  return { p256: p256!, hkdf: hkdf!, sha256: sha256! };
}

/** Set the derivation password for this session. */
export function setPassword(password: string): void {
  currentPassword = password;
}

/** Get the current password (null if not set). */
export function getPassword(): string | null {
  return currentPassword;
}

/** Clear the password from memory. */
export function clearPassword(): void {
  currentPassword = null;
}

/** Check if a password is set for the current session. */
export function hasPassword(): boolean {
  return currentPassword !== null;
}

/**
 * Derive a P256 keypair for a given UTXO index.
 *
 * Same pipeline as moonlight-sdk's deriveP256KeyPairFromSeed:
 * 1. Assemble plaintext: context + password + index
 * 2. SHA-256 hash → 32 bytes
 * 3. HKDF-SHA256 expand → 48 bytes (eliminates bias per FIPS 186-5)
 * 4. mapHashToField reduces to P256 curve order
 * 5. Derive P256 public key from private scalar
 */
export async function deriveUtxoKeypair(index: number): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}> {
  if (!currentPassword) {
    throw new Error("No password set. Call setPassword() first.");
  }

  const crypto = await loadCrypto();

  const context = getNetworkPassphrase() + CHANNEL_CONTRACT_ID;
  const plaintext = `${context}${currentPassword}${index}`;

  // Step 1-2: SHA-256 hash of assembled plaintext
  const encoded = new TextEncoder().encode(plaintext);
  const seed = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", encoded));

  // Step 3: HKDF expand 32 → 48 bytes
  const expanded = crypto.hkdf(crypto.sha256, seed, undefined, "application", 48);

  // Step 4-5: Reduce expanded 48 bytes to P256 private scalar (mod curve order)
  // This follows FIPS 186-5 §A.2.1: interpret expanded bytes as big-endian integer,
  // reduce mod n. Using 48 bytes (384 bits) eliminates modular bias.
  const n = crypto.p256.CURVE.n;
  let scalar = 0n;
  for (let i = 0; i < expanded.length; i++) {
    scalar = (scalar << 8n) | BigInt(expanded[i]);
  }
  scalar = scalar % n;
  if (scalar === 0n) scalar = 1n; // Ensure non-zero

  const privateKey = new Uint8Array(32);
  let temp = scalar;
  for (let i = 31; i >= 0; i--) {
    privateKey[i] = Number(temp & 0xFFn);
    temp >>= 8n;
  }

  const publicKey = crypto.p256.getPublicKey(privateKey, false); // uncompressed (65 bytes)

  // Zero intermediate key material
  seed.fill(0);
  expanded.fill(0);

  return { publicKey, privateKey };
}

/**
 * Derive multiple UTXO keypairs starting from a given index.
 */
export async function deriveUtxoKeypairs(
  startIndex: number,
  count: number,
): Promise<Array<{ index: number; publicKey: Uint8Array; privateKey: Uint8Array }>> {
  const results = [];
  for (let i = 0; i < count; i++) {
    const kp = await deriveUtxoKeypair(startIndex + i);
    results.push({ index: startIndex + i, ...kp });
  }
  return results;
}

/**
 * Get the public key (UTXO address) for a given index.
 */
export async function getUtxoAddress(index: number): Promise<Uint8Array> {
  const kp = await deriveUtxoKeypair(index);
  // Private key not needed — zero it immediately
  kp.privateKey.fill(0);
  return kp.publicKey;
}
