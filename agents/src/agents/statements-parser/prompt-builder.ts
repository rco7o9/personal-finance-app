import type { ParsedTransaction, SkillTemplate, VerificationError } from "./types";

export function buildSystemPrompt(
  skill: SkillTemplate,
  priorAttempt: ParsedTransaction[] | null,
  error: VerificationError | null,
): string {
  const prompt = skill.systemPromptTemplate ?? "";

  let retryContext = "";
  if (priorAttempt && error) {
    retryContext =
      `---\nPREVIOUS ATTEMPT FAILED\n` +
      `Computed balance: ${error.computed}. Expected closing balance: ${error.expected}.\n` +
      `Difference: ${error.diff}.\n` +
      `Prior output:\n${JSON.stringify(priorAttempt, null, 2)}\n` +
      `Re-examine every row and correct amounts or missing rows.`;
  }

  return prompt.replace("{{RETRY_CONTEXT}}", retryContext);
}
