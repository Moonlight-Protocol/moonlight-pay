/**
 * HTTP client for the provider-platform /api/v1/pay/ endpoints.
 * Used by both self-custodial and custodial apps.
 */

let baseUrl = "http://localhost:3000/api/v1";
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

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });

  if (response.status === 401) {
    authToken = null;
    throw new Error("Unauthorized");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.error || `HTTP ${response.status}`);
  }

  return response.json();
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
}): Promise<{ data: { transactions: unknown[]; total: number } }> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  if (opts?.status) params.set("status", opts.status);
  return request(`/pay/transactions?${params}`);
}

// --- Self-custodial ---

export async function getSelfBalance(): Promise<{ data: { totalBalance: string; utxoCount: number; freeSlots: number } }> {
  return request("/pay/self/balance");
}

export async function selfSend(to: string, amount: string): Promise<{ data: { bundleId: string; status: string } }> {
  return request("/pay/self/send", {
    method: "POST",
    body: JSON.stringify({ to, amount }),
  });
}

// --- Custodial ---

export async function getCustodialAccount(): Promise<{ data: { id: string; depositAddress: string; balance: string; status: string } }> {
  return request("/pay/custodial/account");
}

export async function custodialSend(to: string, amount: string): Promise<{ data: { bundleId: string; status: string } }> {
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

// --- Demo ---

export async function simulateKyc(address: string, jurisdiction: string): Promise<{ data: { status: string } }> {
  return request("/pay/demo/simulate-kyc", {
    method: "POST",
    body: JSON.stringify({ address, jurisdiction }),
  });
}
