/**
 * Crypto Instant payment flow for the POS view.
 *
 * Orchestrates the entire payment from customer to merchant:
 *   1. Prepare: call pay-platform to get council config + merchant UTXOs
 *   2. Auth: authenticate with the privacy provider (challenge-response)
 *   3. Build: construct the MLXDR bundle (DEPOSIT + temp CREATE + SPEND + merchant CREATE)
 *   4. Sign: customer signs DEPOSIT via Freighter, temp P256 keys sign SPEND
 *   5. Submit: send the complete bundle to pay-platform for forwarding to provider-platform
 *
 * The customer sees one wallet prompt (the deposit authorization).
 * Everything else is handled by this module + pay-platform.
 */
import { MoonlightOperation } from "@moonlight/moonlight-sdk";
import { getPayPlatformUrl } from "./config.ts";
import { deriveP256KeyPairFromSeed } from "./utxo-derivation.ts";

// The SDK uses branded string types from @colibri/core (Ed25519PublicKey = `G${string}`,
// ContractId = `C${string}`). We cast runtime strings to these types at the call sites.

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
 * Distribute an amount randomly across N parts (for privacy).
 * Each part gets at least 1 stroop.
 */
function partitionAmount(total: bigint, parts: number): bigint[] {
  if (parts <= 0) return [];
  if (parts === 1) return [total];
  const result: bigint[] = [];
  let remaining = total;
  for (let i = 0; i < parts - 1; i++) {
    const maxForThis = remaining - BigInt(parts - i - 1);
    const portion = 1n + BigInt(
      Math.floor(Math.random() * Number(maxForThis - 1n)),
    );
    result.push(portion);
    remaining -= portion;
  }
  result.push(remaining);
  return result;
}

/**
 * Execute the full instant payment flow.
 */
export async function executeInstantPayment(opts: {
  customerWallet: string;
  merchantWallet: string;
  amountXlm: string;
  description?: string;
  /** Signer-compatible object for the customer's wallet (from createWalletSigner). */
  // deno-lint-ignore no-explicit-any
  signer: any;
  /** signMessage for privacy provider auth */
  signMessage: (message: string) => Promise<string>;
  payerJurisdiction?: string;
  onStatus?: (message: string) => void;
}): Promise<{ transactionId: string; status: string }> {
  const {
    customerWallet,
    merchantWallet,
    amountXlm,
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

  // Step 2: Authenticate with the privacy provider
  onStatus?.("Authenticating...");
  const ppAuthToken = await authenticateWithPP(
    pp.url,
    customerWallet,
    signMessage,
  );

  // Step 3: Get current ledger for expiration
  // TODO: fetch from RPC or provider-platform. For now use a large offset.
  const expirationLedger = 999999999;

  // Step 4: Generate temporary P256 keypairs for the hop
  onStatus?.("Building transaction...");
  const tempCount = merchantUtxos.length; // same count as merchant UTXOs
  const tempKeypairs: Array<{
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  }> = [];
  for (let i = 0; i < tempCount; i++) {
    const seed = new Uint8Array(32);
    crypto.getRandomValues(seed);
    const kp = await deriveP256KeyPairFromSeed(seed);
    tempKeypairs.push(kp);
  }

  // Step 5: Build CREATE operations at merchant's receive UTXOs
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

  // Step 6: Build CREATE operations at temporary keys
  const tempAmounts = partitionAmount(amountStroops, tempCount);
  const tempCreateOps = tempKeypairs.map((kp, i) =>
    MoonlightOperation.create(kp.publicKey, tempAmounts[i])
  );

  // Step 7: Build DEPOSIT operation (customer signs via Freighter)
  // Conditions: the temporary CREATE operations
  onStatus?.("Sign the deposit in your wallet...");
  const depositOp = await MoonlightOperation.deposit(
    customerWallet as `G${string}`,
    amountStroops,
  )
    .addConditions(tempCreateOps.map((op) => op.toCondition()))
    .signWithEd25519(
      signer,
      expirationLedger,
      council.privacyChannelId as `C${string}`,
      council.assetId as `C${string}`,
      council.networkPassphrase,
    );

  // Step 8: Build SPEND operations from temporary keys → merchant UTXOs
  // Each SPEND is conditioned on ALL merchant CREATE operations
  const spendOps = [];
  for (let i = 0; i < tempKeypairs.length; i++) {
    const spendOp = MoonlightOperation.spend(tempKeypairs[i].publicKey);
    for (const merchantCreate of merchantCreateOps) {
      spendOp.addCondition(merchantCreate.toCondition());
    }
    // deno-lint-ignore no-explicit-any
    const utxoKeypairAdapter: any = {
      publicKey: tempKeypairs[i].publicKey,
      signPayload: async (hash: Uint8Array) => {
        const hashBuf = new ArrayBuffer(hash.length);
        new Uint8Array(hashBuf).set(hash);
        const key = await crypto.subtle.importKey(
          "pkcs8",
          buildPkcs8P256(tempKeypairs[i].privateKey),
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
      utxoKeypairAdapter,
      council.privacyChannelId as `C${string}`,
      expirationLedger,
    );
    spendOps.push(spendOp);
  }

  // Step 9: Assemble all operations as MLXDR
  const operationsMLXDR = [
    depositOp.toMLXDR(),
    ...tempCreateOps.map((op) => op.toMLXDR()),
    ...spendOps.map((op) => op.toMLXDR()),
    ...merchantCreateOps.map((op) => op.toMLXDR()),
  ];

  // Step 10: Submit to pay-platform
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

/**
 * Authenticate with a privacy provider using challenge-response.
 */
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

/** Build a minimal PKCS#8 wrapper for a P-256 private key. */
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

// Re-export deriveP256KeyPairFromSeed for the temp key generation
export { deriveP256KeyPairFromSeed };
