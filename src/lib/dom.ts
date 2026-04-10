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

/** Extract a user-friendly error message from any thrown value.
 *  Strips internal details — only shows safe, generic messages to the UI. */
export function friendlyError(error: unknown): string {
  const msg = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : String(error);
  const lower = msg.toLowerCase();
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
  if (lower.includes("not found")) {
    return "The requested resource was not found.";
  }
  // Log the full error for debugging, return a generic message
  console.warn("[friendlyError]", msg);
  return "Something went wrong. Please try again.";
}
