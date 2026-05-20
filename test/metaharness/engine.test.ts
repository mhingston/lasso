import { describe, expect, it, vi, beforeEach } from "vitest";
import { DefaultMetaHarness } from "../../src/metaharness/engine.js";
import type {
  MetaHarnessConfig,
  MetaHarnessResult,
} from "../../src/metaharness/types.js";
import type { HarnessSpec } from "../../src/spec/types.js";
import type { EnvironmentModel } from "../../src/environment/types.js";
import type { FailureSignature } from "../../src/failures/ontology.js";
import type { MemoryStore, MemoryAdvice } from "../../src/memory/types.js";
import type { CapabilityRegistry } from "../../src/capabilities/types.js";
import type { MutationPolicy } from "../../src/mutation/types.js";
import type { HarnessStage } from "../../src/composition/types.js";

function makeMinimalSpec(overrides?: Partial<HarnessSpec>): HarnessSpec {
  return {
    name: "test-harness",
    graph: {
      entryNodeId: "node-a",
      nodes: [
        {
          id: "node-a",
          label: "Node A",
          kind: "tool",
          tool: "bash",
          args: ["echo hello"],
        },
      ],
      edges: [],
    },
    ...overrides,
  };
}

function makeMinimalEnv(overrides?: Partial<EnvironmentModel>): EnvironmentModel {
  return {
    tools: [
      { name: "bash", version: "5.0", available: true },
      { name: "git", version: "2.39", available: true },
    ],
    resources: [
      { name: "disk", type: "disk", available: true, limit: "500GB", usage: "45%" },
    ],
    constraints: [],
    authState: [],
    externalSystems: [],
    discoveredAt: Date.now(),
    ...overrides,
  };
}

function makeEmptyMemoryStore(): MemoryStore {
  return {
    async getMemory() { return null; },
    async saveMemory() {},
    async updateMemory() { throw new Error("not found"); },
    async searchMemories() { return []; },
  };
}

function makeMemoryStoreWithAdvice(advice: MemoryAdvice): MemoryStore {
  return {
    async getMemory() { return null; },
    async saveMemory() {},
    async updateMemory() { throw new Error("not found"); },
    async searchMemories() {
      return [
        {
          taskId: "prev-task-1",
          successfulPatterns: ["node-a-before-node-b"],
          failedPatterns: [],
          mutationHistory: [],
          effectivenessScore: 0.85,
          lastUpdated: Date.now(),
        },
      ];
    },
  };
}

