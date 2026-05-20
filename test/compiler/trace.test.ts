import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("pi-duroxide", () => ({
  registerWorkflow: vi.fn(),
}));

import { compileHarnessSpec } from "../../src/compiler/compile.js";
import { recordTrace, type ExecutionState, type ExecutionTraceEntry } from "../../src/compiler/runtime-helpers.js";
import type { CirNode } from "../../src/cir/types.js";
import type { HarnessSpec } from "../../src/spec/types.js";
import { createLineageEntry, createInitialVersion } from "../../src/versioning/history.js";
import type { HarnessExecutionTrace } from "../../src/versioning/types.js";

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

function makeNode(id: string): CirNode {
  return {
    id,
    kind: "tool",
    source: { specNodeId: id, specNodeKind: "tool", specPath: `graph.nodes[0]` },
    action: { tool: "echo", args: ["test"] },
  } as CirNode;
}

function makeState(overrides?: Partial<ExecutionState>): ExecutionState {
  return {
    input: {},
    outputs: {},
    trace: [],
    harnessState: {
      inputs: {},
      outputs: {},
      nodeResults: {},
      failures: [],
      metrics: { retries: 0, durationMs: 0 },
    },
    startTimeMs: Date.now(),
    ...overrides,
  };
}

describe("ExecutionTraceEntry enrichment", () => {
  describe("recordTrace", () => {
    it("captures startedAt on enter phase", () => {
      const ctx = createMockContext();
      const state = makeState();
      const node = makeNode("n1");
      const before = Date.now();

      recordTrace(ctx.context as any, state, node, "enter");

      const entry = state.trace[0];
      expect(entry.startedAt).toBeDefined();
      expect(entry.startedAt!).toBeGreaterThanOrEqual(before);
      expect(entry.startedAt!).toBeLessThanOrEqual(Date.now());
      expect(entry.completedAt).toBeUndefined();
    });

    it("captures completedAt on success phase", () => {
      const ctx = createMockContext();
      const state = makeState();
      const node = makeNode("n1");
      const before = Date.now();

      recordTrace(ctx.context as any, state, node, "success");

      const entry = state.trace[0];
      expect(entry.completedAt).toBeDefined();
      expect(entry.completedAt!).toBeGreaterThanOrEqual(before);
      expect(entry.completedAt!).toBeLessThanOrEqual(Date.now());
      expect(entry.startedAt).toBeUndefined();
    });

    it("captures completedAt on failure phase", () => {
      const ctx = createMockContext();
      const state = makeState();
      const node = makeNode("n1");

      recordTrace(ctx.context as any, state, node, "failure", { message: "boom" });

      const entry = state.trace[0];
      expect(entry.completedAt).toBeDefined();
      expect(entry.startedAt).toBeUndefined();
    });

    it("does not set startedAt or completedAt for non-timestamp phases", () => {
      const ctx = createMockContext();
      const state = makeState();
      const node = makeNode("n1");

      recordTrace(ctx.context as any, state, node, "retry", { delayMs: 100 });

      const entry = state.trace[0];
      expect(entry.startedAt).toBeUndefined();
      expect(entry.completedAt).toBeUndefined();
    });

    it("accepts inputSnapshot and outputSnapshot", () => {
      const ctx = createMockContext();
      const state = makeState();
      const node = makeNode("n1");

      recordTrace(ctx.context as any, state, node, "enter", undefined, { data: "input" }, { data: "output" });

      const entry = state.trace[0];
      expect(entry.inputSnapshot).toEqual({ data: "input" });
      expect(entry.outputSnapshot).toEqual({ data: "output" });
    });

    it("caps inputSnapshot to ~1KB", () => {
      const ctx = createMockContext();
      const state = makeState();
      const node = makeNode("n1");
      const largeInput = "x".repeat(2000);

      recordTrace(ctx.context as any, state, node, "enter", undefined, largeInput);

      const entry = state.trace[0];
      const serialized = JSON.stringify(entry.inputSnapshot);
      expect(serialized.length).toBeLessThanOrEqual(1050);
    });

    it("caps outputSnapshot to ~1KB", () => {
      const ctx = createMockContext();
      const state = makeState();
      const node = makeNode("n1");
      const largeOutput = { data: "y".repeat(2000) };

      recordTrace(ctx.context as any, state, node, "success", undefined, undefined, largeOutput);

      const entry = state.trace[0];
      const serialized = JSON.stringify(entry.outputSnapshot);
      expect(serialized.length).toBeLessThanOrEqual(1050);
    });

    it("preserves parentNodeId in details", () => {
      const ctx = createMockContext();
      const state = makeState();
      const node = makeNode("child-1");

      recordTrace(ctx.context as any, state, node, "enter", { parentNodeId: "parent-1" });

      const entry = state.trace[0];
      expect(entry.details?.parentNodeId).toBe("parent-1");
    });

    it("does not truncate snapshots under 1KB", () => {
      const ctx = createMockContext();
      const state = makeState();
      const node = makeNode("n1");
      const smallInput = { key: "value" };

      recordTrace(ctx.context as any, state, node, "enter", undefined, smallInput);

      const entry = state.trace[0];
      expect(entry.inputSnapshot).toEqual(smallInput);
    });
  });
});

