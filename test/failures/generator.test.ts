import { describe, expect, it } from "vitest";
import { generateFailureModes } from "../../src/failures/generator.js";
import type { EnvironmentModel } from "../../src/environment/types.js";

function makeEnv(overrides: Partial<EnvironmentModel> = {}): EnvironmentModel {
  return {
    tools: [],
    resources: [],
    constraints: [],
    authState: [],
    externalSystems: [],
    discoveredAt: Date.now(),
    ...overrides,
  };
}

describe("generateFailureModes", () => {
  describe("keyword-based generation", () => {
    it("should generate auth/network/config failure modes for 'deploy' tasks", () => {
      const result = generateFailureModes("deploy application to production");
      const classes = result.failureModes.map(f => f.failureClass);

      expect(classes).toContain("auth");
      expect(classes).toContain("network");
      expect(result.failureModes.some(f => f.description.toLowerCase().includes("config"))).toBe(true);
    });

    it("should generate flaky/timeout/environment failure modes for 'test' tasks", () => {
      const result = generateFailureModes("run integration tests");
      const classes = result.failureModes.map(f => f.failureClass);

      expect(classes).toContain("resource");
      expect(result.failureModes.some(f => f.description.toLowerCase().includes("flaky") || f.description.toLowerCase().includes("timeout"))).toBe(true);
    });

    it("should generate dependency/disk/OOM failure modes for 'build' tasks", () => {
      const result = generateFailureModes("build the project");
      const classes = result.failureModes.map(f => f.failureClass);

      expect(classes).toContain("resource");
      expect(result.failureModes.some(f => f.description.toLowerCase().includes("dependency"))).toBe(true);
    });

    it("should generate conflict/verification failure modes for 'merge' tasks", () => {
      const result = generateFailureModes("merge feature branch into main");
      const classes = result.failureModes.map(f => f.failureClass);

      expect(result.failureModes.some(f => f.description.toLowerCase().includes("conflict"))).toBe(true);
    });

    it("should generate connection/migration failure modes for 'database' tasks", () => {
      const result = generateFailureModes("run database migrations");
      const classes = result.failureModes.map(f => f.failureClass);

      expect(classes).toContain("network");
      expect(result.failureModes.some(f => f.description.toLowerCase().includes("migration") || f.description.toLowerCase().includes("database"))).toBe(true);
    });

    it("should generate rate-limit/auth/schema failure modes for 'api' tasks", () => {
      const result = generateFailureModes("call external API");
      const classes = result.failureModes.map(f => f.failureClass);

      expect(classes).toContain("auth");
      expect(result.failureModes.some(f => f.description.toLowerCase().includes("rate") || f.description.toLowerCase().includes("limit"))).toBe(true);
    });

    it("should generate permission/disk/path failure modes for 'file' tasks", () => {
      const result = generateFailureModes("copy files to output directory");
      const classes = result.failureModes.map(f => f.failureClass);

      expect(result.failureModes.some(f => f.description.toLowerCase().includes("permission") || f.description.toLowerCase().includes("file"))).toBe(true);
    });
  });

  describe("environment constraint integration", () => {
    it("should add auth failure modes when auth constraint detected", () => {
      const env = makeEnv({
        constraints: [{ type: "auth", description: "GitHub token missing", severity: "high" }],
      });
      const result = generateFailureModes("push changes", env);

      expect(result.failureModes.some(f => f.failureClass === "auth")).toBe(true);
    });

    it("should add network failure modes when network constraint detected", () => {
      const env = makeEnv({
        constraints: [{ type: "network", description: "No outbound access", severity: "high" }],
      });
      const result = generateFailureModes("fetch remote data", env);

      expect(result.failureModes.some(f => f.failureClass === "network")).toBe(true);
    });

    it("should add resource failure modes when resource constraint detected", () => {
      const env = makeEnv({
        resources: [{ name: "disk", type: "disk", available: false }],
      });
      const result = generateFailureModes("compile project", env);

      expect(result.failureModes.some(f => f.failureClass === "resource")).toBe(true);
    });

    it("should enhance probability when env constraint matches keyword pattern", () => {
      const env = makeEnv({
        constraints: [{ type: "auth", description: "Token expired", severity: "high" }],
      });
      const result = generateFailureModes("deploy to cloud", env);

      const authModes = result.failureModes.filter(f => f.failureClass === "auth");
      expect(authModes.some(f => f.probability === "high")).toBe(true);
    });
  });

  describe("risk summary", () => {
    it("should produce a human-readable risk summary", () => {
      const result = generateFailureModes("deploy application");

      expect(result.riskSummary).toBeTruthy();
      expect(typeof result.riskSummary).toBe("string");
      expect(result.riskSummary.length).toBeGreaterThan(0);
    });

    it("should mention high-probability risks in summary", () => {
      const result = generateFailureModes("deploy to production");
      const highProb = result.failureModes.filter(f => f.probability === "high");

      if (highProb.length > 0) {
        expect(result.riskSummary.toLowerCase()).toContain("high");
      }
    });
  });

  describe("recovery actions", () => {
    it("should include actionable recovery actions for each failure mode", () => {
      const result = generateFailureModes("deploy application");

      for (const mode of result.failureModes) {
        expect(mode.recoveryActions.length).toBeGreaterThan(0);
        for (const action of mode.recoveryActions) {
          expect(action.length).toBeGreaterThan(0);
        }
      }
    });

    it("should include triggers for each failure mode", () => {
      const result = generateFailureModes("build project");

      for (const mode of result.failureModes) {
        expect(mode.triggers.length).toBeGreaterThan(0);
      }
    });

    it("should include mitigations for each failure mode", () => {
      const result = generateFailureModes("test suite");

      for (const mode of result.failureModes) {
        expect(mode.mitigations.length).toBeGreaterThan(0);
      }
    });
  });

  describe("edge cases", () => {
    it("should return minimal failure modes for empty task description", () => {
      const result = generateFailureModes("");

      expect(result.failureModes.length).toBeGreaterThan(0);
      expect(result.failureModes.some(f => f.failureClass === "unknown")).toBe(true);
    });

    it("should combine failure modes when multiple keywords present", () => {
      const result = generateFailureModes("deploy and test the API integration");
      const classes = new Set(result.failureModes.map(f => f.failureClass));

      expect(classes.size).toBeGreaterThanOrEqual(3);
    });

    it("should deduplicate failure modes with same class and similar description", () => {
      const result = generateFailureModes("deploy deploy deploy");
      const descriptions = result.failureModes.map(f => f.description);
      const unique = new Set(descriptions);

      expect(unique.size).toBe(descriptions.length);
    });

    it("should set generatedAt to a timestamp", () => {
      const result = generateFailureModes("build");
      expect(result.generatedAt).toBeGreaterThan(0);
    });

    it("should include the task description in the result", () => {
      const result = generateFailureModes("deploy app");
      expect(result.taskDescription).toBe("deploy app");
    });

    it("should generate unique ids for each failure mode", () => {
      const result = generateFailureModes("deploy and test API");
      const ids = result.failureModes.map(f => f.id);
      const unique = new Set(ids);

      expect(unique.size).toBe(ids.length);
    });
  });
});
