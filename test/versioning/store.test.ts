import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLineageStore } from "../../src/versioning/file-store.js";
import type { HarnessVersion, LineageEntry } from "../../src/versioning/types.js";
import type { HarnessSpec } from "../../src/spec/types.js";
import { createInitialVersion, createNextVersion } from "../../src/versioning/history.js";

function makeSpec(name: string): HarnessSpec {
  return {
    name,
    graph: {
      entryNodeId: "start",
      nodes: [{ id: "start", kind: "tool", tool: "bash", args: ["echo", name] }],
      edges: [],
    },
  };
}

function makeLineageEntry(version: number, overrides?: Partial<LineageEntry>): LineageEntry {
  return {
    version,
    terminalNodeId: "start",
    outputs: { start: { stdout: "ok" } },
    nodeResults: { start: { stdout: "ok" } },
    failures: [],
    metrics: { retries: 0, durationMs: 50 },
    trace: [{ nodeId: "start", source: { specNodeId: "start", specNodeKind: "tool", specPath: "graph.nodes[0]" }, phase: "enter" }],
    completedAt: 1000 + version,
    ...overrides,
  };
}

describe("versioning/FileLineageStore", () => {
  let storeDir: string;
  let store: FileLineageStore;

  beforeEach(async () => {
    storeDir = await mkdtemp(join(tmpdir(), "lineage-test-"));
    store = new FileLineageStore(storeDir);
  });

  afterEach(async () => {
    await rm(storeDir, { recursive: true, force: true });
  });

  describe("saveVersion / getVersion", () => {
    it("should save and retrieve a version", async () => {
      const version = createInitialVersion(makeSpec("wf-1"));

      await store.saveVersion(version);
      const retrieved = await store.getVersion(1);

      expect(retrieved).toEqual(version);
    });

    it("should return null for a missing version", async () => {
      const result = await store.getVersion(999);
      expect(result).toBeNull();
    });

    it("should deep clone on save (mutations do not affect store)", async () => {
      const spec = makeSpec("wf-mutate");
      const version = createInitialVersion(spec);

      await store.saveVersion(version);
      version.reason = "mutated";

      const retrieved = await store.getVersion(1);
      expect(retrieved!.reason).toBe("initial");
    });
  });

  describe("saveLineage / getLineageForVersion", () => {
    it("should save and retrieve a lineage entry", async () => {
      const entry = makeLineageEntry(1);

      await store.saveLineage(entry);
      const retrieved = await store.getLineageForVersion(1);

      expect(retrieved).toEqual(entry);
    });

    it("should return null for a missing lineage entry", async () => {
      const result = await store.getLineageForVersion(999);
      expect(result).toBeNull();
    });

    it("should deep clone on save", async () => {
      const entry = makeLineageEntry(1, { outputs: { start: { data: "original" } } });

      await store.saveLineage(entry);
      entry.outputs.start = "mutated";

      const retrieved = await store.getLineageForVersion(1);
      expect(retrieved!.outputs).toEqual({ start: { data: "original" } });
    });
  });

  describe("getLineageChain", () => {
    it("should return single entry for version with no parent", async () => {
      const v1 = createInitialVersion(makeSpec("chain-1"));
      const e1 = makeLineageEntry(1);

      await store.saveVersion(v1);
      await store.saveLineage(e1);

      const chain = await store.getLineageChain(1);

      expect(chain).toHaveLength(1);
      expect(chain[0].version).toBe(1);
    });

    it("should walk parentVersion links to build chain", async () => {
      const v1 = createInitialVersion(makeSpec("chain-2"));
      const v2 = createNextVersion(v1, makeSpec("chain-2-v2"), "escalation");
      const v3 = createNextVersion(v2, makeSpec("chain-2-v3"), "retry");

      const e1 = makeLineageEntry(1);
      const e2 = makeLineageEntry(2);
      const e3 = makeLineageEntry(3);

      for (const v of [v1, v2, v3]) await store.saveVersion(v);
      for (const e of [e1, e2, e3]) await store.saveLineage(e);

      const chain = await store.getLineageChain(3);

      expect(chain).toHaveLength(3);
      expect(chain.map((e) => e.version)).toEqual([1, 2, 3]);
    });

    it("should stop at first missing version in chain", async () => {
      const v1 = createInitialVersion(makeSpec("chain-gap"));
      const v3 = { ...createNextVersion(v1, makeSpec("chain-gap-v3"), "skip"), version: 3, parentVersion: 2 };

      await store.saveVersion(v1);
      await store.saveVersion(v3);
      await store.saveLineage(makeLineageEntry(1));
      await store.saveLineage(makeLineageEntry(3));

      const chain = await store.getLineageChain(3);

      expect(chain).toHaveLength(1);
      expect(chain[0].version).toBe(3);
    });

    it("should return empty array for completely missing chain", async () => {
      const chain = await store.getLineageChain(999);
      expect(chain).toEqual([]);
    });
  });

  describe("queryLineage", () => {
    beforeEach(async () => {
      const specs = [makeSpec("alpha"), makeSpec("beta"), makeSpec("alpha")];
      const entries: LineageEntry[] = [
        makeLineageEntry(1, { terminalNodeId: "node-a", completedAt: 1000 }),
        makeLineageEntry(2, { terminalNodeId: "node-b", completedAt: 2000 }),
        makeLineageEntry(3, { terminalNodeId: "node-a", completedAt: 3000 }),
      ];

      for (let i = 0; i < specs.length; i++) {
        await store.saveVersion(createInitialVersion(specs[i]));
      }
      for (const entry of entries) {
        await store.saveLineage(entry);
      }
    });

    it("should filter by terminalNodeId", async () => {
      const results = await store.queryLineage({ terminalNodeId: "node-a" });

      expect(results).toHaveLength(2);
      expect(results.every((e) => e.terminalNodeId === "node-a")).toBe(true);
    });

    it("should filter by since (epoch ms)", async () => {
      const results = await store.queryLineage({ since: 1500 });

      expect(results).toHaveLength(2);
      expect(results.every((e) => e.completedAt >= 1500)).toBe(true);
    });

    it("should apply limit", async () => {
      const results = await store.queryLineage({ limit: 1 });

      expect(results).toHaveLength(1);
    });

    it("should combine filters", async () => {
      const results = await store.queryLineage({
        terminalNodeId: "node-a",
        since: 2000,
        limit: 10,
      });

      expect(results).toHaveLength(1);
      expect(results[0].version).toBe(3);
    });

    it("should return empty when no entries match", async () => {
      const results = await store.queryLineage({ terminalNodeId: "nonexistent" });
      expect(results).toEqual([]);
    });
  });

  describe("round-trip integrity", () => {
    it("should preserve all fields through save → retrieve", async () => {
      const spec = makeSpec("roundtrip");
      const version = createInitialVersion(spec);
      const entry: LineageEntry = {
        version: 1,
        terminalNodeId: "end",
        outputs: { start: { nested: { deep: true } }, end: [1, 2, 3] },
        nodeResults: { start: { value: 42 } },
        failures: [
          {
            domainType: "lasso",
            rootCause: "verification_failed",
            nodeId: "start",
            message: "boom",
          },
        ],
        metrics: { retries: 2, durationMs: 1234 },
        trace: [
          { nodeId: "start", source: { specNodeId: "start", specNodeKind: "tool", specPath: "graph.nodes[0]" }, phase: "enter" },
          { nodeId: "start", source: { specNodeId: "start", specNodeKind: "tool", specPath: "graph.nodes[0]" }, phase: "success" },
        ],
        completedAt: 5000,
      };

      await store.saveVersion(version);
      await store.saveLineage(entry);

      const retrievedVersion = await store.getVersion(1);
      const retrievedEntry = await store.getLineageForVersion(1);

      expect(retrievedVersion).toEqual(version);
      expect(retrievedEntry).toEqual(entry);

      expect(retrievedEntry!.outputs).toEqual(entry.outputs);
      expect(retrievedEntry!.failures).toEqual(entry.failures);
      expect(retrievedEntry!.trace).toEqual(entry.trace);
    });
  });
});
