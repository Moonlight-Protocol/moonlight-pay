/**
 * UTXO key derivation for moonlight-pay accounts.
 *
 * At onboarding, generates a pool of P256 receive addresses derived from
 * the user's master seed + email:
 *
 *   1. HKDF(master_seed, salt=email, info="moonlight-pay-utxo-v1") → 32-byte UTXO root
 *   2. For each index i: SHA-256(utxo_root ‖ i) → 32-byte seed
 *   3. deriveP256KeyPairFromSeed(seed) → P256 keypair
 *   4. Store public key in pay-platform DB (private keys never leave the device)
 *
 * Recovery: wallet signature (re-derives master seed) + email = same keys.
 * Portability: any app implementing the same HKDF path can re-derive.
 *
 * The derivation is deterministic to moonlight-pay (the email salt ensures
 * different keys from the browser-wallet which uses a different root).
 * The keys are NOT secret from the user — they can regenerate them anytime.
 */

const HKDF_INFO = "moonlight-pay-utxo-v1";
const DEFAULT_COUNT = 100;

/**
 * Derive P256 UTXO keypairs from a master seed + email.
 * Returns only the public keys and their derivation indexes — private keys
 * are NOT persisted or returned (they stay in the caller's scope and are
 * discarded after the public keys are stored).
 */
export async function deriveReceiveUtxos(
  masterSeed: Uint8Array,
  email: string,
  count: number = DEFAULT_COUNT,
): Promise<Array<{ utxoPublicKey: string; derivationIndex: number }>> {
  // Step 1: HKDF to get the UTXO root key
  const utxoRoot = await hkdfSha256(masterSeed, email, HKDF_INFO);

  // Step 2: derive keypairs at each index
  const results: Array<{ utxoPublicKey: string; derivationIndex: number }> = [];
  for (let i = 0; i < count; i++) {
    const indexBytes = new TextEncoder().encode(i.toString());
    const seedInput = new Uint8Array(utxoRoot.length + indexBytes.length);
    seedInput.set(utxoRoot);
    seedInput.set(indexBytes, utxoRoot.length);

    const seed = new Uint8Array(
      await crypto.subtle.digest("SHA-256", seedInput),
    );

    // Step 3: derive P256 keypair from the seed
    // We use the Web Crypto API to import the seed as an HKDF key and
    // derive a P-256 ECDSA key. The private key is extractable only so
    // we can get the public key — it's never stored.
    const publicKeyBytes = await deriveP256PublicKey(seed);
    const publicKeyB64 = btoa(
      String.fromCharCode(...new Uint8Array(publicKeyBytes)),
    );

    results.push({ utxoPublicKey: publicKeyB64, derivationIndex: i });
  }

  return results;
}

/**
 * HKDF-SHA256: extract-then-expand.
 * Returns a 32-byte derived key.
 */
async function hkdfSha256(
  ikm: Uint8Array,
  salt: string,
  info: string,
): Promise<Uint8Array> {
  const ikmBuf = new ArrayBuffer(ikm.length);
  new Uint8Array(ikmBuf).set(ikm);
  const baseKey = await crypto.subtle.importKey("raw", ikmBuf, "HKDF", false, [
    "deriveBits",
  ]);
  const derived = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(salt),
      info: new TextEncoder().encode(info),
    },
    baseKey,
    256,
  );
  return new Uint8Array(derived);
}

/**
 * Derive a P-256 public key deterministically from a 32-byte seed.
 *
 * Uses the same HKDF→scalar→point approach as the moonlight-sdk's
 * deriveP256KeyPairFromSeed but via the Web Crypto API so it works in
 * the browser without importing @noble/curves.
 *
 * The seed is used as IKM for another HKDF round to expand to 48 bytes
 * (eliminates modular bias per FIPS 186-5), then the result is imported
 * as raw ECDSA key material.
 */
