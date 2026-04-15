/**
 * Wallet integration for Moonlight Pay.
 *
 * Uses stellar-wallets-kit v2 (static API). All testable state lives in
 * wallet-state.ts so the test suite never has to import the kit.
 */
import { StellarWalletsKit } from "@creit-tech/stellar-wallets-kit/sdk";
import { Networks } from "@creit-tech/stellar-wallets-kit/types";
import {
  FreighterModule,
} from "@creit-tech/stellar-wallets-kit/modules/freighter";
import { getNetworkPassphrase, getStellarNetwork } from "./config.ts";
import {
  deriveMasterSeedFromSignature,
  getConnectedAddress,
  getMasterSeed,
  isMasterSeedReady,
  requestSeedFromOtherTabs,
  setConnectedAddress,
} from "./wallet-state.ts";

export {
  clearWalletState as clearSession,
  getConnectedAddress,
  getMasterSeed,
  isAuthenticated,
  isMasterSeedReady,
} from "./wallet-state.ts";

let initialized = false;

function getWalletNetwork(): Networks {
  switch (getStellarNetwork()) {
    case "mainnet":
      return Networks.PUBLIC;
    case "standalone":
      return Networks.STANDALONE;
    default:
      return Networks.TESTNET;
  }
}

function ensureInit(): void {
  if (!initialized) {
    StellarWalletsKit.init({
      modules: [new FreighterModule()],
      network: getWalletNetwork(),
    });
    initialized = true;
  }
  // If the user already connected (e.g. on the login page), tell the kit
  // which wallet to use. v2's static API doesn't persist the selected
  // wallet across page navigations automatically.
  if (getConnectedAddress()) {
    StellarWalletsKit.setWallet("freighter");
  }
}

export async function connectWallet(): Promise<string> {
  ensureInit();
  const { address } = await StellarWalletsKit.authModal();
  setConnectedAddress(address);
  return address;
}

/** Ensure the kit is initialized — called by wallet-signer too. */
export function ensureKitInit(): void {
  ensureInit();
}

export async function signMessage(message: string): Promise<string> {
  ensureInit();
  const address = getConnectedAddress();
  if (!address) throw new Error("Wallet not connected");

  const result = await StellarWalletsKit.signMessage(message, {
    address,
    networkPassphrase: getNetworkPassphrase(),
  });

  if (
    typeof result?.signedMessage !== "string" ||
    result.signedMessage.length === 0
  ) {
    throw new Error("Wallet returned an empty signature");
  }
  return result.signedMessage;
}

/**
 * Derive a deterministic OpEx (treasury) keypair from the master seed.
 * SHA-256(masterSeed + "opex") → Ed25519 seed.
 * No wallet interaction — pure math. One account per user, no index.
 *
 * NOTE: The returned secretKey is a JS string and cannot be zeroed from memory.
 * This is a known limitation of JS string immutability — there is no way to
 * clear it after use. Callers should avoid persisting it unnecessarily.
 */
export async function deriveOpExKeypair(): Promise<
  { publicKey: string; secretKey: string }
> {
  const seed = getMasterSeed();
  const encoder = new TextEncoder();
  const input = new Uint8Array([...seed, ...encoder.encode("opex")]);
  const derived = new Uint8Array(await crypto.subtle.digest("SHA-256", input));

  // deno-lint-ignore no-explicit-any
  const { Keypair } = await import("stellar-sdk") as any;
  const keypair = Keypair.fromRawEd25519Seed(derived);
  return { publicKey: keypair.publicKey(), secretKey: keypair.secret() };
}

export async function initMasterSeed(): Promise<void> {
  const adopted = await requestSeedFromOtherTabs();
  if (adopted && isMasterSeedReady()) return;

  const signature = await signMessage("Moonlight: authorize master key");
  await deriveMasterSeedFromSignature(signature);
}
