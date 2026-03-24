/**
 * Runtime configuration for moonlight-pay-self.
 * Set by config.js which loads before app.js.
 */
declare global {
  interface Window {
    __PAY_CONFIG__?: {
      environment?: string;
      stellarNetwork?: "testnet" | "mainnet" | "standalone";
      rpcUrl?: string;
      apiBaseUrl?: string;
      channelContractId?: string;
      channelAuthId?: string;
      channelAssetId?: string;
      posthogKey?: string;
      posthogHost?: string;
    };
  }
}

const config = (globalThis as unknown as Window).__PAY_CONFIG__ ?? {};

export const ENVIRONMENT = config.environment ?? "development";
export const IS_PRODUCTION = ENVIRONMENT === "production";
export const STELLAR_NETWORK = config.stellarNetwork ?? "testnet";
export const RPC_URL = config.rpcUrl ?? "https://soroban-testnet.stellar.org";
export const API_BASE_URL = config.apiBaseUrl ?? "http://localhost:8000/api/v1";
export const CHANNEL_CONTRACT_ID = config.channelContractId ?? "";
export const CHANNEL_AUTH_ID = config.channelAuthId ?? "";
export const CHANNEL_ASSET_ID = config.channelAssetId ?? "";
export const POSTHOG_KEY = config.posthogKey ?? "";
export const POSTHOG_HOST = config.posthogHost ?? "https://us.i.posthog.com";

export function getNetworkPassphrase(): string {
  switch (STELLAR_NETWORK) {
    case "mainnet": return "Public Global Stellar Network ; September 2015";
    case "standalone": return "Standalone Network ; February 2017";
    default: return "Test SDF Network ; September 2015";
  }
}
