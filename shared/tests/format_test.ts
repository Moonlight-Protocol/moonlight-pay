import { assertEquals } from "jsr:@std/assert";
import { formatAmount } from "../src/components/transaction-list.ts";

Deno.test("formatAmount converts stroops to XLM with 2 decimal places", () => {
  assertEquals(formatAmount("10000000"), "1.00");
  assertEquals(formatAmount("70000000"), "7.00");
  assertEquals(formatAmount("15000000"), "1.50");
  assertEquals(formatAmount("12345678"), "1.23");
});

Deno.test("formatAmount handles zero", () => {
  assertEquals(formatAmount("0"), "0.00");
  assertEquals(formatAmount(""), "0.00");
});

Deno.test("formatAmount handles large values", () => {
  assertEquals(formatAmount("100000000000"), "10,000.00");
  assertEquals(formatAmount("999999999999999"), "99,999,999.99");
});

Deno.test("formatAmount handles small values", () => {
  assertEquals(formatAmount("1"), "0.00");
  assertEquals(formatAmount("100000"), "0.01");
  assertEquals(formatAmount("1000000"), "0.10");
});

Deno.test("formatAmount handles invalid input gracefully", () => {
  assertEquals(formatAmount("not-a-number"), "0.00");
});
