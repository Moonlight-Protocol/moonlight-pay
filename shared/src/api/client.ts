/**
 * HTTP client for the provider-platform /api/v1/pay/ endpoints.
 * Used by both self-custodial and custodial apps.
 */

import type { Transaction } from "../types/index.ts";

/** Default request timeout in milliseconds. */
const REQUEST_TIMEOUT_MS = 30_000;

let baseUrl = "http://localhost:8000/api/v1";
let authToken: string | null = null;

export function configure(opts: { baseUrl: string }): void {
  baseUrl = opts.baseUrl.replace(/\/+$/, "");
}

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...options?.headers },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401) {
    authToken = null;
    window.location.hash = "#/login";
    throw new Error("Unauthorized");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.error || `HTTP ${response.status}`);
  }

  try {
    return await response.json() as T;
  } catch {
    throw new Error(`Invalid JSON in response from ${path}`);
  }
}

// --- KYC (shared) ---

export async function getKycStatus(address: string): Promise<{ data: { status: string; jurisdiction?: string } }> {
  return request(`/pay/kyc/${encodeURIComponent(address)}`);
}

export async function submitKyc(address: string, jurisdiction: string): Promise<{ data: { status: string } }> {
  return request("/pay/kyc", {
    method: "POST",
    body: JSON.stringify({ address, jurisdiction }),
  });
}

// --- Transactions (shared) ---

export async function listTransactions(opts?: {
  limit?: number;
  offset?: number;
  status?: string;
}): Promise<{ data: { transactions: Transaction[]; total: number } }> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  if (opts?.status) params.set("status", opts.status);
  return request(`/pay/transactions?${params}`);
}

// --- Self-custodial ---

export async function getSelfBalance(publicKeys: string[]): Promise<{ data: { totalBalance: string; utxoCount: number; freeSlots: number; utxos: Array<{ publicKey: string; balance: string }> } }> {
  return request("/pay/self/balance", {
    method: "POST",
    body: JSON.stringify({ publicKeys }),
  });
}

export async function selfSend(to: string, amount: string): Promise<{ data: { bundleId: string; status: string; escrowId?: string } }> {
  return request("/pay/self/send", {
    method: "POST",
    body: JSON.stringify({ to, amount }),
  });
}

// --- Custodial ---

export async function getCustodialAccount(): Promise<{ data: { id: string; depositAddress: string; balance: string; status: string } }> {
  return request("/pay/custodial/account");
}

export async function custodialSend(to: string, amount: string): Promise<{ data: { bundleId: string; status: string; escrowId?: string } }> {
  return request("/pay/custodial/send", {
    method: "POST",
    body: JSON.stringify({ to, amount }),
  });
}

export async function custodialLogin(username: string, password: string): Promise<{ data: { token: string } }> {
  return request("/pay/custodial/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function custodialRegister(username: string, password: string): Promise<{ data: { token: string; depositAddress: string } }> {
  return request("/pay/custodial/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

// --- Escrow ---

export async function getEscrowSummary(address: string): Promise<{ data: { count: number; totalAmount: string } }> {
  return request(`/pay/escrow/${encodeURIComponent(address)}`);
}

// --- Error reporting ---

export async function submitReport(report: { description: string; steps?: string; debug?: unknown }): Promise<{ data: { id: string } }> {
  return request("/pay/report", {
    method: "POST",
    body: JSON.stringify(report),
  });
}

// --- Bundle ---

export async function submitBundle(operationsMLXDR: string[]): Promise<{ data: { operationsBundleId: string } }> {
  return request("/bundle", {
    method: "POST",
    body: JSON.stringify({ operationsMLXDR }),
  });
}

export async function getBundleStatus(bundleId: string): Promise<{ data: { status: string } }> {
  return request(`/bundle/${encodeURIComponent(bundleId)}`);
}

// --- Demo ---

export async function demoDeposit(publicKey: string, amount: string): Promise<{ data: { bundleId: string; status: string } }> {
  return request("/pay/demo/deposit", {
    method: "POST",
    body: JSON.stringify({ publicKey, amount }),
  });
}

export async function simulateKyc(address: string, jurisdiction: string): Promise<{ data: { status: string } }> {
  return request("/pay/demo/simulate-kyc", {
    method: "POST",
    body: JSON.stringify({ address, jurisdiction }),
  });
}
