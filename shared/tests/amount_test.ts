import { assertEquals } from "jsr:@std/assert";
import { parseStroops } from "../src/utils/amount.ts";

Deno.test("parseStroops: 1 XLM", () => {
  assertEquals(parseStroops("1"), 10000000n);
});

Deno.test("parseStroops: 0.1 XLM", () => {
  assertEquals(parseStroops("0.1"), 1000000n);
});

Deno.test("parseStroops: 1 stroop (0.0000001)", () => {
  assertEquals(parseStroops("0.0000001"), 1n);
});

Deno.test("parseStroops: 100.5 XLM", () => {
  assertEquals(parseStroops("100.5"), 1005000000n);
});

Deno.test("parseStroops: zero", () => {
  assertEquals(parseStroops("0"), 0n);
});

Deno.test("parseStroops: truncates to 7 decimal places", () => {
  // "1.23456789" → whole="1", frac="2345678" (first 7 chars of "23456789")
  assertEquals(parseStroops("1.23456789"), 12345678n);
});

Deno.test("parseStroops: no fractional part", () => {
  assertEquals(parseStroops("42"), 420000000n);
});

Deno.test("parseStroops: trailing zeros in fraction", () => {
  assertEquals(parseStroops("1.10"), 11000000n);
});

Deno.test("parseStroops: leading zeros in fraction", () => {
  assertEquals(parseStroops("0.01"), 100000n);
});
