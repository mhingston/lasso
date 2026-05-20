import { describe, it, expect, beforeEach } from "vitest";
import { adviseFromMemory } from "../../src/memory/advisor.js";
import { FileMemoryStore } from "../../src/memory/store.js";
import type { MemoryStore, HarnessMemory, MemoryAdvice } from "../../src/memory/types.js";
import type { HarnessSpec } from "../../src/spec/types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeSpec(name: string = "test-harness"): HarnessSpec {
  return {
    name,
    graph: {
      entryNodeId: "start",
      nodes: [
        { id: "start", kind: "tool" as const, tool: "bash", args: ["echo", "start"] },
        { id: "deploy", kind: "tool" as const, tool: "bash", args: ["echo", "deploy"] },
      ],
      edges: [{ from: "start", to: "deploy" }],
    },
  };
}

function makeMemory(taskId: string, overrides?: Partial<HarnessMemory>): HarnessMemory {
  return {
    taskId,
    taskEmbedding: `hash-${taskId}`,
    successfulPatterns: [],
    failedPatterns: [],
    mutationHistory: [],
    effectivenessScore: 0.5,
    lastUpdated: Date.now(),
    ...overrides,
  };
}

describe("memory/adviseFromMemory", () => {
  let storeDir: string;
  let store: MemoryStore;

  beforeEach(async () => {
    storeDir = await mkdtemp(join(tmpdir(), "advisor-test-"));
    store = new FileMemoryStore(storeDir);
  });

  afterEach(async () => {
    await rm(storeDir, { recursive: true, force: true });
  });

  describe("basic advice generation", () => {
    it("should return empty advice when no memories exist", async () => {
      const advice = await adviseFromMemory("new-task", store);

      expect(advice.suggestions).toEqual([]);
      expect(advice.warnings).toEqual([]);
    });

    it("should return advice when matching memories exist", async () => {
      const memory = makeMemory("similar-task", {
        taskEmbedding: "hash-similar",
        successfulPatterns: ["auth-check-before-deploy"],
        effectivenessScore: 0.8,
      });
      await store.saveMemory(memory);

      const advice = await adviseFromMemory("new-task", store, {
        taskSignature: "hash-similar",
      });

      expect(advice.suggestions.length).toBeGreaterThan(0);
    });
  });

  describe("successful pattern suggestions", () => {
    it("should suggest successful patterns from similar tasks", async () => {
      const memory = makeMemory("task-with-success", {
        taskEmbedding: "hash-deploy",
        successfulPatterns: ["auth-check-before-deploy", "verify-after-deploy"],
        effectivenessScore: 0.9,
      });
      await store.saveMemory(memory);

      const advice = await adviseFromMemory("new-deploy-task", store, {
        taskSignature: "hash-deploy",
      });

      expect(advice.suggestions.some(s => s.includes("auth-check-before-deploy"))).toBe(true);
      expect(advice.suggestions.some(s => s.includes("verify-after-deploy"))).toBe(true);
    });

    it("should include effectiveness context in suggestions", async () => {
      const memory = makeMemory("high-perf-task", {
        taskEmbedding: "hash-perf",
        successfulPatterns: ["retry-with-backoff"],
        effectivenessScore: 0.95,
      });
      await store.saveMemory(memory);

      const advice = await adviseFromMemory("new-task", store, {
        taskSignature: "hash-perf",
      });

      expect(advice.suggestions.some(s => s.includes("95") || s.includes("0.95"))).toBe(true);
    });

    it("should aggregate patterns from multiple matching memories", async () => {
      await store.saveMemory(makeMemory("task-a", {
        taskEmbedding: "hash-multi",
        successfulPatterns: ["auth-check-before-deploy"],
        effectivenessScore: 0.7,
      }));
      await store.saveMemory(makeMemory("task-b", {
        taskEmbedding: "hash-multi",
        successfulPatterns: ["verify-after-deploy"],
        effectivenessScore: 0.8,
      }));

      const advice = await adviseFromMemory("new-task", store, {
        taskSignature: "hash-multi",
      });

      expect(advice.suggestions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("failed pattern warnings", () => {
    it("should warn about failed patterns from similar tasks", async () => {
      const memory = makeMemory("task-with-failures", {
        taskEmbedding: "hash-fail",
        failedPatterns: ["deploy-without-auth", "skip-verification"],
        effectivenessScore: 0.3,
      });
      await store.saveMemory(memory);

      const advice = await adviseFromMemory("new-task", store, {
        taskSignature: "hash-fail",
      });

      expect(advice.warnings.some(w => w.includes("deploy-without-auth"))).toBe(true);
      expect(advice.warnings.some(w => w.includes("skip-verification"))).toBe(true);
    });

    it("should include failure context in warnings", async () => {
      const memory = makeMemory("failing-task", {
        taskEmbedding: "hash-warn",
        failedPatterns: ["deploy-without-auth"],
        mutationHistory: [
          {
            mutation: "add-node:auth-check",
            triggeredBy: "auth-failure",
            timestamp: Date.now(),
            outcome: "improved",
          },
        ],
        effectivenessScore: 0.4,
      });
      await store.saveMemory(memory);

      const advice = await adviseFromMemory("new-task", store, {
        taskSignature: "hash-warn",
      });

      expect(advice.warnings.some(w => w.includes("deploy-without-auth"))).toBe(true);
    });
  });

  describe("effectiveness-based filtering", () => {
    it("should prioritize high-effectiveness memories", async () => {
      await store.saveMemory(makeMemory("low-perf", {
        taskEmbedding: "hash-priority",
        successfulPatterns: ["basic-check"],
        effectivenessScore: 0.2,
      }));
      await store.saveMemory(makeMemory("high-perf", {
        taskEmbedding: "hash-priority",
        successfulPatterns: ["advanced-check"],
        effectivenessScore: 0.9,
      }));

      const advice = await adviseFromMemory("new-task", store, {
        taskSignature: "hash-priority",
      });

      expect(advice.suggestions[0]).toBeDefined();
      expect(advice.suggestions[0]).toContain("advanced-check");
    });

    it("should not suggest from low-effectiveness memories when minEffectiveness is set", async () => {
      await store.saveMemory(makeMemory("low-perf", {
        taskEmbedding: "hash-filter",
        successfulPatterns: ["bad-pattern"],
        effectivenessScore: 0.1,
      }));

      const advice = await adviseFromMemory("new-task", store, {
        taskSignature: "hash-filter",
        minEffectiveness: 0.5,
      });

      expect(advice.suggestions.some(s => s.includes("bad-pattern"))).toBe(false);
    });
  });

  describe("mutation history insights", () => {
    it("should suggest mutations that previously improved outcomes", async () => {
      const memory = makeMemory("mutation-task", {
        taskEmbedding: "hash-mutation",
        successfulPatterns: [],
        mutationHistory: [
          {
            mutation: "add-node:auth-check",
            triggeredBy: "auth-failure",
            timestamp: Date.now(),
            outcome: "improved",
          },
        ],
        effectivenessScore: 0.7,
      });
      await store.saveMemory(memory);

      const advice = await adviseFromMemory("new-task", store, {
        taskSignature: "hash-mutation",
      });

      expect(advice.suggestions.some(s => s.includes("add-node:auth-check"))).toBe(true);
    });

    it("should warn about mutations that made things worse", async () => {
      const memory = makeMemory("bad-mutation-task", {
        taskEmbedding: "hash-bad-mutation",
        mutationHistory: [
          {
            mutation: "remove-node:verification",
            triggeredBy: "slow-execution",
            timestamp: Date.now(),
            outcome: "worse",
          },
        ],
        effectivenessScore: 0.3,
      });
      await store.saveMemory(memory);

      const advice = await adviseFromMemory("new-task", store, {
        taskSignature: "hash-bad-mutation",
      });

      expect(advice.warnings.some(w => w.includes("remove-node:verification"))).toBe(true);
    });
  });

  describe("spec-aware advice", () => {
    it("should tailor suggestions based on current spec nodes", async () => {
      const memory = makeMemory("spec-aware-task", {
        taskEmbedding: "hash-spec",
        successfulPatterns: ["auth-check-before-deploy"],
        effectivenessScore: 0.8,
      });
      await store.saveMemory(memory);

      const spec = makeSpec("deploy-harness");
      const advice = await adviseFromMemory("new-task", store, {
        taskSignature: "hash-spec",
      }, spec);

      expect(advice.suggestions.length).toBeGreaterThan(0);
    });

    it("should not suggest patterns for nodes that already exist", async () => {
      const memory = makeMemory("existing-node-task", {
        taskEmbedding: "hash-existing",
        successfulPatterns: ["auth-check-before-deploy"],
        effectivenessScore: 0.8,
      });
      await store.saveMemory(memory);

      const spec: HarnessSpec = {
        name: "harness-with-auth",
        graph: {
          entryNodeId: "auth-check",
          nodes: [
            { id: "auth-check", kind: "tool" as const, tool: "bash", args: ["echo", "auth"] },
            { id: "deploy", kind: "tool" as const, tool: "bash", args: ["echo", "deploy"] },
          ],
          edges: [{ from: "auth-check", to: "deploy" }],
        },
      };

      const advice = await adviseFromMemory("new-task", store, {
        taskSignature: "hash-existing",
      }, spec);

      expect(advice.suggestions.some(s => s.includes("already"))).toBe(true);
    });
  });

  describe("advice structure", () => {
    it("should include source task IDs in advice", async () => {
      const memory = makeMemory("source-task-123", {
        taskEmbedding: "hash-source",
        successfulPatterns: ["good-pattern"],
        effectivenessScore: 0.75,
      });
      await store.saveMemory(memory);

      const advice = await adviseFromMemory("new-task", store, {
        taskSignature: "hash-source",
      });

      expect(advice.sourceTaskIds).toContain("source-task-123");
    });

    it("should include aggregate effectiveness score", async () => {
      await store.saveMemory(makeMemory("task-a", {
        taskEmbedding: "hash-agg",
        successfulPatterns: ["pattern-a"],
        effectivenessScore: 0.6,
      }));
      await store.saveMemory(makeMemory("task-b", {
        taskEmbedding: "hash-agg",
        successfulPatterns: ["pattern-b"],
        effectivenessScore: 0.8,
      }));

      const advice = await adviseFromMemory("new-task", store, {
        taskSignature: "hash-agg",
      });

      expect(advice.aggregateEffectiveness).toBeGreaterThan(0);
      expect(advice.aggregateEffectiveness).toBeLessThanOrEqual(1);
    });
  });
});
