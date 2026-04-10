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
import { getPayPlatformUrl } from "./config.ts";

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
 * Execute the full instant payment flow.
 *
 * @param customerWallet — the customer's Stellar G-address
 * @param merchantWallet — the merchant's Stellar G-address
 * @param amountXlm — payment amount as a decimal string
 * @param description — optional POS description
 * @param signDeposit — callback that signs the deposit auth entry via the customer's wallet.
 *                      Receives the raw auth entry XDR (base64) and returns the signed entry XDR.
 * @param payerJurisdiction — optional jurisdiction code for council routing check
 * @param onStatus — optional status callback for UI updates
 */
export async function executeInstantPayment(opts: {
  customerWallet: string;
  merchantWallet: string;
  amountXlm: string;
  description?: string;
  signDeposit: (
    authEntryXdr: string,
    networkPassphrase: string,
  ) => Promise<string>;
  payerJurisdiction?: string;
  onStatus?: (message: string) => void;
}): Promise<{ transactionId: string; status: string }> {
  const {
    customerWallet,
    merchantWallet,
    amountXlm,
    description: _description,
    signDeposit,
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

  // Step 2: Authenticate with the privacy provider
  onStatus?.("Authenticating with privacy provider...");
  const _ppAuthToken = await authenticateWithPP(
    prepare.pp.url,
    customerWallet,
    signDeposit,
    prepare.council.networkPassphrase,
  );

  // Step 3 + 4: Build and sign the bundle
  // This is where the SDK would build DEPOSIT + CREATE + SPEND + CREATE
  // operations and serialize to MLXDR. For now, this is a placeholder
  // that will be wired to the moonlight-sdk once the full operation
  // building is implemented.
  onStatus?.("Building transaction...");

  // TODO: Import moonlight-sdk and build:
  // - DEPOSIT (customer signs via signDeposit callback)
  // - CREATE at temporary P256 keys
  // - SPEND from temporary keys (signed with temp private keys)
  // - CREATE at merchant's receive UTXO public keys
  //
  // For now, throw to indicate this step needs the SDK integration.
  throw new Error(
    "SDK bundle building not yet implemented — " +
      "requires moonlight-sdk MoonlightOperation integration in the browser bundle",
  );

  // Step 5: Submit to pay-platform
  // onStatus?.("Submitting payment...");
  // const submitRes = await fetch(`${baseUrl}/api/v1/pay/instant/submit`, { ... });
  // return { transactionId, status: "COMPLETED" };
}

/**
 * Authenticate with a privacy provider using challenge-response.
 * Returns a JWT token for submitting bundles.
 */
async function authenticateWithPP(
  ppUrl: string,
  customerWallet: string,
  signFn: (message: string, networkPassphrase: string) => Promise<string>,
  networkPassphrase: string,
): Promise<string> {
  // Request challenge
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

  // Sign the challenge
  const signature = await signFn(nonce, networkPassphrase);

  // Verify
  const verifyRes = await fetch(`${ppUrl}/api/v1/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: customerWallet,
      nonce,
      signature,
    }),
  });
  if (!verifyRes.ok) {
    throw new Error("Privacy provider authentication failed");
  }
  const verifyBody = await verifyRes.json();
  const token = verifyBody?.data?.token;
  if (!token) throw new Error("Privacy provider returned no token");

  return token;
}
