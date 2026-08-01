import { StateGraph, START, END } from "@langchain/langgraph";
import {
  AgentState,
  type AgentStateType,
  type AgentStateUpdate,
  type GraphInput,
  type GraphOutput,
} from "./types";
import { getSkill } from "./skills/registry";
import { verify, shouldSkip } from "./skills/verifier";
import { buildSystemPrompt } from "./prompt-builder";
import { parseCsv } from "./skills/parsers/csv.parser";
import { parseGemini } from "./skills/parsers/gemini.parser";

// ── Node implementations ─────────────────────────────────────────────────────

function metadataParserNode(state: AgentStateType): Partial<AgentStateUpdate> {
  try {
    const skill = getSkill(state.metadata.platform);
    return { skill };
  } catch (err) {
    return { errorMessage: err instanceof Error ? err.message : String(err) };
  }
}

async function parserNode(state: AgentStateType): Promise<Partial<AgentStateUpdate>> {
  const skill = state.skill!;
  const newAttempts = state.attempts + 1;

  const priorAttempt = state.parsedTransactions.length > 0 ? state.parsedTransactions : null;

  try {
    let parseResult;

    if (skill.parserType === "deterministic") {
      parseResult = parseCsv({ file: state.file, skill });
    } else {
      const systemPrompt = buildSystemPrompt(skill, priorAttempt, state.verificationError);
      parseResult = await parseGemini({
        file: state.file,
        filename: state.metadata.filename ?? `statement.${skill.format}`,
        skill,
        systemPrompt,
      });
    }

    return {
      parsedTransactions: parseResult.transactions,
      attempts: newAttempts,
      openingBalance: parseResult.openingBalance ?? state.openingBalance,
      closingBalance: parseResult.closingBalance ?? state.closingBalance,
      verificationError: null,
    };
  } catch (err) {
    return {
      attempts: newAttempts,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function verifierNode(state: AgentStateType): Partial<AgentStateUpdate> {
  if (state.errorMessage) return { verificationStatus: "failed" };

  const skill = state.skill!;

  if (shouldSkip(skill)) {
    return { verificationStatus: "skipped" };
  }

  // A parse that comes back with zero transactions and no balances at all is not
  // a legitimate empty statement — it's Gemini returning effectively nothing.
  // Defaulting missing balances to 0 would make `verify()` trivially pass (0 ≈ 0),
  // silently reporting "verified" on a statement that was never actually read.
  // Route it through the same retry/fail path as a real verification mismatch.
  const gotNothing =
    state.parsedTransactions.length === 0 &&
    state.openingBalance === null &&
    state.closingBalance === null;
  if (gotNothing) {
    if (state.attempts >= 3) {
      return { verificationStatus: "failed" };
    }
    return {
      verificationError: { computed: 0, expected: 0, diff: 0 },
    };
  }

  const mode = skill.balanceCheck === "opening_closing_liability" ? "liability" : "asset";
  const error = verify(
    state.parsedTransactions,
    state.openingBalance ?? 0,
    state.closingBalance ?? 0,
    mode,
  );

  if (!error) {
    return { verificationStatus: "passed" };
  }

  // Max 3 attempts
  if (state.attempts >= 3) {
    return { verificationStatus: "failed" };
  }

  return { verificationError: error };
}

function returnResponseNode(_state: AgentStateType): Partial<AgentStateUpdate> {
  return {};
}

// ── Conditional routing ───────────────────────────────────────────────────────

function routeAfterMetadata(state: AgentStateType): "parser" | "returnResponse" {
  return state.errorMessage ? "returnResponse" : "parser";
}

function routeAfterVerifier(state: AgentStateType): "parser" | "returnResponse" {
  // verificationStatus is set → done (passed, skipped, or failed)
  // verificationStatus is null → retry
  return state.verificationStatus !== null ? "returnResponse" : "parser";
}

// ── Graph compilation ─────────────────────────────────────────────────────────

const graph = new StateGraph(AgentState)
  .addNode("metadataParser", metadataParserNode)
  .addNode("parser", parserNode)
  .addNode("verifier", verifierNode)
  .addNode("returnResponse", returnResponseNode)
  .addEdge(START, "metadataParser")
  .addConditionalEdges("metadataParser", routeAfterMetadata, {
    parser: "parser",
    returnResponse: "returnResponse",
  })
  .addEdge("parser", "verifier")
  .addConditionalEdges("verifier", routeAfterVerifier, {
    parser: "parser",
    returnResponse: "returnResponse",
  })
  .addEdge("returnResponse", END)
  .compile();

// ── Public API ────────────────────────────────────────────────────────────────

export async function runGraph(input: GraphInput): Promise<GraphOutput> {
  const finalState = await graph.invoke({
    file: input.file,
    metadata: input.metadata,
  });

  if (finalState.errorMessage) {
    // A later retry attempt can fail (e.g. a truncated Gemini response) after an
    // earlier attempt already produced a valid parse. Falling back to that last
    // good parse — flagged as failed verification, so every row lands in manual
    // review — beats silently discarding real data the caller already paid for.
    if (finalState.parsedTransactions.length > 0) {
      return {
        status: "ok",
        verificationStatus: "failed",
        attempts: finalState.attempts,
        transactions: finalState.parsedTransactions,
        openingBalance: finalState.openingBalance ?? undefined,
        closingBalance: finalState.closingBalance ?? undefined,
      };
    }
    return {
      status: "error",
      verificationStatus: "skipped",
      attempts: finalState.attempts,
      transactions: [],
      error: finalState.errorMessage,
    };
  }

  return {
    status: "ok",
    verificationStatus: finalState.verificationStatus ?? "skipped",
    attempts: finalState.attempts,
    transactions: finalState.parsedTransactions,
    openingBalance: finalState.openingBalance ?? undefined,
    closingBalance: finalState.closingBalance ?? undefined,
  };
}
