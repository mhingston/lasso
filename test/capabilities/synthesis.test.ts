import { describe, it, expect } from "vitest";
import { buildTaskGraph } from "../../src/synthesis/graph-builder.js";
import { analyzeRisks } from "../../src/synthesis/risk-analyzer.js";
import { synthesizePolicy } from "../../src/synthesis/policy-builder.js";
import { planWorkflowRequest } from "../../src/planner/synthesize.js";
import { DefaultCapabilityRegistry } from "../../src/capabilities/registry.js";
import type { IntentIR } from "../../src/synthesis/intent-ir.js";
import type { CapabilityRegistry } from "../../src/capabilities/types.js";

function createRegistry(): CapabilityRegistry {
  return new DefaultCapabilityRegistry();
}

describe("capability-driven synthesis", () => {
  describe("graph construction from capabilities", () => {
    it("should build capability-driven graph when capabilities are present", () => {
      const intent: IntentIR = {
        family: "custom",
        goal: "Run custom workflow",
        inputs: {},
        requiredTools: ["bash", "git"],
        humanCheckpoints: [],
        verificationTargets: [],
        capabilities: ["bash", "git"]
      };

      const registry = createRegistry();
      const graph = buildTaskGraph(intent, registry);

      expect(graph.stages.length).toBeGreaterThan(0);
      expect(graph.stages.some(s => s.type === "setup")).toBe(true);
    });

    it("should include verification stages from capability verification steps", () => {
      const intent: IntentIR = {
        family: "custom",
        goal: "Run custom workflow",
        inputs: {},
        requiredTools: ["git"],
        humanCheckpoints: [],
        verificationTargets: [],
        capabilities: ["git"]
      };

      const registry = createRegistry();
      const graph = buildTaskGraph(intent, registry);

      const verifyStages = graph.stages.filter(s => s.type === "verify");
      expect(verifyStages.length).toBeGreaterThan(0);
    });

    it("should include risk stages from capability risk declarations", () => {
      const intent: IntentIR = {
        family: "custom",
        goal: "Run custom workflow",
        inputs: {},
        requiredTools: ["bash"],
        humanCheckpoints: [],
        verificationTargets: [],
        capabilities: ["bash"]
      };

      const registry = createRegistry();
      const graph = buildTaskGraph(intent, registry);

      expect(graph.stages.some(s => s.id.includes("risk") || s.description.toLowerCase().includes("risk"))).toBe(true);
    });

    it("should add human-approval stage when human-approval capability is required", () => {
      const intent: IntentIR = {
        family: "custom",
        goal: "Run custom workflow with approval",
        inputs: {},
        requiredTools: ["bash", "human-approval"],
        humanCheckpoints: [],
        verificationTargets: [],
        capabilities: ["bash", "human-approval"]
      };

      const registry = createRegistry();
      const graph = buildTaskGraph(intent, registry);

      expect(graph.stages.some(s => s.type === "approval")).toBe(true);
    });

    it("should handle missing capabilities gracefully", () => {
      const intent: IntentIR = {
        family: "custom",
        goal: "Run custom workflow",
        inputs: {},
        requiredTools: ["bash", "nonexistent"],
        humanCheckpoints: [],
        verificationTargets: [],
        capabilities: ["bash", "nonexistent"]
      };

      const registry = createRegistry();
      const graph = buildTaskGraph(intent, registry);

      expect(graph.stages.length).toBeGreaterThan(0);
    });
  });

  describe("backward compatibility", () => {
    it("should still build patch-validation graph without capabilities", () => {
      const intent: IntentIR = {
        family: "patch-validation",
        goal: "Validate patch",
        inputs: {
          repoPath: "/repo",
          baselineRef: "main",
          candidateBranch: "fix",
          reproduceCommands: ["npm run fail"],
          verificationCommands: ["npm test"],
          reviewInstructions: "Check"
        },
        requiredTools: ["git"],
        humanCheckpoints: [],
        verificationTargets: ["npm test"]
      };

      const graph = buildTaskGraph(intent);

      expect(graph.family).toBe("patch-validation");
      expect(graph.stages.map(s => s.type)).toEqual([
        "setup", "reproduce", "apply", "verify", "review"
      ]);
    });

    it("should still build pr-review-merge graph without capabilities", () => {
      const intent: IntentIR = {
        family: "pr-review-merge",
        goal: "Review and merge PR",
        inputs: {
          repoPath: "/repo",
          sourceBranch: "feature",
          targetBranch: "main",
          reviewInstructions: "Check",
          verificationCommands: ["npm test"]
        },
        requiredTools: ["git"],
        humanCheckpoints: [],
        verificationTargets: ["npm test"]
      };

      const graph = buildTaskGraph(intent);

      expect(graph.family).toBe("pr-review-merge");
      expect(graph.stages.map(s => s.type)).toEqual([
        "setup", "review", "verify", "merge"
      ]);
    });
  });

  describe("risk analysis with capabilities", () => {
    it("should lower risk when all capabilities are available", () => {
      const intent: IntentIR = {
        family: "custom",
        goal: "Run workflow",
        inputs: {},
        requiredTools: ["bash", "git"],
        humanCheckpoints: [],
        verificationTargets: [],
        capabilities: ["bash", "git"]
      };

      const registry = createRegistry();
      const graph = buildTaskGraph(intent, registry);
      const risks = analyzeRisks(graph, registry);

      expect(risks.overallRisk).toBe("low");
      expect(risks.capabilityRisk).toBeDefined();
      expect(risks.capabilityRisk?.allAvailable).toBe(true);
    });

    it("should escalate risk when capabilities are missing", () => {
      const intent: IntentIR = {
        family: "custom",
        goal: "Run workflow",
        inputs: {},
        requiredTools: ["bash", "missing-tool"],
        humanCheckpoints: [],
        verificationTargets: [],
        capabilities: ["bash", "missing-tool"]
      };

      const registry = createRegistry();
      const graph = buildTaskGraph(intent, registry);
      const risks = analyzeRisks(graph, registry);

      expect(risks.capabilityRisk).toBeDefined();
      expect(risks.capabilityRisk?.allAvailable).toBe(false);
      expect(risks.capabilityRisk?.missing).toContain("missing-tool");
    });

    it("should incorporate capability risk declarations", () => {
      const registry = createRegistry();
      const intent: IntentIR = {
        family: "custom",
        goal: "Run workflow",
        inputs: {},
        requiredTools: ["bash"],
        humanCheckpoints: [],
        verificationTargets: [],
        capabilities: ["bash"]
      };

      const graph = buildTaskGraph(intent, registry);
      const risks = analyzeRisks(graph, registry);

      expect(risks.capabilityRisk?.riskFactors.length).toBeGreaterThan(0);
    });
  });

  describe("end-to-end capability-driven synthesis", () => {
    it("should synthesize policy from capability-driven intent", () => {
      const intent: IntentIR = {
        family: "custom",
        goal: "Run custom workflow",
        inputs: {},
        requiredTools: ["bash", "git"],
        humanCheckpoints: [],
        verificationTargets: [],
        capabilities: ["bash", "git"]
      };

      const registry = createRegistry();
      const graph = buildTaskGraph(intent, registry);
      const risks = analyzeRisks(graph, registry);
      const policyResult = synthesizePolicy(graph, risks);

      expect(policyResult.success).toBe(true);
      if (policyResult.success) {
        expect(policyResult.policy.workflow).toBe("custom");
        expect(policyResult.policy.rationale.length).toBeGreaterThan(0);
      }
    });

    it("should include capability information in rationale", () => {
      const intent: IntentIR = {
        family: "custom",
        goal: "Run custom workflow",
        inputs: {},
        requiredTools: ["bash", "git"],
        humanCheckpoints: [],
        verificationTargets: [],
        capabilities: ["bash", "git"]
      };

      const registry = createRegistry();
      const graph = buildTaskGraph(intent, registry);
      const risks = analyzeRisks(graph, registry);
      const policyResult = synthesizePolicy(graph, risks);

      expect(policyResult.success).toBe(true);
      if (policyResult.success) {
        const hasCapabilityMention = policyResult.policy.rationale.some(
          r => r.toLowerCase().includes("capability") || r.includes("bash") || r.includes("git")
        );
        expect(hasCapabilityMention).toBe(true);
      }
    });
  });
});
