import { describe, it, expect } from "vitest";
import { synthesizePolicy } from "../../src/synthesis/policy-builder.js";
import type { TaskGraph } from "../../src/synthesis/graph-builder.js";
import type { RiskModel } from "../../src/synthesis/risk-analyzer.js";

describe("policy-builder", () => {
  describe("synthesizePolicy", () => {
    const lowRisks: RiskModel = {
      overallRisk: "low",
      approvalRequired: false,
      candidateSourceKind: "branch",
      verificationBreadth: "moderate",
      stageRisks: new Map(),
      mitigations: []
    };

    describe("steps-based graph handling", () => {
      it("should return success for graph with steps-based nodes", () => {
        const graph: TaskGraph = {
          family: "patch-validation",
          stages: [
            {
              id: "setup-baseline",
              type: "setup",
              dependencies: [],
              description: "Check out baseline",
              requiredInputs: ["repoPath", "baselineRef"]
            },
            {
              id: "step-1",
              type: "setup",
              dependencies: [],
              description: "Custom step",
              requiredInputs: []
            }
          ],
          inputs: {
            repoPath: "/repo",
            baselineRef: "main",
            candidateBranch: "fix",
            reproduceCommands: ["npm run fail"],
            verificationCommands: ["npm test"],
            reviewInstructions: "Check"
          },
          goal: "Validate"
        };

        const result = synthesizePolicy(graph, lowRisks);

        expect(result.success).toBe(true);
      });

      it("should return generic bundle for steps-based graph", () => {
        const graph: TaskGraph = {
          family: "patch-validation",
          stages: [
            {
              id: "step-1",
              type: "setup",
              dependencies: [],
              description: "Custom step",
              requiredInputs: []
            }
          ],
          inputs: {
            repoPath: "/repo",
            baselineRef: "main",
            candidateBranch: "fix",
            reproduceCommands: ["npm run fail"],
            verificationCommands: ["npm test"],
            reviewInstructions: "Check"
          },
          goal: "Validate"
        };

        const result = synthesizePolicy(graph, lowRisks);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.policy.bundle).toBeDefined();
          expect(result.policy.rationale.length).toBeGreaterThan(0);
        }
      });

      it("should not break existing patch-validation policy", () => {
        const graph: TaskGraph = {
          family: "patch-validation",
          stages: [
            {
              id: "setup-baseline",
              type: "setup",
              dependencies: [],
              description: "Check out baseline",
              requiredInputs: ["repoPath", "baselineRef"]
            }
          ],
          inputs: {
            repoPath: "/repo",
            baselineRef: "main",
            candidateBranch: "fix",
            reproduceCommands: ["npm run fail"],
            verificationCommands: ["npm test"],
            reviewInstructions: "Check"
          },
          goal: "Validate"
        };

        const result = synthesizePolicy(graph, lowRisks);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.policy.workflow).toBe("patch-validation");
          expect(result.policy.bundle).toBeDefined();
        }
      });

      it("should not break existing pr-review-merge policy", () => {
        const graph: TaskGraph = {
          family: "pr-review-merge",
          stages: [
            {
              id: "setup-pr",
              type: "setup",
              dependencies: [],
              description: "Fetch PR",
              requiredInputs: ["repoPath", "sourceBranch", "targetBranch"]
            }
          ],
          inputs: {
            repoPath: "/repo",
            sourceBranch: "feature",
            targetBranch: "main",
            reviewInstructions: "Check",
            verificationCommands: ["npm test"]
          },
          goal: "Review"
        };

        const result = synthesizePolicy(graph, lowRisks);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.policy.workflow).toBe("pr-review-merge");
          expect(result.policy.bundle).toBeDefined();
        }
      });
    });
  });
});
