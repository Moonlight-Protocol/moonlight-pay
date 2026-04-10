/**
 * Adapter that wraps the Stellar Wallets Kit into the Signer interface
 * expected by the moonlight-sdk's MoonlightOperation.signWithEd25519().
 *
 * This allows the SDK to sign deposit auth entries via Freighter (or any
 * other SEP-43 wallet) without needing access to the private key.
 */
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/stellar-wallets-kit.mjs";
import { getNetworkPassphrase } from "./config.ts";
import { getConnectedAddress } from "./wallet-state.ts";

/**
 * Create a Signer-compatible object from the wallets-kit instance.
 * The returned object satisfies the colibri/core Signer interface:
 *   publicKey(), sign(), signTransaction(), signSorobanAuthEntry(), signsFor()
 */
export function createWalletSigner(kit: StellarWalletsKit): {
  publicKey: () => string;
  sign: (data: Uint8Array) => Promise<Uint8Array>;
  signTransaction: (
    xdr: string,
    opts?: { networkPassphrase?: string },
  ) => Promise<{ signedTxXdr: string }>;
  signSorobanAuthEntry: (
    authEntry: unknown,
    signatureExpirationLedger: number,
    networkPassphrase: string,
  ) => Promise<unknown>;
  signsFor: (publicKey: string) => boolean;
} {
  const address = getConnectedAddress();
  if (!address) throw new Error("Wallet not connected");
  const passphrase = getNetworkPassphrase();

  return {
    publicKey: () => address,

    sign: (_data: Uint8Array) => {
      // Not used by the deposit flow — signSorobanAuthEntry handles it
      return Promise.reject(
        new Error("Raw sign not supported via wallet kit"),
      );
    },

    signTransaction: async (
      xdr: string,
      opts?: { networkPassphrase?: string },
    ) => {
      const result = await kit.signTransaction(xdr, {
        networkPassphrase: opts?.networkPassphrase ?? passphrase,
        address,
      });
      return { signedTxXdr: result.signedTxXdr };
    },

    signSorobanAuthEntry: async (
      authEntry: unknown,
      _signatureExpirationLedger: number,
      networkPassphrase: string,
    ) => {
      // The wallets-kit's signAuthEntry signs a Soroban auth entry.
      // It expects the auth entry as a base64 XDR string.
      const entryXdr = typeof authEntry === "string"
        ? authEntry
        : (authEntry as { toXDR: (fmt: string) => string }).toXDR("base64");

      const result = await kit.signAuthEntry(entryXdr, {
        networkPassphrase,
        address,
      });
      return result.signedAuthEntry;
    },

    signsFor: (pk: string) => pk === address,
  };
}
