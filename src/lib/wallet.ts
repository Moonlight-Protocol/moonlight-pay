/**
 * Wallet integration for Moonlight Pay.
 *
 * This file owns the stellar-wallets-kit instance and the high-level flows
 * (connect, sign, init master seed). All testable state lives in
 * wallet-state.ts so the test suite never has to import the kit (which
 * pulls in a broken @stellar/freighter-api transitive at module load).
 */
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/stellar-wallets-kit.mjs";
import { WalletNetwork } from "@creit.tech/stellar-wallets-kit/types.mjs";
import { FreighterModule, FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter.module.mjs";
import "@creit.tech/stellar-wallets-kit/components/modal/stellar-wallets-modal.mjs";
import { getNetworkPassphrase, getStellarNetwork } from "./config.ts";
import {
  deriveMasterSeedFromSignature,
  getConnectedAddress,
  isMasterSeedReady,
  requestSeedFromOtherTabs,
  setConnectedAddress,
} from "./wallet-state.ts";

// Re-export the read-only state surface so existing callers
// (`page.ts`, `nav.ts`, etc.) keep importing from a single module.
export {
  clearWalletState as clearSession,
  getConnectedAddress,
  getMasterSeed,
  isAuthenticated,
  isMasterSeedReady,
} from "./wallet-state.ts";

let kit: StellarWalletsKit | null = null;

function getWalletNetwork(): WalletNetwork {
  switch (getStellarNetwork()) {
    case "mainnet":
      return WalletNetwork.PUBLIC;
    case "standalone":
      return WalletNetwork.STANDALONE;
    default:
      return WalletNetwork.TESTNET;
  }
}

export function getKit(): StellarWalletsKit {
  if (!kit) {
    // sep43Modules() returns only wallets that implement SEP-43 signMessage,
    // which moonlight-pay requires for both master-seed derivation and the
    // platform challenge-response. Adding non-SEP-43 wallets here would let
    // users pick a wallet and then hit a dead end on the next step.
    kit = new StellarWalletsKit({
      network: getWalletNetwork(),
      selectedWalletId: FREIGHTER_ID,
      modules: [new FreighterModule()],
    });
  }
  return kit;
}

/**
 * Open wallet modal, connect, and store the user's address.
 * Returns the public key.
 */
export function connectWallet(): Promise<string> {
  const walletKit = getKit();

  return new Promise((resolve, reject) => {
    walletKit.openModal({
      onWalletSelected: async (option) => {
        walletKit.setWallet(option.id);
        try {
          const { address } = await walletKit.getAddress();
          setConnectedAddress(address);
          resolve(address);
        } catch (err) {
          reject(err);
        }
      },
    }).catch(reject);
  });
}

/**
 * Shape returned by the kit's signMessage at runtime. The kit's published
 * type omits the `error` field, but real wallets (and the kit's runtime
 * dispatcher) can return one when the user rejects or the wallet errors —
 * so we type and check it explicitly.
 */
interface SignMessageResult {
  signedMessage?: string;
  signerAddress?: string;
  error?: string;
}

/**
 * Sign an arbitrary message with the connected wallet (SEP-43).
 * Used for both master seed derivation and challenge-response auth.
 *
 * Throws on:
 *   - no connected wallet,
 *   - kit returning an `error` field (user rejection / wallet failure),
 *   - kit returning no `signedMessage` (some failure modes return neither
 *     `error` nor `signedMessage`).
 */
export async function signMessage(message: string): Promise<string> {
  const address = getConnectedAddress();
  if (!address) throw new Error("Wallet not connected");

  const result = await getKit().signMessage(message, {
    address,
    networkPassphrase: getNetworkPassphrase(),
  }) as SignMessageResult;

  if (result?.error) {
    throw new Error(result.error);
  }
  if (
    typeof result?.signedMessage !== "string" ||
    result.signedMessage.length === 0
  ) {
    throw new Error("Wallet returned an empty signature");
  }
  return result.signedMessage;
}

/**
 * Initialize the master seed.
 *
 * 1. If another open tab already has the seed, adopt it via BroadcastChannel
 *    (no extra wallet signature needed).
 * 2. Otherwise prompt the wallet for a fresh signature and derive the seed.
 *
 * Must be called once per tab before any key derivation. The seed lives
 * in memory only — see the security model in wallet-state.ts.
 */
export async function initMasterSeed(): Promise<void> {
  // Try cross-tab adoption first — saves the user a wallet prompt when
  // they already have Moonlight Pay open in another tab.
  const adopted = await requestSeedFromOtherTabs();
  if (adopted && isMasterSeedReady()) return;

  const signature = await signMessage("Moonlight: authorize master key");
  await deriveMasterSeedFromSignature(signature);
}
