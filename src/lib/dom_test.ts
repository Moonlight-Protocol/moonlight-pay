/**
 * Unit tests for src/lib/dom.ts.
 *
 * dom.ts depends on `document` and `HTMLElement` for the escapeHtml /
 * renderError helpers, but friendlyError() and truncateAddress() are pure
 * functions that we can exercise without a DOM. We test those here so the
 * tests run against the same Deno binary as the rest of CI without a
 * jsdom dependency.
 */
import { assertEquals } from "@std/assert";
import { friendlyError, truncateAddress } from "./dom.ts";

Deno.test("truncateAddress shortens long addresses to head + tail", () => {
  const addr = "GAEILCNSC4ZTA63RK3ACSADVSWC47NRG7KFVYHZ4HKS265YEZVEHWMHG";
  assertEquals(truncateAddress(addr), "GAEILC...WMHG");
});

Deno.test("truncateAddress passes short strings through unchanged", () => {
  assertEquals(truncateAddress("short"), "short");
  assertEquals(truncateAddress("12char_long!"), "12char_long!");
});

Deno.test("friendlyError maps wallet rejection to a friendly message", () => {
  // Wallet kits surface a few different phrasings depending on the wallet —
  // friendlyError must collapse them all to the same UI string so the user
  // gets a consistent experience.
  const cancelled = "Transaction cancelled.";
  for (
    const raw of [
      "User rejected the request",
      "User refused signing",
      "Permission denied",
      "Operation cancelled by user",
    ]
  ) {
    assertEquals(friendlyError(new Error(raw)), cancelled);
  }
});

Deno.test("friendlyError maps session expiry to the re-auth message", () => {
  const expected = "Session expired. Please sign in again.";
  assertEquals(friendlyError(new Error("Session expired")), expected);
  assertEquals(friendlyError(new Error("Not authenticated")), expected);
});

Deno.test("friendlyError maps network errors to a generic network message", () => {
  const expected = "Network error. Please check your connection.";
  assertEquals(friendlyError(new TypeError("Failed to fetch")), expected);
  assertEquals(
    friendlyError(new Error("NetworkError when attempting to fetch resource")),
    expected,
  );
});

Deno.test("friendlyError maps insufficient-funds variants", () => {
  const expected =
    "Your wallet doesn't have enough funds to complete this transaction.";
  for (
    const raw of [
      "Insufficient balance",
      "Account is underfunded",
      "tx_insufficient_balance",
    ]
  ) {
    assertEquals(friendlyError(new Error(raw)), expected);
  }
});

Deno.test("friendlyError maps not-found errors", () => {
  assertEquals(
    friendlyError(new Error("Account not found")),
    "The requested resource was not found.",
  );
});

Deno.test("friendlyError passes through readable API messages", () => {
  assertEquals(
    friendlyError(
      new Error("No council available for this merchant's jurisdiction"),
    ),
    "No council available for this merchant's jurisdiction",
  );
});

Deno.test("friendlyError maps a StructuredError code to friendly copy", () => {
  // The primary path: a machine-readable code beats any free-text message.
  assertEquals(
    friendlyError({ code: "SOROBAN_1010", message: "auth entry expired" }),
    "Your authorization expired — please try again.",
  );
  assertEquals(
    friendlyError({ code: "BND_015", message: "channel withdraw-only" }),
    "This channel is temporarily withdraw-only — you can still withdraw.",
  );
  assertEquals(
    friendlyError({ code: "PROVIDER_EXECUTION_FAILED", message: "boom" }),
    "The payment couldn't be completed. Please try again.",
  );
});

Deno.test("friendlyError falls back to server message for an unknown code", () => {
  // Unknown code, but the message is a safe human sentence → show it.
  assertEquals(
    friendlyError({
      code: "SOROBAN_9999",
      message: "The merchant is not accepting payments right now",
    }),
    "The merchant is not accepting payments right now",
  );
});

Deno.test("friendlyError hides raw status strings instead of leaking them", () => {
  // Regression for hole #7: the old pass-through heuristic showed this raw.
  const generic = "Something went wrong. Please try again.";
  assertEquals(
    friendlyError(new Error("Deposit transaction failed: FAILED")),
    generic,
  );
});

Deno.test("friendlyError falls back to a generic message for unknown errors", () => {
  // We never want to leak raw stack traces or backend error fields to the UI.
  const generic = "Something went wrong. Please try again.";
  assertEquals(
    friendlyError(new Error("ECONN_REFUSED at 127.0.0.1:5432")),
    generic,
  );
  assertEquals(friendlyError("plain string"), generic);
  assertEquals(friendlyError(undefined), generic);
  assertEquals(friendlyError({ message: "object with message" }), generic);
});
