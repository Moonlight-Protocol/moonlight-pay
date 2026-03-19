/**
 * Shared types for moonlight-pay apps.
 */

/** Transaction as returned by the provider-platform API. */
export interface Transaction {
  id: string;
  type: "deposit" | "withdraw" | "send" | "receive";
  status: "pending" | "completed" | "failed" | "expired";
  amount: string; // stroops
  assetCode: string;
  from?: string;
  to?: string;
  jurisdiction?: { from?: string; to?: string };
  createdAt: string;
  updatedAt: string;
}

/** KYC status for an address. */
export interface KycStatus {
  address: string;
  status: "none" | "pending" | "verified";
  jurisdiction?: string;
  verifiedAt?: string;
}

/** Custodial account info. */
export interface CustodialAccount {
  id: string;
  depositAddress: string;
  balance: string; // stroops
  status: "active" | "suspended";
  createdAt: string;
}

/** Self-custodial UTXO summary. */
export interface UtxoSummary {
  totalBalance: string; // stroops
  utxoCount: number;
  freeSlots: number;
}

/** Escrow record — funds held for an unverified address. */
export interface EscrowRecord {
  id: string;
  heldForAddress: string;
  amount: string;
  status: "held" | "claimed" | "expired";
  createdAt: string;
}

/** Send request (both apps use this shape). */
export interface SendRequest {
  to: string; // Stellar address
  amount: string; // stroops
}

/** Send result. */
export interface SendResult {
  bundleId: string;
  status: "pending" | "completed" | "failed";
}
