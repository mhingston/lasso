import { describe, it, expect } from "vitest";
import { parsePromptOrSkill } from "../../src/synthesis/skill-parser.js";
import { validateIntent } from "../../src/synthesis/intent-ir.js";
import type { IntentIR } from "../../src/synthesis/intent-ir.js";
import { buildTaskGraph } from "../../src/synthesis/graph-builder.js";
import { synthesizePolicy } from "../../src/synthesis/policy-builder.js";
import type { RiskModel } from "../../src/synthesis/risk-analyzer.js";

describe("custom workflow families", () => {
  const lowRisks: RiskModel = {
    overallRisk: "low",
    approvalRequired: false,
    candidateSourceKind: null,
    verificationBreadth: "moderate",
    stageRisks: new Map(),
    mitigations: []
  };

  describe("validateIntent", () => {
    it("should accept a custom family with steps", () => {
      const intent: IntentIR = {
        family: "deploy-staging",
        goal: "Deploy to staging",
        inputs: { repoPath: "/repo" },
        requiredTools: ["git"],
        humanCheckpoints: [],
        verificationTargets: [],
        steps: [
          { id: "step-1", label: "Build", kind: "tool" },
          { id: "step-2", label: "Deploy", kind: "tool" }
        ]
      };

      const result = validateIntent(intent);
      expect(result).toBeNull();
    });

    it("should accept a custom family without steps", () => {
      const intent: IntentIR = {
        family: "data-pipeline",
        goal: "Run data pipeline",
        inputs: {},
        requiredTools: [],
        humanCheckpoints: [],
        verificationTargets: []
      };

      const result = validateIntent(intent);
      expect(result).toBeNull();
    });

    it("should still accept patch-validation", () => {
      const intent: IntentIR = {
        family: "patch-validation",
        goal: "Validate patch",
        inputs: {},
        requiredTools: ["git"],
        humanCheckpoints: [],
        verificationTargets: []
      };

      const result = validateIntent(intent);
      expect(result).toBeNull();
    });

    it("should still accept pr-review-merge", () => {
      const intent: IntentIR = {
        family: "pr-review-merge",
        goal: "Review PR",
        inputs: {},
        requiredTools: ["git"],
        humanCheckpoints: [],
        verificationTargets: []
      };

      const result = validateIntent(intent);
      expect(result).toBeNull();
    });
  });

  describe("buildTaskGraph", () => {
    it("should create a graph from custom-family steps", () => {
      const intent: IntentIR = {
        family: "deploy-staging",
        goal: "Deploy to staging",
        inputs: { repoPath: "/repo", environment: "staging" },
        requiredTools: ["git"],
        humanCheckpoints: [],
        verificationTargets: ["curl https://staging.example.com/health"],
        steps: [
          { id: "step-1", label: "Build artifacts", kind: "tool" },
          { id: "step-2", label: "Deploy to staging", kind: "tool" },
          { id: "step-3", label: "Verify health", kind: "condition" }
        ]
      };

      const graph = buildTaskGraph(intent);

      expect(graph.family).toBe("deploy-staging");
      expect(graph.stages.find(s => s.id === "step-1")).toBeDefined();
      expect(graph.stages.find(s => s.id === "step-2")).toBeDefined();
      expect(graph.stages.find(s => s.id === "step-3")).toBeDefined();
      expect(graph.stages.find(s => s.id === "verify-target-0")).toBeDefined();
    });

    it("should create a minimal single-node graph for custom family without steps", () => {
      const intent: IntentIR = {
        family: "data-pipeline",
        goal: "Run pipeline",
        inputs: { source: "s3://bucket/data" },
        requiredTools: [],
        humanCheckpoints: [],
        verificationTargets: []
      };

      const graph = buildTaskGraph(intent);

      expect(graph.family).toBe("data-pipeline");
      expect(graph.stages).toHaveLength(0);
      expect(graph.goal).toBe("Run pipeline");
    });

    it("should connect steps sequentially for custom families", () => {
      const intent: IntentIR = {
        family: "deploy-staging",
        goal: "Deploy",
        inputs: {},
        requiredTools: [],
        humanCheckpoints: [],
        verificationTargets: [],
        steps: [
          { id: "step-1", label: "First", kind: "tool" },
          { id: "step-2", label: "Second", kind: "tool" },
          { id: "step-3", label: "Third", kind: "llm" }
        ]
      };

      const graph = buildTaskGraph(intent);

      expect(graph.stages.find(s => s.id === "step-1")!.dependencies).toEqual([]);
      expect(graph.stages.find(s => s.id === "step-2")!.dependencies).toEqual(["step-1"]);
      expect(graph.stages.find(s => s.id === "step-3")!.dependencies).toEqual(["step-2"]);
    });
  });

  describe("synthesizePolicy", () => {
    it("should produce a valid bundle for custom families with steps", () => {
      const graph = buildTaskGraph({
        family: "deploy-staging",
        goal: "Deploy to staging",
        inputs: { repoPath: "/repo" },
        requiredTools: ["git"],
        humanCheckpoints: [],
        verificationTargets: [],
        steps: [
          { id: "step-1", label: "Build", kind: "tool" }
        ]
      });

      const result = synthesizePolicy(graph, lowRisks);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.policy.workflow).toBe("deploy-staging");
        expect(result.policy.bundle).toBeDefined();
        expect(result.policy.rationale.length).toBeGreaterThan(0);
      }
    });

    it("should produce a valid bundle for custom families without steps", () => {
      const graph = buildTaskGraph({
        family: "data-pipeline",
        goal: "Run pipeline",
        inputs: {},
        requiredTools: [],
        humanCheckpoints: [],
        verificationTargets: []
      });

      const result = synthesizePolicy(graph, lowRisks);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.policy.workflow).toBe("data-pipeline");
        expect(result.policy.bundle).toBeDefined();
      }
    });
  });

  describe("end-to-end: skill markdown with custom family", () => {
    it("should compile a deploy-staging skill markdown end-to-end", () => {
      const skillMd = `
# Deploy to Staging

workflow: deploy-staging

## Inputs
- repoPath: /path/to/repo
- environment: staging

## Steps
- [tool] Build artifacts
- [tool] Deploy to staging env
- [condition] Health check passed
- [human] Approve go-live

## Verification
- curl https://staging.example.com/health
      `;

      const result = parsePromptOrSkill(skillMd);

      expect(result).toHaveProperty("success", true);
      if ("success" in result && result.success) {
        expect(result.intent.family).toBe("deploy-staging");
        expect(result.intent.steps).toHaveLength(4);
        expect(result.intent.inputs.repoPath).toBe("/path/to/repo");
        expect(result.intent.inputs.environment).toBe("staging");
        expect(result.intent.verificationTargets).toContain("curl https://staging.example.com/health");

        const graph = buildTaskGraph(result.intent);
        expect(graph.family).toBe("deploy-staging");
        expect(graph.stages.find(s => s.id === "step-1")).toBeDefined();
        expect(graph.stages.find(s => s.id === "step-4")).toBeDefined();
        expect(graph.stages.find(s => s.id === "verify-target-0")).toBeDefined();

        const risks = {
          overallRisk: "low" as const,
          approvalRequired: false,
          candidateSourceKind: null as null,
          verificationBreadth: "moderate" as const,
          stageRisks: new Map(),
          mitigations: []
        };
        const policyResult = synthesizePolicy(graph, risks);
        expect(policyResult.success).toBe(true);
      }
    });

    it("should compile a custom family skill markdown with no steps", () => {
      const skillMd = `
# Data Pipeline

workflow: data-pipeline

## Inputs
- source: s3://bucket/data
      `;

      const result = parsePromptOrSkill(skillMd);

      expect(result).toHaveProperty("success", true);
      if ("success" in result && result.success) {
        expect(result.intent.family).toBe("data-pipeline");

        const graph = buildTaskGraph(result.intent);
        expect(graph.family).toBe("data-pipeline");

        const policyResult = synthesizePolicy(graph, lowRisks);
        expect(policyResult.success).toBe(true);
      }
    });
  });
});
