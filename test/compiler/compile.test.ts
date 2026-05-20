import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pi-duroxide", () => ({
  registerWorkflow: vi.fn(),
}));

import { registerWorkflow } from "pi-duroxide";
import { compileHarnessSpec } from "../../src/compiler/compile.js";
import type { HarnessSpec } from "../../src/spec/types.js";

interface MockContextCalls {
  tools: Array<{ name: string; args: unknown }>;
  llm: Array<{ messages: unknown[]; options?: unknown }>;
  events: string[];
  merges: unknown[][];
  subworkflows: Array<{ name: string; input: unknown }>;
  timers: number[];
  statuses: unknown[];
}

function createMockContext() {
  const calls: MockContextCalls = {
    tools: [],
    llm: [],
    events: [],
    merges: [],
    subworkflows: [],
    timers: [],
    statuses: [],
  };

  return {
    calls,
    context: {
      scheduleActivity: vi.fn(),
      scheduleActivityWithRetry: vi.fn(),
      scheduleTimer: (delayMs: number) => {
        calls.timers.push(delayMs);
        return { kind: "timer", delayMs };
      },
      waitForEvent: (eventName: string) => {
        calls.events.push(eventName);
        return { kind: "wait-for-event", eventName };
      },
      scheduleSubOrchestration: (name: string, input: unknown) => {
        calls.subworkflows.push({ name, input });
        return { kind: "subworkflow", name, input };
      },
      all: (tasks: unknown[]) => {
        calls.merges.push(tasks);
        return { kind: "all", tasks };
      },
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
      kv: {
        get: vi.fn(),
        set: vi.fn(),
        clear: vi.fn(),
      },
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
    },
  };
}

