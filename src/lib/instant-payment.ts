/**
 * Crypto Instant payment flow for the POS view.
 *
 * The customer sends a standard Stellar payment to the merchant's OpEx
 * address. Pay-platform then verifies the payment and executes the
 * moonlight deposit + MLXDR bundle server-side.
 *
 * The customer sees one wallet prompt (the Stellar payment).
 */
import { getPayPlatformUrl } from "./config.ts";
import { buildFundOpexTx, submitHorizonTx } from "./stellar.ts";

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
  opex: {
    publicKey: string | null;
    feePct: number | null;
  };
  merchantUtxos: Array<{
    id: string;
    utxoPublicKey: string;
    derivationIndex: number;
  }>;
  amountStroops: string;
}

export async function executeInstantPayment(opts: {
  customerWallet: string;
  merchantWallet: string;
  amountXlm: string;
  assetCode?: string;
  description?: string;
  signer: {
    signTransaction: (
      xdr: string,
      opts?: { networkPassphrase?: string },
    ) => Promise<{ signedTxXdr: string }>;
  };
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

  // Step 1: Prepare — get OpEx address, council config, merchant UTXOs
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

  if (!prepare.opex.publicKey) {
    throw new Error("Merchant has not set up instant payments yet");
  }

  // Step 2: Send standard Stellar payment to OpEx address
  onStatus?.("Sign the payment in your wallet...");
  const txXdr = await buildFundOpexTx(
    customerWallet,
    prepare.opex.publicKey,
    amountXlm,
  );
  const { signedTxXdr } = await signer.signTransaction(txXdr, {
    networkPassphrase: prepare.council.networkPassphrase,
  });
  onStatus?.("Submitting payment...");
  await submitHorizonTx(signedTxXdr);

  // Extract the tx hash from the signed XDR for verification
  const { TransactionBuilder } = await import("stellar-sdk");
  // deno-lint-ignore no-explicit-any
  const signedTx = (TransactionBuilder as any).fromXDR(
    signedTxXdr,
    prepare.council.networkPassphrase,
  );
  const txHash = signedTx.hash().toString("hex");

  // Step 3: Tell pay-platform to execute the moonlight send
  onStatus?.("Processing payment...");
  const submitRes = await fetch(`${baseUrl}/api/v1/pay/instant/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerPaymentHash: txHash,
      merchantWallet,
      amountStroops: prepare.amountStroops,
      assetCode: prepare.channel.assetCode,
      description: description ?? null,
      merchantUtxoIds: prepare.merchantUtxos.map((u) => u.id),
    }),
  });

  if (!submitRes.ok) {
    const err = await submitRes.json().catch(() => ({}));
    throw new Error(
      err.message ?? `Payment processing failed: ${submitRes.status}`,
    );
  }

  const { data: result } = await submitRes.json();
  return {
    transactionId: result.transactionId,
    status: result.status,
  };
}
