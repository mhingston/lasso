import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pi-duroxide", () => ({
  registerWorkflow: vi.fn(),
}));

import {
  analyzeCompiledWorkflow,
  applyCompilerSuggestions,
  type CompilerAnalysis,
  type CompilerSuggestion,
  type CostEstimate,
} from "../../src/compiler/feedback.js";
import { compileHarnessSpec } from "../../src/compiler/compile.js";
import type { HarnessSpec } from "../../src/spec/types.js";
import type { HarnessMutation, MutationTrigger } from "../../src/mutation/types.js";

// ============================================================================
// Test helper: create specs with various shapes
// ============================================================================

function createEmptySpec(): HarnessSpec {
  return {
    name: "empty",
    graph: {
      entryNodeId: "start",
      nodes: [
        {
          id: "start",
          kind: "tool",
          tool: "echo",
          args: ["hello"],
        },
      ],
      edges: [],
    },
  };
}

function createMultiLlmSpec(llmCount: number): HarnessSpec {
  const nodes: HarnessSpec["graph"]["nodes"] = [];
  const edges: HarnessSpec["graph"]["edges"] = [];

  for (let i = 0; i < llmCount; i++) {
    nodes.push({
      id: `llm-${i}`,
      kind: "llm",
      provider: "anthropic",
      model: "claude-sonnet",
      prompt: `Prompt ${i}`,
    });
    if (i > 0) {
      edges.push({ from: `llm-${i - 1}`, to: `llm-${i}` });
    }
  }

  return {
    name: "multi-llm",
    graph: {
      entryNodeId: "llm-0",
      nodes,
      edges,
    },
  };
}

function createSpecWithRetry(): HarnessSpec {
  return {
    name: "with-retry",
    graph: {
      entryNodeId: "tool-a",
      nodes: [
        {
          id: "tool-a",
          kind: "tool",
          tool: "npm",
          args: ["test"],
          retryPolicy: {
            maxAttempts: 3,
            backoff: "exponential",
            initialDelay: 1,
          },
        },
      ],
      edges: [],
    },
  };
}

function createSpecWithVerification(): HarnessSpec {
  return {
    name: "with-verification",
    graph: {
      entryNodeId: "tool-a",
      nodes: [
        {
          id: "tool-a",
          kind: "tool",
          tool: "npm",
          args: ["test"],
          verificationPolicy: {
            rules: [
              {
                kind: "tool",
                checkNodeId: "verify-check",
                onFail: "block",
              },
            ],
          },
        },
        {
          id: "verify-check",
          kind: "tool",
          tool: "cat",
          args: ["output.txt"],
        },
      ],
      edges: [],
    },
  };
}

function createSpecWithHumanNode(): HarnessSpec {
  return {
    name: "with-human",
    graph: {
      entryNodeId: "tool-a",
      nodes: [
        {
          id: "tool-a",
          kind: "tool",
          tool: "echo",
          args: ["hello"],
        },
        {
          id: "approve",
          kind: "human",
          prompt: "Approve?",
          interactionType: "approval",
        },
      ],
      edges: [{ from: "tool-a", to: "approve" }],
    },
  };
}

function createAdjacentToolSpec(): HarnessSpec {
  return {
    name: "adjacent-tools",
    graph: {
      entryNodeId: "tool-a",
      nodes: [
        {
          id: "tool-a",
          kind: "tool",
          tool: "echo",
          args: ["a"],
        },
        {
          id: "tool-b",
          kind: "tool",
          tool: "echo",
          args: ["b"],
        },
        {
          id: "tool-c",
          kind: "tool",
          tool: "echo",
          args: ["c"],
        },
      ],
      edges: [
        { from: "tool-a", to: "tool-b" },
        { from: "tool-b", to: "tool-c" },
      ],
    },
  };
}

function createComplexSpec(): HarnessSpec {
  return {
    name: "complex",
    graph: {
      entryNodeId: "n1",
      nodes: [
        { id: "n1", kind: "llm", provider: "anthropic", model: "claude-sonnet", prompt: "p1" },
        { id: "n2", kind: "llm", provider: "anthropic", model: "claude-sonnet", prompt: "p2" },
        { id: "n3", kind: "llm", provider: "anthropic", model: "claude-sonnet", prompt: "p3" },
        { id: "n4", kind: "llm", provider: "anthropic", model: "claude-sonnet", prompt: "p4" },
        { id: "n5", kind: "llm", provider: "anthropic", model: "claude-sonnet", prompt: "p5" },
        { id: "n6", kind: "llm", provider: "anthropic", model: "claude-sonnet", prompt: "p6" },
        { id: "n7", kind: "tool", tool: "echo", args: ["done"] },
      ],
      edges: [
        { from: "n1", to: "n2" },
        { from: "n2", to: "n3" },
        { from: "n3", to: "n4" },
        { from: "n4", to: "n5" },
        { from: "n5", to: "n6" },
        { from: "n6", to: "n7" },
      ],
    },
  };
}

