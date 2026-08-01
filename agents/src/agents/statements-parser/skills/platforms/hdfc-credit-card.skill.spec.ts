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
});
