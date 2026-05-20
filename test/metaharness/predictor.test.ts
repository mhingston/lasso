import { describe, expect, it } from "vitest";
import type { HarnessSpec } from "../../src/spec/types.js";
import type { EnvironmentModel } from "../../src/environment/types.js";
import type { FailureSignature } from "../../src/failures/ontology.js";
import { predictFailuresFromEnvironment } from "../../src/metaharness/predictor.js";

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
      { name: "node", version: "20.0", available: true },
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

function makeFailureSignature(
  cls: FailureSignature["class"],
  overrides?: Partial<FailureSignature>,
): FailureSignature {
  return {
    class: cls,
    confidence: 0.9,
    evidence: ["test evidence"],
    suggestedRecovery: [],
    retryable: false,
    requiresHumanIntervention: false,
    ...overrides,
  };
}

describe("predictFailuresFromEnvironment", () => {
  describe("tool availability checks", () => {
    it("returns no failures when all required tools are available", () => {
      const spec = makeMinimalSpec();
      const env = makeMinimalEnv();

      const failures = predictFailuresFromEnvironment(spec, env);

      expect(failures.length).toBe(0);
    });

    it("predicts tool failure when required tool is missing", () => {
      const spec: HarnessSpec = {
        name: "test-harness",
        graph: {
          entryNodeId: "node-a",
          nodes: [
            {
              id: "node-a",
              label: "Node A",
              kind: "tool",
              tool: "kubectl",
              args: ["get pods"],
            },
          ],
          edges: [],
        },
      };
      const env = makeMinimalEnv();

      const failures = predictFailuresFromEnvironment(spec, env);

      expect(failures.length).toBeGreaterThan(0);
      expect(failures.some(f => f.class === "tool")).toBe(true);
    });

    it("predicts failures for multiple nodes with missing tools", () => {
      const spec: HarnessSpec = {
        name: "test-harness",
        graph: {
          entryNodeId: "node-a",
          nodes: [
            {
              id: "node-a",
              label: "Node A",
              kind: "tool",
              tool: "kubectl",
              args: ["get pods"],
            },
            {
              id: "node-b",
              label: "Node B",
              kind: "tool",
              tool: "docker",
              args: ["ps"],
            },
          ],
          edges: [{ from: "node-a", to: "node-b" }],
        },
      };
      const env = makeMinimalEnv();

      const failures = predictFailuresFromEnvironment(spec, env);

      expect(failures.length).toBeGreaterThanOrEqual(2);
    });

    it("includes node ID in evidence for tool failures", () => {
      const spec: HarnessSpec = {
        name: "test-harness",
        graph: {
          entryNodeId: "node-a",
          nodes: [
            {
              id: "deploy-step",
              label: "Deploy",
              kind: "tool",
              tool: "kubectl",
              args: ["apply -f deploy.yaml"],
            },
          ],
          edges: [],
        },
      };
      const env = makeMinimalEnv();

      const failures = predictFailuresFromEnvironment(spec, env);

      const toolFailure = failures.find(f => f.class === "tool");
      expect(toolFailure).toBeDefined();
      expect(toolFailure!.evidence.some(e => e.includes("deploy-step"))).toBe(true);
    });
  });

  describe("constraint-based predictions", () => {
    it("predicts failures from high-severity constraints", () => {
      const spec = makeMinimalSpec();
      const env = makeMinimalEnv({
        constraints: [
          {
            type: "permission",
            description: "No write access to /etc",
            severity: "high",
          },
        ],
      });

      const failures = predictFailuresFromEnvironment(spec, env);

      expect(failures.length).toBeGreaterThan(0);
    });

    it("includes constraint description in evidence", () => {
      const spec = makeMinimalSpec();
      const env = makeMinimalEnv({
        constraints: [
          {
            type: "auth",
            description: "GitHub API rate limited",
            severity: "high",
          },
        ],
      });

      const failures = predictFailuresFromEnvironment(spec, env);

      expect(failures.some(f =>
        f.evidence.some(e => e.includes("GitHub API rate limited")),
      )).toBe(true);
    });

    it("does not predict failures for low-severity constraints", () => {
      const spec = makeMinimalSpec();
      const env = makeMinimalEnv({
        constraints: [
          {
            type: "network",
            description: "High latency to remote API",
            severity: "low",
          },
        ],
      });

      const failures = predictFailuresFromEnvironment(spec, env);

      expect(failures.length).toBe(0);
    });
  });

  describe("auth state predictions", () => {
    it("predicts auth failure when authentication is missing", () => {
      const spec: HarnessSpec = {
        name: "test-harness",
        graph: {
          entryNodeId: "node-a",
          nodes: [
            {
              id: "node-a",
              label: "Push to remote",
              kind: "tool",
              tool: "git",
              args: ["push origin main"],
            },
          ],
          edges: [],
        },
      };
      const env = makeMinimalEnv({
        authState: [
          { system: "github", authenticated: false },
        ],
      });

      const failures = predictFailuresFromEnvironment(spec, env);

      expect(failures.some(f => f.class === "auth")).toBe(true);
    });

    it("does not predict auth failure when authenticated", () => {
      const spec = makeMinimalSpec();
      const env = makeMinimalEnv({
        authState: [
          { system: "github", authenticated: true },
        ],
      });

      const failures = predictFailuresFromEnvironment(spec, env);

      expect(failures.some(f => f.class === "auth")).toBe(false);
    });
  });

  describe("resource constraint predictions", () => {
    it("predicts resource failure when disk is unavailable", () => {
      const spec = makeMinimalSpec();
      const env = makeMinimalEnv({
        resources: [
          { name: "disk", type: "disk", available: false },
        ],
      });

      const failures = predictFailuresFromEnvironment(spec, env);

      expect(failures.some(f => f.class === "resource")).toBe(true);
    });

    it("predicts resource failure when disk usage is critical", () => {
      const spec = makeMinimalSpec();
      const env = makeMinimalEnv({
        resources: [
          { name: "disk", type: "disk", available: true, usage: "95%" },
        ],
      });

      const failures = predictFailuresFromEnvironment(spec, env);

      expect(failures.some(f => f.class === "resource")).toBe(true);
    });

    it("does not predict resource failure for healthy disk", () => {
      const spec = makeMinimalSpec();
      const env = makeMinimalEnv({
        resources: [
          { name: "disk", type: "disk", available: true, usage: "45%" },
        ],
      });

      const failures = predictFailuresFromEnvironment(spec, env);

      expect(failures.some(f => f.class === "resource")).toBe(false);
    });
  });

  describe("confidence scores", () => {
    it("assigns high confidence for missing tools", () => {
      const spec: HarnessSpec = {
        name: "test-harness",
        graph: {
          entryNodeId: "node-a",
          nodes: [
            {
              id: "node-a",
              kind: "tool",
              tool: "nonexistent-tool-xyz",
              args: [],
            },
          ],
          edges: [],
        },
      };
      const env = makeMinimalEnv();

      const failures = predictFailuresFromEnvironment(spec, env);

      const toolFailure = failures.find(f => f.class === "tool");
      expect(toolFailure).toBeDefined();
      expect(toolFailure!.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it("assigns confidence based on constraint severity", () => {
      const spec = makeMinimalSpec();
      const env = makeMinimalEnv({
        constraints: [
          { type: "permission", description: "No access", severity: "high" },
        ],
      });

      const failures = predictFailuresFromEnvironment(spec, env);

      expect(failures[0].confidence).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe("empty/edge cases", () => {
    it("returns empty array for spec with no nodes", () => {
      const spec: HarnessSpec = {
        name: "empty",
        graph: { entryNodeId: "", nodes: [], edges: [] },
      };
      const env = makeMinimalEnv();

      const failures = predictFailuresFromEnvironment(spec, env);

      expect(failures.length).toBe(0);
    });

    it("handles LLM nodes without tool checks", () => {
      const spec: HarnessSpec = {
        name: "llm-harness",
        graph: {
          entryNodeId: "node-a",
          nodes: [
            {
              id: "node-a",
              kind: "llm",
              provider: "openai",
              model: "gpt-4",
              prompt: "Review this code",
            },
          ],
          edges: [],
        },
      };
      const env = makeMinimalEnv();

      const failures = predictFailuresFromEnvironment(spec, env);

      // LLM nodes don't require specific tools, so no tool failures expected
      expect(failures.some(f => f.class === "tool")).toBe(false);
    });

    it("handles human nodes without tool checks", () => {
      const spec: HarnessSpec = {
        name: "human-harness",
        graph: {
          entryNodeId: "node-a",
          nodes: [
            {
              id: "node-a",
              kind: "human",
              prompt: "Approve this change",
              interactionType: "approval",
            },
          ],
          edges: [],
        },
      };
      const env = makeMinimalEnv();

      const failures = predictFailuresFromEnvironment(spec, env);

      expect(failures.some(f => f.class === "tool")).toBe(false);
    });
  });

  describe("retryable flag", () => {
    it("marks tool failures as non-retryable", () => {
      const spec: HarnessSpec = {
        name: "test-harness",
        graph: {
          entryNodeId: "node-a",
          nodes: [
            {
              id: "node-a",
              kind: "tool",
              tool: "missing-tool",
              args: [],
            },
          ],
          edges: [],
        },
      };
      const env = makeMinimalEnv();

      const failures = predictFailuresFromEnvironment(spec, env);

      const toolFailure = failures.find(f => f.class === "tool");
      expect(toolFailure).toBeDefined();
      expect(toolFailure!.retryable).toBe(false);
    });

    it("marks resource failures as retryable", () => {
      const spec = makeMinimalSpec();
      const env = makeMinimalEnv({
        resources: [
          { name: "disk", type: "disk", available: false },
        ],
      });

      const failures = predictFailuresFromEnvironment(spec, env);

      const resourceFailure = failures.find(f => f.class === "resource");
      expect(resourceFailure).toBeDefined();
      expect(resourceFailure!.retryable).toBe(true);
    });
  });
});
