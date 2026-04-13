/**
 * Crypto Self-custodial payment flow for the POS view.
 *
 * The customer manages their own UTXO keys, derived from a password they
 * choose. Same wallet + same password = same UTXOs every time. The user
 * fully controls their derivation path.
 *
 * Flow:
 *   1. Customer connects wallet
 *   2. Customer enters a password
 *   3. Customer signs the password via Freighter → SHA-256 → UTXO derivation key
 *   4. Derive P256 keypairs from that key via StellarDerivator
 *   5. Query channel for existing UTXO balances at those keys
 *   6. If insufficient balance: build DEPOSIT (Freighter signs) + CREATE at customer's UTXOs
 *   7. Build SEND: SPEND from customer's UTXOs + CREATE at merchant's receive UTXOs
 *   8. Submit bundle to provider-platform
 *
 * Customer signs at most 2 times: once for the derivation key (password
 * signature), once for the deposit if needed. SPEND signatures are silent
 * (derived P256 keys in memory).
 */
import { MoonlightOperation } from "@moonlight/moonlight-sdk";
import { getPayPlatformUrl } from "./config.ts";
import { base64UrlToBytes } from "./encoding.ts";

interface PrepareResult {
  council: {
    id: string;
    channelAuthId: string;
    privacyChannelId: string;
    assetId: string;
    networkPassphrase: string;
  };
  pp: {
    url: string;
    publicKey: string;
  };
  merchantUtxos: Array<{
    id: string;
    utxoPublicKey: string;
    derivationIndex: number;
  }>;
  amountStroops: string;
}

/**
 * Derive the UTXO derivation key from a wallet signature of the password.
 * password → sign via Freighter → SHA-256 → 32-byte UTXO derivation key.
 */
