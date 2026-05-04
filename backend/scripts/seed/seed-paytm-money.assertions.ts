/**
 * Assertions for pure functions in seed-paytm-money.ts.
 * Run: cd backend && npx ts-node --project tsconfig.scripts.json scripts/seed-paytm-money.assertions.ts
 */

import assert from "assert";
import { isGoldFund, validateRow } from "./seed-paytm-money";

let passed = 0;
let failed = 0;

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${(e as Error).message}`);
    failed++;
  }
}

// ─── isGoldFund ───────────────────────────────────────────────────────────────

console.log("\nisGoldFund:");

test("detects 'gold' keyword", () => {
  assert.strictEqual(isGoldFund("Nippon India Gold Savings Fund"), true);
});

test("detects 'Gold' (case-insensitive)", () => {
  assert.strictEqual(isGoldFund("HDFC Gold Fund"), true);
});

test("detects sovereign gold bond keyword", () => {
  assert.strictEqual(isGoldFund("Sovereign Gold Bond 2024-25"), true);
});

test("returns false for equity fund", () => {
  assert.strictEqual(isGoldFund("Axis Bluechip Fund"), false);
});

test("returns false for OMAXAUTO-like false positives (no gold keyword)", () => {
  assert.strictEqual(isGoldFund("Mirae Asset Large Cap Fund"), false);
});

test("returns false for debt fund", () => {
  assert.strictEqual(isGoldFund("ICICI Prudential Short Term Fund"), false);
});

// ─── validateRow ──────────────────────────────────────────────────────────────

console.log("\nvalidateRow:");

const VALID_ROW = {
  date: "2023-05-15",
  scheme_name: "Axis Bluechip Fund",
  transaction_type: "buy" as const,
  units: "12.345",
  nav: "45.6789",
  amount: "5000.00",
};

test("accepts a fully valid buy row", () => {
  assert.strictEqual(validateRow(VALID_ROW), true);
});

test("accepts a valid sell row", () => {
  assert.strictEqual(validateRow({ ...VALID_ROW, transaction_type: "sell" }), true);
});

test("rejects null", () => {
  assert.strictEqual(validateRow(null), false);
});

test("rejects non-object", () => {
  assert.strictEqual(validateRow("string"), false);
});

test("rejects invalid date format (non-ISO)", () => {
  assert.strictEqual(validateRow({ ...VALID_ROW, date: "15 May 2023" }), false);
});

test("rejects invalid date format (slash-separated)", () => {
  assert.strictEqual(validateRow({ ...VALID_ROW, date: "2023/05/15" }), false);
});

test("rejects unknown transaction_type", () => {
  assert.strictEqual(validateRow({ ...VALID_ROW, transaction_type: "Purchase - SIP" }), false);
});

test("rejects empty scheme_name", () => {
  assert.strictEqual(validateRow({ ...VALID_ROW, scheme_name: "  " }), false);
});

test("rejects zero units", () => {
  assert.strictEqual(validateRow({ ...VALID_ROW, units: "0" }), false);
});

test("rejects negative amount", () => {
  assert.strictEqual(validateRow({ ...VALID_ROW, amount: "-500" }), false);
});

test("rejects non-numeric nav", () => {
  assert.strictEqual(validateRow({ ...VALID_ROW, nav: "N/A" }), false);
});

test("rejects missing required field", () => {
  const { nav: _nav, ...withoutNav } = VALID_ROW;
  assert.strictEqual(validateRow(withoutNav), false);
});

// ─── Results ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
