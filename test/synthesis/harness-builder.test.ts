import { describe, it, expect } from "vitest";
import { synthesizeHarness } from "../../src/synthesis/harness-builder.js";
import type { TaskGraph } from "../../src/synthesis/graph-builder.js";
import type { RiskModel } from "../../src/synthesis/risk-analyzer.js";

describe("harness-builder", () => {
  describe("synthesizeHarness", () => {
    describe("patch-validation harness synthesis", () => {
      it("should synthesize valid HarnessSpec for patch validation", () => {
        const graph: TaskGraph = {
          family: "patch-validation",
          stages: [],
          inputs: {
            repoPath: "/path/to/repo",
            baselineRef: "v1.0.0",
            candidateBranch: "fix-branch",
            reproduceCommands: ["npm run fail-test"],
            verificationCommands: ["npm test"],
            reviewInstructions: "Check the fix"
          },
          goal: "Validate patch"
        };
        
        const risks: RiskModel = {
          overallRisk: "low",
          approvalRequired: false,
          candidateSourceKind: "branch",
          verificationBreadth: "moderate",
          stageRisks: new Map(),
          mitigations: []
        };
        
        const spec = synthesizeHarness(graph, risks);
        
        expect(spec).toBeDefined();
        expect(spec.graph.nodes).toBeDefined();
        expect(spec.graph.nodes.length).toBeGreaterThan(0);
      });
      
      it("should delegate to existing reference builder", () => {
        const graph: TaskGraph = {
          family: "patch-validation",
          stages: [],
          inputs: {
            repoPath: "/path/to/repo",
            baselineRef: "main",
            candidateBranch: "fix",
            reproduceCommands: ["npm run fail"],
            verificationCommands: ["npm test"],
            reviewInstructions: "Check"
          },
          goal: "Validate"
        };
        
        const risks: RiskModel = {
          overallRisk: "low",
          approvalRequired: false,
          candidateSourceKind: "branch",
          verificationBreadth: "moderate",
          stageRisks: new Map(),
          mitigations: []
        };
        
        const spec = synthesizeHarness(graph, risks);
        
        // Verify that we get a real harness spec with the expected structure
        expect(spec.graph.entryNodeId).toBe("run-baseline");
        expect(spec.graph.nodes.some(n => n.id === "run-baseline")).toBe(true);
      });
    });
    
    describe("pr-review-merge harness synthesis", () => {
      it("should synthesize valid HarnessSpec for PR review and merge", () => {
        const graph: TaskGraph = {
          family: "pr-review-merge",
          stages: [],
          inputs: {
            repoPath: "/path/to/repo",
            sourceBranch: "feature",
            targetBranch: "main",
            reviewInstructions: "Check security",
            verificationCommands: ["npm test"]
          },
          goal: "Review and merge PR"
        };
        
        const risks: RiskModel = {
          overallRisk: "low",
          approvalRequired: false,
          candidateSourceKind: "pr",
          verificationBreadth: "moderate",
          stageRisks: new Map(),
          mitigations: []
        };
        
        const spec = synthesizeHarness(graph, risks);
        
        expect(spec).toBeDefined();
        expect(spec.graph.nodes).toBeDefined();
        expect(spec.graph.nodes.length).toBeGreaterThan(0);
      });
      
      it("should throw when policy synthesis cannot produce a valid harness", () => {
        const graph: TaskGraph = {
          family: "pr-review-merge",
          stages: [],
          inputs: {
            repoPath: "/path/to/repo",
            sourceBranch: "feature",
            reviewInstructions: "Check"
          },
          goal: "Review"
        };
        
        const risks: RiskModel = {
          overallRisk: "medium",
          approvalRequired: false,
          candidateSourceKind: "pr",
          verificationBreadth: "narrow",
          stageRisks: new Map(),
          mitigations: ["Consider adding more tests"]
        };
        
        expect(() => synthesizeHarness(graph, risks)).toThrow(/Policy synthesis failed/);
      });
    });
  });
});
