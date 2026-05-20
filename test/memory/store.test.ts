import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileMemoryStore } from "../../src/memory/store.js";
import type { HarnessMemory, MemoryUpdate, MemoryQuery } from "../../src/memory/types.js";

function makeMemory(taskId: string, overrides?: Partial<HarnessMemory>): HarnessMemory {
  return {
    taskId,
    taskEmbedding: `hash-${taskId}`,
    successfulPatterns: ["auth-check-before-deploy"],
    failedPatterns: ["deploy-without-auth"],
    mutationHistory: [],
    effectivenessScore: 0.7,
    lastUpdated: Date.now(),
    ...overrides,
  };
}

describe("memory/FileMemoryStore", () => {
  let storeDir: string;
  let store: FileMemoryStore;

  beforeEach(async () => {
    storeDir = await mkdtemp(join(tmpdir(), "memory-test-"));
    store = new FileMemoryStore(storeDir);
  });

  afterEach(async () => {
    await rm(storeDir, { recursive: true, force: true });
  });

  describe("saveMemory / getMemory", () => {
    it("should save and retrieve a memory", async () => {
      const memory = makeMemory("task-1");

      await store.saveMemory(memory);
      const retrieved = await store.getMemory("task-1");

      expect(retrieved).toEqual(memory);
    });

    it("should return null for a missing memory", async () => {
      const result = await store.getMemory("nonexistent");
      expect(result).toBeNull();
    });

    it("should deep clone on save (mutations do not affect store)", async () => {
      const memory = makeMemory("task-mutate");
      await store.saveMemory(memory);

      memory.successfulPatterns.push("mutated-pattern");

      const retrieved = await store.getMemory("task-mutate");
      expect(retrieved!.successfulPatterns).not.toContain("mutated-pattern");
    });

    it("should handle memory without taskEmbedding", async () => {
      const memory = makeMemory("task-no-embedding", { taskEmbedding: undefined });

      await store.saveMemory(memory);
      const retrieved = await store.getMemory("task-no-embedding");

      expect(retrieved).toEqual(memory);
      expect(retrieved!.taskEmbedding).toBeUndefined();
    });
  });

  describe("updateMemory", () => {
    it("should add a successful pattern", async () => {
      const memory = makeMemory("task-update");
      await store.saveMemory(memory);

      const update: MemoryUpdate = { successfulPattern: "retry-before-fail" };
      const updated = await store.updateMemory("task-update", update);

      expect(updated.successfulPatterns).toContain("retry-before-fail");
      expect(updated.successfulPatterns).toContain("auth-check-before-deploy");
    });

    it("should add a failed pattern", async () => {
      const memory = makeMemory("task-update");
      await store.saveMemory(memory);

      const update: MemoryUpdate = { failedPattern: "skip-validation" };
      const updated = await store.updateMemory("task-update", update);

      expect(updated.failedPatterns).toContain("skip-validation");
    });

    it("should add a mutation record", async () => {
      const memory = makeMemory("task-update");
      await store.saveMemory(memory);

      const mutationRecord = {
        mutation: "add-node:auth-check",
        triggeredBy: "auth-failure",
        timestamp: Date.now(),
        outcome: "improved" as const,
      };
      const update: MemoryUpdate = { mutation: mutationRecord };
      const updated = await store.updateMemory("task-update", update);

      expect(updated.mutationHistory).toHaveLength(1);
      expect(updated.mutationHistory[0]).toEqual(mutationRecord);
    });

    it("should adjust effectiveness score with delta", async () => {
      const memory = makeMemory("task-update", { effectivenessScore: 0.5 });
      await store.saveMemory(memory);

      const update: MemoryUpdate = { effectivenessDelta: 0.1 };
      const updated = await store.updateMemory("task-update", update);

      expect(updated.effectivenessScore).toBeCloseTo(0.6);
    });

    it("should clamp effectiveness score to 1.0", async () => {
      const memory = makeMemory("task-update", { effectivenessScore: 0.95 });
      await store.saveMemory(memory);

      const update: MemoryUpdate = { effectivenessDelta: 0.1 };
      const updated = await store.updateMemory("task-update", update);

      expect(updated.effectivenessScore).toBe(1.0);
    });

    it("should clamp effectiveness score to 0.0", async () => {
      const memory = makeMemory("task-update", { effectivenessScore: 0.05 });
      await store.saveMemory(memory);

      const update: MemoryUpdate = { effectivenessDelta: -0.1 };
      const updated = await store.updateMemory("task-update", update);

      expect(updated.effectivenessScore).toBe(0.0);
    });

    it("should throw if memory does not exist", async () => {
      const update: MemoryUpdate = { successfulPattern: "new-pattern" };
      await expect(store.updateMemory("nonexistent", update)).rejects.toThrow();
    });

    it("should apply multiple updates atomically", async () => {
      const memory = makeMemory("task-update", { effectivenessScore: 0.5 });
      await store.saveMemory(memory);

      const update: MemoryUpdate = {
        successfulPattern: "new-success",
        effectivenessDelta: 0.2,
      };
      const updated = await store.updateMemory("task-update", update);

      expect(updated.successfulPatterns).toContain("new-success");
      expect(updated.effectivenessScore).toBeCloseTo(0.7);
    });
  });

  describe("searchMemories", () => {
    beforeEach(async () => {
      const memories = [
        makeMemory("task-alpha", { taskEmbedding: "hash-alpha", effectivenessScore: 0.8 }),
        makeMemory("task-beta", { taskEmbedding: "hash-beta", effectivenessScore: 0.3 }),
        makeMemory("task-gamma", { taskEmbedding: "hash-alpha-similar", effectivenessScore: 0.9 }),
      ];
      for (const m of memories) {
        await store.saveMemory(m);
      }
    });

    it("should find memories by task signature prefix match", async () => {
      const query: MemoryQuery = { taskSignature: "hash-alpha" };
      const results = await store.searchMemories(query);

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.taskEmbedding === "hash-alpha")).toBe(true);
    });

    it("should filter by minimum effectiveness", async () => {
      const query: MemoryQuery = { minEffectiveness: 0.5 };
      const results = await store.searchMemories(query);

      expect(results.every(r => r.effectivenessScore >= 0.5)).toBe(true);
    });

    it("should apply limit", async () => {
      const query: MemoryQuery = { limit: 1 };
      const results = await store.searchMemories(query);

      expect(results.length).toBeLessThanOrEqual(1);
    });

    it("should combine filters", async () => {
      const query: MemoryQuery = {
        taskSignature: "hash-alpha",
        minEffectiveness: 0.5,
        limit: 10,
      };
      const results = await store.searchMemories(query);

      expect(results.every(r => r.effectivenessScore >= 0.5)).toBe(true);
    });

    it("should return empty when no memories match", async () => {
      const query: MemoryQuery = { taskSignature: "nonexistent-signature" };
      const results = await store.searchMemories(query);

      expect(results).toEqual([]);
    });

    it("should return all memories when query is empty", async () => {
      const results = await store.searchMemories({});
      expect(results.length).toBe(3);
    });
  });

  describe("round-trip integrity", () => {
    it("should preserve all fields through save → retrieve", async () => {
      const mutationRecord = {
        mutation: "add-node:auth-check",
        triggeredBy: "auth-failure",
        timestamp: 1234567890,
        outcome: "improved" as const,
      };

      const memory: HarnessMemory = {
        taskId: "roundtrip",
        taskEmbedding: "hash-roundtrip",
        successfulPatterns: ["pattern-a", "pattern-b"],
        failedPatterns: ["pattern-c"],
        mutationHistory: [mutationRecord],
        effectivenessScore: 0.85,
        lastUpdated: 9876543210,
      };

      await store.saveMemory(memory);
      const retrieved = await store.getMemory("roundtrip");

      expect(retrieved).toEqual(memory);
      expect(retrieved!.mutationHistory).toHaveLength(1);
      expect(retrieved!.mutationHistory[0].outcome).toBe("improved");
    });
  });
});
