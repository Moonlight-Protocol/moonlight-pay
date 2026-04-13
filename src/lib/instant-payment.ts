/**
 * Crypto Instant payment flow for the POS view.
 *
 * Orchestrates the entire payment from customer to merchant:
 *   1. Prepare: call pay-platform to get council config + merchant UTXOs
 *   2. Build: construct the MLXDR bundle (DEPOSIT + temp CREATE + SPEND + merchant CREATE)
 *   3. Sign: customer signs DEPOSIT via Freighter, temp P256 keys sign SPEND
 *   4. Submit: send the bundle to pay-platform (pay-platform handles provider auth)
 *
 * The customer sees one wallet prompt (the deposit authorization).
 * Pay-platform handles provider-platform authentication server-side.
 */
import { MoonlightOperation } from "@moonlight/moonlight-sdk";
import { getPayPlatformUrl } from "./config.ts";
import { deriveP256KeyPairFromSeed } from "./utxo-derivation.ts";

interface PrepareResult {
  council: {
    id: string;
    channelAuthId: string;
    networkPassphrase: string;
  };
  channel: {
    id: string;
    assetCode: string;
    assetContractId: string;
    privacyChannelId: string;
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

export async function executeInstantPayment(opts: {
  customerWallet: string;
  merchantWallet: string;
  amountXlm: string;
  assetCode?: string;
  description?: string;
  // deno-lint-ignore no-explicit-any
  signer: any;
  payerJurisdiction?: string;
  onStatus?: (message: string) => void;
}): Promise<{ transactionId: string; status: string }> {
  const {
    customerWallet,
    merchantWallet,
    amountXlm,
    assetCode,
    description,
    signer,
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
      assetCode,
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
  const { council, channel, merchantUtxos } = prepare;

  // Step 2: Get current ledger for expiration
  // TODO: fetch from RPC or provider-platform. For now use a large offset.
  const expirationLedger = 999999999;

  // Step 3: Generate temporary P256 keypairs for the hop
  onStatus?.("Building transaction...");
  const tempCount = merchantUtxos.length;
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

  // Step 4: Build CREATE operations at merchant's receive UTXOs
  const merchantAmounts = partitionAmount(amountStroops, merchantUtxos.length);
  const merchantCreateOps = merchantUtxos.map((u, i) =>
    MoonlightOperation.create(
      Uint8Array.from(atob(u.utxoPublicKey), (c) => c.charCodeAt(0)),
      merchantAmounts[i],
    )
  );

  // Step 5: Build CREATE operations at temporary keys
  const tempAmounts = partitionAmount(amountStroops, tempCount);
  const tempCreateOps = tempKeypairs.map((kp, i) =>
    MoonlightOperation.create(kp.publicKey, tempAmounts[i])
  );

  // Step 6: Build DEPOSIT operation (customer signs via Freighter)
  onStatus?.("Sign the deposit in your wallet...");
  const depositOp = await MoonlightOperation.deposit(
    customerWallet as `G${string}`,
    amountStroops,
  )
    .addConditions(tempCreateOps.map((op) => op.toCondition()))
    .signWithEd25519(
      signer,
      expirationLedger,
      channel.privacyChannelId as `C${string}`,
      channel.assetContractId as `C${string}`,
      council.networkPassphrase,
    );

  // Step 7: Build SPEND operations from temporary keys → merchant UTXOs
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
      channel.privacyChannelId as `C${string}`,
      expirationLedger,
    );
    spendOps.push(spendOp);
  }

  // Step 8: Assemble all operations as MLXDR
  const operationsMLXDR = [
    depositOp.toMLXDR(),
    ...tempCreateOps.map((op) => op.toMLXDR()),
    ...spendOps.map((op) => op.toMLXDR()),
    ...merchantCreateOps.map((op) => op.toMLXDR()),
  ];

  // Step 9: Submit to pay-platform (pay-platform handles provider auth)
  onStatus?.("Submitting payment...");
  const submitRes = await fetch(`${baseUrl}/api/v1/pay/instant/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerWallet,
      merchantWallet,
      amountStroops: amountStroops.toString(),
      assetCode: channel.assetCode,
      description: description ?? null,
      operationsMLXDR,
      merchantUtxoIds: merchantUtxos.map((u) => u.id),
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

/** Build a minimal PKCS#8 wrapper for a P-256 private key. */
function buildPkcs8P256(rawPrivateKey: Uint8Array): ArrayBuffer {
  const header = new Uint8Array([
    0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48,
    0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03,
    0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20,
  ]);
  const result = new Uint8Array(header.length + 32);
  result.set(header);
  result.set(rawPrivateKey, header.length);
  return result.buffer as ArrayBuffer;
}

export { deriveP256KeyPairFromSeed };
