import { describe, it, expect } from "vitest";
import { parseWorkflowRequest } from "../../src/reference/catalog.js";

describe("parseWorkflowRequest", () => {
  describe("existing behavior", () => {
    it("should parse a valid pr-review-merge request", () => {
      const input = JSON.stringify({
        workflow: "pr-review-merge",
        input: {
          repoPath: "/repo",
          sourceBranch: "feature",
          targetBranch: "main",
          reviewInstructions: "Check",
          verificationCommands: ["npm test"]
        }
      });

      const result = parseWorkflowRequest(input);
      expect(result.workflow).toBe("pr-review-merge");
    });

    it("should parse a valid patch-validation request", () => {
      const input = JSON.stringify({
        workflow: "patch-validation",
        input: {
          repoPath: "/repo",
          baselineRef: "main",
          candidateSource: { kind: "branch", value: "fix" },
          reproduceCommands: ["npm run fail"],
          verificationCommands: ["npm test"],
          reviewInstructions: "Check",
          approvalRequired: false
        }
      });

      const result = parseWorkflowRequest(input);
      expect(result.workflow).toBe("patch-validation");
    });
  });

  describe("custom workflow families", () => {
    it("should accept an arbitrary workflow family with a generic input shape", () => {
      const input = JSON.stringify({
        workflow: "deploy-staging",
        input: {
          repoPath: "/repo",
          environment: "staging"
        }
      });

      const result = parseWorkflowRequest(input);
      expect(result.workflow).toBe("deploy-staging");
      expect(result.input).toEqual({ repoPath: "/repo", environment: "staging" });
    });

    it("should accept a data-pipeline workflow", () => {
      const input = JSON.stringify({
        workflow: "data-pipeline",
        input: {
          source: "s3://bucket/data",
          destination: "/tmp/output"
        }
      });

      const result = parseWorkflowRequest(input);
      expect(result.workflow).toBe("data-pipeline");
      expect(result.input).toEqual({ source: "s3://bucket/data", destination: "/tmp/output" });
    });
  });
});
