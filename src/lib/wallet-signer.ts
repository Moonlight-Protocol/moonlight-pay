/**
 * Adapter that wraps the stellar-wallets-kit v2 static API into the
 * Signer interface expected by @colibri/core and moonlight-sdk.
 */
import { StellarWalletsKit } from "@creit-tech/stellar-wallets-kit/sdk";
import { getNetworkPassphrase } from "./config.ts";
import { getConnectedAddress } from "./wallet-state.ts";
import { ensureKitInit } from "./wallet.ts";

export function createWalletSigner(): {
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
  ensureKitInit();
  const address = getConnectedAddress();
  if (!address) throw new Error("Wallet not connected");
  const passphrase = getNetworkPassphrase();

  return {
    publicKey: () => address,

    sign: (_data: Uint8Array) => {
      return Promise.reject(
        new Error("Raw sign not supported via wallet kit"),
      );
    },

    signTransaction: async (
      xdr: string,
      opts?: { networkPassphrase?: string },
    ) => {
      const result = await StellarWalletsKit.signTransaction(xdr, {
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
      const entryXdr = typeof authEntry === "string"
        ? authEntry
        : (authEntry as { toXDR: (fmt: string) => string }).toXDR("base64");

      const result = await StellarWalletsKit.signAuthEntry(entryXdr, {
        networkPassphrase,
        address,
      });

      const signedXdr = result.signedAuthEntry;
      if (!signedXdr) {
        throw new Error("Wallet returned no signed auth entry");
      }

      // Parse back to XDR object — the moonlight-sdk expects this
      const { xdr } = await import("stellar-sdk");
      return xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, "base64");
    },

    signsFor: (pk: string) => pk === address,
  };
}
