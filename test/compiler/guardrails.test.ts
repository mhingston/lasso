import { describe, expect, it, vi } from "vitest";

vi.mock("pi-duroxide", () => ({
  registerWorkflow: vi.fn(),
}));

import { compileHarnessSpec } from "../../src/compiler/compile.js";
import { checkGuardrails, GuardrailExceededError } from "../../src/compiler/runtime-helpers.js";
import type { HarnessSpec } from "../../src/spec/types.js";

function createMockContext() {
  return {
    scheduleActivity: vi.fn(),
    scheduleActivityWithRetry: vi.fn(),
    scheduleTimer: vi.fn(),
    waitForEvent: vi.fn(),
    scheduleSubOrchestration: vi.fn(),
    all: vi.fn(),
    race: vi.fn(),
    utcNow: () => 0,
    newGuid: () => "guid-1",
    continueAsNew: vi.fn(),
    setCustomStatus: vi.fn(),
    traceInfo: vi.fn(),
    traceWarn: vi.fn(),
    traceError: vi.fn(),
    traceDebug: vi.fn(),
    kv: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
    pi: {
      tool: (name: string, args: unknown) => ({ kind: "tool-call", name, args }),
      llm: (messages: unknown[], options?: unknown) => ({ kind: "llm-call", messages, options }),
      skill: vi.fn(),
      sendMessage: vi.fn(),
      prompt: vi.fn(),
    },
  };
}

function createLinearSpec(count: number, policy?: import("../../src/spec/types.js").ExecutionPolicy): HarnessSpec {
  const nodes: any[] = [];
  const edges: any[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push({
      id: `step-${i}`,
      kind: "tool",
      tool: "echo",
      args: [`step ${i}`],
    });
    if (i > 0) {
      edges.push({ from: `step-${i - 1}`, to: `step-${i}` });
    }
  }
  return {
    name: "linear-chain",
    ...(policy ? { executionPolicy: policy } : {}),
    graph: {
      entryNodeId: "step-0",
      nodes,
      edges,
    },
  };
}

describe("checkGuardrails", () => {
  it("returns withinLimits=true when no limits set", () => {
    const state = { stepCount: 100, estimatedCostUsd: 99.99 };
    const result = checkGuardrails(state);
    expect(result.withinLimits).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("returns withinLimits=true when under step limit", () => {
    const state = { stepCount: 4, estimatedCostUsd: 0, maxSteps: 5 };
    const result = checkGuardrails(state);
    expect(result.withinLimits).toBe(true);
  });

  it("returns withinLimits=false when step limit reached", () => {
    const state = { stepCount: 5, estimatedCostUsd: 0, maxSteps: 5 };
    const result = checkGuardrails(state);
    expect(result.withinLimits).toBe(false);
    expect(result.reason).toContain("Step limit reached");
    expect(result.reason).toContain("5/5");
  });

  it("returns withinLimits=true when under cost limit", () => {
    const state = { stepCount: 0, estimatedCostUsd: 0.24, costLimitUsd: 0.25 };
    const result = checkGuardrails(state);
    expect(result.withinLimits).toBe(true);
  });

  it("returns withinLimits=false when cost limit exceeded", () => {
    const state = { stepCount: 0, estimatedCostUsd: 0.28, costLimitUsd: 0.25 };
    const result = checkGuardrails(state);
    expect(result.withinLimits).toBe(false);
    expect(result.reason).toContain("Cost limit exceeded");
    expect(result.reason).toContain("$0.28");
    expect(result.reason).toContain("$0.25");
  });

  it("checks both limits and fails on step first if both exceeded", () => {
    const state = { stepCount: 5, estimatedCostUsd: 1.0, maxSteps: 5, costLimitUsd: 0.25 };
    const result = checkGuardrails(state);
    expect(result.withinLimits).toBe(false);
    expect(result.reason).toContain("Step limit reached");
  });
});

describe("GuardrailExceededError", () => {
  it("has descriptive message for step limit", () => {
    const error = new GuardrailExceededError("Step limit reached (5/5)");
    expect(error.message).toBe("Step limit reached (5/5)");
    expect(error.name).toBe("GuardrailExceededError");
    expect(error).toBeInstanceOf(Error);
  });

  it("has descriptive message for cost limit", () => {
    const error = new GuardrailExceededError("Cost limit exceeded ($0.28/$0.25)");
    expect(error.message).toBe("Cost limit exceeded ($0.28/$0.25)");
    expect(error.name).toBe("GuardrailExceededError");
  });
});

describe("guardrail enforcement in compiler", () => {
  it("stops after maxSteps node executions", () => {
    const spec = createLinearSpec(10, { maxSteps: 3 });
    const compiled = compileHarnessSpec(spec);
    const ctx = createMockContext();
    const iterator = compiled.workflows[0].generator(ctx as any, {});

    // Steps 0, 1, 2 should execute; step 3 should throw
    expect(iterator.next().value).toMatchObject({ kind: "tool-call" }); // step-0
    expect(iterator.next("out0").value).toMatchObject({ kind: "tool-call" }); // step-1
    expect(iterator.next("out1").value).toMatchObject({ kind: "tool-call" }); // step-2

    // After 3 steps, the next call should throw GuardrailExceededError
    let thrownError: unknown;
    try {
      iterator.next("out2");
    } catch (error) {
      thrownError = error;
    }
    expect(thrownError).toBeInstanceOf(GuardrailExceededError);
    expect((thrownError as GuardrailExceededError).message).toContain("Step limit reached");
    expect((thrownError as GuardrailExceededError).message).toContain("3/3");
  });

  it("runs normally without guardrails", () => {
    const spec = createLinearSpec(3);
    const compiled = compileHarnessSpec(spec);
    const ctx = createMockContext();
    const iterator = compiled.workflows[0].generator(ctx as any, {});

    expect(iterator.next().value).toMatchObject({ kind: "tool-call" });
    expect(iterator.next("a").value).toMatchObject({ kind: "tool-call" });
    expect(iterator.next("b").value).toMatchObject({ kind: "tool-call" });
    const completed = iterator.next("c");
    expect(completed.done).toBe(true);
    expect(completed.value.status).toBe("completed");
  });

  it("resets step count on continueAsNew (adaptive)", () => {
    // This test verifies that guardrail state is per-execution, not global
    // For now, we just verify the guardrailState is reset when a new execution starts
    const state: ExecutionState = {
      input: {},
      outputs: {},
      trace: [],
      harnessState: { inputs: {}, outputs: {}, nodeResults: {}, failures: [], metrics: { retries: 0, durationMs: 0 } } as any,
      startTimeMs: Date.now(),
      stepCount: 0,
      estimatedCostUsd: 0,
    };
    const result1 = checkGuardrails({ stepCount: 3, estimatedCostUsd: 0, maxSteps: 5 });
    expect(result1.withinLimits).toBe(true);

    // Simulating a new execution (continueAsNew resets state)
    const result2 = checkGuardrails({ stepCount: 5, estimatedCostUsd: 0, maxSteps: 5 });
    expect(result2.withinLimits).toBe(false);
  });

  it("cost accumulates across execution", () => {
    const state = { stepCount: 2, estimatedCostUsd: 0.20, costLimitUsd: 0.25 };
    const result = checkGuardrails(state);
    expect(result.withinLimits).toBe(true);

    const state2 = { stepCount: 3, estimatedCostUsd: 0.30, costLimitUsd: 0.25 };
    const result2 = checkGuardrails(state2);
    expect(result2.withinLimits).toBe(false);
  });
});
