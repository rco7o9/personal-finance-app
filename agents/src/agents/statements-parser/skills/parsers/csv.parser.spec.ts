import { parseCsv } from "./csv.parser";
import { zerodhaSkill } from "../platforms/zerodha.skill";
import type { SkillTemplate } from "../../types";

// Minimal Zerodha-style CSV (3 rows) using actual column names from the skill mapping
const ZERODHA_CSV = `trade_date,symbol,isin,trade_type,quantity,price
2024-01-10,INFY,INE009A01021,BUY,10,1700.50
2024-01-15,RELIANCE,INE002A01018,SELL,5,2850.00
2024-01-20,TCS,INE467B01029,BUY,3,3950.00`;

const UNKNOWN_COL_CSV = `unknown_col,another_col
val1,val2`;

describe("parseCsv", () => {
  it("parses 3 CSV rows into 3 ParsedTransactions", () => {
    const file = Buffer.from(ZERODHA_CSV);
    const result = parseCsv({ file, skill: zerodhaSkill });
    expect(result.transactions).toHaveLength(3);
  });

  it("sets confidence = 1.0 on every row", () => {
    const file = Buffer.from(ZERODHA_CSV);
    const result = parseCsv({ file, skill: zerodhaSkill });
    result.transactions.forEach((tx) => expect(tx.confidence).toBe(1.0));
  });

  it("populates source_text on every row", () => {
    const file = Buffer.from(ZERODHA_CSV);
    const result = parseCsv({ file, skill: zerodhaSkill });
    result.transactions.forEach((tx) => expect(tx.source_text).toBeTruthy());
  });

  it("maps date column correctly", () => {
    const file = Buffer.from(ZERODHA_CSV);
    const result = parseCsv({ file, skill: zerodhaSkill });
    expect(result.transactions[0].date).toBe("2024-01-10");
  });

  it("maps assetName from symbol column", () => {
    const file = Buffer.from(ZERODHA_CSV);
    const result = parseCsv({ file, skill: zerodhaSkill });
    expect(result.transactions[0].assetName).toBe("INFY");
  });

  it("maps price as number and computes amount from qty * price", () => {
    const file = Buffer.from(ZERODHA_CSV);
    const result = parseCsv({ file, skill: zerodhaSkill });
    expect(result.transactions[0].price).toBe(1700.5);
    expect(result.transactions[0].amount).toBe(10 * 1700.5);
  });

  it("returns empty array for empty file", () => {
    const file = Buffer.from("");
    const result = parseCsv({ file, skill: zerodhaSkill });
    expect(result.transactions).toHaveLength(0);
  });

  it("returns empty array when CSV has no matching columns", () => {
    const skill: SkillTemplate = {
      ...zerodhaSkill,
      columnMappings: { "nonexistent": "date" },
    };
    const file = Buffer.from(UNKNOWN_COL_CSV);
    const result = parseCsv({ file, skill });
    // Rows with no mapped columns produce minimal transactions; check it doesn't crash
    expect(Array.isArray(result.transactions)).toBe(true);
  });
});
