/**
 * Compute the UTXO derivation root for the connected wallet's pay-platform
 * account. Called once at signup; the resulting 32-byte root is shipped
 * (encrypted by TLS) to pay-platform, which encrypts it at rest with
 * SERVICE_AUTH_SECRET and derives the per-index UTXO keypairs on demand.
 *
 *   utxoRoot = HKDF-SHA256(
 *     IKM  = masterSeed,
 *     salt = utf8("moonlight-pay"),
 *     info = utf8("moonlight-pay-utxo-v1"),
 *     L    = 32 bytes,
 *   )
 *
 * The masterSeed never leaves the device — only this root crosses the wire,
 * and only once.
 */

export const UTXO_ROOT_HKDF_SALT = "moonlight-pay";
export const UTXO_ROOT_HKDF_INFO = "moonlight-pay-utxo-v1";

export async function computeUtxoRoot(
  masterSeed: Uint8Array,
): Promise<Uint8Array> {
  const ikmBuf = new ArrayBuffer(masterSeed.length);
  new Uint8Array(ikmBuf).set(masterSeed);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    ikmBuf,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(UTXO_ROOT_HKDF_SALT),
      info: new TextEncoder().encode(UTXO_ROOT_HKDF_INFO),
    },
    baseKey,
    256,
  );
  return new Uint8Array(derived);
}
