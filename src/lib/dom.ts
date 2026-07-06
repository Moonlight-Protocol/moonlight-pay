/**
 * Safe DOM helpers to avoid innerHTML XSS.
 */

export function renderError(
  container: HTMLElement,
  title: string,
  message: string,
): void {
  container.textContent = "";
  const h2 = document.createElement("h2");
  h2.textContent = title;
  const p = document.createElement("p");
  p.className = "error-text";
  p.textContent = message;
  container.append(h2, p);
}

export function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

export function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Machine-readable failure code → user-facing copy. The pay-platform error
 * envelope and the async bundle failure identity both carry a `code`
 * (StructuredError.code); this is the primary mapping so the UI never has to
 * guess intent from free text. Extend as new codes appear on the wire.
 */
const CODE_COPY: Record<string, string> = {
  SOROBAN_1010: "Your authorization expired — please try again.",
  SOROBAN_2002: "Those funds were already spent. Refresh and try again.",
  SOROBAN_2003: "The payment amounts didn't balance. Please try again.",
  SOROBAN_3006: "That operation wasn't authorized.",
  SOROBAN_3007: "The amount must be greater than zero.",
  BND_005: "Some funds are no longer available. Refresh and try again.",
  BND_011: "Your account isn't approved for payments yet.",
  BND_015:
    "This channel is temporarily withdraw-only — you can still withdraw.",
  PROVIDER_EXECUTION_FAILED:
    "The payment couldn't be completed. Please try again.",
};

/** Pull a StructuredError-style `code` off any thrown value, if present. */
function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return undefined;
}

/**
 * A message is safe to show verbatim only if it reads like a human sentence:
 * starts with a capital, has spaces, and carries no technical tokens — raw
 * status words (FAILED/EXPIRED), version strings, error codes, or `snake_case`
 * / errno identifiers. This keeps internal strings like
 * "Deposit transaction failed: FAILED" or "ECONN_REFUSED at 127.0.0.1:5432"
 * out of the UI (they fall through to the generic message instead).
 */
function isSafeSentence(msg: string): boolean {
  return (
    msg.length > 10 && msg.length < 200 && /^[A-Z]/.test(msg) &&
    msg.includes(" ") && !/\d+\.\d+\.\d+/.test(msg) &&
    !/\b[A-Z]{4,}\b/.test(msg) && !msg.includes("_") &&
    !msg.includes("ECONN") && !msg.includes("ENOENT")
  );
}

/** Extract a user-friendly error message from any thrown value.
 *  Keys on a StructuredError `code` first, then falls back to the server
 *  message (only if it's a safe, human sentence), then a generic message.
 *  Never shows raw internal strings or stack traces to the UI. */
export function friendlyError(error: unknown): string {
  // Primary path: map a machine-readable code to friendly copy.
  const code = errorCode(error);
  if (code && code in CODE_COPY) return CODE_COPY[code];

  const msg = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : String(error);
  const lower = msg.toLowerCase();

  // Codeless client-side errors (wallet kit, fetch, local auth) never carry a
  // platform code; keep their friendly mappings.
  if (
    lower.includes("cancel") || lower.includes("rejected") ||
    lower.includes("denied") || lower.includes("user refused")
  ) {
    return "Transaction cancelled.";
  }
  if (
    lower.includes("not authenticated") || lower.includes("session expired")
  ) {
    return "Session expired. Please sign in again.";
  }
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Network error. Please check your connection.";
  }
  if (
    lower.includes("insufficient") || lower.includes("underfunded") ||
    lower.includes("balance") || lower.includes("tx_insufficient")
  ) {
    return "Your wallet doesn't have enough funds to complete this transaction.";
  }
  if (lower.includes("account not found") || lower === "not found") {
    return "The requested resource was not found.";
  }

  // Unknown/missing code: show the server message only if it's a safe, human
  // sentence; otherwise a generic fallback (and log the real detail).
  if (isSafeSentence(msg)) return msg;
  console.warn("[friendlyError]", msg);
  return "Something went wrong. Please try again.";
}
