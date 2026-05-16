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

  const error = verify(
    state.parsedTransactions,
    state.openingBalance ?? 0,
    state.closingBalance ?? 0,
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
