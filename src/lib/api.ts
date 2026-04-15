/**
 * API client for the pay-platform backend.
 *
 * Handles wallet challenge-response auth and account CRUD calls. The JWT is
 * persisted in localStorage so the user stays signed in across page refreshes.
 *
 * Storage reads are lazy so this module can be imported in non-browser
 * contexts (tests, build) without crashing. Wallet operations are passed
 * into authenticate() as a dependency rather than imported, so this file
 * has no compile-time dependency on the wallets-kit (which pulls in DOM
 * components and wouldn't load under Deno test).
 */
import { getPayPlatformUrl } from "./config.ts";

const TOKEN_KEY = "moonlight_pay_jwt";

/**
 * Thrown by the API client when the platform rejects the bearer token.
 * Views catch this to redirect to login — the API layer never navigates.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired");
    this.name = "SessionExpiredError";
  }
}

/**
 * Thrown when the platform's response body doesn't match the expected
 * shape — e.g. an upstream proxy injects an HTML error page, or the
 * platform's contract changes without the client being updated.
 */
export class InvalidResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidResponseError";
  }
}

let cachedToken: string | null | undefined = undefined;
// Hold a reference to the installed listener so __resetApiForTests can
// removeEventListener it. Without this, repeated install/reset cycles
// would attach duplicate listeners.
let storageListener: ((event: StorageEvent) => void) | null = null;

/**
 * Resolve `localStorage` lazily via globalThis so unit tests can install a
 * mock on `globalThis.localStorage` after this module has been imported.
 * Returns undefined when no storage is available (Deno without --location,
 * SSR, sandboxed contexts).
 */
function getLocalStorage(): Storage | undefined {
  // deno-lint-ignore no-explicit-any
  return (globalThis as any).localStorage;
}

/**
 * Cross-tab token sync: when another tab clears the JWT (logout, manual
 * removal, expired-session redirect), our cached copy becomes stale. The
 * `storage` event fires on every other same-origin tab/window when
 * localStorage is mutated. We invalidate our cache on TOKEN_KEY change so
 * the next API call re-reads from storage and either picks up the new
 * value or finds it gone.
 */
function ensureStorageListener(): void {
  if (storageListener) return;
  // deno-lint-ignore no-explicit-any
  const w = (globalThis as any).window;
  if (!w || typeof w.addEventListener !== "function") return;
  storageListener = (event: StorageEvent) => {
    if (event.key === null || event.key === TOKEN_KEY) {
      cachedToken = undefined;
    }
  };
  w.addEventListener("storage", storageListener);
}

function getToken(): string | null {
  ensureStorageListener();
  if (cachedToken === undefined) {
    const storage = getLocalStorage();
    cachedToken = storage ? storage.getItem(TOKEN_KEY) : null;
  }
  return cachedToken;
}

function setToken(token: string): void {
  cachedToken = token;
  const storage = getLocalStorage();
  if (storage) storage.setItem(TOKEN_KEY, token);
}

export function isPlatformAuthed(): boolean {
  return !!getToken();
}

export function clearPlatformAuth(): void {
  cachedToken = null;
  const storage = getLocalStorage();
  if (storage) storage.removeItem(TOKEN_KEY);
}

/** Test hook — resets the in-memory cache so the next read re-checks storage. */
export function __resetApiForTests(): void {
  cachedToken = undefined;
  if (storageListener) {
    // deno-lint-ignore no-explicit-any
    const w = (globalThis as any).window;
    if (w && typeof w.removeEventListener === "function") {
      w.removeEventListener("storage", storageListener);
    }
    storageListener = null;
  }
}

/**
 * Wallet-side dependencies needed by the challenge-response auth flow.
 * The view layer wires these up from the wallet module so api.ts has no
 * compile-time link to the wallets-kit.
 */
export interface WalletAuthDeps {
  publicKey: string;
  sign: (message: string) => Promise<string>;
}

/** Parse a JSON body, returning a sentinel on failure rather than throwing. */
async function parseJsonBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Unwrap the platform's `{ data: T }` envelope. Throws InvalidResponseError
 * if the body isn't an object or is missing the `data` field — better than
 * a confusing TypeError when the platform returns an HTML error page from
 * an upstream proxy.
 */
function unwrapData<T>(body: unknown, where: string): T {
  if (!isObject(body) || !("data" in body)) {
    throw new InvalidResponseError(
      `${where}: response body did not contain a 'data' field`,
    );
  }
  return body.data as T;
}

/**
 * Throw an Error built from the failed response. Prefers `body.message`
 * (the platform's standard error envelope) over a bare HTTP status. Used
 * by every wrapper so non-401/404 errors don't leak to the user as
 * "Get account failed: 503" when the platform sent a real explanation.
 */
async function throwFromErrorResponse(
  res: Response,
  fallbackPrefix: string,
): Promise<never> {
  const body = await parseJsonBody(res);
  const message = isObject(body) && typeof body.message === "string"
    ? body.message
    : `${fallbackPrefix}: ${res.status}`;
  throw new Error(message);
}

/**
 * Authenticate with pay-platform via wallet challenge-response.
 * The wallet signs the nonce (SEP-43/53), the platform verifies and returns a JWT.
 */
