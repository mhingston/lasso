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
    
    describe("steps-based graph building", () => {
      it("should build graph nodes from intent.steps", () => {
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
          verificationTargets: ["npm test"],
          steps: [
            { id: "step-1", label: "Install deps", kind: "tool" },
            { id: "step-2", label: "Run build", kind: "tool" }
          ]
        };

        const graph = buildTaskGraph(intent);

        const stepNodes = graph.stages.filter(s => s.id.startsWith("step-"));
        expect(stepNodes).toHaveLength(2);
        expect(stepNodes[0].id).toBe("step-1");
        expect(stepNodes[0].description).toBe("Install deps");
        expect(stepNodes[1].id).toBe("step-2");
        expect(stepNodes[1].description).toBe("Run build");
      });

      it("should connect steps sequentially", () => {
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
          verificationTargets: ["npm test"],
          steps: [
            { id: "step-1", label: "First", kind: "tool" },
            { id: "step-2", label: "Second", kind: "tool" },
            { id: "step-3", label: "Third", kind: "tool" }
          ]
        };

        const graph = buildTaskGraph(intent);

        const step1 = graph.stages.find(s => s.id === "step-1")!;
        const step2 = graph.stages.find(s => s.id === "step-2")!;
        const step3 = graph.stages.find(s => s.id === "step-3")!;

        expect(step1.dependencies).toEqual([]);
        expect(step2.dependencies).toEqual(["step-1"]);
        expect(step3.dependencies).toEqual(["step-2"]);
      });

      it("should include workflow stages alongside step nodes", () => {
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
          verificationTargets: ["npm test"],
          steps: [
            { id: "step-1", label: "Custom step", kind: "tool" }
          ]
        };

        const graph = buildTaskGraph(intent);

        expect(graph.stages.find(s => s.id === "setup-baseline")).toBeDefined();
        expect(graph.stages.find(s => s.id === "step-1")).toBeDefined();
      });

      it("should add verification nodes from verificationTargets", () => {
        const intent: IntentIR = {
          family: "patch-validation",
          goal: "Validate patch",
          inputs: {
            repoPath: "/repo",
            baselineRef: "main",
            candidateBranch: "fix",
            reproduceCommands: ["npm run fail"],
            verificationCommands: ["npm test", "npm run lint"],
            reviewInstructions: "Check"
          },
          requiredTools: ["git"],
          humanCheckpoints: [],
          verificationTargets: ["npm test", "npm run lint"],
          steps: [
            { id: "step-1", label: "Custom step", kind: "tool" }
          ]
        };

        const graph = buildTaskGraph(intent);

        const verifyNodes = graph.stages.filter(s => s.id.startsWith("verify-target-"));
        expect(verifyNodes).toHaveLength(2);
        expect(verifyNodes[0].type).toBe("verify");
      });

      it("should connect verification nodes after the last step", () => {
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
          verificationTargets: ["npm test"],
          steps: [
            { id: "step-1", label: "First", kind: "tool" },
            { id: "step-2", label: "Second", kind: "tool" }
          ]
        };

        const graph = buildTaskGraph(intent);

        const verifyNode = graph.stages.find(s => s.id === "verify-target-0")!;
        expect(verifyNode.dependencies).toEqual(["step-2"]);
      });

      it("should handle llm and human step kinds", () => {
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
          verificationTargets: [],
          steps: [
            { id: "step-1", label: "Run tool", kind: "tool" },
            { id: "step-2", label: "Analyze", kind: "llm" },
            { id: "step-3", label: "Approve", kind: "human" }
          ]
        };

        const graph = buildTaskGraph(intent);

        expect(graph.stages.find(s => s.id === "step-1")!.type).toBe("setup");
        expect(graph.stages.find(s => s.id === "step-2")!.type).toBe("review");
        expect(graph.stages.find(s => s.id === "step-3")!.type).toBe("approval");
      });

      it("should build steps-only graph for pr-review-merge family", () => {
        const intent: IntentIR = {
          family: "pr-review-merge",
          goal: "Review PR",
          inputs: {
            repoPath: "/repo",
            sourceBranch: "feature",
            targetBranch: "main",
            reviewInstructions: "Check",
            verificationCommands: ["npm test"]
          },
          requiredTools: ["git"],
          humanCheckpoints: [],
          verificationTargets: ["npm test"],
          steps: [
            { id: "step-1", label: "Custom step", kind: "tool" }
          ]
        };

        const graph = buildTaskGraph(intent);

        expect(graph.stages.find(s => s.id === "step-1")).toBeDefined();
        expect(graph.stages.find(s => s.id === "setup-pr")).toBeDefined();
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
