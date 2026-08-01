import { EXPENSE_CATEGORY_LIST, VENDOR_CATEGORY_GUIDANCE } from "./vendor-rules";
import { EXPENSE_CATEGORIES } from "../config/categories";

describe("EXPENSE_CATEGORY_LIST", () => {
  it("includes the new household categories", () => {
    expect(EXPENSE_CATEGORY_LIST).toContain("Groceries");
    expect(EXPENSE_CATEGORY_LIST).toContain("Maintenance");
    expect(EXPENSE_CATEGORY_LIST).toContain("Arjun's Parents' Expense");
    expect(EXPENSE_CATEGORY_LIST).toContain("Priya's Parents' Expense");
  });

  it("excludes Salary and Transfer — never Gemini's call to make", () => {
    const categories = EXPENSE_CATEGORY_LIST.split(", ");
    expect(categories).not.toContain("Salary");
    expect(categories).not.toContain("Transfer");
  });

  it("stays in sync with config/categories.ts (minus Salary/Transfer)", () => {
    const expected = EXPENSE_CATEGORIES.filter((c) => c !== "Salary" && c !== "Transfer");
    expect(EXPENSE_CATEGORY_LIST).toBe(expected.join(", "));
  });
});

describe("VENDOR_CATEGORY_GUIDANCE", () => {
  it("maps the household's known vendors to their categories", () => {
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Zomato");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Uber");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Rapido");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Green SM");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("HDFC Prepaid Card");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Airtel");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Jio");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Myntra");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Zepto");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Blinkit");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Instamart");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Handpickd");
  });

  it("routes named-payee transfers to expense categories, not internal_transfer", () => {
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Vikram Rao");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Green Meadows Residency");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("MyGate");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Sunita Mehta");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Arjun's Parents' Expense");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Rajesh Kapoor");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Neeta Kapoor");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Priya's Parents' Expense");
  });

  it("instructs refunds to be classified as income, not expense", () => {
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("REFUND");
    expect(VENDOR_CATEGORY_GUIDANCE).toMatch(/rowType "income"/);
  });

  it("tells Gemini not to hallucinate a specific category when unsure", () => {
    expect(VENDOR_CATEGORY_GUIDANCE.toLowerCase()).toContain("do not hallucinate");
    expect(VENDOR_CATEGORY_GUIDANCE).toContain("Other");
  });
});