describe("DefaultMetaHarness", () => {
  describe("constructor", () => {
    it("creates instance with empty config", () => {
      const harness = new DefaultMetaHarness({});
      expect(harness).toBeDefined();
    });

    it("creates instance with full config", () => {
      const config: MetaHarnessConfig = {
        environmentModel: makeMinimalEnv(),
        memoryStore: makeEmptyMemoryStore(),
        capabilityRegistry: undefined,
        maxVersions: 5,
        mutationPolicy: { allowedMutations: ["add-node", "modify-node"], maxMutations: 10 },
      };
      const harness = new DefaultMetaHarness(config);
      expect(harness).toBeDefined();
    });
  });

  describe("discoverEnvironment", () => {
    it("discovers environment without repo path", async () => {
      const harness = new DefaultMetaHarness({});
      const env = await harness.discoverEnvironment();

      expect(env.tools.length).toBeGreaterThan(0);
      expect(env.resources.length).toBeGreaterThan(0);
      expect(env.discoveredAt).toBeGreaterThan(0);
    });

    it("discovers environment with repo path", async () => {
      const harness = new DefaultMetaHarness({});
      const env = await harness.discoverEnvironment(process.cwd());

      expect(env.repoState).toBeDefined();
      expect(env.repoState!.path).toBe(process.cwd());
    });
  });

  describe("predictFailures", () => {
    it("returns empty array when environment is healthy", async () => {
      const harness = new DefaultMetaHarness({});
      const spec = makeMinimalSpec();
      const env = makeMinimalEnv();

      const failures = await harness.predictFailures(spec, env);

      expect(failures.length).toBe(0);
    });

    it("predicts tool failures for missing tools", async () => {
      const harness = new DefaultMetaHarness({});
      const spec: HarnessSpec = {
        name: "test-harness",
        graph: {
          entryNodeId: "node-a",
          nodes: [
            {
              id: "node-a",
              kind: "tool",
              tool: "kubectl",
              args: ["get pods"],
            },
          ],
          edges: [],
        },
      };
      const env = makeMinimalEnv();

      const failures = await harness.predictFailures(spec, env);

      expect(failures.length).toBeGreaterThan(0);
      expect(failures.some(f => f.class === "tool")).toBe(true);
    });

    it("predicts constraint-based failures", async () => {
      const harness = new DefaultMetaHarness({});
      const spec = makeMinimalSpec();
      const env = makeMinimalEnv({
        constraints: [
          { type: "permission", description: "No write access", severity: "high" },
        ],
      });

      const failures = await harness.predictFailures(spec, env);

      expect(failures.length).toBeGreaterThan(0);
    });
  });

  describe("synthesizePolicies", () => {
    it("returns original spec when no failures", () => {
      const harness = new DefaultMetaHarness({});
      const spec = makeMinimalSpec();

      const result = harness.synthesizePolicies(spec, []);

      expect(result).toEqual(spec);
    });

    it("adds verification node for semantic failures", () => {
      const harness = new DefaultMetaHarness({});
      const spec = makeMinimalSpec();
      const failures: FailureSignature[] = [
        {
          class: "semantic",
          confidence: 0.9,
          evidence: ["node: node-a", "test evidence"],
          suggestedRecovery: [],
          retryable: false,
          requiresHumanIntervention: false,
        },
      ];

      const result = harness.synthesizePolicies(spec, failures);

      const nodeA = result.graph.nodes.find(n => n.id === "node-a");
      expect(nodeA).toBeDefined();
      expect(nodeA!.verificationPolicy).toBeDefined();
    });

    it("adds retry policy for network failures", () => {
      const harness = new DefaultMetaHarness({});
      const spec = makeMinimalSpec();
      const failures: FailureSignature[] = [
        {
          class: "network",
          confidence: 0.9,
          evidence: ["node: node-a", "connection timeout"],
          suggestedRecovery: [],
          retryable: true,
          requiresHumanIntervention: false,
        },
      ];

      const result = harness.synthesizePolicies(spec, failures);

      const nodeA = result.graph.nodes.find(n => n.id === "node-a");
      expect(nodeA).toBeDefined();
      expect(nodeA!.retryPolicy).toBeDefined();
    });

    it("adds auth check for auth failures", () => {
      const harness = new DefaultMetaHarness({});
      const spec: HarnessSpec = {
        name: "test-harness",
        graph: {
          entryNodeId: "node-a",
          nodes: [
            {
              id: "node-a",
              kind: "tool",
              tool: "git",
              args: ["push"],
            },
          ],
          edges: [],
        },
      };
      const failures: FailureSignature[] = [
        {
          class: "auth",
          confidence: 0.9,
          evidence: ["node: node-a", "401 unauthorized"],
          suggestedRecovery: [],
          retryable: false,
          requiresHumanIntervention: true,
        },
      ];

      const result = harness.synthesizePolicies(spec, failures);

      expect(result.graph.nodes.length).toBeGreaterThan(spec.graph.nodes.length);
    });

    it("applies multiple mutations for multiple failures", () => {
      const harness = new DefaultMetaHarness({});
      const spec: HarnessSpec = {
        name: "test-harness",
        graph: {
          entryNodeId: "node-a",
          nodes: [
            {
              id: "node-a",
              kind: "tool",
              tool: "git",
              args: ["push"],
            },
          ],
          edges: [],
        },
      };
      const failures: FailureSignature[] = [
        {
          class: "auth",
          confidence: 0.9,
          evidence: ["node: node-a", "401"],
          suggestedRecovery: [],
          retryable: false,
          requiresHumanIntervention: true,
        },
        {
          class: "network",
          confidence: 0.9,
          evidence: ["node: node-a", "timeout"],
          suggestedRecovery: [],
          retryable: true,
          requiresHumanIntervention: false,
        },
      ];

      const result = harness.synthesizePolicies(spec, failures);

      expect(result.graph.nodes.length).toBeGreaterThan(spec.graph.nodes.length);
    });

    it("does not duplicate mutations when node already has policy", () => {
      const harness = new DefaultMetaHarness({});
      const spec: HarnessSpec = {
        name: "test-harness",
        graph: {
          entryNodeId: "node-a",
          nodes: [
            {
              id: "node-a",
              kind: "tool",
              tool: "bash",
              args: ["echo hello"],
              retryPolicy: { maxAttempts: 3, backoff: "exponential" },
            },
          ],
          edges: [],
        },
      };
      const failures: FailureSignature[] = [
        {
          class: "network",
          confidence: 0.9,
          evidence: ["node-a", "timeout"],
          suggestedRecovery: [],
          retryable: true,
          requiresHumanIntervention: false,
        },
      ];

      const result = harness.synthesizePolicies(spec, failures);

      const nodeA = result.graph.nodes.find(n => n.id === "node-a");
      expect(nodeA).toBeDefined();
      expect(nodeA!.retryPolicy).toBeDefined();
    });
  });

  describe("generateHarness (full pipeline)", () => {
    it("generates harness from intent string", async () => {
      const harness = new DefaultMetaHarness({});

      const result = await harness.generateHarness("Run tests and verify the build passes");

      expect(result.spec).toBeDefined();
      expect(result.spec.name).toBeDefined();
      expect(result.predictedFailures).toBeDefined();
      expect(result.optimizations).toBeDefined();
      expect(result.readinessScore).toBeGreaterThan(0);
      expect(result.readinessScore).toBeLessThanOrEqual(100);
    });

    it("includes environment analysis in result", async () => {
      const harness = new DefaultMetaHarness({});

      const result = await harness.generateHarness("Run tests");

      expect(result.environmentAnalysis).toBeDefined();
    });

    it("queries memory store for advice when provided", async () => {
      const memoryStore = makeMemoryStoreWithAdvice({
        suggestions: ["Add verification after build step"],
        warnings: [],
        sourceTaskIds: ["prev-task-1"],
        aggregateEffectiveness: 0.85,
      });
      const harness = new DefaultMetaHarness({ memoryStore });

      const result = await harness.generateHarness("Run tests and verify");

      expect(result.memoryAdvice).toBeDefined();
      expect(result.memoryAdvice!.suggestions.length).toBeGreaterThan(0);
    });

    it("returns empty memory advice when no memory store", async () => {
      const harness = new DefaultMetaHarness({});

      const result = await harness.generateHarness("Run tests");

      expect(result.memoryAdvice).toBeUndefined();
    });

    it("returns empty memory advice when store has no memories", async () => {
      const harness = new DefaultMetaHarness({
        memoryStore: makeEmptyMemoryStore(),
      });

      const result = await harness.generateHarness("Run tests");

      expect(result.memoryAdvice).toBeUndefined();
    });

    it("predicts failures and synthesizes policies", async () => {
      const harness = new DefaultMetaHarness({});

      const result = await harness.generateHarness("Deploy to production using kubectl");

      expect(result.predictedFailures).toBeDefined();
      expect(result.spec).toBeDefined();
    });

    it("uses cached environment model when provided in config", async () => {
      const cachedEnv = makeMinimalEnv();
      const harness = new DefaultMetaHarness({
        environmentModel: cachedEnv,
      });

      const result = await harness.generateHarness("Run tests");

      expect(result.environmentAnalysis).toBeDefined();
    });

    it("includes optimizations in result", async () => {
      const harness = new DefaultMetaHarness({});

      const result = await harness.generateHarness("Run tests");

      expect(result.optimizations).toBeDefined();
      expect(Array.isArray(result.optimizations)).toBe(true);
    });

    it("calculates readiness score based on environment and failures", async () => {
      const harness = new DefaultMetaHarness({});

      const result = await harness.generateHarness("Run tests");

      expect(result.readinessScore).toBeGreaterThanOrEqual(0);
      expect(result.readinessScore).toBeLessThanOrEqual(100);
    });

    it("lower readiness score when predicted failures exist", async () => {
      const harness = new DefaultMetaHarness({});

      const result = await harness.generateHarness("Deploy using kubectl to production");

      if (result.predictedFailures.length > 0) {
        expect(result.readinessScore).toBeLessThan(100);
      }
    });
  });

  describe("capability-aware generation", () => {
    it("generates harness without capability registry", async () => {
      const harness = new DefaultMetaHarness({});

      const result = await harness.generateHarness("Run tests");

      expect(result.spec).toBeDefined();
    });
  });

  describe("mutation policy enforcement", () => {
    it("respects mutation policy during synthesis", () => {
      const harness = new DefaultMetaHarness({
        mutationPolicy: {
          allowedMutations: ["add-node"],
          maxMutations: 1,
        },
      });
      const spec: HarnessSpec = {
        name: "test-harness",
        graph: {
          entryNodeId: "node-a",
          nodes: [
            {
              id: "node-a",
              kind: "tool",
              tool: "git",
              args: ["push"],
            },
          ],
          edges: [],
        },
      };
      const failures: FailureSignature[] = [
        {
          class: "auth",
          confidence: 0.9,
          evidence: ["node: node-a", "401"],
          suggestedRecovery: [],
          retryable: false,
          requiresHumanIntervention: true,
        },
        {
          class: "network",
          confidence: 0.9,
          evidence: ["node: node-a", "timeout"],
          suggestedRecovery: [],
          retryable: true,
          requiresHumanIntervention: false,
        },
      ];

      const result = harness.synthesizePolicies(spec, failures);

      expect(result.graph.nodes.length).toBeLessThanOrEqual(spec.graph.nodes.length + 1);
    });
  });

  describe("composeHarnesses", () => {
    it("chains multiple stages via meta-harness", () => {
      const harness = new DefaultMetaHarness({});
      const stages: HarnessStage[] = [
        {
          name: "research",
          spec: makeMinimalSpec({ name: "research" }),
          inputMapping: {},
        },
        {
          name: "plan",
          spec: makeMinimalSpec({ name: "plan" }),
          inputMapping: {},
        },
      ];

      const result = harness.composeHarnesses(stages);

      expect(result.stageCount).toBe(2);
      expect(result.totalNodes).toBe(2);
      expect(result.combinedSpec.graph.nodes.length).toBe(2);
    });

    it("returns composition result with combined spec", () => {
      const harness = new DefaultMetaHarness({});
      const stages: HarnessStage[] = [
        {
          name: "single",
          spec: makeMinimalSpec({ name: "single" }),
          inputMapping: {},
        },
      ];

      const result = harness.composeHarnesses(stages);

      expect(result.combinedSpec.name).toBe("single");
      expect(result.estimatedDurationMs).toBeGreaterThan(0);
    });

    it("prefixes node IDs to avoid collisions", () => {
      const harness = new DefaultMetaHarness({});
      const stages: HarnessStage[] = [
        {
          name: "alpha",
          spec: {
            name: "alpha",
            graph: {
              entryNodeId: "node-a",
              nodes: [
                { id: "node-a", kind: "tool", tool: "echo", args: ["a"] },
              ],
              edges: [],
            },
          },
          inputMapping: {},
        },
        {
          name: "beta",
          spec: {
            name: "beta",
            graph: {
              entryNodeId: "node-a",
              nodes: [
                { id: "node-a", kind: "tool", tool: "echo", args: ["b"] },
              ],
              edges: [],
            },
          },
          inputMapping: {},
        },
      ];

      const result = harness.composeHarnesses(stages);

      const nodeIds = result.combinedSpec.graph.nodes.map((n) => n.id);
      expect(nodeIds).toContain("alpha:node-a");
      expect(nodeIds).toContain("beta:node-a");
    });
  });
});