describe("HarnessExecutionTrace", () => {
  it("buildCompletedResult wraps trace into HarnessExecutionTrace", () => {
    const compiled = compileHarnessSpec(createSimpleToolSpec());
    const mock = createMockContext();
    const iterator = compiled.workflows[0].generator(mock.context as any, {});

    iterator.next();
    const completed = iterator.next({ stdout: "ok" });

    expect(completed.done).toBe(true);
    const result = completed.value;
    expect(result.trace).toBeDefined();

    expect(isHarnessExecutionTrace(result.trace)).toBe(true);
    if (isHarnessExecutionTrace(result.trace)) {
      expect(result.trace.entries).toBeInstanceOf(Array);
      expect(result.trace.entries.length).toBeGreaterThanOrEqual(2);
      expect(result.trace.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.trace.nodeCount).toBeGreaterThanOrEqual(1);
      expect(result.trace.failureCount).toBe(0);
      expect(result.trace.startTimeMs).toBeGreaterThan(0);
      expect(result.trace.endTimeMs).toBeGreaterThanOrEqual(result.trace.startTimeMs);
    }
  });

  it("failureCount reflects failed entries", () => {
    const compiled = compileHarnessSpec(createRetrySpec());
    const mock = createMockContext();
    const iterator = compiled.workflows[0].generator(mock.context as any, {});

    // First attempt
    iterator.next();
    // Trigger failure then retry
    const afterTimer = iterator.throw?.(new Error("timeout while running verification"));
    expect(afterTimer?.value).toEqual({ kind: "timer", delayMs: 2000 });
    iterator.next();
    // Second attempt succeeds
    const completed = iterator.next({ passed: true });

    expect(completed.done).toBe(true);
    expect(isHarnessExecutionTrace(completed.value.trace)).toBe(true);
    if (isHarnessExecutionTrace(completed.value.trace)) {
      expect(completed.value.trace.failureCount).toBeGreaterThanOrEqual(1);
    }
  });

  it("entries contain enriched trace fields", () => {
    const compiled = compileHarnessSpec(createSimpleToolSpec());
    const mock = createMockContext();
    const iterator = compiled.workflows[0].generator(mock.context as any, {});

    iterator.next();
    const completed = iterator.next({ stdout: "ok" });

    expect(isHarnessExecutionTrace(completed.value.trace)).toBe(true);
    if (isHarnessExecutionTrace(completed.value.trace)) {
      const enterEntry = completed.value.trace.entries.find(e => e.phase === "enter");
      const successEntry = completed.value.trace.entries.find(e => e.phase === "success");

      expect(enterEntry).toBeDefined();
      expect(enterEntry!.startedAt).toBeDefined();
      expect(successEntry).toBeDefined();
      expect(successEntry!.completedAt).toBeDefined();
    }
  });
});

describe("LineageEntry with HarnessExecutionTrace", () => {
  it("createLineageEntry produces HarnessExecutionTrace in trace field", () => {
    const spec = createSimpleToolSpec();
    const version = createInitialVersion(spec);
    const now = Date.now();
    const mockResult = {
      status: "completed" as const,
      terminalNodeId: "run-diff",
      result: { stdout: "ok" },
      outputs: { "run-diff": { stdout: "ok" } },
      trace: {
        entries: [
          { nodeId: "run-diff", source: { specNodeId: "run-diff", specNodeKind: "tool", specPath: "graph.nodes[0]" }, phase: "enter" as const, startedAt: now },
          { nodeId: "run-diff", source: { specNodeId: "run-diff", specNodeKind: "tool", specPath: "graph.nodes[0]" }, phase: "success" as const, completedAt: now + 50 },
        ],
        totalDurationMs: 50,
        nodeCount: 1,
        failureCount: 0,
        startTimeMs: now,
        endTimeMs: now + 50,
      },
      harnessState: {
        inputs: {},
        outputs: { "run-diff": { stdout: "ok" } },
        nodeResults: { "run-diff": { stdout: "ok" } },
        failures: [],
        metrics: { retries: 0, durationMs: 50 },
      },
    };

    const lineage = createLineageEntry(version, mockResult);

    expect(lineage.trace).toBeDefined();
    expect(isHarnessExecutionTrace(lineage.trace)).toBe(true);
    if (isHarnessExecutionTrace(lineage.trace)) {
      expect(lineage.trace.entries).toHaveLength(2);
      expect(lineage.trace.totalDurationMs).toBe(50);
      expect(lineage.trace.nodeCount).toBe(1);
      expect(lineage.trace.failureCount).toBe(0);
      expect(lineage.trace.startTimeMs).toBe(now);
      expect(lineage.trace.endTimeMs).toBe(now + 50);
    }
  });
});

function isHarnessExecutionTrace(trace: unknown): trace is HarnessExecutionTrace {
  return (
    typeof trace === "object" &&
    trace !== null &&
    "entries" in trace &&
    "totalDurationMs" in trace &&
    "nodeCount" in trace &&
    "failureCount" in trace
  );
}

function createSimpleToolSpec(): HarnessSpec {
  return {
    name: "run-diff",
    executionPolicy: { timeout: 30 },
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

function createRetrySpec(): HarnessSpec {
  return {
    name: "retry-tool",
    executionPolicy: {
      failureClassification: [
        { pattern: "timeout", category: "transient", retry: true },
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