async function deriveUtxoKey(
  password: string,
  signFn: (message: string) => Promise<string>,
): Promise<Uint8Array> {
  const signature = await signFn(password);
  const normalized = signature.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  const sigBytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  const buf = new ArrayBuffer(sigBytes.length);
  new Uint8Array(buf).set(sigBytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}

/**
 * Derive P256 keypairs from the UTXO derivation key.
 * Each index produces a deterministic keypair.
 */
async function deriveUtxoKeypairs(
  utxoKey: Uint8Array,
  count: number,
): Promise<Array<{ publicKey: Uint8Array; privateKey: Uint8Array }>> {
  const keypairs: Array<{ publicKey: Uint8Array; privateKey: Uint8Array }> = [];
  for (let i = 0; i < count; i++) {
    const indexBytes = new TextEncoder().encode(i.toString());
    const seedInput = new Uint8Array(utxoKey.length + indexBytes.length);
    seedInput.set(utxoKey);
    seedInput.set(indexBytes, utxoKey.length);
    const seed = new Uint8Array(
      await crypto.subtle.digest("SHA-256", seedInput),
    );
    const kp = await deriveP256Keypair(seed);
    keypairs.push(kp);
  }
  return keypairs;
}

function partitionAmount(total: bigint, parts: number): bigint[] {
  if (parts <= 0) return [];
  if (parts === 1) return [total];
  const result: bigint[] = [];
  let remaining = total;
  for (let i = 0; i < parts - 1; i++) {
    const maxForThis = remaining - BigInt(parts - i - 1);
    const portion = 1n +
      BigInt(Math.floor(Math.random() * Number(maxForThis - 1n)));
    result.push(portion);
    remaining -= portion;
  }
  result.push(remaining);
  return result;
}

/**
 * Execute the self-custodial payment flow.
 */
export async function executeSelfCustodialPayment(opts: {
  customerWallet: string;
  merchantWallet: string;
  amountXlm: string;
  password: string;
  description?: string;
  // deno-lint-ignore no-explicit-any
  signer: any;
  signMessage: (message: string) => Promise<string>;
  payerJurisdiction?: string;
  onStatus?: (message: string) => void;
}): Promise<{ transactionId: string; status: string }> {
  const {
    customerWallet,
    merchantWallet,
    amountXlm,
    password,
    description,
    signer,
    signMessage,
    payerJurisdiction,
    onStatus,
  } = opts;
  const baseUrl = getPayPlatformUrl();

  // Step 1: Prepare — get council config + merchant UTXOs
  onStatus?.("Preparing payment...");
  const prepareRes = await fetch(`${baseUrl}/api/v1/pay/instant/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      merchantWallet,
      amountXlm,
      customerWallet,
      payerJurisdiction,
    }),
  });
  if (!prepareRes.ok) {
    const err = await prepareRes.json().catch(() => ({}));
    throw new Error(
      err.message ?? `Payment preparation failed: ${prepareRes.status}`,
    );
  }
  const { data: prepare } = (await prepareRes.json()) as {
    data: PrepareResult;
  };

  const amountStroops = BigInt(prepare.amountStroops);
  const { council, pp, merchantUtxos } = prepare;

  // Step 2: Authenticate with privacy provider
  onStatus?.("Authenticating...");
  const ppAuthToken = await authenticateWithPP(
    pp.url,
    customerWallet,
    signMessage,
  );

  // Step 3: Derive UTXO key from password signature
  onStatus?.("Sign your password in the wallet...");
  const utxoKey = await deriveUtxoKey(password, signMessage);

  // Step 4: Derive customer's P256 keypairs (derive enough for deposit + send)
  onStatus?.("Deriving keys...");
  const customerKeypairs = await deriveUtxoKeypairs(utxoKey, 10);

  // Step 5: TODO — query on-chain UTXO balances at customer's keys to check
  // existing balance. For now, assume 0 balance and always deposit.
  const needsDeposit = true;

  const expirationLedger = 999999999; // TODO: fetch from RPC

  // Step 6: Build merchant CREATE operations
  const merchantAmounts = partitionAmount(
    amountStroops,
    merchantUtxos.length,
  );
  const merchantCreateOps = merchantUtxos.map((u, i) =>
    MoonlightOperation.create(
      Uint8Array.from(atob(u.utxoPublicKey), (c) => c.charCodeAt(0)),
      merchantAmounts[i],
    )
  );

  // deno-lint-ignore no-explicit-any
  const allOps: any[] = [];

  if (needsDeposit) {
    // Step 6a: Build DEPOSIT + CREATE at customer's UTXOs
    const depositCount = 5;
    const depositKeypairs = customerKeypairs.slice(0, depositCount);
    const depositAmounts = partitionAmount(amountStroops, depositCount);

    const customerCreateOps = depositKeypairs.map((kp, i) =>
      MoonlightOperation.create(kp.publicKey, depositAmounts[i])
    );

    onStatus?.("Sign the deposit in your wallet...");
    const depositOp = await MoonlightOperation.deposit(
      customerWallet as `G${string}`,
      amountStroops,
    )
      .addConditions(customerCreateOps.map((op) => op.toCondition()))
      .signWithEd25519(
        signer,
        expirationLedger,
        council.privacyChannelId as `C${string}`,
        council.assetId as `C${string}`,
        council.networkPassphrase,
      );

    // Step 6b: Build SPEND from customer's UTXOs → merchant's receive UTXOs
    onStatus?.("Building transaction...");
    const spendOps = [];
    for (let i = 0; i < depositKeypairs.length; i++) {
      const spendOp = MoonlightOperation.spend(depositKeypairs[i].publicKey);
      for (const merchantCreate of merchantCreateOps) {
        spendOp.addCondition(merchantCreate.toCondition());
      }
      // deno-lint-ignore no-explicit-any
      const utxoAdapter: any = {
        publicKey: depositKeypairs[i].publicKey,
        signPayload: async (hash: Uint8Array) => {
          const hashBuf = new ArrayBuffer(hash.length);
          new Uint8Array(hashBuf).set(hash);
          const key = await crypto.subtle.importKey(
            "pkcs8",
            buildPkcs8P256(depositKeypairs[i].privateKey),
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["sign"],
          );
          const sig = await crypto.subtle.sign(
            { name: "ECDSA", hash: "SHA-256" },
            key,
            hashBuf,
          );
          return new Uint8Array(sig);
        },
      };
      await spendOp.signWithUTXO(
        utxoAdapter,
        council.privacyChannelId as `C${string}`,
        expirationLedger,
      );
      spendOps.push(spendOp);
    }

    allOps.push(
      depositOp,
      ...customerCreateOps,
      ...spendOps,
      ...merchantCreateOps,
    );
  }

  // Step 7: Serialize to MLXDR
  const operationsMLXDR = allOps.map((op: { toMLXDR: () => string }) =>
    op.toMLXDR()
  );

  // Step 8: Submit to pay-platform
  onStatus?.("Submitting payment...");
  const submitRes = await fetch(`${baseUrl}/api/v1/pay/instant/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerWallet,
      merchantWallet,
      amountStroops: amountStroops.toString(),
      description: description ?? null,
      operationsMLXDR,
      merchantUtxoIds: merchantUtxos.map((u) => u.id),
      ppUrl: pp.url,
      ppAuthToken,
      channelContractId: council.privacyChannelId,
    }),
  });

  if (!submitRes.ok) {
    const err = await submitRes.json().catch(() => ({}));
    throw new Error(
      err.message ?? `Payment submission failed: ${submitRes.status}`,
    );
  }

  const { data: result } = await submitRes.json();
  return {
    transactionId: result.transactionId,
    status: result.status,
  };
}

