import { describe, it, expect } from "vitest";
import { analyzeEnvironment } from "../../src/environment/analyzer.js";
import type { EnvironmentModel, ToolCapability, Constraint } from "../../src/environment/types.js";

function createMockModel(overrides: Partial<EnvironmentModel> = {}): EnvironmentModel {
  return {
    tools: [
      { name: "bash", version: "5.0.0", available: true },
      { name: "git", version: "2.30.0", available: true },
      { name: "node", version: "18.0.0", available: true },
    ],
    resources: [
      { name: "disk", type: "disk", available: true, limit: "500GB", usage: "200GB" },
    ],
    constraints: [],
    authState: [],
    externalSystems: [],
    discoveredAt: Date.now(),
    ...overrides,
  };
}

describe("analyzeEnvironment", () => {
  describe("tool matching", () => {
    it("matches all available required tools", () => {
      const model = createMockModel();

      const result = analyzeEnvironment(model, ["bash", "git"]);

      expect(result.matchedTools).toHaveLength(2);
      expect(result.missingTools).toHaveLength(0);
      expect(result.matchedTools.map(t => t.name)).toContain("bash");
      expect(result.matchedTools.map(t => t.name)).toContain("git");
    });

    it("identifies missing required tools", () => {
      const model = createMockModel();

      const result = analyzeEnvironment(model, ["bash", "nonexistent-tool"]);

      expect(result.matchedTools).toHaveLength(1);
      expect(result.missingTools).toHaveLength(1);
      expect(result.missingTools).toContain("nonexistent-tool");
    });

    it("handles empty required tools list", () => {
      const model = createMockModel();

      const result = analyzeEnvironment(model, []);

      expect(result.matchedTools).toHaveLength(0);
      expect(result.missingTools).toHaveLength(0);
    });

    it("handles undefined required tools", () => {
      const model = createMockModel();

      const result = analyzeEnvironment(model);

      expect(result.matchedTools).toHaveLength(0);
      expect(result.missingTools).toHaveLength(0);
    });

    it("identifies multiple missing tools", () => {
      const model = createMockModel({
        tools: [
          { name: "bash", available: true },
        ],
      });

      const result = analyzeEnvironment(model, ["bash", "git", "node", "docker"]);

      expect(result.missingTools).toHaveLength(3);
      expect(result.missingTools).toContain("git");
      expect(result.missingTools).toContain("node");
      expect(result.missingTools).toContain("docker");
    });
  });

  describe("readiness score", () => {
    it("computes 100 when all tools available", () => {
      const model = createMockModel();

      const result = analyzeEnvironment(model, ["bash", "git"]);

      expect(result.readinessScore).toBe(100);
    });

    it("computes 0 when no tools available", () => {
      const model = createMockModel({
        tools: [
          { name: "bash", available: false },
          { name: "git", available: false },
        ],
      });

      const result = analyzeEnvironment(model, ["bash", "git"]);

      expect(result.readinessScore).toBe(0);
    });

    it("computes 50 when half tools available", () => {
      const model = createMockModel({
        tools: [
          { name: "bash", available: true },
          { name: "git", available: false },
        ],
      });

      const result = analyzeEnvironment(model, ["bash", "git"]);

      expect(result.readinessScore).toBe(50);
    });

    it("reduces score for high-risk constraints", () => {
      const model = createMockModel({
        tools: [
          { name: "bash", available: true },
          { name: "git", available: true },
        ],
        constraints: [
          { type: "auth", description: "GitHub not authenticated", severity: "high" },
        ],
      });

      const result = analyzeEnvironment(model, ["bash", "git"]);

      expect(result.readinessScore).toBeLessThan(100);
    });
  });

  describe("constraint analysis", () => {
    it("flags high-risk constraints", () => {
      const highRisk: Constraint = {
        type: "auth",
        description: "GitHub not authenticated",
        severity: "high",
      };
      const model = createMockModel({
        constraints: [
          highRisk,
          { type: "network", description: "Slow network", severity: "low" },
        ],
      });

      const result = analyzeEnvironment(model, ["bash"]);

      expect(result.highRiskConstraints).toHaveLength(1);
      expect(result.highRiskConstraints[0]).toBe(highRisk);
    });

    it("returns empty highRiskConstraints when none exist", () => {
      const model = createMockModel();

      const result = analyzeEnvironment(model, ["bash"]);

      expect(result.highRiskConstraints).toHaveLength(0);
    });

    it("includes medium severity constraints in preparatory steps", () => {
      const model = createMockModel({
        constraints: [
          { type: "network", description: "Rate limit approaching", severity: "medium" },
        ],
      });

      const result = analyzeEnvironment(model, ["bash"]);

      expect(result.preparatorySteps.some(s => s.includes("Rate limit"))).toBe(true);
    });
  });

  describe("preparatory steps", () => {
    it("suggests steps for missing tools", () => {
      const model = createMockModel({
        tools: [{ name: "bash", available: true }],
      });

      const result = analyzeEnvironment(model, ["bash", "docker"]);

      expect(result.preparatorySteps.some(s => s.includes("docker"))).toBe(true);
    });

    it("suggests steps for high-risk constraints", () => {
      const model = createMockModel({
        constraints: [
          { type: "auth", description: "GitHub not authenticated", severity: "high" },
        ],
      });

      const result = analyzeEnvironment(model, ["bash"]);

      expect(result.preparatorySteps.some(s => s.includes("GitHub"))).toBe(true);
    });

    it("returns empty preparatory steps when environment is ready", () => {
      const model = createMockModel();

      const result = analyzeEnvironment(model, ["bash", "git"]);

      expect(result.preparatorySteps).toHaveLength(0);
    });
  });
});
