/**
 * Stellar/Soroban helpers for Moonlight Pay.
 *
 * Provides lazy-loaded stellar-sdk access and RPC helpers for building,
 * simulating, signing, and submitting Soroban transactions directly to
 * the Stellar network.
 *
 * Follows the same pattern as council-console/src/lib/stellar.ts.
 */
import {
  getNetworkPassphrase,
  getRpcUrl,
  getStellarNetwork,
} from "./config.ts";
import { getToken, StructuredError } from "./api.ts";

// ─── Lazy-loaded SDK types ─────────────────────────────────────
// Keep everything behind dynamic import so the module can be imported
// in non-browser contexts (tests, build) without pulling stellar-sdk.

interface StellarSdkSubset {
  TransactionBuilder: {
    new (
      account: StellarAccount,
      opts: { fee: string; networkPassphrase: string },
    ): TxBuilder;
    fromXDR(xdr: string, networkPassphrase: string): Transaction;
  };
  Contract: new (id: string) => {
    call(fn: string, ...args: unknown[]): unknown;
  };
  Address: new (addr: string) => { toScVal(): unknown };
  nativeToScVal(value: unknown, opts?: { type: string }): unknown;
  rpc: {
    Server: new (
      url: string,
      opts?: { allowHttp?: boolean; headers?: Record<string, string> },
    ) => RpcServer;
    assembleTransaction(
      tx: Transaction,
      sim: SimulationResult,
    ): { build(): Transaction };
  };
}

interface StellarAccount {
  sequenceNumber(): string;
}
interface TxBuilder {
  addOperation(op: unknown): TxBuilder;
  setTimeout(seconds: number): TxBuilder;
  build(): Transaction;
}
interface Transaction {
  toXDR(): string;
}
interface RpcServer {
  getAccount(publicKey: string): Promise<StellarAccount>;
  simulateTransaction(tx: Transaction): Promise<SimulationResult>;
  sendTransaction(tx: Transaction): Promise<{ hash: string }>;
  getTransaction(hash: string): Promise<TxResult>;
}
interface SimulationResult {
  error?: string;
  // Structured simulation-error identity when the SDK provides one. Kept loose
  // because we don't pull in the full SDK types here.
  errorResult?: unknown;
}
interface TxResult {
  status: string;
  // On a non-SUCCESS getTransaction the Soroban RPC surfaces the failed
  // transaction result and diagnostic events (as XDR / decoded objects). We
  // read them best-effort so a failure carries its real on-chain identity
  // instead of being flattened to the bare status string.
  errorResult?: unknown;
  resultXdr?: unknown;
  diagnosticEventsXdr?: unknown;
}

/**
 * Best-effort readable detail from an unknown SDK error field. Returns a string
 * only when one is actually recoverable; never fabricates a code. Callers pair
 * this with a regex to lift a machine code (e.g. "SOROBAN_1010") when present.
 */
function readErrorDetail(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(readErrorDetail).filter((p): p is string => !!p);
    return parts.length ? parts.join("; ") : undefined;
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.message === "string" && o.message) return o.message;
    if (typeof o.code === "string" && o.code) return o.code;
    if (typeof o.code === "number") return String(o.code);
  }
  return undefined;
}

/** Lift a machine code token (e.g. SOROBAN_1010, BND_005) out of a detail string. */
function codeFromDetail(detail: string | undefined): string | undefined {
  return detail?.match(/[A-Z][A-Z0-9]+_\d+/)?.[0];
}

let StellarSdk: StellarSdkSubset | null = null;

async function sdk(): Promise<StellarSdkSubset> {
  if (!StellarSdk) {
    StellarSdk = await import("stellar-sdk") as unknown as StellarSdkSubset;
  }
  return StellarSdk;
}

