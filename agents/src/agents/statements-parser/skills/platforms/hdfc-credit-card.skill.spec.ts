import { hdfcCreditCardSkill } from "./hdfc-credit-card.skill";

describe("hdfcCreditCardSkill", () => {
  it("has the required SkillTemplate fields", () => {
    expect(hdfcCreditCardSkill.platformId).toBe("hdfc-credit-card");
    expect(hdfcCreditCardSkill.format).toBe("pdf");
    expect(hdfcCreditCardSkill.parserType).toBe("gemini");
    expect(hdfcCreditCardSkill.balanceCheck).toBe("opening_closing_liability");
  });

  it("prompt template supports retry context", () => {
    expect(hdfcCreditCardSkill.systemPromptTemplate).toContain("{{RETRY_CONTEXT}}");
  });

  it("prompt template instructs per-transaction cardholder attribution", () => {
    const prompt = hdfcCreditCardSkill.systemPromptTemplate ?? "";
    expect(prompt).toContain("cardHolderName");
    expect(prompt.toLowerCase()).toContain("add-on");
  });

  it("prompt template includes the transfer classification rule", () => {
    const prompt = hdfcCreditCardSkill.systemPromptTemplate ?? "";
    expect(prompt).toContain("transferType");
    expect(prompt).toContain("own_account");
  });

  it("few-shot examples include at least one example per cardholder", () => {
    const names = (hdfcCreditCardSkill.fewShotExamples ?? []).map((e) => e.parsed.cardHolderName);
    expect(names).toContain("ARJUN MEHTA");
    expect(names).toContain("PRIYA MEHTA");
  });

  // A refund (e.g. a Global Blue tax refund credited back to the card) has no
  // valid non-expense rowType without "income" — it used to get forced into
  // "expense" since "expense"/"internal_transfer"/"ignore" were the only options.
  it("prompt template offers 'income' as a rowType, for refunds credited back to the card", () => {
    const prompt = hdfcCreditCardSkill.systemPromptTemplate ?? "";
    expect(prompt).toMatch(/"income"\s*—/);
  });

  it("includes a refund few-shot example classified as income, not expense", () => {
    const refundExample = (hdfcCreditCardSkill.fewShotExamples ?? []).find((e) =>
      e.sourceText.includes("REFUND"),
    );
    expect(refundExample).toBeDefined();
    expect(refundExample?.parsed.rowType).toBe("income");
    expect(refundExample?.parsed.type).toBe("credit");
  });

  it("prompt template's category list includes the new household categories", () => {
    const prompt = hdfcCreditCardSkill.systemPromptTemplate ?? "";
    expect(prompt).toContain("Groceries");
    expect(prompt).toContain("Maintenance");
  });
});