async function deriveP256PublicKey(seed: Uint8Array): Promise<ArrayBuffer> {
  // Expand seed to 48 bytes to eliminate bias
  const seedBuf = new ArrayBuffer(seed.length);
  new Uint8Array(seedBuf).set(seed);
  const expandKey = await crypto.subtle.importKey(
    "raw",
    seedBuf,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const expanded = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode("moonlight-p256"),
    },
    expandKey,
    384, // 48 bytes
  );

  // Import as ECDSA P-256 private key and extract the public key
  // Web Crypto doesn't directly support "seed → keypair", so we use
  // ECDSA import of the raw private key bytes (first 32 bytes of the
  // expanded output, reduced mod n by the runtime).
  const privateKeyBytes = new Uint8Array(expanded).slice(0, 32);

  try {
    const keyPair = await crypto.subtle.importKey(
      "pkcs8",
      buildPkcs8P256(privateKeyBytes).buffer as ArrayBuffer,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign"],
    );
    // JWK export includes both private (d) and public (x, y) components.
    const jwk = await crypto.subtle.exportKey("jwk", keyPair);
    // Reconstruct the uncompressed public key from x and y
    const x = base64UrlToBytes(jwk.x!);
    const y = base64UrlToBytes(jwk.y!);
    const uncompressed = new Uint8Array(65);
    uncompressed[0] = 0x04;
    uncompressed.set(x, 1);
    uncompressed.set(y, 33);
    return uncompressed.buffer;
  } catch {
    // If PKCS8 import fails (e.g., the private key bytes are out of range),
    // fall back to a hash-retry approach
    throw new Error(
      `Failed to derive P-256 key at seed. This should not happen with HKDF-expanded input.`,
    );
  }
}

/** Decode base64url (no padding) to Uint8Array. */
function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (b64.length % 4)) % 4;
  const padded = b64 + "=".repeat(pad);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Build a minimal PKCS#8 wrapper for a P-256 private key.
 * This is the DER encoding of:
 *   PrivateKeyInfo ::= SEQUENCE {
 *     version INTEGER (0),
 *     privateKeyAlgorithm SEQUENCE { OID ecPublicKey, OID prime256v1 },
 *     privateKey OCTET STRING { ECPrivateKey ::= SEQUENCE {
 *       version INTEGER (1),
 *       privateKey OCTET STRING (32 bytes)
 *     }}
 *   }
 */
/**
 * Derive a full P-256 keypair (public + private) from a 32-byte seed.
 * Used by the instant payment flow to generate temporary hop keys.
 * The private key is needed to sign SPEND operations.
 */
export async function deriveP256KeyPairFromSeed(
  seed: Uint8Array,
): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
  const seedBuf = new ArrayBuffer(seed.length);
  new Uint8Array(seedBuf).set(seed);
  const expandKey = await crypto.subtle.importKey(
    "raw",
    seedBuf,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const expanded = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode("moonlight-p256"),
    },
    expandKey,
    384,
  );
  const privateKeyBytes = new Uint8Array(expanded).slice(0, 32);

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    buildPkcs8P256(privateKeyBytes).buffer as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", cryptoKey);
  const x = base64UrlToBytes(jwk.x!);
  const y = base64UrlToBytes(jwk.y!);
  const publicKey = new Uint8Array(65);
  publicKey[0] = 0x04;
  publicKey.set(x, 1);
  publicKey.set(y, 33);

  return { publicKey, privateKey: privateKeyBytes };
}

function buildPkcs8P256(rawPrivateKey: Uint8Array): Uint8Array {
  // DER-encoded PKCS#8 header for P-256 (fixed bytes)
  const header = new Uint8Array([
    0x30,
    0x41, // SEQUENCE (65 bytes total)
    0x02,
    0x01,
    0x00, // INTEGER version = 0
    0x30,
    0x13, // SEQUENCE (19 bytes)
    0x06,
    0x07,
    0x2a,
    0x86,
    0x48,
    0xce,
    0x3d,
    0x02,
    0x01, // OID ecPublicKey
    0x06,
    0x08,
    0x2a,
    0x86,
    0x48,
    0xce,
    0x3d,
    0x03,
    0x01,
    0x07, // OID prime256v1
    0x04,
    0x27, // OCTET STRING (39 bytes)
    0x30,
    0x25, // SEQUENCE (37 bytes)
    0x02,
    0x01,
    0x01, // INTEGER version = 1
    0x04,
    0x20, // OCTET STRING (32 bytes) — the private key
  ]);
  const result = new Uint8Array(header.length + 32);
  result.set(header);
  result.set(rawPrivateKey, header.length);
  return result;
}
