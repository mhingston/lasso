import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pi-duroxide", () => ({
  registerWorkflow: vi.fn(),
}));

import { compileHarnessSpec } from "../../src/compiler/compile.js";
import { GuardrailExceededError } from "../../src/compiler/runtime-helpers.js";
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

describe("per-node guardrails", () => {
  it("enforces per-node maxRetries overriding global retryPolicy", () => {
    const spec: HarnessSpec = {
      name: "per-node-retry-override",
      executionPolicy: {
        failureClassification: [
          { pattern: "transient", category: "transient", retry: true },
        ],
      },
      graph: {
        entryNodeId: "action",
        nodes: [
          {
            id: "action",
            kind: "tool",
            tool: "bash",
            args: ["echo fail"],
            retryPolicy: {
              maxAttempts: 5,
              backoff: "constant",
              initialDelay: 2,
              retryOn: ["transient"],
            },
            guardrails: {
              maxRetries: 1,
            },
          },
        ],
        edges: [],
      },
    };

    const compiled = compileHarnessSpec(spec);
    const mock = {
      calls: { timers: [] as number[] },
      context: createMockContext(),
    };
    mock.context.scheduleTimer = (delayMs: number) => {
      mock.calls.timers.push(delayMs);
      return { kind: "timer", delayMs };
    };
    const iterator = compiled.workflows[0].generator(mock.context as any, {});

    // First attempt
    expect(iterator.next().value).toMatchObject({ kind: "tool-call" });

    // Throw to trigger retry — with initialDelay=2, we get a timer
    const retryYield = iterator.throw(new Error("transient failure"));
    expect(retryYield.value).toEqual({ kind: "timer", delayMs: 2000 });
    expect(mock.calls.timers).toEqual([2000]);

    // Second attempt (retry 1 — maxRetries=1 allows 1 retry = 2 total attempts)
    expect(iterator.next().value).toMatchObject({ kind: "tool-call" });

    // Second failure should exhaust retries (maxRetries=1 means maxAttempts=2)
    let threw = false;
    try {
      iterator.throw(new Error("transient failure"));
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("enforces per-node maxCostUsd on LLM nodes (per-node delta, not cumulative)", () => {
    const spec: HarnessSpec = {
      name: "per-node-cost",
      graph: {
        entryNodeId: "llm-first",
        nodes: [
          {
            id: "llm-first",
            kind: "llm",
            provider: "anthropic",
            model: "claude-sonnet",
            prompt: "Do something first",
          },
          {
            id: "llm-second",
            kind: "llm",
            provider: "anthropic",
            model: "claude-sonnet",
            prompt: "Do something second",
            guardrails: {
              maxCostUsd: 0.005,
            },
          },
        ],
        edges: [
          { from: "llm-first", to: "llm-second" },
        ],
      },
    };

    const compiled = compileHarnessSpec(spec);
    const ctx = createMockContext();
    const iterator = compiled.workflows[0].generator(ctx as any, {});

    // First LLM yields
    expect(iterator.next().value).toMatchObject({ kind: "llm-call" });

    // First LLM returns → cost += 0.01, moves to llm-second
    // Per-node check: nodeStartCost=0.01, maxCostUsd=0.005 → pre-check passes (delta not yet measured)
    // llm-second yields
    expect(iterator.next("output1").value).toMatchObject({ kind: "llm-call" });

    // llm-second returns → cost += 0.01 (cumulative = 0.02)
    // Per-node delta check: nodeCost = 0.02 - 0.01 = 0.01 > 0.005 → should throw
    let thrownError: unknown;
    try {
      iterator.next("output2");
    } catch (error) {
      thrownError = error;
    }
    expect(thrownError).toBeInstanceOf(GuardrailExceededError);
    expect((thrownError as GuardrailExceededError).message).toContain("Per-node cost limit exceeded");
    expect((thrownError as GuardrailExceededError).message).toContain("llm-second");
  });

  it("evaluates per-node constraints before executing the node", () => {
    const spec: HarnessSpec = {
      name: "per-node-constraints",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "tool",
            tool: "echo",
            args: ["hello"],
          },
          {
            id: "guarded",
            kind: "tool",
            tool: "echo",
            args: ["should not run"],
            guardrails: {
              constraints: ["outputs.start.ok"],
            },
          },
          {
            id: "fallback",
            kind: "tool",
            tool: "echo",
            args: ["fallback"],
          },
        ],
        edges: [
          { from: "start", to: "guarded" },
          { from: "guarded", to: "fallback" },
        ],
      },
    };

    const compiled = compileHarnessSpec(spec);
    const ctx = createMockContext();
    const iterator = compiled.workflows[0].generator(ctx as any, {});

    // First node executes
    expect(iterator.next().value).toMatchObject({ kind: "tool-call" });

    // Return { ok: false } — constraint "outputs.start.ok" will be falsy
    // The constraint check should throw before guarded executes
    let thrownError: unknown;
    try {
      iterator.next({ ok: false });
    } catch (error) {
      thrownError = error;
    }
    expect(thrownError).toBeInstanceOf(GuardrailExceededError);
    expect((thrownError as GuardrailExceededError).message).toContain("Constraint failed");
    expect((thrownError as GuardrailExceededError).message).toContain("outputs.start.ok");
  });

  it("allows execution when per-node constraints pass", () => {
    const spec: HarnessSpec = {
      name: "per-node-constraints-pass",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "tool",
            tool: "echo",
            args: ["hello"],
          },
          {
            id: "guarded",
            kind: "tool",
            tool: "echo",
            args: ["should run"],
            guardrails: {
              constraints: ["outputs.start.ok"],
            },
          },
        ],
        edges: [
          { from: "start", to: "guarded" },
        ],
      },
    };

    const compiled = compileHarnessSpec(spec);
    const ctx = createMockContext();
    const iterator = compiled.workflows[0].generator(ctx as any, {});

    expect(iterator.next().value).toMatchObject({ kind: "tool-call" });
    // Return { ok: true } — constraint passes
    expect(iterator.next({ ok: true }).value).toMatchObject({ kind: "tool-call" });
    const completed = iterator.next("done");
    expect(completed.done).toBe(true);
    expect(completed.value.status).toBe("completed");
  });

  it("enforces per-node timeoutSeconds by checking elapsed time after yield", () => {
    const spec: HarnessSpec = {
      name: "per-node-timeout",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "tool",
            tool: "echo",
            args: ["first"],
          },
          {
            id: "slow-node",
            kind: "tool",
            tool: "echo",
            args: ["too slow"],
            guardrails: {
              timeoutSeconds: 1,
            },
          },
        ],
        edges: [
          { from: "start", to: "slow-node" },
        ],
      },
    };

    const compiled = compileHarnessSpec(spec);
    const ctx = createMockContext();
    const iterator = compiled.workflows[0].generator(ctx as any, {});

    // Mock Date.now before iteration starts so nodeStartTime uses mocked time
    const originalNow = Date.now;
    let fakeTime = 1000;
    Date.now = () => fakeTime;

    try {
      // First node executes fine (fakeTime=1000, no guardrails timeout)
      expect(iterator.next().value).toMatchObject({ kind: "tool-call" });
      expect(iterator.next("ok").value).toMatchObject({ kind: "tool-call" });

      // slow-node yielded. Advance time by 2 seconds (past 1s timeout)
      fakeTime = 3500;

      let thrownError: unknown;
      try {
        iterator.next("done");
      } catch (error) {
        thrownError = error;
      }
      expect(thrownError).toBeInstanceOf(GuardrailExceededError);
      expect((thrownError as GuardrailExceededError).message).toContain("timeout exceeded");
      expect((thrownError as GuardrailExceededError).message).toContain("slow-node");
    } finally {
      Date.now = originalNow;
    }
  });

  it("global guardrails still work alongside per-node guardrails", () => {
    const spec: HarnessSpec = {
      name: "mixed-guardrails",
      executionPolicy: {
        maxSteps: 3,
      },
      graph: {
        entryNodeId: "step-0",
        nodes: [
          {
            id: "step-0",
            kind: "tool",
            tool: "echo",
            args: ["0"],
            guardrails: {
              constraints: ["outputs.step-0.ok"],
            },
          },
          {
            id: "step-1",
            kind: "tool",
            tool: "echo",
            args: ["1"],
          },
          {
            id: "step-2",
            kind: "tool",
            tool: "echo",
            args: ["2"],
          },
          {
            id: "step-3",
            kind: "tool",
            tool: "echo",
            args: ["3"],
          },
        ],
        edges: [
          { from: "step-0", to: "step-1" },
          { from: "step-1", to: "step-2" },
          { from: "step-2", to: "step-3" },
        ],
      },
    };

    const compiled = compileHarnessSpec(spec);
    const ctx = createMockContext();
    const iterator = compiled.workflows[0].generator(ctx as any, {});

    // step-0 has constraint on outputs.step-0.ok — but there's no prior output for step-0
    // The constraint check happens before step-0 executes, so outputs.step-0 doesn't exist yet
    // This means the constraint will fail
    let thrownError: unknown;
    try {
      iterator.next();
    } catch (error) {
      thrownError = error;
    }
    expect(thrownError).toBeInstanceOf(GuardrailExceededError);
    expect((thrownError as GuardrailExceededError).message).toContain("Constraint failed");
  });
});