// ============================================================================
// Cost Estimation Tests
// ============================================================================

describe("analyzeCompiledWorkflow — cost estimation", () => {
  it("estimates cost for a single tool node", () => {
    const compiled = compileHarnessSpec(createEmptySpec());
    const analysis = analyzeCompiledWorkflow(compiled);

    expect(analysis.cost.llmCallCount).toBe(0);
    expect(analysis.cost.toolCallCount).toBe(1);
    expect(analysis.cost.humanInteractionCount).toBe(0);
    expect(analysis.cost.estimatedCostUsd).toBe(0);
    expect(analysis.cost.estimatedDurationMs).toBeGreaterThan(0);
  });

  it("estimates cost for multiple LLM nodes", () => {
    const compiled = compileHarnessSpec(createMultiLlmSpec(3));
    const analysis = analyzeCompiledWorkflow(compiled);

    expect(analysis.cost.llmCallCount).toBe(3);
    expect(analysis.cost.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("estimates cost for human nodes", () => {
    const compiled = compileHarnessSpec(createSpecWithHumanNode());
    const analysis = analyzeCompiledWorkflow(compiled);

    expect(analysis.cost.humanInteractionCount).toBe(1);
  });

  it("estimates total cost combining all node types", () => {
    const spec: HarnessSpec = {
      name: "mixed",
      graph: {
        entryNodeId: "llm-1",
        nodes: [
          { id: "llm-1", kind: "llm", provider: "anthropic", model: "claude-sonnet", prompt: "p1" },
          { id: "tool-1", kind: "tool", tool: "echo", args: ["hi"] },
          { id: "human-1", kind: "human", prompt: "OK?", interactionType: "approval" },
        ],
        edges: [
          { from: "llm-1", to: "tool-1" },
          { from: "tool-1", to: "human-1" },
        ],
      },
    };
    const compiled = compileHarnessSpec(spec);
    const analysis = analyzeCompiledWorkflow(compiled);

    expect(analysis.cost.llmCallCount).toBe(1);
    expect(analysis.cost.toolCallCount).toBe(1);
    expect(analysis.cost.humanInteractionCount).toBe(1);
  });

  it("estimates duration based on tool count", () => {
    const compiled = compileHarnessSpec(createAdjacentToolSpec());
    const analysis = analyzeCompiledWorkflow(compiled);

    // 3 tool nodes should have longer duration than 1 tool node
    const singleToolAnalysis = analyzeCompiledWorkflow(compileHarnessSpec(createEmptySpec()));
    expect(analysis.cost.estimatedDurationMs).toBeGreaterThan(singleToolAnalysis.cost.estimatedDurationMs);
  });
});

// ============================================================================
// Risk Assessment Tests
// ============================================================================

describe("analyzeCompiledWorkflow — risk assessment", () => {
  it("identifies high cost risk when LLM count > 5", () => {
    const compiled = compileHarnessSpec(createMultiLlmSpec(6));
    const analysis = analyzeCompiledWorkflow(compiled);

    const costRisk = analysis.risk.costRisk;
    expect(costRisk.level).toBe("high");
    expect(costRisk.factors.length).toBeGreaterThan(0);
  });

  it("identifies low cost risk when LLM count <= 2", () => {
    const compiled = compileHarnessSpec(createMultiLlmSpec(2));
    const analysis = analyzeCompiledWorkflow(compiled);

    expect(analysis.risk.costRisk.level).toBe("low");
  });

  it("identifies high failure risk when no retry policies exist", () => {
    const compiled = compileHarnessSpec(createEmptySpec());
    const analysis = analyzeCompiledWorkflow(compiled);

    expect(analysis.risk.failureRisk.level).toBe("high");
  });

  it("identifies low failure risk when retry policies exist", () => {
    const compiled = compileHarnessSpec(createSpecWithRetry());
    const analysis = analyzeCompiledWorkflow(compiled);

    expect(analysis.risk.failureRisk.level).toBe("low");
  });

  it("identifies high quality risk when no verification exists", () => {
    const compiled = compileHarnessSpec(createEmptySpec());
    const analysis = analyzeCompiledWorkflow(compiled);

    expect(analysis.risk.qualityRisk.level).toBe("high");
  });

  it("identifies low quality risk when verification exists", () => {
    const compiled = compileHarnessSpec(createSpecWithVerification());
    const analysis = analyzeCompiledWorkflow(compiled);

    expect(analysis.risk.qualityRisk.level).toBe("low");
  });

  it("identifies high complexity risk for complex graphs", () => {
    const compiled = compileHarnessSpec(createComplexSpec());
    const analysis = analyzeCompiledWorkflow(compiled);

    expect(analysis.risk.complexityRisk.level).toBe("high");
  });

  it("identifies low complexity risk for simple graphs", () => {
    const compiled = compileHarnessSpec(createEmptySpec());
    const analysis = analyzeCompiledWorkflow(compiled);

    expect(analysis.risk.complexityRisk.level).toBe("low");
  });

  it("computes overall risk as the maximum of individual risks", () => {
    // Complex spec with no retry → high failure risk → overall high
    const compiled = compileHarnessSpec(createComplexSpec());
    const analysis = analyzeCompiledWorkflow(compiled);

    expect(analysis.risk.overallRisk).toBe("high");
  });

  it("computes overall risk as low when all individual risks are low", () => {
    const spec: HarnessSpec = {
      name: "safe",
      graph: {
        entryNodeId: "tool-a",
        nodes: [
          {
            id: "tool-a",
            kind: "tool",
            tool: "echo",
            args: ["hello"],
            retryPolicy: { maxAttempts: 2, backoff: "constant" },
            verificationPolicy: {
              rules: [
                { kind: "tool", checkNodeId: "v1", onFail: "block" },
              ],
            },
          },
          {
            id: "v1",
            kind: "tool",
            tool: "echo",
            args: ["verify"],
          },
        ],
        edges: [],
      },
    };
    const compiled = compileHarnessSpec(spec);
    const analysis = analyzeCompiledWorkflow(compiled);

    expect(analysis.risk.overallRisk).toBe("low");
  });
});

// ============================================================================
// Mutation Generation Tests
// ============================================================================

describe("analyzeCompiledWorkflow — mutation generation", () => {
  it("emits replace-node mutation with cost_high trigger when LLM count > 5", () => {
    const compiled = compileHarnessSpec(createMultiLlmSpec(6));
    const analysis = analyzeCompiledWorkflow(compiled);

    const costMutations = analysis.mutations.filter(m => m.trigger === "cost_high");
    expect(costMutations.length).toBeGreaterThan(0);
    expect(costMutations[0].type).toBe("replace-node");
    expect(costMutations[0].params.nodeId).toBeDefined();
    expect(costMutations[0].description).toBeDefined();
  });

  it("does not emit cost_high mutation when LLM count <= 5", () => {
    const compiled = compileHarnessSpec(createMultiLlmSpec(3));
    const analysis = analyzeCompiledWorkflow(compiled);

    const costMutations = analysis.mutations.filter(m => m.trigger === "cost_high");
    expect(costMutations.length).toBe(0);
  });

  it("emits modify-node mutation with retry_exhausted trigger when no retry policies exist", () => {
    const compiled = compileHarnessSpec(createEmptySpec());
    const analysis = analyzeCompiledWorkflow(compiled);

    const retryMutations = analysis.mutations.filter(m => m.trigger === "retry_exhausted");
    expect(retryMutations.length).toBeGreaterThan(0);
    expect(retryMutations[0].type).toBe("modify-node");
    expect(retryMutations[0].params.nodeId).toBeDefined();
    expect(retryMutations[0].params.changes).toBeDefined();
    expect(retryMutations[0].description).toBeDefined();
  });

  it("does not emit retry_exhausted mutation when retry policies exist", () => {
    const compiled = compileHarnessSpec(createSpecWithRetry());
    const analysis = analyzeCompiledWorkflow(compiled);

    const retryMutations = analysis.mutations.filter(m => m.trigger === "retry_exhausted");
    expect(retryMutations.length).toBe(0);
  });

  it("emits modify-node mutation for merge-nodes with loop_detected trigger", () => {
    const compiled = compileHarnessSpec(createAdjacentToolSpec());
    const analysis = analyzeCompiledWorkflow(compiled);

    const mergeMutations = analysis.mutations.filter(m => m.trigger === "loop_detected");
    expect(mergeMutations.length).toBeGreaterThan(0);
    expect(mergeMutations[0].type).toBe("modify-node");
    expect(mergeMutations[0].description).toBeDefined();
  });

  it("does not emit merge mutation for non-adjacent same-tool nodes", () => {
    const spec: HarnessSpec = {
      name: "non-adjacent",
      graph: {
        entryNodeId: "tool-a",
        nodes: [
          { id: "tool-a", kind: "tool", tool: "echo", args: ["a"] },
          { id: "llm-1", kind: "llm", provider: "anthropic", model: "claude-sonnet", prompt: "p1" },
          { id: "tool-b", kind: "tool", tool: "echo", args: ["b"] },
        ],
        edges: [
          { from: "tool-a", to: "llm-1" },
          { from: "llm-1", to: "tool-b" },
        ],
      },
    };
    const compiled = compileHarnessSpec(spec);
    const analysis = analyzeCompiledWorkflow(compiled);

    const mergeMutations = analysis.mutations.filter(m => m.trigger === "loop_detected");
    expect(mergeMutations.length).toBe(0);
  });

  it("emits add-verification mutation with verification_failed trigger when no verification exists", () => {
    const compiled = compileHarnessSpec(createEmptySpec());
    const analysis = analyzeCompiledWorkflow(compiled);

    const verificationMutations = analysis.mutations.filter(m => m.trigger === "verification_failed");
    expect(verificationMutations.length).toBeGreaterThan(0);
    expect(verificationMutations[0].type).toBe("add-verification");
    expect(verificationMutations[0].params.nodeId).toBeDefined();
    expect(verificationMutations[0].description).toBeDefined();
  });

  it("does not emit verification_failed mutation when verification exists", () => {
    const compiled = compileHarnessSpec(createSpecWithVerification());
    const analysis = analyzeCompiledWorkflow(compiled);

    const verificationMutations = analysis.mutations.filter(m => m.trigger === "verification_failed");
    expect(verificationMutations.length).toBe(0);
  });

  it("generates multiple mutations for a complex workflow", () => {
    const compiled = compileHarnessSpec(createComplexSpec());
    const analysis = analyzeCompiledWorkflow(compiled);

    expect(analysis.mutations.length).toBeGreaterThan(1);
  });

  it("mutations carry both trigger and description for readability", () => {
    const compiled = compileHarnessSpec(createComplexSpec());
    const analysis = analyzeCompiledWorkflow(compiled);

    for (const mutation of analysis.mutations) {
      expect(mutation.trigger).toBeDefined();
      expect(mutation.description).toBeDefined();
      expect(typeof mutation.description).toBe("string");
      expect(mutation.description!.length).toBeGreaterThan(0);
    }
  });

  it("emits replace-node mutations for each LLM node when cost_high", () => {
    const compiled = compileHarnessSpec(createMultiLlmSpec(6));
    const analysis = analyzeCompiledWorkflow(compiled);

    const replaceMutations = analysis.mutations.filter(m => m.type === "replace-node");
    expect(replaceMutations.length).toBe(6);
    for (const m of replaceMutations) {
      expect(m.params.nodeId).toMatch(/^llm-/);
      expect(m.params.changes).toBeDefined();
    }
  });

  it("keeps backward-compatible suggestions field", () => {
    const compiled = compileHarnessSpec(createComplexSpec());
    const analysis = analyzeCompiledWorkflow(compiled);

    expect(analysis.suggestions).toBeDefined();
    expect(Array.isArray(analysis.suggestions)).toBe(true);
  });
});

// ============================================================================
// applyCompilerSuggestions Tests (backward compatibility)
// ============================================================================

describe("applyCompilerSuggestions", () => {
  it("returns unchanged spec when no suggestions", () => {
    const spec = createEmptySpec();
    const result = applyCompilerSuggestions(spec, []);

    expect(result).toEqual(spec);
  });

  it("adds retry policy for add-retry suggestion", () => {
    const spec: HarnessSpec = {
      name: "no-retry",
      graph: {
        entryNodeId: "tool-a",
        nodes: [
          {
            id: "tool-a",
            kind: "tool",
            tool: "npm",
            args: ["test"],
          },
        ],
        edges: [],
      },
    };
    const suggestions: CompilerSuggestion[] = [
      { type: "add-retry", description: "Add retry to tool nodes", impact: "high" },
    ];

    const result = applyCompilerSuggestions(spec, suggestions);
    const toolNode = result.graph.nodes.find(n => n.id === "tool-a");

    expect(toolNode?.retryPolicy).toBeDefined();
    expect(toolNode?.retryPolicy?.maxAttempts).toBe(3);
  });

  it("adds verification for add-verification suggestion", () => {
    const spec: HarnessSpec = {
      name: "no-verification",
      graph: {
        entryNodeId: "tool-a",
        nodes: [
          {
            id: "tool-a",
            kind: "tool",
            tool: "npm",
            args: ["test"],
          },
        ],
        edges: [],
      },
    };
    const suggestions: CompilerSuggestion[] = [
      { type: "add-verification", description: "Add verification", impact: "high" },
    ];

    const result = applyCompilerSuggestions(spec, suggestions);
    const toolNode = result.graph.nodes.find(n => n.id === "tool-a");

    expect(toolNode?.verificationPolicy).toBeDefined();
  });

  it("applies multiple suggestions in sequence", () => {
    const spec: HarnessSpec = {
      name: "multi-suggestion",
      graph: {
        entryNodeId: "tool-a",
        nodes: [
          {
            id: "tool-a",
            kind: "tool",
            tool: "npm",
            args: ["test"],
          },
        ],
        edges: [],
      },
    };
    const suggestions: CompilerSuggestion[] = [
      { type: "add-retry", description: "Add retry", impact: "high" },
      { type: "add-verification", description: "Add verification", impact: "medium" },
    ];

    const result = applyCompilerSuggestions(spec, suggestions);
    const toolNode = result.graph.nodes.find(n => n.id === "tool-a");

    expect(toolNode?.retryPolicy).toBeDefined();
    expect(toolNode?.verificationPolicy).toBeDefined();
  });

  it("does not modify spec for reduce-llm suggestion (requires manual intervention)", () => {
    const spec = createMultiLlmSpec(6);
    const suggestions: CompilerSuggestion[] = [
      { type: "reduce-llm", description: "Reduce LLM calls", impact: "high" },
    ];

    const result = applyCompilerSuggestions(spec, suggestions);

    // reduce-llm should not auto-modify the spec
    expect(result.graph.nodes.length).toBe(spec.graph.nodes.length);
  });

  it("does not modify spec for simplify suggestion (no-op for now)", () => {
    const spec = createEmptySpec();
    const suggestions: CompilerSuggestion[] = [
      { type: "simplify", description: "Simplify workflow", impact: "low" },
    ];

    const result = applyCompilerSuggestions(spec, suggestions);

    expect(result).toEqual(spec);
  });

  it("does not modify spec for merge-nodes suggestion (no-op for now)", () => {
    const spec = createAdjacentToolSpec();
    const suggestions: CompilerSuggestion[] = [
      { type: "merge-nodes", description: "Merge adjacent tool nodes", impact: "medium" },
    ];

    const result = applyCompilerSuggestions(spec, suggestions);

    expect(result.graph.nodes.length).toBe(spec.graph.nodes.length);
  });

  it("adds retry to all tool and llm nodes, not just one", () => {
    const spec: HarnessSpec = {
      name: "multi-node",
      graph: {
        entryNodeId: "tool-a",
        nodes: [
          { id: "tool-a", kind: "tool", tool: "echo", args: ["a"] },
          { id: "tool-b", kind: "tool", tool: "echo", args: ["b"] },
          { id: "llm-c", kind: "llm", provider: "anthropic", model: "claude-sonnet", prompt: "p" },
        ],
        edges: [
          { from: "tool-a", to: "tool-b" },
          { from: "tool-b", to: "llm-c" },
        ],
      },
    };
    const suggestions: CompilerSuggestion[] = [
      { type: "add-retry", description: "Add retry", impact: "high" },
    ];

    const result = applyCompilerSuggestions(spec, suggestions);

    expect(result.graph.nodes.find(n => n.id === "tool-a")?.retryPolicy).toBeDefined();
    expect(result.graph.nodes.find(n => n.id === "tool-b")?.retryPolicy).toBeDefined();
    expect(result.graph.nodes.find(n => n.id === "llm-c")?.retryPolicy).toBeDefined();
  });
});

// ============================================================================
// Mutation-based feedback → mutateHarness integration
// ============================================================================

describe("feedback mutations → mutateHarness integration", () => {
  it("retry_exhausted mutations can be applied via mutateHarness", async () => {
    const { mutateHarness } = await import("../../src/mutation/engine.js");
    const spec = createEmptySpec();
    const compiled = compileHarnessSpec(spec);
    const analysis = analyzeCompiledWorkflow(compiled);

    const retryMutations = analysis.mutations.filter(m => m.trigger === "retry_exhausted");
    expect(retryMutations.length).toBeGreaterThan(0);

    const result = mutateHarness(spec, retryMutations);
    const toolNode = result.spec.graph.nodes.find(n => n.id === "start");
    expect(toolNode?.retryPolicy).toBeDefined();
    expect(toolNode?.retryPolicy?.maxAttempts).toBe(3);
  });

  it("verification_failed mutations can be applied via mutateHarness", async () => {
    const { mutateHarness } = await import("../../src/mutation/engine.js");
    const spec = createEmptySpec();
    const compiled = compileHarnessSpec(spec);
    const analysis = analyzeCompiledWorkflow(compiled);

    const verificationMutations = analysis.mutations.filter(m => m.trigger === "verification_failed");
    expect(verificationMutations.length).toBeGreaterThan(0);

    const result = mutateHarness(spec, verificationMutations);
    const toolNode = result.spec.graph.nodes.find(n => n.id === "start");
    expect(toolNode?.verificationPolicy).toBeDefined();
  });

  it("cost_high replace-node mutations can be applied via mutateHarness", async () => {
    const { mutateHarness } = await import("../../src/mutation/engine.js");
    const spec = createMultiLlmSpec(6);
    const compiled = compileHarnessSpec(spec);
    const analysis = analyzeCompiledWorkflow(compiled);

    const costMutations = analysis.mutations.filter(m => m.trigger === "cost_high");
    expect(costMutations.length).toBeGreaterThan(0);

    const result = mutateHarness(spec, costMutations);
    for (const node of result.spec.graph.nodes) {
      if (node.kind === "llm") {
        expect((node as any).model).toBe("gpt-4o-mini");
      }
    }
  });

  it("all mutation types from feedback are valid HarnessMutation types", async () => {
    const { mutateHarness } = await import("../../src/mutation/engine.js");
    const spec = createComplexSpec();
    const compiled = compileHarnessSpec(spec);
    const analysis = analyzeCompiledWorkflow(compiled);

    // Should not throw — all mutation types are valid
    expect(() => mutateHarness(spec, analysis.mutations)).not.toThrow();
  });
});

// ============================================================================
// Integration with Meta-Harness Tests
// ============================================================================

describe("Meta-Harness integration", () => {
  it("includes compilerAnalysis in MetaHarnessResult", async () => {
    const { DefaultMetaHarness } = await import("../../src/metaharness/engine.js");
    const harness = new DefaultMetaHarness({});

    const result = await harness.generateHarness("Run tests and verify the build passes");

    expect(result.compilerAnalysis).toBeDefined();
    expect(result.compilerAnalysis?.cost).toBeDefined();
    expect(result.compilerAnalysis?.risk).toBeDefined();
    expect(result.compilerAnalysis?.mutations).toBeDefined();
  });

  it("applies high-risk mutations and recompiles", async () => {
    const { DefaultMetaHarness } = await import("../../src/metaharness/engine.js");
    const harness = new DefaultMetaHarness({});

    const result = await harness.generateHarness("Run tests");

    // After feedback loop, the spec should have retry policies applied
    // if retry_exhausted mutations were found
    if (result.compilerAnalysis?.mutations.some(m => m.trigger === "retry_exhausted")) {
      const hasRetry = result.spec.graph.nodes.some(
        n => n.kind === "tool" || n.kind === "llm"
      ) && result.spec.graph.nodes.some(
        n => (n.kind === "tool" || n.kind === "llm") && n.retryPolicy
      );
      expect(hasRetry).toBe(true);
    }
  });

  it("includes compiler optimizations in result", async () => {
    const { DefaultMetaHarness } = await import("../../src/metaharness/engine.js");
    const harness = new DefaultMetaHarness({});

    const result = await harness.generateHarness("Run tests");

    expect(result.compilerOptimizations).toBeDefined();
    expect(Array.isArray(result.compilerOptimizations)).toBe(true);
  });

  it("stores applied mutations in MetaHarnessResult", async () => {
    const { DefaultMetaHarness } = await import("../../src/metaharness/engine.js");
    const harness = new DefaultMetaHarness({});

    const result = await harness.generateHarness("Run tests");

    expect(result.appliedMutations).toBeDefined();
    expect(Array.isArray(result.appliedMutations)).toBe(true);
  });
});
