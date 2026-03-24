import { assertEquals, assertThrows } from "jsr:@std/assert";
import { bytesToHex, hexToBytes } from "../src/utils/hex.ts";

Deno.test("bytesToHex: round-trip with known value", () => {
  const hex = "deadbeef01020304";
  assertEquals(bytesToHex(hexToBytes(hex)), hex);
});

Deno.test("bytesToHex: empty Uint8Array", () => {
  assertEquals(bytesToHex(new Uint8Array([])), "");
});

Deno.test("bytesToHex: [0, 255, 16]", () => {
  assertEquals(bytesToHex(new Uint8Array([0, 255, 16])), "00ff10");
});

Deno.test("hexToBytes: 00ff10", () => {
  const bytes = hexToBytes("00ff10");
  assertEquals(bytes, new Uint8Array([0, 255, 16]));
});

Deno.test("hexToBytes: empty string", () => {
  const bytes = hexToBytes("");
  assertEquals(bytes, new Uint8Array([]));
});

Deno.test("hexToBytes: throws on odd-length string", () => {
  assertThrows(
    () => hexToBytes("abc"),
    Error,
    "odd length",
  );
});

Deno.test("hexToBytes: throws on invalid hex characters 'gg'", () => {
  assertThrows(
    () => hexToBytes("gg"),
    Error,
    "non-hex characters",
  );
});

Deno.test("hexToBytes: throws on invalid hex characters 'xyz'", () => {
  assertThrows(
    () => hexToBytes("xyz"),
    Error,
  );
});

Deno.test("hexToBytes: case insensitive", () => {
  const upper = hexToBytes("AABB");
  const lower = hexToBytes("aabb");
  assertEquals(upper, lower);
  assertEquals(upper, new Uint8Array([0xAA, 0xBB]));
});

Deno.test("round-trip: hexToBytes then bytesToHex", () => {
  const original = new Uint8Array([1, 2, 3, 127, 128, 255]);
  assertEquals(hexToBytes(bytesToHex(original)), original);
});
