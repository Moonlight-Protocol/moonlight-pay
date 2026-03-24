/**
 * Freighter wallet integration for moonlight-pay-self.
 * Connects via SEP-10 challenge flow for auth token.
 */
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/stellar-wallets-kit.mjs";
import { WalletNetwork } from "@creit.tech/stellar-wallets-kit/types.mjs";
import { FreighterModule, FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter.module.mjs";
import "@creit.tech/stellar-wallets-kit/components/modal/stellar-wallets-modal.mjs";
import { STELLAR_NETWORK, getNetworkPassphrase, API_BASE_URL } from "./config.ts";
import { setAuthToken } from "shared/api/client.ts";

const TOKEN_KEY = "moonlight_pay_self_token";
const ADDRESS_KEY = "moonlight_pay_self_address";

let kit: StellarWalletsKit | null = null;
let connectedAddress: string | null = null;
let authToken: string | null = null;

function getWalletNetwork(): WalletNetwork {
  switch (STELLAR_NETWORK) {
    case "mainnet": return WalletNetwork.PUBLIC;
    case "standalone": return WalletNetwork.STANDALONE;
    default: return WalletNetwork.TESTNET;
  }
}

function getKit(): StellarWalletsKit {
  if (!kit) {
    kit = new StellarWalletsKit({
      network: getWalletNetwork(),
      selectedWalletId: FREIGHTER_ID,
      modules: [new FreighterModule()],
    });
  }
  return kit;
}

export function getConnectedAddress(): string | null {
  if (!connectedAddress) {
    connectedAddress = localStorage.getItem(ADDRESS_KEY);
  }
  return connectedAddress;
}

export function getToken(): string | null {
  if (!authToken) {
    authToken = localStorage.getItem(TOKEN_KEY);
  }
  return authToken;
}

export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token) return false;
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    if (typeof payload.exp === "number" && Date.now() / 1000 > payload.exp) {
      clearSession();
      return false;
    }
  } catch {
    clearSession();
    return false;
  }
  return true;
}

export function clearSession(): void {
  authToken = null;
  connectedAddress = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ADDRESS_KEY);
  setAuthToken(null);
}

/**
 * Connect wallet, authenticate via SEP-10, return address + token.
 */
export async function connectAndAuth(): Promise<{ address: string; token: string }> {
  const walletKit = getKit();

  return new Promise((resolve, reject) => {
    walletKit.openModal({
      onWalletSelected: async (option) => {
        walletKit.setWallet(option.id);
        try {
          const { address } = await walletKit.getAddress();

          // SEP-10 challenge
          const challengeRes = await fetch(
            `${API_BASE_URL}/stellar/auth?account=${encodeURIComponent(address)}`,
          );
          if (!challengeRes.ok) throw new Error(`Challenge failed: ${challengeRes.status}`);
          const { data: { challenge } } = await challengeRes.json();

          // Sign challenge transaction
          const { signedTxXdr } = await walletKit.signTransaction(challenge, {
            address,
            networkPassphrase: getNetworkPassphrase(),
          });

          // Verify signed challenge
          const verifyRes = await fetch(`${API_BASE_URL}/stellar/auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signedChallenge: signedTxXdr }),
          });
          if (!verifyRes.ok) throw new Error(`Verify failed: ${verifyRes.status}`);
          const { data: { jwt: token } } = await verifyRes.json();

          // Store
          connectedAddress = address;
          authToken = token;
          localStorage.setItem(ADDRESS_KEY, address);
          localStorage.setItem(TOKEN_KEY, token);

          resolve({ address, token });
        } catch (err) {
          reject(err);
        }
      },
    }).catch(reject);
  });
}

export async function signTransaction(xdr: string): Promise<string> {
  const walletKit = getKit();
  const address = getConnectedAddress();
  if (!address) throw new Error("No wallet connected");

  const { signedTxXdr } = await walletKit.signTransaction(xdr, {
    address,
    networkPassphrase: getNetworkPassphrase(),
  });
  return signedTxXdr;
}
