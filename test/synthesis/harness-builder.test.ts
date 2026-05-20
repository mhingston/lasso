import { describe, it, expect } from "vitest";
import { synthesizeHarness } from "../../src/synthesis/harness-builder.js";
import type { TaskGraph } from "../../src/synthesis/graph-builder.js";
import type { RiskModel } from "../../src/synthesis/risk-analyzer.js";
import type { PolicyBundle } from "../../src/synthesis/policy-builder.js";

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
        
        const policy: PolicyBundle = {
          workflow: "patch-validation",
          bundle: {
            repoPath: "/path/to/repo",
            baselineRef: "v1.0.0",
            candidateSource: { kind: "branch", value: "fix-branch" },
            reproduceCommands: ["npm run fail-test"],
            verificationCommands: ["npm test"],
            reviewInstructions: "Check the fix",
            approvalRequired: false
          },
          rationale: ["Classified as patch-validation"],
          warnings: [],
          missingFields: []
        };
        
        const result = synthesizeHarness(graph, risks, policy);
        
        expect(result.success).toBe(true);
        expect(result.spec).toBeDefined();
        expect(result.spec.graph.nodes).toBeDefined();
        expect(result.spec.graph.nodes.length).toBeGreaterThan(0);
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
        
        const policy: PolicyBundle = {
          workflow: "patch-validation",
          bundle: {
            repoPath: "/path/to/repo",
            baselineRef: "main",
            candidateSource: { kind: "branch", value: "fix" },
            reproduceCommands: ["npm run fail"],
            verificationCommands: ["npm test"],
            reviewInstructions: "Check",
            approvalRequired: false
          },
          rationale: [],
          warnings: [],
          missingFields: []
        };
        
        const result = synthesizeHarness(graph, risks, policy);
        
        // Verify that we get a real harness spec with the expected structure
        expect(result.spec.graph.entryNodeId).toBe("run-baseline");
        expect(result.spec.graph.nodes.some(n => n.id === "run-baseline")).toBe(true);
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
        
        const policy: PolicyBundle = {
          workflow: "pr-review-merge",
          bundle: {
            repoPath: "/path/to/repo",
            sourceBranch: "feature",
            targetBranch: "main",
            reviewInstructions: "Check security",
            verificationCommands: ["npm test"]
          },
          rationale: ["Classified as pr-review-merge"],
          warnings: [],
          missingFields: []
        };
        
        const result = synthesizeHarness(graph, risks, policy);
        
        expect(result.success).toBe(true);
        expect(result.spec).toBeDefined();
        expect(result.spec.graph.nodes).toBeDefined();
        expect(result.spec.graph.nodes.length).toBeGreaterThan(0);
      });
      
      it("should preserve rationale and warnings", () => {
        const graph: TaskGraph = {
          family: "pr-review-merge",
          stages: [],
          inputs: {
            repoPath: "/path/to/repo",
            sourceBranch: "feature",
            targetBranch: "main",
            reviewInstructions: "Check",
            verificationCommands: ["npm test"]
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
        
        const policy: PolicyBundle = {
          workflow: "pr-review-merge",
          bundle: {
            repoPath: "/path/to/repo",
            sourceBranch: "feature",
            targetBranch: "main",
            reviewInstructions: "Check",
            verificationCommands: ["npm test"]
          },
          rationale: ["Classified as pr-review-merge", "Risk: medium"],
          warnings: ["Limited test coverage"],
          missingFields: []
        };
        
        const result = synthesizeHarness(graph, risks, policy);
        
        expect(result.rationale).toContain("Classified as pr-review-merge");
        expect(result.warnings).toContain("Limited test coverage");
      });
    });
  });
});