export async function getRpcServer(): Promise<RpcServer> {
  const s = await sdk();
  const url = getRpcUrl();
  // `url` points at pay-platform's `/api/v1/rpc` passthrough proxy (set via
  // pay config), not the raw RPC. The proxy is JWT-gated, so the SDK Server
  // sends the user JWT on every RPC call; the RPC-Pro token stays server-side
  // and never enters the bundle.
  const token = getToken();
  return new s.rpc.Server(url, {
    allowHttp: url.startsWith("http://"),
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
}

// ─── Deposit ───────────────────────────────────────────────────

/**
 * Build a deposit transaction: SAC transfer from customer to the
 * privacy channel contract.
 *
 * Returns the assembled (simulated) transaction XDR ready for wallet
 * signing.
 */
export async function buildDepositTx(opts: {
  customerWallet: string;
  privacyChannelId: string;
  assetContractId: string;
  amountStroops: bigint;
}): Promise<string> {
  const { customerWallet, privacyChannelId, assetContractId, amountStroops } =
    opts;
  const stellar = await sdk();
  const { TransactionBuilder, Contract, Address, nativeToScVal } = stellar;
  const server = await getRpcServer();
  const networkPassphrase = getNetworkPassphrase();

  const account = await server.getAccount(customerWallet);
  const contract = new Contract(assetContractId);

  const tx = new TransactionBuilder(account, {
    fee: "10000000",
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        "transfer",
        new Address(customerWallet).toScVal(),
        new Address(privacyChannelId).toScVal(),
        nativeToScVal(amountStroops, { type: "i128" }),
      ),
    )
    .setTimeout(300)
    .build();

  const sim = await server.simulateTransaction(tx);
  if ("error" in sim && sim.error) {
    const detail = sim.error ?? readErrorDetail(sim.errorResult);
    throw new StructuredError(
      `Deposit simulation failed: ${sim.error}`,
      codeFromDetail(detail),
    );
  }
  const { assembleTransaction } = stellar.rpc;
  const prepared = assembleTransaction(tx, sim).build();
  return prepared.toXDR();
}

// ─── Submit ────────────────────────────────────────────────────

/**
 * Submit a signed transaction XDR to the Stellar network and wait
 * for confirmation.
 */
export async function submitTx(
  signedXdr: string,
): Promise<{ status: string }> {
  const stellar = await sdk();
  const { TransactionBuilder } = stellar;
  const server = await getRpcServer();
  const networkPassphrase = getNetworkPassphrase();

  const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const result = await server.sendTransaction(tx);
  const status = await waitForTx(server, result.hash);

  if (status.status !== "SUCCESS") {
    // Don't flatten to the bare status — preserve whatever on-chain identity
    // the RPC gave us (a machine code if we can lift one, else the real detail).
    const detail = readErrorDetail(status.errorResult) ??
      readErrorDetail(status.resultXdr) ??
      readErrorDetail(status.diagnosticEventsXdr);
    throw new StructuredError(
      detail
        ? `Deposit transaction failed on-chain: ${detail}`
        : `Deposit transaction failed: ${status.status}`,
      codeFromDetail(detail),
    );
  }
  return { status: status.status };
}

async function waitForTx(
  server: RpcServer,
  hash: string,
  timeoutMs = 60000,
): Promise<TxResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await server.getTransaction(hash);
    if (status.status !== "NOT_FOUND") {
      return status;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Transaction ${hash} timed out`);
}

// ─── Horizon ───────────────────────────────────────────────────

function getHorizonUrl(): string {
  const rpcUrl = getRpcUrl();
  // Standalone: RPC is http://host:port/soroban/rpc, Horizon is http://host:port
  if (rpcUrl.includes("/soroban/rpc")) {
    return rpcUrl.replace("/soroban/rpc", "");
  }
  // Public networks: derive from network name
  switch (getStellarNetwork()) {
    case "mainnet":
      return "https://horizon.stellar.org";
    default:
      return "https://horizon-testnet.stellar.org";
  }
}

/**
 * Check if a Stellar account exists and return its native balance.
 */
export async function getAccountBalance(
  publicKey: string,
): Promise<{ xlm: string; funded: boolean }> {
  try {
    const res = await fetch(`${getHorizonUrl()}/accounts/${publicKey}`);
    if (res.status === 404) return { xlm: "0", funded: false };
    if (!res.ok) return { xlm: "0", funded: false };
    const data = await res.json();
    const native = data.balances?.find(
      (b: { asset_type: string; balance: string }) => b.asset_type === "native",
    );
    return { xlm: native?.balance ?? "0", funded: true };
  } catch {
    return { xlm: "0", funded: false };
  }
}

/**
 * Build a transaction to fund the OpEx account.
 * Uses createAccount if the account doesn't exist yet, or payment if it does.
 * Returns the XDR string for wallet signing.
 */
export async function buildFundOpexTx(
  sourcePublicKey: string,
  destinationPublicKey: string,
  amountXlm: string,
): Promise<string> {
  const stellar = await sdk();
  const server = await getRpcServer();
  const networkPassphrase = getNetworkPassphrase();

  const account = await server.getAccount(sourcePublicKey);
  const { funded } = await getAccountBalance(destinationPublicKey);

  // deno-lint-ignore no-explicit-any
  const { TransactionBuilder, Operation, Asset } = stellar as any;
  const op = funded
    ? Operation.payment({
      destination: destinationPublicKey,
      asset: Asset.native(),
      amount: amountXlm,
    })
    : Operation.createAccount({
      destination: destinationPublicKey,
      startingBalance: amountXlm,
    });

  const tx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  return tx.toXDR();
}

/**
 * Submit a signed transaction via Horizon (for non-Soroban operations).
 */
export async function submitHorizonTx(signedXdr: string): Promise<void> {
  const horizonUrl = getHorizonUrl();
  const res = await fetch(`${horizonUrl}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `tx=${encodeURIComponent(signedXdr)}`,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      err.extras?.result_codes?.operations?.[0] || err.title ||
        `Transaction failed: ${res.status}`,
    );
  }
}
