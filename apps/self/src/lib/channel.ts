/**
 * Privacy channel client for on-chain UTXO balance queries
 * and operation building.
 */
import {
  PrivacyChannel,
  ChannelReadMethods,
  MoonlightOperation,
  UTXOKeypairBase,
  encodePKCS8,
} from "@moonlight/moonlight-sdk";
import { NetworkConfig, type ContractId } from "@colibri/core";
import { Buffer } from "buffer";
import {
  STELLAR_NETWORK,
  RPC_URL,
  CHANNEL_CONTRACT_ID,
  CHANNEL_AUTH_ID,
  CHANNEL_ASSET_ID,
  getNetworkPassphrase,
} from "./config.ts";

let channelClient: PrivacyChannel | null = null;

function getNetworkConfig(): NetworkConfig {
  switch (STELLAR_NETWORK) {
    case "mainnet":
      return NetworkConfig.MainNet();
    case "standalone":
      return NetworkConfig.CustomNet({
        networkPassphrase: getNetworkPassphrase(),
        rpcUrl: RPC_URL,
        horizonUrl: RPC_URL.replace("/soroban/rpc", ""),
        friendbotUrl: RPC_URL.replace("/soroban/rpc", "/friendbot"),
        allowHttp: true,
      });
    default:
      return NetworkConfig.TestNet();
  }
}

export function getChannel(): PrivacyChannel {
  if (!channelClient) {
    if (!CHANNEL_CONTRACT_ID || !CHANNEL_AUTH_ID) {
      throw new Error("Channel contract IDs not configured");
    }
    channelClient = new PrivacyChannel(
      getNetworkConfig(),
      CHANNEL_CONTRACT_ID as ContractId,
      CHANNEL_AUTH_ID as ContractId,
      (CHANNEL_ASSET_ID || CHANNEL_CONTRACT_ID) as ContractId,
    );
  }
  return channelClient;
}

/**
 * Query on-chain balances for a set of P256 UTXO public keys.
 * Returns an array of balances (bigint). -1 means the UTXO slot is unused.
 */
export async function queryUtxoBalances(
  publicKeys: Uint8Array[],
): Promise<bigint[]> {
  const channel = getChannel();
  return channel.read({
    method: ChannelReadMethods.utxo_balances,
    methodArgs: { utxos: publicKeys.map((pk) => Buffer.from(pk)) },
  });
}

/**
 * Get the latest ledger sequence from the RPC.
 */
export async function getLatestLedger(): Promise<number> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getLatestLedger",
    }),
  });

  if (!res.ok) {
    throw new Error(`RPC getLatestLedger failed: HTTP ${res.status}`);
  }

  let data: { result?: { sequence?: number }; error?: { message?: string } };
  try {
    data = await res.json();
  } catch {
    throw new Error("RPC getLatestLedger returned invalid JSON");
  }

  if (!data.result?.sequence) {
    const errMsg = data.error?.message ?? "missing result.sequence";
    throw new Error(`RPC getLatestLedger error: ${errMsg}`);
  }

  return data.result.sequence;
}

/**
 * Get the channel contract ID (needed for signing operations).
 */
export function getChannelContractId(): ContractId {
  if (!CHANNEL_CONTRACT_ID) throw new Error("Channel contract ID not configured");
  return CHANNEL_CONTRACT_ID as ContractId;
}

/**
 * Create a UTXOKeypairBase from raw private key and public key bytes.
 * The raw private key is PKCS8-encoded before constructing, as required
 * by the SDK's signPayload function.
 */
export function createUtxoKeypair(rawPrivateKey: Uint8Array, publicKey: Uint8Array): UTXOKeypairBase {
  const pkcs8PrivateKey = encodePKCS8(rawPrivateKey, publicKey);
  return new UTXOKeypairBase({ privateKey: pkcs8PrivateKey, publicKey });
}

export { MoonlightOperation };
