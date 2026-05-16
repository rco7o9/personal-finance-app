import { parse as parseCsvSync } from "csv-parse/sync";
import * as XLSX from "xlsx";
import type { ParsedTransaction, ParseResult, SkillTemplate } from "../../types";

interface CsvParserInput {
  file: Buffer;
  skill: SkillTemplate;
}

const NUMERIC_FIELDS = new Set<string>(["amount", "quantity", "price"]);

function findHeaderRowIndex(rows: unknown[][], searchKey: string): number {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some((cell) => String(cell).trim() === searchKey)) {
      return i;
    }
  }
  return 0;
}

function parseRows(file: Buffer, skill: SkillTemplate): Record<string, string>[] {
  if (skill.format === "xlsx") {
    const workbook = XLSX.read(file, { type: "buffer" });
    const sheetName = skill.sheetName ?? workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    if (skill.headerSearchKey) {
      // Get all rows as raw arrays, find the header row, then build objects manually.
      // This is more reliable than passing `range` to sheet_to_json.
      const rawRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
      const headerIdx = findHeaderRowIndex(rawRows, skill.headerSearchKey);
      const headers = rawRows[headerIdx];
      return rawRows.slice(headerIdx + 1).map((row) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          obj[h] = String(row[i] ?? "");
        });
        return obj;
      });
    }

    return XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
  }

  const content = file.toString("utf-8").trim();
  if (!content) return [];

  return parseCsvSync(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

const MONTH_ABBR: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

// Normalises crypto market pair symbols: "BTCINR" → "BTC-INR", "ETHINR" → "ETH-INR"
function normaliseAssetName(raw: string): string {
  return raw.replace(/^([A-Z0-9]+)(INR|USDT|ETH|BTC|USDC|BNB|SOL)$/i, (_, base, quote) =>
    `${base.toUpperCase()}-${quote.toUpperCase()}`
  );
}

// Normalises any date string to YYYY-MM-DD.
// Handles: "08 Apr 2026, 07:53 PM", "2026-04-08", "08-Apr-2026", "DD/MM/YYYY"
function normaliseDate(raw: string): string {
  const s = raw.trim();
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  const dmy = /^(\d{1,2})[-\s]([A-Za-z]{3})[-\s,]*\s*(\d{4})/.exec(s);
  if (dmy) {
    return `${dmy[3]}-${MONTH_ABBR[dmy[2].toLowerCase()] ?? "01"}-${dmy[1].padStart(2, "0")}`;
  }
  const slash = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (slash) return `${slash[3]}-${slash[2]}-${slash[1]}`;
  return s;
}

function toNumber(value: string): number {
  // Strip currency symbols, commas, spaces, and trailing text (e.g. " INR", " USD")
  const cleaned = String(value)
    .replace(/[₹$,]/g, "")
    .replace(/\s+[A-Z]{2,5}\s*$/i, "")
    .trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

export function parseCsv({ file, skill }: CsvParserInput): ParseResult {
  if (!skill.columnMappings || Object.keys(skill.columnMappings).length === 0) {
    return { transactions: [] };
  }

  const rows = parseRows(file, skill);

  const transactions: ParsedTransaction[] = rows
    .filter((row) => {
      // Skip rows that match the header search key (XLSX re-includes header as first data row)
      if (skill.headerSearchKey) {
        const vals = Object.values(row);
        return !vals.some((v) => String(v).trim() === skill.headerSearchKey);
      }
      return true;
    })
    .map((row) => {
      const tx: Partial<ParsedTransaction> = {
        description: "",
        rowType: "investment",
        confidence: 1.0,
        source_text: JSON.stringify(row),
      };

      for (const [csvCol, txField] of Object.entries(skill.columnMappings!)) {
        const rawValue = row[csvCol];
        if (rawValue === undefined || String(rawValue).trim() === "") continue;

        if (NUMERIC_FIELDS.has(txField)) {
          (tx as Record<string, unknown>)[txField] = toNumber(String(rawValue));
        } else if (txField === "type") {
          const lower = String(rawValue).toLowerCase();
          (tx as Record<string, unknown>)[txField] = lower.includes("sell") ? "debit" : "credit";
        } else if (txField === "date") {
          (tx as Record<string, unknown>)[txField] = normaliseDate(String(rawValue));
        } else if (txField === "assetName") {
          (tx as Record<string, unknown>)[txField] = normaliseAssetName(String(rawValue));
        } else {
          (tx as Record<string, unknown>)[txField] = String(rawValue);
        }
      }

      if (!tx.date) tx.date = "";
      if (!tx.description) tx.description = tx.assetName ?? "";
      if (!tx.amount && tx.quantity && tx.price) tx.amount = tx.quantity * tx.price;
      if (tx.amount === undefined) tx.amount = 0;
      if (!tx.type) tx.type = "credit";

      return tx as ParsedTransaction;
    })
    // Drop rows that carry no real transaction data (empty/footer rows)
    .filter((tx) => tx.date !== "" || (tx.amount !== 0 && tx.amount !== undefined));

  return { transactions };
}