describe("compileHarnessSpec", () => {
  beforeEach(() => {
    vi.mocked(registerWorkflow).mockReset();
  });

  it("compiles tool nodes into bash tool calls", () => {
    const compiled = compileHarnessSpec(createToolSpec());
    const mock = createMockContext();
    const iterator = compiled.workflows[0].generator(mock.context as any, {});

    expect(compiled.workflows).toHaveLength(1);
    expect(compiled.workflows[0]?.name).toBe("run-diff");
    expect(compiled.workflows[0]?.options).toMatchObject({
      description: "Compiled Lasso harness run-diff",
      timeoutMs: 30000,
    });

    expect(iterator.next().value).toEqual({
      kind: "tool-call",
      name: "bash",
      args: {
        command: "cd /repo && git diff main...feature",
        description: "Lasso tool node run-diff"
      }
    });

    const completed = iterator.next({ stdout: "diff output" });
    expect(completed.done).toBe(true);
    expect(completed.value).toMatchObject({
      status: "completed",
      terminalNodeId: "run-diff",
      outputs: {
        "run-diff": { stdout: "diff output" }
      }
    });
  });

  it("compiles llm nodes into ctx.pi.llm calls", () => {
    const compiled = compileHarnessSpec(createLlmSpec());
    const mock = createMockContext();
    const iterator = compiled.workflows[0].generator(mock.context as any, {});

    const firstYield = iterator.next().value;
    expect(firstYield).toMatchObject({
      kind: "llm-call",
      options: {
        model: "claude-sonnet"
      }
    });
    expect(mock.calls.llm[0]?.messages).toEqual([
      {
        role: "system",
        content: [{ type: "text", text: "Be precise." }]
      },
      {
        role: "user",
        content: [{ type: "text", text: "Summarise the diff." }]
      }
    ]);
  });

  it("compiles human nodes into ctx.waitForEvent calls", () => {
    const compiled = compileHarnessSpec(createHumanSpec());
    const mock = createMockContext();
    const iterator = compiled.workflows[0].generator(mock.context as any, {});

    expect(iterator.next().value).toEqual({
      kind: "wait-for-event",
      eventName: "lasso:human:human-review:approve"
    });
    expect(mock.calls.events).toEqual(["lasso:human:human-review:approve"]);
  });

  it("compiles supported merge branches into ctx.all joins", () => {
    const compiled = compileHarnessSpec(createMergeSpec());
    const mock = createMockContext();
    const iterator = compiled.workflows[0].generator(mock.context as any, {});

    expect(iterator.next().value).toMatchObject({
      kind: "tool-call",
      name: "bash",
    });

    const mergeYield = iterator.next({ loaded: true });
    expect(mergeYield.value).toMatchObject({
      kind: "all",
      tasks: [
        {
          kind: "llm-call",
        },
        {
          kind: "tool-call",
          name: "bash",
        }
      ]
    });
    expect(mock.calls.merges).toHaveLength(1);
    expect(mock.calls.merges[0]).toHaveLength(2);
  });

  it("retries failed node executions with deterministic timers", () => {
    const compiled = compileHarnessSpec(createRetrySpec());
    const mock = createMockContext();
    const iterator = compiled.workflows[0].generator(mock.context as any, {});

    expect(iterator.next().value).toMatchObject({
      kind: "tool-call",
      name: "bash",
    });

    expect(iterator.throw?.(new Error("timeout while running verification"))?.value).toEqual({
      kind: "timer",
      delayMs: 2000
    });

    expect(iterator.next().value).toMatchObject({
      kind: "tool-call",
      name: "bash",
    });
    expect(mock.calls.tools).toHaveLength(2);
    expect(mock.calls.timers).toEqual([2000]);
  });

  it("injects verification nodes after the primary node executes", () => {
    const compiled = compileHarnessSpec(createVerificationSpec());
    const mock = createMockContext();
    const iterator = compiled.workflows[0].generator(mock.context as any, {});

    expect(iterator.next().value).toMatchObject({
      kind: "tool-call",
      name: "bash",
    });

    expect(iterator.next({ ok: true }).value).toMatchObject({
      kind: "llm-call",
      options: {
        model: "claude-sonnet"
      }
    });
  });

  it("defaults verification retries to one actual retry when maxAttempts is omitted", () => {
    const compiled = compileHarnessSpec(createVerificationRetrySpec());
    const mock = createMockContext();
    const iterator = compiled.workflows[0].generator(mock.context as any, {});

    expect(iterator.next().value).toMatchObject({
      kind: "tool-call",
      name: "bash",
    });

    expect(iterator.next({ ok: true }).value).toMatchObject({
      kind: "llm-call",
      options: {
        model: "claude-sonnet"
      }
    });

    expect(iterator.next({ passed: false }).value).toMatchObject({
      kind: "tool-call",
      name: "bash",
    });
  });

  it("rejects ambiguous boolean verification payloads", () => {
    const compiled = compileHarnessSpec(createVerificationSpec());
    const mock = createMockContext();
    const iterator = compiled.workflows[0].generator(mock.context as any, {});

    expect(iterator.next().value).toMatchObject({
      kind: "tool-call",
      name: "bash",
    });
    expect(iterator.next({ ok: true }).value).toMatchObject({
      kind: "llm-call",
    });

    expect(() => iterator.next({ passed: true, ok: false })).toThrow(/Ambiguous boolean status fields: passed, ok/);
  });

  it("routes condition nodes using stored node outputs", () => {
    const compiled = compileHarnessSpec(createConditionSpec());
    const mock = createMockContext();
    const iterator = compiled.workflows[0].generator(mock.context as any, {});

    expect(iterator.next().value).toMatchObject({
      kind: "tool-call",
      name: "bash",
    });

    expect(iterator.next({ ok: true }).value).toEqual({
      kind: "subworkflow",
      name: "yes-branch",
      input: {}
    });
  });

  it("registers compiled workflows through pi-duroxide", () => {
    const compiled = compileHarnessSpec(createToolSpec());

    compiled.register({} as any);

    expect(registerWorkflow).toHaveBeenCalledTimes(1);
    expect(registerWorkflow).toHaveBeenCalledWith(
      "run-diff",
      expect.any(Function),
      expect.objectContaining({
        description: "Compiled Lasso harness run-diff",
        timeoutMs: 30000,
      }),
    );
  });

  it("rejects unsupported multi-step merge shapes at compile time", () => {
    expect(() => compileHarnessSpec(createUnsupportedMergeSpec())).toThrow(/Unsupported parallel merge shape/);
  });

  it("rejects parallel merge branches that rely on failure-routing metadata", () => {
    expect(() => compileHarnessSpec(createFailureRoutedMergeSpec())).toThrow(
      /Unsupported parallel merge shape.*failure-routing metadata/,
    );
  });

  it("rejects verifier nodes with nested verification hooks", () => {
    expect(() => compileHarnessSpec(createNestedVerifierSpec())).toThrow(
      /Verifier node nested-check cannot carry nested verification hooks/,
    );
  });

  it("rejects invalid environment variable names before building bash commands", () => {
    expect(() => compileHarnessSpec(createInvalidEnvSpec()).workflows[0].generator(createMockContext().context as any, {}).next()).toThrow(
      /Invalid environment variable name: BAD=NAME/,
    );
  });

  it("rejects merge convergence outside supported fork-join patterns", () => {
    expect(() => compileHarnessSpec(createConditionalMergeSpec())).toThrow(
      /Unsupported merge execution shape for merge node join/,
    );
  });

  it("preserves trace and adds harnessState to result", () => {
    const compiled = compileHarnessSpec(createToolSpec());
    const mock = createMockContext();
    const iterator = compiled.workflows[0].generator(mock.context as any, { testInput: 42 });

    iterator.next();
    const completed = iterator.next({ stdout: "diff output" });

    expect(completed.done).toBe(true);
    expect(completed.value).toMatchObject({
      status: "completed",
      terminalNodeId: "run-diff",
      outputs: {
        "run-diff": { stdout: "diff output" }
      },
      trace: expect.arrayContaining([
        expect.objectContaining({
          nodeId: "run-diff",
          phase: "enter"
        })
      ])
    });
    
    expect(completed.value.harnessState).toBeDefined();
    expect(completed.value.harnessState.inputs).toEqual({ testInput: 42 });
    expect(completed.value.harnessState.outputs).toEqual({ "run-diff": { stdout: "diff output" } });
    expect(completed.value.harnessState.nodeResults).toEqual({ "run-diff": { stdout: "diff output" } });
    expect(completed.value.harnessState.failures).toEqual([]);
    expect(completed.value.harnessState.metrics).toEqual({ retries: 0, durationMs: expect.any(Number) });
  });

  it("records failures in harnessState when retry occurs", () => {
    const compiled = compileHarnessSpec(createRetrySpec());
    const mock = createMockContext();
    const iterator = compiled.workflows[0].generator(mock.context as any, {});

    // First attempt
    const firstAttempt = iterator.next();
    expect(firstAttempt.value).toMatchObject({
      kind: "tool-call",
      name: "bash",
    });
    
    const errorMessage = "timeout while running verification";
    
    // Throw error to trigger retry
    const afterError = iterator.throw?.(new Error(errorMessage));
    
    // Should get timer for backoff
    expect(afterError?.value).toEqual({
      kind: "timer",
      delayMs: 2000
    });

    // After timer, second attempt
    const secondAttempt = iterator.next();
    expect(secondAttempt.value).toMatchObject({
      kind: "tool-call",
      name: "bash",
    });

    // Complete successfully on second attempt
    const completed = iterator.next({ passed: true });
    expect(completed.done).toBe(true);
    
    // Check that failure was recorded
    expect(completed.value.harnessState.failures).toHaveLength(1);
    expect(completed.value.harnessState.failures[0]).toMatchObject({
      domainType: "lasso",
      rootCause: "tool_timeout",
      nodeId: "verify",
      message: errorMessage,
    });
    
    // Check that retry was counted
    expect(completed.value.harnessState.metrics.retries).toBe(1);
  });

  it("accumulates multiple failures in harnessState during retries", () => {
    const compiled = compileHarnessSpec(createRetrySpec());
    const mock = createMockContext();
    const iterator = compiled.workflows[0].generator(mock.context as any, {});

    // First attempt
    iterator.next();
    
    // First failure
    const afterFirstError = iterator.throw?.(new Error("timeout while running verification"));
    expect(afterFirstError?.value).toEqual({ kind: "timer", delayMs: 2000 });
    
    // Second attempt after timer
    const secondAttempt = iterator.next();
    expect(secondAttempt.value).toMatchObject({ kind: "tool-call" });
    
    // Second failure - should exhaust retries and throw
    expect(() => iterator.throw?.(new Error("timeout while running verification"))).toThrow();
  });

  it("increments retry metric in harnessState for each retry attempt", () => {
    const compiled = compileHarnessSpec(createRetrySpec());
    const mock = createMockContext();
    const iterator = compiled.workflows[0].generator(mock.context as any, {});

    iterator.next();
    const afterError = iterator.throw?.(new Error("timeout while running verification"));
    
    expect(afterError?.value).toEqual({ kind: "timer", delayMs: 2000 });

    const secondAttempt = iterator.next();
    expect(secondAttempt.value).toMatchObject({
      kind: "tool-call",
      name: "bash",
    });

    const completed = iterator.next({ passed: true });
    
    // Verify retry metric was incremented
    expect(completed.value.harnessState.metrics.retries).toBe(1);
    expect(mock.calls.timers).toEqual([2000]);
  });
});

