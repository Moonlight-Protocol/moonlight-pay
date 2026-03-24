/**
 * Decimal-string-to-stroops parser.
 * Avoids floating-point rounding errors by splitting on the decimal
 * point and treating the integer and fractional parts as strings.
 */
export function parseStroops(amountStr: string): bigint {
  const parts = amountStr.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(7, "0").slice(0, 7);
  return BigInt(whole + frac);
}