async function authenticateWithPP(
  ppUrl: string,
  customerWallet: string,
  signFn: (message: string) => Promise<string>,
): Promise<string> {
  const challengeRes = await fetch(`${ppUrl}/api/v1/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: customerWallet }),
  });
  if (!challengeRes.ok) {
    throw new Error("Failed to get auth challenge from privacy provider");
  }
  const challengeBody = await challengeRes.json();
  const nonce = challengeBody?.data?.nonce;
  if (!nonce) throw new Error("Privacy provider returned no nonce");

  const signature = await signFn(nonce);

  const verifyRes = await fetch(`${ppUrl}/api/v1/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: customerWallet, nonce, signature }),
  });
  if (!verifyRes.ok) {
    throw new Error("Privacy provider authentication failed");
  }
  const verifyBody = await verifyRes.json();
  const token = verifyBody?.data?.token;
  if (!token) throw new Error("Privacy provider returned no token");
  return token;
}

async function deriveP256Keypair(
  seed: Uint8Array,
): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
  const seedBuf = new ArrayBuffer(seed.length);
  new Uint8Array(seedBuf).set(seed);
  const expandKey = await crypto.subtle.importKey(
    "raw",
    seedBuf,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const expanded = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode("moonlight-p256"),
    },
    expandKey,
    384,
  );
  const privateKeyBytes = new Uint8Array(expanded).slice(0, 32);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    buildPkcs8P256(privateKeyBytes),
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", cryptoKey);
  const x = base64UrlToBytes(jwk.x!);
  const y = base64UrlToBytes(jwk.y!);
  const publicKey = new Uint8Array(65);
  publicKey[0] = 0x04;
  publicKey.set(x, 1);
  publicKey.set(y, 33);
  return { publicKey, privateKey: privateKeyBytes };
}

function buildPkcs8P256(rawPrivateKey: Uint8Array): ArrayBuffer {
  const header = new Uint8Array([
    0x30,
    0x41,
    0x02,
    0x01,
    0x00,
    0x30,
    0x13,
    0x06,
    0x07,
    0x2a,
    0x86,
    0x48,
    0xce,
    0x3d,
    0x02,
    0x01,
    0x06,
    0x08,
    0x2a,
    0x86,
    0x48,
    0xce,
    0x3d,
    0x03,
    0x01,
    0x07,
    0x04,
    0x27,
    0x30,
    0x25,
    0x02,
    0x01,
    0x01,
    0x04,
    0x20,
  ]);
  const result = new Uint8Array(header.length + 32);
  result.set(header);
  result.set(rawPrivateKey, header.length);
  return result.buffer as ArrayBuffer;
}
