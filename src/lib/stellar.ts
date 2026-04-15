/**
 * Stellar/Soroban helpers for Moonlight Pay.
 *
 * Provides lazy-loaded stellar-sdk access and RPC helpers for building,
 * simulating, signing, and submitting Soroban transactions directly to
 * the Stellar network.
 *
 * Follows the same pattern as council-console/src/lib/stellar.ts.
 */
import { getNetworkPassphrase, getRpcUrl } from "./config.ts";

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
      opts?: { allowHttp?: boolean },
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
}
interface TxResult {
  status: string;
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
  return new s.rpc.Server(url, { allowHttp: url.startsWith("http://") });
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

  const rpcUrl = getRpcUrl();
  console.log("[deposit] RPC URL:", rpcUrl);
  console.log("[deposit] customerWallet:", customerWallet);
  console.log("[deposit] privacyChannelId:", privacyChannelId);
  console.log("[deposit] assetContractId:", assetContractId);
  console.log("[deposit] amountStroops:", amountStroops.toString());

  const account = await server.getAccount(customerWallet);
  console.log("[deposit] account loaded, seq:", account.sequenceNumber());
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
    throw new Error(`Deposit simulation failed: ${sim.error}`);
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
    throw new Error(`Deposit transaction failed: ${status.status}`);
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
