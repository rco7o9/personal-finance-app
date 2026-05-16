import { StateSchema, ReducedValue, StateGraph, START, END } from "@langchain/langgraph";

import { z } from "zod/v4";

const AgentState = new StateSchema({
  statementType: z.string(),
  steps: new ReducedValue(
    z.array(z.string()).default(() => []),
    {
      inputSchema: z.string(),
      reducer: (currentSteps, newStep) => [...currentSteps, newStep],
    },
  ),
});

type State = typeof AgentState.State;
type Update = typeof AgentState.Update;

const testNode = (state: State): Partial<Update> => {
  return {
    steps: "test",
  };
};

const loggerNode = (state: State): Partial<Update> => {
    console.log(state);
    return {};
};

const graph = new StateGraph(AgentState)
    .addNode("testNode", testNode)
    .addNode("loggerNode", loggerNode)
    .addEdge(START, 'testNode')
    .addEdge('testNode', 'loggerNode')
    .addEdge('loggerNode', END)
    .compile();

(async function main() {
    await graph.invoke({ statementType: "expense" });
})();