export async function authenticate(deps: WalletAuthDeps): Promise<string> {
  const baseUrl = getPayPlatformUrl();

  // Step 1: request challenge
  const challengeRes = await fetch(`${baseUrl}/api/v1/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: deps.publicKey }),
  });
  if (!challengeRes.ok) {
    throw new Error(`Auth challenge failed: ${challengeRes.status}`);
  }
  const challengeBody = await parseJsonBody(challengeRes);
  const challengeData = unwrapData<{ nonce?: unknown }>(
    challengeBody,
    "POST /auth/challenge",
  );
  if (
    typeof challengeData.nonce !== "string" || challengeData.nonce.length === 0
  ) {
    throw new InvalidResponseError(
      "POST /auth/challenge: response did not include a nonce",
    );
  }
  const nonce = challengeData.nonce;

  // Step 2: sign with wallet
  const signature = await deps.sign(nonce);

  // Step 3: verify signature, receive JWT
  const verifyRes = await fetch(`${baseUrl}/api/v1/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonce, signature, publicKey: deps.publicKey }),
  });
  if (!verifyRes.ok) {
    throw new Error("Pay platform authentication failed");
  }
  const verifyBody = await parseJsonBody(verifyRes);
  const verifyData = unwrapData<{ token?: unknown }>(
    verifyBody,
    "POST /auth/verify",
  );
  if (typeof verifyData.token !== "string" || verifyData.token.length === 0) {
    throw new InvalidResponseError(
      "POST /auth/verify: response did not include a token",
    );
  }

  setToken(verifyData.token);
  return verifyData.token;
}

/**
 * Normalize HeadersInit to a Record<string, string> so we can spread it
 * into our header bag without dropping keys. Headers and [string, string][]
 * inputs are iterated; plain objects pass through.
 */
function headersToRecord(
  input: HeadersInit | undefined,
): Record<string, string> {
  if (!input) return {};
  if (input instanceof Headers) {
    const out: Record<string, string> = {};
    input.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(input)) {
    const out: Record<string, string> = {};
    for (const [k, v] of input) out[k] = v;
    return out;
  }
  return { ...input };
}

/**
 * Authenticated fetch wrapper. Throws SessionExpiredError on 401 so the
 * caller can decide how to handle re-auth (typically by clearing local
 * state and routing to /login). The API layer does not navigate.
 */
async function payFetch(
  path: string,
  opts: RequestInit = {},
): Promise<Response> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated. Please sign in first.");

  const res = await fetch(`${getPayPlatformUrl()}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      ...headersToRecord(opts.headers),
    },
  });

  if (res.status === 401) {
    clearPlatformAuth();
    throw new SessionExpiredError();
  }

  return res;
}

// ─── Account ────────────────────────────────────────────────

export interface PayAccount {
  walletPublicKey: string;
  email: string;
  jurisdictionCountryCode: string;
  displayName: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAccountInput {
  email: string;
  jurisdictionCountryCode: string;
  displayName?: string;
}

export async function createAccount(
  input: CreateAccountInput,
): Promise<PayAccount> {
  const res = await payFetch("/api/v1/account", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) await throwFromErrorResponse(res, "Create account failed");
  return unwrapData<PayAccount>(await parseJsonBody(res), "POST /account");
}

export async function getMe(): Promise<PayAccount | null> {
  const res = await payFetch("/api/v1/account/me");
  if (res.status === 404) return null;
  if (!res.ok) await throwFromErrorResponse(res, "Get account failed");
  return unwrapData<PayAccount>(await parseJsonBody(res), "GET /account/me");
}

export interface UpdateAccountInput {
  email?: string;
  jurisdictionCountryCode?: string;
  displayName?: string | null;
}

export async function updateMe(input: UpdateAccountInput): Promise<PayAccount> {
  const res = await payFetch("/api/v1/account/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  if (!res.ok) await throwFromErrorResponse(res, "Update account failed");
  return unwrapData<PayAccount>(
    await parseJsonBody(res),
    "PATCH /account/me",
  );
}

// ─── OpEx ──────────────────────────────────────────────────

export async function registerOpex(input: {
  secretKey: string;
  publicKey: string;
  feePct: number;
}): Promise<void> {
  const res = await payFetch("/api/v1/account/opex", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) await throwFromErrorResponse(res, "Register OpEx failed");
}

// ─── Receive UTXOs ──────────────────────────────────────────

export async function storeReceiveUtxos(
  utxos: Array<{ utxoPublicKey: string; derivationIndex: number }>,
): Promise<{ count: number }> {
  const res = await payFetch("/api/v1/utxo/receive", {
    method: "POST",
    body: JSON.stringify({ utxos }),
  });
  if (!res.ok) await throwFromErrorResponse(res, "Store UTXOs failed");
  return unwrapData<{ count: number }>(
    await parseJsonBody(res),
    "POST /utxo/receive",
  );
}

// ─── Transactions ───────────────────────────────────────────

export interface Balance {
  balanceStroops: string;
  balanceXlm: string;
}

export async function getBalance(): Promise<Balance> {
  const res = await payFetch("/api/v1/transactions/balance");
  if (!res.ok) await throwFromErrorResponse(res, "Get balance failed");
  return unwrapData<Balance>(
    await parseJsonBody(res),
    "GET /transactions/balance",
  );
}

export interface TransactionSummary {
  id: string;
  direction: "IN" | "OUT";
  status: "PENDING" | "COMPLETED" | "FAILED";
  method: string;
  amountStroops: string;
  amountXlm: string;
  feeStroops: string;
  counterparty: string | null;
  description: string | null;
  createdAt: string;
  completedAt: string | null;
}

export async function listTransactions(
  opts?: { direction?: "IN" | "OUT"; limit?: number; offset?: number },
): Promise<TransactionSummary[]> {
  const params = new URLSearchParams();
  if (opts?.direction) params.set("direction", opts.direction);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  const qs = params.toString();
  const path = `/api/v1/transactions${qs ? `?${qs}` : ""}`;
  const res = await payFetch(path);
  if (!res.ok) await throwFromErrorResponse(res, "List transactions failed");
  return unwrapData<TransactionSummary[]>(
    await parseJsonBody(res),
    "GET /transactions",
  );
}