describe("per-node verification hooks", () => {
  it("runs verification hooks after node execution and blocks on failure", () => {
    const spec: HarnessSpec = {
      name: "verify-block",
      graph: {
        entryNodeId: "action",
        nodes: [
          {
            id: "action",
            kind: "tool",
            tool: "bash",
            args: ["echo test"],
            verificationHooks: [
              {
                name: "check-output",
                kind: "llm",
                check: "Did the test pass?",
                onFail: "block",
              },
            ],
          },
          {
            id: "after",
            kind: "tool",
            tool: "echo",
            args: ["done"],
          },
        ],
        edges: [
          { from: "action", to: "after" },
        ],
      },
    };

    const compiled = compileHarnessSpec(spec);
    const ctx = createMockContext();
    const iterator = compiled.workflows[0].generator(ctx as any, {});

    // Primary node executes
    expect(iterator.next().value).toMatchObject({ kind: "tool-call" });

    // Verification hook runs (LLM verifier)
    expect(iterator.next({ ok: true }).value).toMatchObject({ kind: "llm-call" });

    // Verifier returns false → block
    let thrownError: unknown;
    try {
      iterator.next({ passed: false });
    } catch (error) {
      thrownError = error;
    }
    expect(thrownError).toBeDefined();
    expect((thrownError as Error).message).toContain("Verification hook");
    expect((thrownError as Error).message).toContain("check-output");
    expect((thrownError as Error).message).toContain("blocked");
  });

  it("runs verification hooks and warns on failure without halting", () => {
    const spec: HarnessSpec = {
      name: "verify-warn",
      graph: {
        entryNodeId: "action",
        nodes: [
          {
            id: "action",
            kind: "tool",
            tool: "bash",
            args: ["echo test"],
            verificationHooks: [
              {
                name: "soft-check",
                kind: "llm",
                check: "Is this OK?",
                onFail: "warn",
              },
            ],
          },
          {
            id: "after",
            kind: "tool",
            tool: "echo",
            args: ["done"],
          },
        ],
        edges: [
          { from: "action", to: "after" },
        ],
      },
    };

    const compiled = compileHarnessSpec(spec);
    const ctx = createMockContext();
    const iterator = compiled.workflows[0].generator(ctx as any, {});

    // Primary node executes
    expect(iterator.next().value).toMatchObject({ kind: "tool-call" });

    // Verification hook runs
    expect(iterator.next({ ok: true }).value).toMatchObject({ kind: "llm-call" });

    // Verifier returns false → warn, but execution continues
    expect(iterator.next({ passed: false }).value).toMatchObject({ kind: "tool-call" });

    const completed = iterator.next("done");
    expect(completed.done).toBe(true);
    expect(completed.value.status).toBe("completed");
  });

  it("runs verification hooks and retries the node on failure", () => {
    const spec: HarnessSpec = {
      name: "verify-retry",
      graph: {
        entryNodeId: "action",
        nodes: [
          {
            id: "action",
            kind: "tool",
            tool: "bash",
            args: ["echo test"],
            verificationHooks: [
              {
                name: "retry-check",
                kind: "llm",
                check: "Did it work?",
                onFail: "retry",
                maxAttempts: 2,
              },
            ],
          },
          {
            id: "after",
            kind: "tool",
            tool: "echo",
            args: ["done"],
          },
        ],
        edges: [
          { from: "action", to: "after" },
        ],
      },
    };

    const compiled = compileHarnessSpec(spec);
    const ctx = createMockContext();
    const iterator = compiled.workflows[0].generator(ctx as any, {});

    // First attempt: primary node
    expect(iterator.next().value).toMatchObject({ kind: "tool-call" });

    // Verification runs
    expect(iterator.next({ ok: true }).value).toMatchObject({ kind: "llm-call" });

    // Verification fails → retry (attempt 1 of maxAttempts=2)
    // Should re-execute the primary node
    expect(iterator.next({ passed: false }).value).toMatchObject({ kind: "tool-call" });

    // Second attempt verification runs
    expect(iterator.next({ ok: true }).value).toMatchObject({ kind: "llm-call" });

    // Verification fails again → retry exhausted
    let thrownError: unknown;
    try {
      iterator.next({ passed: false });
    } catch (error) {
      thrownError = error;
    }
    expect(thrownError).toBeDefined();
    expect((thrownError as Error).message).toContain("Verification hook");
    expect((thrownError as Error).message).toContain("retry exhausted");
  });

  it("defaults maxAttempts to 2 for retry verification hooks", () => {
    const spec: HarnessSpec = {
      name: "verify-retry-default",
      graph: {
        entryNodeId: "action",
        nodes: [
          {
            id: "action",
            kind: "tool",
            tool: "bash",
            args: ["echo test"],
            verificationHooks: [
              {
                name: "default-retry",
                kind: "llm",
                check: "Did it work?",
                onFail: "retry",
              },
            ],
          },
        ],
        edges: [],
      },
    };

    const compiled = compileHarnessSpec(spec);
    const ctx = createMockContext();
    const iterator = compiled.workflows[0].generator(ctx as any, {});

    // First attempt
    expect(iterator.next().value).toMatchObject({ kind: "tool-call" });
    expect(iterator.next({ ok: true }).value).toMatchObject({ kind: "llm-call" });

    // Fail → retry (maxAttempts defaults to 2, so 1 retry)
    expect(iterator.next({ passed: false }).value).toMatchObject({ kind: "tool-call" });

    // Second attempt
    expect(iterator.next({ ok: true }).value).toMatchObject({ kind: "llm-call" });

    // Fail again → exhausted
    let thrownError: unknown;
    try {
      iterator.next({ passed: false });
    } catch (error) {
      thrownError = error;
    }
    expect(thrownError).toBeDefined();
    expect((thrownError as Error).message).toContain("retry exhausted");
  });

  it("runs multiple verification hooks in order", () => {
    const spec: HarnessSpec = {
      name: "verify-multiple",
      graph: {
        entryNodeId: "action",
        nodes: [
          {
            id: "action",
            kind: "tool",
            tool: "bash",
            args: ["echo test"],
            verificationHooks: [
              {
                name: "first-check",
                kind: "llm",
                check: "First check?",
                onFail: "block",
              },
              {
                name: "second-check",
                kind: "llm",
                check: "Second check?",
                onFail: "block",
              },
            ],
          },
          {
            id: "after",
            kind: "tool",
            tool: "echo",
            args: ["done"],
          },
        ],
        edges: [
          { from: "action", to: "after" },
        ],
      },
    };

    const compiled = compileHarnessSpec(spec);
    const ctx = createMockContext();
    const iterator = compiled.workflows[0].generator(ctx as any, {});

    // Primary node
    expect(iterator.next().value).toMatchObject({ kind: "tool-call" });

    // First verification hook
    expect(iterator.next({ ok: true }).value).toMatchObject({ kind: "llm-call" });

    // First hook passes → second verification hook
    expect(iterator.next({ passed: true }).value).toMatchObject({ kind: "llm-call" });

    // Second hook passes → proceed to next node
    expect(iterator.next({ approved: true }).value).toMatchObject({ kind: "tool-call" });

    const completed = iterator.next("done");
    expect(completed.done).toBe(true);
    expect(completed.value.status).toBe("completed");
  });

  it("stops early when first verification hook fails with block", () => {
    const spec: HarnessSpec = {
      name: "verify-early-stop",
      graph: {
        entryNodeId: "action",
        nodes: [
          {
            id: "action",
            kind: "tool",
            tool: "bash",
            args: ["echo test"],
            verificationHooks: [
              {
                name: "first-check",
                kind: "llm",
                check: "First check?",
                onFail: "block",
              },
              {
                name: "second-check",
                kind: "llm",
                check: "Second check?",
                onFail: "block",
              },
            ],
          },
        ],
        edges: [],
      },
    };

    const compiled = compileHarnessSpec(spec);
    const ctx = createMockContext();
    const iterator = compiled.workflows[0].generator(ctx as any, {});

    // Primary node
    expect(iterator.next().value).toMatchObject({ kind: "tool-call" });

    // First verification hook
    expect(iterator.next({ ok: true }).value).toMatchObject({ kind: "llm-call" });

    // First hook fails → block, second hook should NOT run
    let thrownError: unknown;
    try {
      iterator.next({ passed: false });
    } catch (error) {
      thrownError = error;
    }
    expect(thrownError).toBeDefined();
    expect((thrownError as Error).message).toContain("first-check");
  });

  it("runs expression-based verification hooks without yielding", () => {
    const spec: HarnessSpec = {
      name: "verify-expression",
      graph: {
        entryNodeId: "action",
        nodes: [
          {
            id: "action",
            kind: "tool",
            tool: "bash",
            args: ["echo test"],
            verificationHooks: [
              {
                name: "expr-check",
                kind: "expression",
                check: "outputs.action.ok",
                onFail: "block",
              },
            ],
          },
          {
            id: "after",
            kind: "tool",
            tool: "echo",
            args: ["done"],
          },
        ],
        edges: [
          { from: "action", to: "after" },
        ],
      },
    };

    const compiled = compileHarnessSpec(spec);
    const ctx = createMockContext();
    const iterator = compiled.workflows[0].generator(ctx as any, {});

    // Primary node executes
    expect(iterator.next().value).toMatchObject({ kind: "tool-call" });

    // Expression verification evaluates inline (no yield) → passes
    expect(iterator.next({ ok: true }).value).toMatchObject({ kind: "tool-call" });

    const completed = iterator.next("done");
    expect(completed.done).toBe(true);
    expect(completed.value.status).toBe("completed");
  });

  it("expression verification hook fails when expression is falsy", () => {
    const spec: HarnessSpec = {
      name: "verify-expression-fail",
      graph: {
        entryNodeId: "action",
        nodes: [
          {
            id: "action",
            kind: "tool",
            tool: "bash",
            args: ["echo test"],
            verificationHooks: [
              {
                name: "expr-check",
                kind: "expression",
                check: "outputs.action.ok",
                onFail: "block",
              },
            ],
          },
        ],
        edges: [],
      },
    };

    const compiled = compileHarnessSpec(spec);
    const ctx = createMockContext();
    const iterator = compiled.workflows[0].generator(ctx as any, {});

    // Primary node executes
    expect(iterator.next().value).toMatchObject({ kind: "tool-call" });

    // Return { ok: false } → expression fails → block
    let thrownError: unknown;
    try {
      iterator.next({ ok: false });
    } catch (error) {
      thrownError = error;
    }
    expect(thrownError).toBeDefined();
    expect((thrownError as Error).message).toContain("expr-check");
    expect((thrownError as Error).message).toContain("blocked");
  });

  it("nodes without verificationHooks work normally", () => {
    const spec: HarnessSpec = {
      name: "no-hooks",
      graph: {
        entryNodeId: "action",
        nodes: [
          {
            id: "action",
            kind: "tool",
            tool: "bash",
            args: ["echo test"],
          },
          {
            id: "after",
            kind: "tool",
            tool: "echo",
            args: ["done"],
          },
        ],
        edges: [
          { from: "action", to: "after" },
        ],
      },
    };

    const compiled = compileHarnessSpec(spec);
    const ctx = createMockContext();
    const iterator = compiled.workflows[0].generator(ctx as any, {});

    expect(iterator.next().value).toMatchObject({ kind: "tool-call" });
    expect(iterator.next("ok").value).toMatchObject({ kind: "tool-call" });
    const completed = iterator.next("done");
    expect(completed.done).toBe(true);
    expect(completed.value.status).toBe("completed");
  });
});

