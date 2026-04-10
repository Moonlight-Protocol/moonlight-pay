import { assertEquals, assertNotEquals } from "@std/assert";
import { COUNTRY_CODES } from "./jurisdictions.ts";

Deno.test("COUNTRY_CODES is non-empty and shaped correctly", () => {
  assertNotEquals(COUNTRY_CODES.length, 0);
  for (const entry of COUNTRY_CODES) {
    assertEquals(typeof entry.code, "string");
    assertEquals(typeof entry.label, "string");
    // ISO 3166-1 alpha-2 — exactly two uppercase letters.
    assertEquals(
      /^[A-Z]{2}$/.test(entry.code),
      true,
      `bad code: ${entry.code}`,
    );
  }
});

Deno.test("COUNTRY_CODES has no duplicate codes", () => {
  const seen = new Set<string>();
  for (const entry of COUNTRY_CODES) {
    if (seen.has(entry.code)) {
      throw new Error(`Duplicate code: ${entry.code}`);
    }
    seen.add(entry.code);
  }
});

Deno.test("COUNTRY_CODES contains expected major jurisdictions", () => {
  // The pay-platform validator (helpers_test.ts) uses the same set of
  // sample codes — these must always be present so the form covers the
  // common signup paths.
  const codes = new Set(COUNTRY_CODES.map((c) => c.code));
  for (
    const expected of [
      "US",
      "AR",
      "ES",
      "GB",
      "JP",
      "DE",
      "BR",
      "MX",
      "FR",
      "AU",
    ]
  ) {
    assertEquals(codes.has(expected), true, `missing ${expected}`);
  }
});
