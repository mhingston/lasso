import { describe, it, expect } from "vitest";
import { analyzeRisks } from "../../src/synthesis/risk-analyzer.js";
import type { TaskGraph } from "../../src/synthesis/graph-builder.js";

describe("risk-analyzer", () => {
  describe("analyzeRisks", () => {
    describe("candidate source kind detection", () => {
      it("should detect branch candidate source", () => {
        const graph: TaskGraph = {
          family: "patch-validation",
          stages: [],
          inputs: {
            candidateBranch: "fix-branch",
            verificationCommands: ["npm test"]
          },
          goal: "Validate patch"
        };
        
        const risks = analyzeRisks(graph);
        
        expect(risks.candidateSourceKind).toBe("branch");
      });
      
      it("should detect patch file candidate source", () => {
        const graph: TaskGraph = {
          family: "patch-validation",
          stages: [],
          inputs: {
            patchFilePath: "fix.patch",
            verificationCommands: ["npm test"]
          },
          goal: "Validate patch"
        };
        
        const risks = analyzeRisks(graph);
        
        expect(risks.candidateSourceKind).toBe("patchFile");
      });
      
      it("should detect PR candidate source", () => {
        const graph: TaskGraph = {
          family: "pr-review-merge",
          stages: [],
          inputs: {
            sourceBranch: "feature",
            targetBranch: "main",
            verificationCommands: ["npm test"]
          },
          goal: "Review and merge PR"
        };
        
        const risks = analyzeRisks(graph);
        
        expect(risks.candidateSourceKind).toBe("pr");
      });
    });
    
    describe("approval requirement detection", () => {
      it("should detect approval requirement from inputs", () => {
        const graph: TaskGraph = {
          family: "patch-validation",
          stages: [],
          inputs: {
            approvalRequired: true,
            candidateBranch: "fix-branch"
          },
          goal: "Validate patch"
        };
        
        const risks = analyzeRisks(graph);
        
        expect(risks.approvalRequired).toBe(true);
      });
      
      it("should default approval to false when not specified", () => {
        const graph: TaskGraph = {
          family: "patch-validation",
          stages: [],
          inputs: {
            candidateBranch: "fix-branch"
          },
          goal: "Validate patch"
        };
        
        const risks = analyzeRisks(graph);
        
        expect(risks.approvalRequired).toBe(false);
      });
    });
    
    describe("verification breadth assessment", () => {
      it("should assess narrow verification breadth with no commands", () => {
        const graph: TaskGraph = {
          family: "patch-validation",
          stages: [],
          inputs: {},
          goal: "Validate patch"
        };
        
        const risks = analyzeRisks(graph);
        
        expect(risks.verificationBreadth).toBe("narrow");
      });
      
      it("should assess moderate verification breadth with 1-2 commands", () => {
        const graph: TaskGraph = {
          family: "patch-validation",
          stages: [],
          inputs: {
            verificationCommands: ["npm test"],
            reproduceCommands: ["npm run fail"]
          },
          goal: "Validate patch"
        };
        
        const risks = analyzeRisks(graph);
        
        expect(risks.verificationBreadth).toBe("moderate");
      });
      
      it("should assess comprehensive verification breadth with 3+ commands", () => {
        const graph: TaskGraph = {
          family: "patch-validation",
          stages: [],
          inputs: {
            verificationCommands: ["npm test", "npm run lint"],
            reproduceCommands: ["npm run fail"]
          },
          goal: "Validate patch"
        };
        
        const risks = analyzeRisks(graph);
        
        expect(risks.verificationBreadth).toBe("comprehensive");
      });
    });
    
    describe("stage risk analysis", () => {
      it("should analyze stage risks correctly", () => {
        const graph: TaskGraph = {
          family: "patch-validation",
          stages: [
            {
              id: "apply-candidate",
              type: "apply",
              dependencies: [],
              description: "Apply candidate",
              requiredInputs: []
            },
            {
              id: "verify-fix",
              type: "verify",
              dependencies: [],
              description: "Verify fix",
              requiredInputs: []
            }
          ],
          inputs: {
            patchFilePath: "fix.patch",
            verificationCommands: ["npm test"]
          },
          goal: "Validate patch"
        };
        
        const risks = analyzeRisks(graph);
        
        expect(risks.stageRisks.size).toBeGreaterThan(0);
        const applyRisk = risks.stageRisks.get("apply-candidate");
        expect(applyRisk).toBeDefined();
        expect(applyRisk?.risk).toBe("medium");
      });
    });
    
    describe("overall risk calculation", () => {
      it("should calculate overall risk as medium when any stage is medium", () => {
        const graph: TaskGraph = {
          family: "patch-validation",
          stages: [
            {
              id: "apply-candidate",
              type: "apply",
              dependencies: [],
              description: "Apply candidate",
              requiredInputs: []
            }
          ],
          inputs: {
            patchFilePath: "fix.patch"
          },
          goal: "Validate patch"
        };
        
        const risks = analyzeRisks(graph);
        
        expect(risks.overallRisk).toBe("medium");
      });
    });
    
    describe("mitigation suggestions", () => {
      it("should suggest mitigations for narrow verification", () => {
        const graph: TaskGraph = {
          family: "patch-validation",
          stages: [],
          inputs: {},
          goal: "Validate patch"
        };
        
        const risks = analyzeRisks(graph);
        
        expect(risks.mitigations.length).toBeGreaterThan(0);
        expect(risks.mitigations.some(m => m.includes("verification commands"))).toBe(true);
      });
      
      it("should suggest mitigations for patch file candidate", () => {
        const graph: TaskGraph = {
          family: "patch-validation",
          stages: [],
          inputs: {
            patchFilePath: "fix.patch"
          },
          goal: "Validate patch"
        };
        
        const risks = analyzeRisks(graph);
        
        expect(risks.mitigations.some(m => m.includes("Patch application"))).toBe(true);
      });
    });
  });
});
