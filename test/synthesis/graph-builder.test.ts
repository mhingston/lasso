import { describe, it, expect } from "vitest";
import { buildTaskGraph } from "../../src/synthesis/graph-builder.js";
import type { IntentIR } from "../../src/synthesis/intent-ir.js";

describe("graph-builder", () => {
  describe("buildTaskGraph", () => {
    describe("patch-validation family", () => {
      it("should build graph for patch validation with branch", () => {
        const intent: IntentIR = {
          family: "patch-validation",
          goal: "Validate patch against baseline",
          inputs: {
            repoPath: "/path/to/repo",
            baselineRef: "v1.0.0",
            candidateBranch: "fix-branch",
            reproduceCommands: ["npm run fail-test"],
            verificationCommands: ["npm test"],
            reviewInstructions: "Check fix"
          },
          requiredTools: ["git"],
          humanCheckpoints: [],
          verificationTargets: ["npm test"]
        };
        
        const graph = buildTaskGraph(intent);
        
        expect(graph.family).toBe("patch-validation");
        expect(graph.stages).toHaveLength(5);
        expect(graph.stages.map(s => s.type)).toEqual([
          "setup",
          "reproduce",
          "apply",
          "verify",
          "review"
        ]);
      });
      
      it("should add approval stage when approval checkpoint is present", () => {
        const intent: IntentIR = {
          family: "patch-validation",
          goal: "Validate patch against baseline",
          inputs: {
            repoPath: "/path/to/repo",
            baselineRef: "v1.0.0",
            candidateBranch: "fix-branch",
            reproduceCommands: ["npm run fail-test"],
            verificationCommands: ["npm test"],
            reviewInstructions: "Check fix",
            approvalRequired: true
          },
          requiredTools: ["git"],
          humanCheckpoints: ["approval-gate"],
          verificationTargets: ["npm test"]
        };
        
        const graph = buildTaskGraph(intent);
        
        expect(graph.stages).toHaveLength(6);
        expect(graph.stages[5].type).toBe("approval");
        expect(graph.stages[5].id).toBe("approval-gate");
      });
      
      it("should handle patch file candidate source", () => {
        const intent: IntentIR = {
          family: "patch-validation",
          goal: "Validate patch against baseline",
          inputs: {
            repoPath: "/path/to/repo",
            baselineRef: "main",
            patchFilePath: "fix.patch",
            reproduceCommands: ["npm run fail-test"],
            verificationCommands: ["npm test"],
            reviewInstructions: "Check fix"
          },
          requiredTools: ["git"],
          humanCheckpoints: [],
          verificationTargets: ["npm test"]
        };
        
        const graph = buildTaskGraph(intent);
        
        expect(graph.family).toBe("patch-validation");
        expect(graph.inputs.patchFilePath).toBe("fix.patch");
      });
    });
    
    describe("pr-review-merge family", () => {
      it("should build graph for PR review and merge", () => {
        const intent: IntentIR = {
          family: "pr-review-merge",
          goal: "Review and merge PR",
          inputs: {
            repoPath: "/path/to/repo",
            sourceBranch: "feature",
            targetBranch: "main",
            reviewInstructions: "Check security",
            verificationCommands: ["npm test", "npm run lint"]
          },
          requiredTools: ["git"],
          humanCheckpoints: [],
          verificationTargets: ["npm test", "npm run lint"]
        };
        
        const graph = buildTaskGraph(intent);
        
        expect(graph.family).toBe("pr-review-merge");
        expect(graph.stages).toHaveLength(4);
        expect(graph.stages.map(s => s.type)).toEqual([
          "setup",
          "review",
          "verify",
          "merge"
        ]);
      });
      
      it("should maintain stage dependencies correctly", () => {
        const intent: IntentIR = {
          family: "pr-review-merge",
          goal: "Review and merge PR",
          inputs: {
            repoPath: "/path/to/repo",
            sourceBranch: "feature",
            targetBranch: "main",
            reviewInstructions: "Check code",
            verificationCommands: ["npm test"]
          },
          requiredTools: ["git"],
          humanCheckpoints: [],
          verificationTargets: ["npm test"]
        };
        
        const graph = buildTaskGraph(intent);
        
        expect(graph.stages[0].dependencies).toEqual([]);
        expect(graph.stages[1].dependencies).toEqual(["setup-pr"]);
        expect(graph.stages[2].dependencies).toEqual(["review-changes"]);
        expect(graph.stages[3].dependencies).toEqual(["verify-tests"]);
      });
    });
    
    describe("stage metadata accuracy", () => {
      it("should list actual input field names in requiredInputs, not derived fields", () => {
        const intent: IntentIR = {
          family: "patch-validation",
          goal: "Validate patch against baseline",
          inputs: {
            repoPath: "/path/to/repo",
            baselineRef: "v1.0.0",
            candidateBranch: "fix-branch",
            reproduceCommands: ["npm run fail-test"],
            verificationCommands: ["npm test"],
            reviewInstructions: "Check fix"
          },
          requiredTools: ["git"],
          humanCheckpoints: [],
          verificationTargets: ["npm test"]
        };
        
        const graph = buildTaskGraph(intent);
        
        const applyStage = graph.stages.find(s => s.id === "apply-candidate");
        expect(applyStage).toBeDefined();
        
        // Should list actual input names (candidateBranch, patchFilePath), not the derived "candidateSource"
        expect(applyStage!.requiredInputs).toEqual(["candidateBranch", "patchFilePath"]);
        expect(applyStage!.requiredInputs).not.toContain("candidateSource");
      });
    });
  });
});