function createToolSpec(): HarnessSpec {
  return {
    name: "run-diff",
    executionPolicy: {
      timeout: 30,
    },
    graph: {
      entryNodeId: "run-diff",
      nodes: [
        {
          id: "run-diff",
          kind: "tool",
          tool: "git",
          args: ["diff", "main...feature"],
          cwd: "/repo",
        },
      ],
      edges: [],
    },
  };
}

function createLlmSpec(): HarnessSpec {
  return {
    name: "summarise-diff",
    graph: {
      entryNodeId: "summarise",
      nodes: [
        {
          id: "summarise",
          kind: "llm",
          provider: "anthropic",
          model: "claude-sonnet",
          system: "Be precise.",
          prompt: "Summarise the diff.",
        },
      ],
      edges: [],
    },
  };
}

function createHumanSpec(): HarnessSpec {
  return {
    name: "human-review",
    graph: {
      entryNodeId: "approve",
      nodes: [
        {
          id: "approve",
          kind: "human",
          prompt: "Approve the merge?",
          interactionType: "approval",
        },
      ],
      edges: [],
    },
  };
}

function createMergeSpec(): HarnessSpec {
  return {
    name: "parallel-review",
    graph: {
      entryNodeId: "load-pr",
      nodes: [
        {
          id: "load-pr",
          kind: "tool",
          tool: "git",
          args: ["status"],
        },
        {
          id: "review",
          kind: "llm",
          provider: "anthropic",
          model: "claude-sonnet",
          prompt: "Review the pull request.",
        },
        {
          id: "verify",
          kind: "tool",
          tool: "npm",
          args: ["test"],
        },
        {
          id: "join",
          kind: "merge",
          waitFor: ["review", "verify"],
        },
        {
          id: "finish",
          kind: "subworkflow",
          specRef: "finish-flow",
        },
      ],
      edges: [
        { from: "load-pr", to: "review" },
        { from: "load-pr", to: "verify" },
        { from: "review", to: "join" },
        { from: "verify", to: "join" },
        { from: "join", to: "finish" },
      ],
    },
  };
}