describe("per-node guardrails and verification hooks combined", () => {
  it("enforces guardrails before verification hooks", () => {
    const spec: HarnessSpec = {
      name: "guardrails-before-verify",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "tool",
            tool: "echo",
            args: ["go"],
          },
          {
            id: "action",
            kind: "tool",
            tool: "bash",
            args: ["echo action"],
            guardrails: {
              constraints: ["outputs.start.proceed"],
            },
            verificationHooks: [
              {
                name: "post-check",
                kind: "llm",
                check: "Was it correct?",
                onFail: "block",
              },
            ],
          },
        ],
        edges: [
          { from: "start", to: "action" },
        ],
      },
    };

    const compiled = compileHarnessSpec(spec);
    const ctx = createMockContext();
    const iterator = compiled.workflows[0].generator(ctx as any, {});

    // start executes
    expect(iterator.next().value).toMatchObject({ kind: "tool-call" });

    // start returns { proceed: false } → constraint fails → guardrail error
    let thrownError: unknown;
    try {
      iterator.next({ proceed: false });
    } catch (error) {
      thrownError = error;
    }
    expect(thrownError).toBeInstanceOf(GuardrailExceededError);
    expect((thrownError as GuardrailExceededError).message).toContain("Constraint failed");
  });

  it("verification hooks run after guardrails pass", () => {
    const spec: HarnessSpec = {
      name: "guardrails-pass-verify-runs",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "tool",
            tool: "echo",
            args: ["go"],
          },
          {
            id: "action",
            kind: "tool",
            tool: "bash",
            args: ["echo action"],
            guardrails: {
              constraints: ["outputs.start.proceed"],
            },
            verificationHooks: [
              {
                name: "post-check",
                kind: "llm",
                check: "Was it correct?",
                onFail: "block",
              },
            ],
          },
          {
            id: "after",
            kind: "tool",
            tool: "echo",
            args: ["done"],
          },
        ],
        edges: [
          { from: "start", to: "action" },
          { from: "action", to: "after" },
        ],
      },
    };

    const compiled = compileHarnessSpec(spec);
    const ctx = createMockContext();
    const iterator = compiled.workflows[0].generator(ctx as any, {});

    // start executes
    expect(iterator.next().value).toMatchObject({ kind: "tool-call" });

    // start returns { proceed: true } → constraint passes → action executes
    expect(iterator.next({ proceed: true }).value).toMatchObject({ kind: "tool-call" });

    // action returns → verification hook runs
    expect(iterator.next({ result: "ok" }).value).toMatchObject({ kind: "llm-call" });

    // Verifier passes → continue
    expect(iterator.next({ approved: true }).value).toMatchObject({ kind: "tool-call" });

    const completed = iterator.next("done");
    expect(completed.done).toBe(true);
    expect(completed.value.status).toBe("completed");
  });
});
