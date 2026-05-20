import { describe, expect, it, vi } from "vitest";
import { runVerification } from "../../src/verification/engine.js";
import type { CirNode, CirVerificationHook, CirWorkflow } from "../../src/cir/types.js";
import type { ExecutionState } from "../../src/compiler/runtime-helpers.js";
import type { WorkflowContext, YieldItem } from "pi-duroxide";
import { createHarnessState } from "../../src/state/snapshots.js";

function createMockContext() {
  const calls: { tools: Array<{ name: string; args: unknown }>; llm: Array<{ messages: unknown[]; options?: unknown }>; statuses: unknown[] } = {
    tools: [],
    llm: [],
    statuses: [],
  };

  return {
    calls,
    context: {
      scheduleTimer: vi.fn(),
      waitForEvent: vi.fn(),
      scheduleSubOrchestration: vi.fn(),
      all: vi.fn(),
      race: vi.fn(),
      utcNow: () => 0,
      newGuid: () => "guid-1",
      continueAsNew: vi.fn(),
      setCustomStatus: (status: unknown) => {
        calls.statuses.push(status);
      },
      traceInfo: vi.fn(),
      traceWarn: vi.fn(),
      traceError: vi.fn(),
      traceDebug: vi.fn(),
      kv: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
      pi: {
        tool: (name: string, args: unknown) => {
          calls.tools.push({ name, args });
          return { kind: "tool-call", name, args };
        },
        llm: (messages: unknown[], options?: unknown) => {
          calls.llm.push({ messages, options });
          return { kind: "llm-call", messages, options };
        },
        skill: vi.fn(),
        sendMessage: vi.fn(),
        prompt: vi.fn(),
      },
    } satisfies WorkflowContext,
  };
}

function createToolNode(id: string, verification?: CirVerificationHook[]): CirNode {
  return {
    id,
    kind: "tool",
    source: { specNodeId: id, specNodeKind: "tool", specPath: `graph.nodes[0]` },
    verification,
    action: { tool: "echo", args: ["hello"] },
  } as Extract<CirNode, { kind: "tool" }>;
}

function createLlmVerifierNode(id: string): CirNode {
  return {
    id,
    kind: "llm",
    source: { specNodeId: id, specNodeKind: "llm", specPath: `graph.nodes[1]` },
    action: { provider: "anthropic", model: "claude-sonnet", prompt: "Verify?" },
  } as Extract<CirNode, { kind: "llm" }>;
}

function createToolVerifierNode(id: string): CirNode {
  return {
    id,
    kind: "tool",
    source: { specNodeId: id, specNodeKind: "tool", specPath: `graph.nodes[1]` },
    action: { tool: "test", args: ["-f", "output.txt"] },
  } as Extract<CirNode, { kind: "tool" }>;
}

function createConditionNode(id: string, conditionExpr: string): CirNode {
  return {
    id,
    kind: "condition",
    source: { specNodeId: id, specNodeKind: "condition", specPath: `graph.nodes[1]` },
    action: { conditionExpr },
  } as Extract<CirNode, { kind: "condition" }>;
}

function createExecutionState(): ExecutionState {
  return {
    input: {},
    outputs: {},
    trace: [],
    harnessState: createHarnessState({}),
    startTimeMs: Date.now(),
  };
}

function collectGenerator<T>(gen: Generator<YieldItem, T, unknown>): { yields: YieldItem[]; result: T } {
  const yields: YieldItem[] = [];
  let current = gen.next();
  while (!current.done) {
    yields.push(current.value);
    current = gen.next(undefined);
  }
  return { yields, result: current.value };
}

