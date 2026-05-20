import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { discoverEnvironment } from "../../src/environment/discovery.js";
import type { DiscoveryOptions } from "../../src/environment/types.js";

describe("discoverEnvironment", () => {
  describe("tool detection", () => {
    it("detects available tools (bash should be available)", async () => {
      const model = await discoverEnvironment();

      const bashTool = model.tools.find(t => t.name === "bash");
      expect(bashTool).toBeDefined();
      expect(bashTool!.available).toBe(true);
      expect(bashTool!.version).toBeDefined();
    });

    it("detects git as available", async () => {
      const model = await discoverEnvironment();

      const gitTool = model.tools.find(t => t.name === "git");
      expect(gitTool).toBeDefined();
      expect(gitTool!.available).toBe(true);
    });

    it("detects node as available", async () => {
      const model = await discoverEnvironment();

      const nodeTool = model.tools.find(t => t.name === "node");
      expect(nodeTool).toBeDefined();
      expect(nodeTool!.available).toBe(true);
    });

    it("reports missing tools as unavailable", async () => {
      const options: DiscoveryOptions = {
        tools: ["bash", "nonexistent-tool-xyz-123"],
      };
      const model = await discoverEnvironment(undefined, options);

      const missingTool = model.tools.find(t => t.name === "nonexistent-tool-xyz-123");
      expect(missingTool).toBeDefined();
      expect(missingTool!.available).toBe(false);
    });

    it("uses default tool set when no tools specified", async () => {
      const model = await discoverEnvironment();

      const defaultTools = ["bash", "git", "node"];
      for (const toolName of defaultTools) {
        const tool = model.tools.find(t => t.name === toolName);
        expect(tool).toBeDefined();
      }
    });

    it("discovers custom tools list", async () => {
      const options: DiscoveryOptions = {
        tools: ["bash", "node"],
      };
      const model = await discoverEnvironment(undefined, options);

      expect(model.tools).toHaveLength(2);
      expect(model.tools.map(t => t.name)).toContain("bash");
      expect(model.tools.map(t => t.name)).toContain("node");
    });
  });

  describe("resource detection", () => {
    it("detects disk resource", async () => {
      const model = await discoverEnvironment();

      const diskResource = model.resources.find(r => r.type === "disk");
      expect(diskResource).toBeDefined();
      expect(diskResource!.available).toBe(true);
    });
  });

  describe("repo state detection", () => {
    it("detects repo state when repoPath provided", async () => {
      const model = await discoverEnvironment(process.cwd());

      expect(model.repoState).toBeDefined();
      expect(model.repoState!.path).toBe(process.cwd());
    });

    it("does not set repoState when no repoPath provided", async () => {
      const model = await discoverEnvironment();

      expect(model.repoState).toBeUndefined();
    });

    it("detects branch name in a git repo", async () => {
      const model = await discoverEnvironment(process.cwd());

      expect(model.repoState!.branch).toBeDefined();
    });

    it("detects remotes in a git repo", async () => {
      const model = await discoverEnvironment(process.cwd());

      expect(Array.isArray(model.repoState!.remotes)).toBe(true);
    });
  });

  describe("external system probing", () => {
    it("probes external systems when specified", async () => {
      const options: DiscoveryOptions = {
        externalSystems: ["example.com"],
        networkTimeoutMS: 2000,
      };
      const model = await discoverEnvironment(undefined, options);

      const exampleSystem = model.externalSystems.find(s => s.name === "example.com");
      expect(exampleSystem).toBeDefined();
    });

    it("reports unreachable systems", async () => {
      const options: DiscoveryOptions = {
        externalSystems: ["192.0.2.1"],
        networkTimeoutMS: 500,
      };
      const model = await discoverEnvironment(undefined, options);

      const unreachableSystem = model.externalSystems.find(s => s.name === "192.0.2.1");
      expect(unreachableSystem).toBeDefined();
      expect(unreachableSystem!.reachable).toBe(false);
    });
  });

  describe("model metadata", () => {
    it("sets discoveredAt timestamp", async () => {
      const before = Date.now();
      const model = await discoverEnvironment();
      const after = Date.now();

      expect(model.discoveredAt).toBeGreaterThanOrEqual(before);
      expect(model.discoveredAt).toBeLessThanOrEqual(after);
    });

    it("includes auth state array", async () => {
      const model = await discoverEnvironment();

      expect(Array.isArray(model.authState)).toBe(true);
    });

    it("includes constraints array", async () => {
      const model = await discoverEnvironment();

      expect(Array.isArray(model.constraints)).toBe(true);
    });
  });
});
