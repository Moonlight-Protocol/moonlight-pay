/**
 * Crypto Self-custodial payment flow for the POS view.
 *
 * The customer manages their own UTXO keys, derived from a password they
 * choose. Same wallet + same password = same UTXOs every time.
 *
 * Flow:
 *   1. Prepare: call pay-platform to get council config + merchant UTXOs
 *   2. Customer enters a password, signs it via Freighter → UTXO derivation key
 *   3. Derive P256 keypairs from the key
 *   4. Build DEPOSIT + CREATE at customer's UTXOs + SPEND → merchant CREATEs
 *   5. Submit bundle to pay-platform (pay-platform handles provider auth)
 *
 * Customer signs at most 2 times: once for the derivation key (password
 * signature), once for the deposit. SPEND signatures are silent
 * (derived P256 keys in memory).
 */
import { MoonlightOperation } from "@moonlight/moonlight-sdk";
import { getPayPlatformUrl } from "./config.ts";
import { buildDepositTx, submitTx } from "./stellar.ts";

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

export async function executeSelfCustodialPayment(opts: {
  customerWallet: string;
  merchantWallet: string;
  amountXlm: string;
  assetCode?: string;
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
    assetCode,
    password,
    description,
    signer,
    signMessage,
    payerJurisdiction,
    onStatus,
  } = opts;
  const baseUrl = getPayPlatformUrl();

  // Step 1: Prepare
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
    const errBody = await prepareRes.text().catch(() => "");
    console.error(
      `[selfcustodial] prepare failed: ${prepareRes.status} ${prepareRes.statusText}`,
      `\nURL: ${baseUrl}/api/v1/pay/instant/prepare`,
      `\nBody: ${errBody}`,
    );
    const err = (() => { try { return JSON.parse(errBody); } catch { return {}; } })();
    throw new Error(
      err.message ?? `Payment preparation failed: ${prepareRes.status}`,
    );
  }
  const { data: prepare } = (await prepareRes.json()) as {
    data: PrepareResult;
  };

  const amountStroops = BigInt(prepare.amountStroops);
  const { council, channel, merchantUtxos } = prepare;

  // Step 2: Derive UTXO key from password signature
  onStatus?.("Sign your password in the wallet...");
  const utxoKey = await deriveUtxoKey(password, signMessage);

  // Step 3: Derive customer's P256 keypairs
  onStatus?.("Deriving keys...");
  const customerKeypairs = await deriveUtxoKeypairs(utxoKey, 10);

  const needsDeposit = true; // TODO: query on-chain balance
  const expirationLedger = 999999999; // TODO: fetch from RPC

  // Step 4: Build merchant CREATE operations
  const merchantAmounts = partitionAmount(amountStroops, merchantUtxos.length);
  const merchantCreateOps = merchantUtxos.map((u, i) =>
    MoonlightOperation.create(
      Uint8Array.from(atob(u.utxoPublicKey), (c) => c.charCodeAt(0)),
      merchantAmounts[i],
    )
  );

  // deno-lint-ignore no-explicit-any
  const allOps: any[] = [];

  console.log("[selfcustodial] prepare ok:", JSON.stringify({ council, channel, merchantUtxos: merchantUtxos.length, amountStroops: amountStroops.toString() }));

  if (needsDeposit) {
    // Step 4a: Deposit — SAC transfer from customer to privacy channel
    onStatus?.("Sign the deposit in your wallet...");
    console.log("[selfcustodial] building deposit tx...");
    const depositXdr = await buildDepositTx({
      customerWallet,
      privacyChannelId: channel.privacyChannelId,
      assetContractId: channel.assetContractId,
      amountStroops,
    });
    const { signedTxXdr } = await signer.signTransaction(depositXdr, {
      networkPassphrase: council.networkPassphrase,
    });
    onStatus?.("Submitting deposit...");
    console.log("[selfcustodial] submitting deposit to RPC...");
    await submitTx(signedTxXdr);
    console.log("[selfcustodial] deposit confirmed on-chain");

    // Step 4b: Build MLXDR operations for the privacy channel
    onStatus?.("Building transaction...");
    const depositCount = 5;
    const depositKeypairs = customerKeypairs.slice(0, depositCount);
    const depositAmounts = partitionAmount(amountStroops, depositCount);

    const customerCreateOps = depositKeypairs.map((kp, i) =>
      MoonlightOperation.create(kp.publicKey, depositAmounts[i])
    );

    const depositOp = MoonlightOperation.deposit(
      customerWallet as `G${string}`,
      amountStroops,
    )
      .addConditions(customerCreateOps.map((op) => op.toCondition()));

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
        channel.privacyChannelId as `C${string}`,
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

  // Step 5: Serialize and submit to pay-platform
  const operationsMLXDR = allOps.map((op: { toMLXDR: () => string }) =>
    op.toMLXDR()
  );

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
    const submitErrBody = await submitRes.text().catch(() => "");
    console.error(
      `[selfcustodial] submit failed: ${submitRes.status} ${submitRes.statusText}`,
      `\nURL: ${baseUrl}/api/v1/pay/instant/submit`,
      `\nBody: ${submitErrBody}`,
    );
    const err = (() => { try { return JSON.parse(submitErrBody); } catch { return {}; } })();
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

  const { p256 } = await import("@noble/curves/p256");
  const publicKey = p256.ProjectivePoint.fromPrivateKey(privateKeyBytes)
    .toRawBytes(false);

  return { publicKey: new Uint8Array(publicKey), privateKey: privateKeyBytes };
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