describe("runVerification", () => {
  it("returns pass report when no hooks are provided", async () => {
    const { context } = createMockContext();
    const node = createToolNode("action", []);
    const nodeMap = new Map<string, CirNode>([["action", node]]);
    const state = createExecutionState();

    const gen = runVerification("action", [], nodeMap, state, context);
    const { result } = collectGenerator(gen);

    expect(result).toEqual({
      nodeId: "action",
      hookResults: [],
      overallStatus: "pass",
    });
  });

  it("returns pass report when single hook passes", async () => {
    const hook: CirVerificationHook = { kind: "llm", checkNodeId: "verifier", onFail: "block" };
    const { context, calls } = createMockContext();
    const node = createToolNode("action", [hook]);
    const verifierNode = createLlmVerifierNode("verifier");
    const nodeMap = new Map<string, CirNode>([
      ["action", node],
      ["verifier", verifierNode],
    ]);
    const state = createExecutionState();

    const gen = runVerification("action", [hook], nodeMap, state, context);

    // Yields LLM call for verifier
    const first = gen.next();
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({ kind: "llm-call" });

    // Pass verifier result (boolean true)
    const { result } = collectGeneratorFrom(gen, true);

    expect(result.overallStatus).toBe("pass");
    expect(result.hookResults).toHaveLength(1);
    expect(result.hookResults[0].hook).toBe(hook);
    expect(result.hookResults[0].outcome).toEqual({ status: "pass" });
    expect(result.hookResults[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns block report when single hook fails with block onFail", async () => {
    const hook: CirVerificationHook = { kind: "llm", checkNodeId: "verifier", onFail: "block" };
    const { context } = createMockContext();
    const node = createToolNode("action", [hook]);
    const verifierNode = createLlmVerifierNode("verifier");
    const nodeMap = new Map<string, CirNode>([
      ["action", node],
      ["verifier", verifierNode],
    ]);
    const state = createExecutionState();

    const gen = runVerification("action", [hook], nodeMap, state, context);

    // Yields LLM call for verifier
    gen.next();

    // Fail verifier result (boolean false)
    const { result } = collectGeneratorFrom(gen, false);

    expect(result.overallStatus).toBe("block");
    expect(result.hookResults).toHaveLength(1);
    expect(result.hookResults[0].outcome).toEqual({
      status: "block",
      hook,
      message: "Verification failed via verifier",
    });
  });

  it("returns warn report when single hook fails with warn onFail", async () => {
    const hook: CirVerificationHook = { kind: "llm", checkNodeId: "verifier", onFail: "warn" };
    const { context } = createMockContext();
    const node = createToolNode("action", [hook]);
    const verifierNode = createLlmVerifierNode("verifier");
    const nodeMap = new Map<string, CirNode>([
      ["action", node],
      ["verifier", verifierNode],
    ]);
    const state = createExecutionState();

    const gen = runVerification("action", [hook], nodeMap, state, context);
    gen.next();
    const { result } = collectGeneratorFrom(gen, false);

    expect(result.overallStatus).toBe("pass");
    expect(result.hookResults).toHaveLength(1);
    expect(result.hookResults[0].outcome).toEqual({ status: "warn", hook });
  });

  it("all-must-pass strategy: stops at first block", async () => {
    const hooks: CirVerificationHook[] = [
      { kind: "llm", checkNodeId: "verifier-a", onFail: "block" },
      { kind: "llm", checkNodeId: "verifier-b", onFail: "block" },
    ];
    const { context, calls } = createMockContext();
    const node = createToolNode("action", hooks);
    const verifierA = createLlmVerifierNode("verifier-a");
    const verifierB = createLlmVerifierNode("verifier-b");
    const nodeMap = new Map<string, CirNode>([
      ["action", node],
      ["verifier-a", verifierA],
      ["verifier-b", verifierB],
    ]);
    const state = createExecutionState();

    const gen = runVerification("action", hooks, nodeMap, state, context, "all-must-pass");

    // First verifier yields
    gen.next();
    // First verifier fails
    const { result } = collectGeneratorFrom(gen, false);

    expect(result.overallStatus).toBe("block");
    expect(result.hookResults).toHaveLength(1);
    expect(result.hookResults[0].hook).toBe(hooks[0]);
    // Second verifier should not have been called
    expect(calls.llm).toHaveLength(1);
  });

  it("all-must-pass strategy: all pass yields pass report", async () => {
    const hooks: CirVerificationHook[] = [
      { kind: "llm", checkNodeId: "verifier-a", onFail: "block" },
      { kind: "llm", checkNodeId: "verifier-b", onFail: "block" },
    ];
    const { context, calls } = createMockContext();
    const node = createToolNode("action", hooks);
    const verifierA = createLlmVerifierNode("verifier-a");
    const verifierB = createLlmVerifierNode("verifier-b");
    const nodeMap = new Map<string, CirNode>([
      ["action", node],
      ["verifier-a", verifierA],
      ["verifier-b", verifierB],
    ]);
    const state = createExecutionState();

    const gen = runVerification("action", hooks, nodeMap, state, context, "all-must-pass");

    // First verifier yields
    gen.next();
    // First verifier passes, second verifier yields
    gen.next(true);
    // Second verifier passes
    const { result } = collectGeneratorFrom(gen, true);

    expect(result.overallStatus).toBe("pass");
    expect(result.hookResults).toHaveLength(2);
    expect(calls.llm).toHaveLength(2);
  });

  it("first-pass strategy: exits on first pass", async () => {
    const hooks: CirVerificationHook[] = [
      { kind: "llm", checkNodeId: "verifier-a", onFail: "block" },
      { kind: "llm", checkNodeId: "verifier-b", onFail: "block" },
    ];
    const { context, calls } = createMockContext();
    const node = createToolNode("action", hooks);
    const verifierA = createLlmVerifierNode("verifier-a");
    const verifierB = createLlmVerifierNode("verifier-b");
    const nodeMap = new Map<string, CirNode>([
      ["action", node],
      ["verifier-a", verifierA],
      ["verifier-b", verifierB],
    ]);
    const state = createExecutionState();

    const gen = runVerification("action", hooks, nodeMap, state, context, "first-pass");

    // First verifier yields
    gen.next();
    // First verifier passes
    const { result } = collectGeneratorFrom(gen, true);

    expect(result.overallStatus).toBe("pass");
    expect(result.hookResults).toHaveLength(1);
    expect(result.hookResults[0].hook).toBe(hooks[0]);
    // Second verifier should not have been called
    expect(calls.llm).toHaveLength(1);
  });

  it("first-pass strategy: continues to second hook when first fails", async () => {
    const hooks: CirVerificationHook[] = [
      { kind: "llm", checkNodeId: "verifier-a", onFail: "block" },
      { kind: "llm", checkNodeId: "verifier-b", onFail: "block" },
    ];
    const { context, calls } = createMockContext();
    const node = createToolNode("action", hooks);
    const verifierA = createLlmVerifierNode("verifier-a");
    const verifierB = createLlmVerifierNode("verifier-b");
    const nodeMap = new Map<string, CirNode>([
      ["action", node],
      ["verifier-a", verifierA],
      ["verifier-b", verifierB],
    ]);
    const state = createExecutionState();

    const gen = runVerification("action", hooks, nodeMap, state, context, "first-pass");

    // First verifier yields
    gen.next();
    // First verifier fails, second verifier yields
    gen.next(false);
    // Second verifier passes
    const { result } = collectGeneratorFrom(gen, true);

    expect(result.overallStatus).toBe("pass");
    expect(result.hookResults).toHaveLength(2);
    expect(calls.llm).toHaveLength(2);
  });

  it("any-block strategy: exits on first block", async () => {
    const hooks: CirVerificationHook[] = [
      { kind: "llm", checkNodeId: "verifier-a", onFail: "block" },
      { kind: "llm", checkNodeId: "verifier-b", onFail: "block" },
    ];
    const { context, calls } = createMockContext();
    const node = createToolNode("action", hooks);
    const verifierA = createLlmVerifierNode("verifier-a");
    const verifierB = createLlmVerifierNode("verifier-b");
    const nodeMap = new Map<string, CirNode>([
      ["action", node],
      ["verifier-a", verifierA],
      ["verifier-b", verifierB],
    ]);
    const state = createExecutionState();

    const gen = runVerification("action", hooks, nodeMap, state, context, "any-block");

    // First verifier yields
    gen.next();
    // First verifier blocks
    const { result } = collectGeneratorFrom(gen, false);

    expect(result.overallStatus).toBe("block");
    expect(result.hookResults).toHaveLength(1);
    expect(calls.llm).toHaveLength(1);
  });

  it("any-block strategy: continues when hook warns", async () => {
    const hooks: CirVerificationHook[] = [
      { kind: "llm", checkNodeId: "verifier-a", onFail: "warn" },
      { kind: "llm", checkNodeId: "verifier-b", onFail: "block" },
    ];
    const { context, calls } = createMockContext();
    const node = createToolNode("action", hooks);
    const verifierA = createLlmVerifierNode("verifier-a");
    const verifierB = createLlmVerifierNode("verifier-b");
    const nodeMap = new Map<string, CirNode>([
      ["action", node],
      ["verifier-a", verifierA],
      ["verifier-b", verifierB],
    ]);
    const state = createExecutionState();

    const gen = runVerification("action", hooks, nodeMap, state, context, "any-block");

    // First verifier yields
    gen.next();
    // First verifier warns (not a block, continue), second verifier yields
    gen.next(false);
    // Second verifier passes
    const { result } = collectGeneratorFrom(gen, true);

    expect(result.overallStatus).toBe("pass");
    expect(result.hookResults).toHaveLength(2);
    expect(calls.llm).toHaveLength(2);
  });

  it("tracks duration for each hook", async () => {
    const hooks: CirVerificationHook[] = [
      { kind: "llm", checkNodeId: "verifier", onFail: "block" },
    ];
    const { context } = createMockContext();
    const node = createToolNode("action", hooks);
    const verifierNode = createLlmVerifierNode("verifier");
    const nodeMap = new Map<string, CirNode>([
      ["action", node],
      ["verifier", verifierNode],
    ]);
    const state = createExecutionState();

    const gen = runVerification("action", hooks, nodeMap, state, context);
    gen.next();
    const { result } = collectGeneratorFrom(gen, true);

    expect(result.hookResults[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.hookResults[0].durationMs).toBe("number");
  });

  it("handles expression verification hooks without yielding", async () => {
    const hook: CirVerificationHook = { kind: "expression", checkNodeId: "check-expr", onFail: "block" };
    const { context, calls } = createMockContext();
    const node = createToolNode("action", [hook]);
    const conditionNode = createConditionNode("check-expr", "outputs.action.ok");
    const nodeMap = new Map<string, CirNode>([
      ["action", node],
      ["check-expr", conditionNode],
    ]);
    const state = createExecutionState();
    state.outputs["action"] = { ok: true };

    const gen = runVerification("action", [hook], nodeMap, state, context);
    const { result, yields } = collectGenerator(gen);

    // Expression verification should not yield any external actions
    expect(yields).toHaveLength(0);
    expect(result.overallStatus).toBe("pass");
    expect(result.hookResults).toHaveLength(1);
    expect(result.hookResults[0].outcome).toEqual({ status: "pass" });
  });

  it("defaults to all-must-pass strategy when not specified", async () => {
    const hooks: CirVerificationHook[] = [
      { kind: "llm", checkNodeId: "verifier-a", onFail: "block" },
      { kind: "llm", checkNodeId: "verifier-b", onFail: "block" },
    ];
    const { context, calls } = createMockContext();
    const node = createToolNode("action", hooks);
    const verifierA = createLlmVerifierNode("verifier-a");
    const verifierB = createLlmVerifierNode("verifier-b");
    const nodeMap = new Map<string, CirNode>([
      ["action", node],
      ["verifier-a", verifierA],
      ["verifier-b", verifierB],
    ]);
    const state = createExecutionState();

    const gen = runVerification("action", hooks, nodeMap, state, context);

    // First verifier yields
    gen.next();
    // First verifier fails -> should block immediately (all-must-pass default)
    const { result } = collectGeneratorFrom(gen, false);

    expect(result.overallStatus).toBe("block");
    expect(result.hookResults).toHaveLength(1);
    expect(calls.llm).toHaveLength(1);
  });

  it("stores verifier output in state.outputs", async () => {
    const hook: CirVerificationHook = { kind: "llm", checkNodeId: "verifier", onFail: "block" };
    const { context } = createMockContext();
    const node = createToolNode("action", [hook]);
    const verifierNode = createLlmVerifierNode("verifier");
    const nodeMap = new Map<string, CirNode>([
      ["action", node],
      ["verifier", verifierNode],
    ]);
    const state = createExecutionState();

    const gen = runVerification("action", [hook], nodeMap, state, context);
    gen.next();
    collectGeneratorFrom(gen, { passed: true });

    expect(state.outputs["verifier"]).toEqual({ passed: true });
  });

  it("warn outcome does not block even with all-must-pass strategy", async () => {
    const hooks: CirVerificationHook[] = [
      { kind: "llm", checkNodeId: "verifier-a", onFail: "warn" },
      { kind: "llm", checkNodeId: "verifier-b", onFail: "block" },
    ];
    const { context, calls } = createMockContext();
    const node = createToolNode("action", hooks);
    const verifierA = createLlmVerifierNode("verifier-a");
    const verifierB = createLlmVerifierNode("verifier-b");
    const nodeMap = new Map<string, CirNode>([
      ["action", node],
      ["verifier-a", verifierA],
      ["verifier-b", verifierB],
    ]);
    const state = createExecutionState();

    const gen = runVerification("action", hooks, nodeMap, state, context, "all-must-pass");

    // First verifier yields
    gen.next();
    // First verifier warns (not a block), second verifier yields
    gen.next(false);
    // Second verifier passes
    const { result } = collectGeneratorFrom(gen, true);

    expect(result.overallStatus).toBe("pass");
    expect(result.hookResults).toHaveLength(2);
    expect(calls.llm).toHaveLength(2);
  });
});

function collectGeneratorFrom<T>(gen: Generator<YieldItem, T, unknown>, ...nextValues: unknown[]): { yields: YieldItem[]; result: T } {
  const yields: YieldItem[] = [];
  let valueIndex = 0;
  let current = gen.next(nextValues[valueIndex++]);
  while (!current.done) {
    yields.push(current.value);
    current = gen.next(nextValues[valueIndex] ?? undefined);
    valueIndex++;
  }
  return { yields, result: current.value };
}