function createRetrySpec(): HarnessSpec {
  return {
    name: "retry-tool",
    executionPolicy: {
      failureClassification: [
        {
          pattern: "timeout",
          category: "transient",
          retry: true,
        },
      ],
    },
    graph: {
      entryNodeId: "verify",
      nodes: [
        {
          id: "verify",
          kind: "tool",
          tool: "npm",
          args: ["test"],
          retryPolicy: {
            maxAttempts: 2,
            backoff: "constant",
            initialDelay: 2,
            retryOn: ["transient"],
          },
        },
      ],
      edges: [],
    },
  };
}

function createVerificationSpec(): HarnessSpec {
  return {
    name: "verification-flow",
    graph: {
      entryNodeId: "run-check",
      nodes: [
        {
          id: "run-check",
          kind: "tool",
          tool: "npm",
          args: ["test"],
          verificationPolicy: {
            rules: [
              {
                checkNodeId: "confirm-output",
                onFail: "block",
              },
            ],
          },
        },
        {
          id: "confirm-output",
          kind: "llm",
          provider: "anthropic",
          model: "claude-sonnet",
          prompt: "Did the verification pass?",
        },
        {
          id: "finish",
          kind: "subworkflow",
          specRef: "finish-flow",
        },
      ],
      edges: [
        { from: "run-check", to: "confirm-output" },
        { from: "confirm-output", to: "finish" },
      ],
    },
  };
}

function createConditionSpec(): HarnessSpec {
  return {
    name: "condition-flow",
    graph: {
      entryNodeId: "start",
      nodes: [
        {
          id: "start",
          kind: "tool",
          tool: "npm",
          args: ["test"],
        },
        {
          id: "decide",
          kind: "condition",
          condition: "start.ok",
          thenNodeId: "yes",
          elseNodeId: "no",
        },
        {
          id: "yes",
          kind: "subworkflow",
          specRef: "yes-branch",
        },
        {
          id: "no",
          kind: "subworkflow",
          specRef: "no-branch",
        },
      ],
      edges: [
        { from: "start", to: "decide" },
      ],
    },
  };
}

function createVerificationRetrySpec(): HarnessSpec {
  return {
    name: "verification-retry",
    graph: {
      entryNodeId: "run-check",
      nodes: [
        {
          id: "run-check",
          kind: "tool",
          tool: "npm",
          args: ["test"],
          verificationPolicy: {
            rules: [
              {
                checkNodeId: "confirm-output",
                onFail: "retry",
              },
            ],
          },
        },
        {
          id: "confirm-output",
          kind: "llm",
          provider: "anthropic",
          model: "claude-sonnet",
          prompt: "Did the verification pass?",
        },
        {
          id: "finish",
          kind: "subworkflow",
          specRef: "finish-flow",
        },
      ],
      edges: [
        { from: "run-check", to: "confirm-output" },
        { from: "confirm-output", to: "finish" },
      ],
    },
  };
}

function createUnsupportedMergeSpec(): HarnessSpec {
  return {
    name: "unsupported-merge",
    graph: {
      entryNodeId: "start",
      nodes: [
        {
          id: "start",
          kind: "tool",
          tool: "echo",
          args: ["start"],
        },
        {
          id: "branch-a",
          kind: "tool",
          tool: "echo",
          args: ["a"],
        },
        {
          id: "branch-a-followup",
          kind: "tool",
          tool: "echo",
          args: ["a2"],
        },
        {
          id: "branch-b",
          kind: "tool",
          tool: "echo",
          args: ["b"],
        },
        {
          id: "join",
          kind: "merge",
          waitFor: ["branch-a-followup", "branch-b"],
        },
        {
          id: "finish",
          kind: "subworkflow",
          specRef: "finish-flow",
        },
      ],
      edges: [
        { from: "start", to: "branch-a" },
        { from: "start", to: "branch-b" },
        { from: "branch-a", to: "branch-a-followup" },
        { from: "branch-a-followup", to: "join" },
        { from: "branch-b", to: "join" },
        { from: "join", to: "finish" },
      ],
    },
  };
}

function createFailureRoutedMergeSpec(): HarnessSpec {
  return {
    name: "failure-routed-merge",
    graph: {
      entryNodeId: "start",
      nodes: [
        {
          id: "start",
          kind: "tool",
          tool: "echo",
          args: ["start"],
        },
        {
          id: "review",
          kind: "tool",
          tool: "echo",
          args: ["review"],
          executionPolicy: {
            failureClassification: [
              {
                pattern: "timeout",
                category: "transient",
                retry: true,
              },
            ],
          },
        },
        {
          id: "verify",
          kind: "tool",
          tool: "echo",
          args: ["verify"],
        },
        {
          id: "join",
          kind: "merge",
          waitFor: ["review", "verify"],
        },
        {
          id: "finish",
          kind: "subworkflow",
          specRef: "finish-flow",
        },
      ],
      edges: [
        { from: "start", to: "review" },
        { from: "start", to: "verify" },
        { from: "review", to: "join" },
        { from: "verify", to: "join" },
        { from: "join", to: "finish" },
      ],
    },
  };
}

function createNestedVerifierSpec(): HarnessSpec {
  return {
    name: "nested-verifier",
    graph: {
      entryNodeId: "start",
      nodes: [
        {
          id: "start",
          kind: "tool",
          tool: "echo",
          args: ["start"],
          verificationPolicy: {
            rules: [
              {
                checkNodeId: "nested-check",
                onFail: "block",
              },
            ],
          },
        },
        {
          id: "nested-check",
          kind: "tool",
          tool: "echo",
          args: ["nested"],
          verificationPolicy: {
            rules: [
              {
                checkNodeId: "final-check",
                onFail: "block",
              },
            ],
          },
        },
        {
          id: "final-check",
          kind: "tool",
          tool: "echo",
          args: ["final"],
        },
      ],
      edges: [
        { from: "start", to: "nested-check" },
        { from: "nested-check", to: "final-check" },
      ],
    },
  };
}

function createInvalidEnvSpec(): HarnessSpec {
  return {
    name: "invalid-env",
    graph: {
      entryNodeId: "run",
      nodes: [
        {
          id: "run",
          kind: "tool",
          tool: "printenv",
          args: ["HOME"],
          env: {
            "BAD=NAME": "oops",
          },
        },
      ],
      edges: [],
    },
  };
}

function createConditionalMergeSpec(): HarnessSpec {
  return {
    name: "conditional-merge",
    graph: {
      entryNodeId: "start",
      nodes: [
        {
          id: "start",
          kind: "tool",
          tool: "echo",
          args: ["start"],
        },
        {
          id: "decide",
          kind: "condition",
          condition: "start.ok",
          thenNodeId: "yes-branch",
          elseNodeId: "no-branch",
        },
        {
          id: "yes-branch",
          kind: "tool",
          tool: "echo",
          args: ["yes"],
        },
        {
          id: "no-branch",
          kind: "tool",
          tool: "echo",
          args: ["no"],
        },
        {
          id: "join",
          kind: "merge",
          waitFor: ["yes-branch", "no-branch"],
        },
        {
          id: "finish",
          kind: "subworkflow",
          specRef: "finish-flow",
        },
      ],
      edges: [
        { from: "start", to: "decide" },
        { from: "yes-branch", to: "join" },
        { from: "no-branch", to: "join" },
        { from: "join", to: "finish" },
      ],
    },
  };
}
