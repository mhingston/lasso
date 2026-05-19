import { describe, expect, it } from "vitest";
import { planWorkflowRequest } from "../../src/planner/synthesize.js";

describe("planWorkflowRequest", () => {
  describe("empty brief", () => {
    it("rejects empty string", () => {
      const result = planWorkflowRequest("");
      expect(result.status).toBe("needs_clarification");
      if (result.status === "needs_clarification") {
        expect(result.reasons).toContain("Brief is empty");
        expect(result.missingFields).toContain("brief");
        expect(Array.isArray(result.guidance)).toBe(true);
        expect(result.guidance.length).toBeGreaterThan(0);
      }
    });

    it("rejects whitespace-only string", () => {
      const result = planWorkflowRequest("   \n\t  ");
      expect(result.status).toBe("needs_clarification");
      if (result.status === "needs_clarification") {
        expect(result.reasons).toContain("Brief is empty");
        expect(Array.isArray(result.guidance)).toBe(true);
      }
    });
  });

  describe("pr-review-merge happy path", () => {
    it("extracts all fields from complete brief", () => {
      const brief = `
        PR review workflow:
        repoPath: /Users/test/repo
        source branch: feature-xyz
        target branch: main
        verification commands: ["npm test", "npm run lint"]
        reviewInstructions: "Check for breaking changes"
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("draft_request");
      
      if (result.status === "draft_request") {
        expect(result.workflow).toBe("pr-review-merge");
        expect(result.request.workflow).toBe("pr-review-merge");
        expect(Array.isArray(result.rationale)).toBe(true);
        expect(result.rationale.length).toBeGreaterThan(0);
        expect(result.rationale.some(r => r.includes("pr-review-merge"))).toBe(true);
        expect(Array.isArray(result.warnings)).toBe(true);
        
        if (result.request.workflow === "pr-review-merge") {
          const input = result.request.input;
          expect(input.repoPath).toBe("/Users/test/repo");
          expect(input.sourceBranch).toBe("feature-xyz");
          expect(input.targetBranch).toBe("main");
          expect(input.verificationCommands).toEqual(["npm test", "npm run lint"]);
          expect(input.reviewInstructions).toBe("Check for breaking changes");
        }
      }
    });

    it("requires explicit reviewInstructions", () => {
      const brief = `
        Pull request review:
        repoPath: /opt/project
        source branch: dev
        target branch: staging
        verification: ["make test"]
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("needs_clarification");
      
      if (result.status === "needs_clarification") {
        expect(result.candidateWorkflow).toBe("pr-review-merge");
        expect(result.missingFields).toContain("reviewInstructions");
        expect(result.guidance.some(g => g.includes("reviewInstructions"))).toBe(true);
      }
    });
  });

  describe("pr-review-merge missing fields", () => {
    it("flags missing repoPath", () => {
      const brief = `
        PR merge:
        source branch: feature
        target branch: main
        reviewInstructions: "Review carefully"
        verification: ["test"]
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("needs_clarification");
      
      if (result.status === "needs_clarification") {
        expect(result.candidateWorkflow).toBe("pr-review-merge");
        expect(result.missingFields).toContain("repoPath");
        expect(Array.isArray(result.guidance)).toBe(true);
        expect(result.guidance.some(g => g.includes("repoPath"))).toBe(true);
      }
    });

    it("flags missing sourceBranch", () => {
      const brief = `
        PR review:
        repoPath: /repo
        target branch: main
        reviewInstructions: "Review carefully"
        verification: ["test"]
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("needs_clarification");
      
      if (result.status === "needs_clarification") {
        expect(result.candidateWorkflow).toBe("pr-review-merge");
        expect(result.missingFields).toContain("sourceBranch");
      }
    });

    it("flags missing targetBranch", () => {
      const brief = `
        PR merge:
        repoPath: /repo
        source branch: feature
        reviewInstructions: "Review carefully"
        verification: ["test"]
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("needs_clarification");
      
      if (result.status === "needs_clarification") {
        expect(result.candidateWorkflow).toBe("pr-review-merge");
        expect(result.missingFields).toContain("targetBranch");
      }
    });

    it("flags missing verificationCommands", () => {
      const brief = `
        PR review:
        repoPath: /repo
        source branch: feature
        target branch: main
        reviewInstructions: "Review carefully"
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("needs_clarification");
      
      if (result.status === "needs_clarification") {
        expect(result.candidateWorkflow).toBe("pr-review-merge");
        expect(result.missingFields).toContain("verificationCommands");
      }
    });
  });

  describe("patch-validation happy path with branch", () => {
    it("extracts all fields from complete brief", () => {
      const brief = `
        Patch validation workflow:
        repoPath: /home/user/project
        baseline: v1.2.3
        candidate branch: bugfix-123
        reproduce commands: ["npm run reproduce-bug"]
        verification commands: ["npm test", "npm run integration"]
        reviewInstructions: "Verify the bug is fixed"
        approval required
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("draft_request");
      
      if (result.status === "draft_request") {
        expect(result.workflow).toBe("patch-validation");
        expect(result.request.workflow).toBe("patch-validation");
        expect(Array.isArray(result.rationale)).toBe(true);
        expect(result.rationale.length).toBeGreaterThan(0);
        expect(result.rationale.some(r => r.includes("patch-validation"))).toBe(true);
        expect(Array.isArray(result.warnings)).toBe(true);
        
        if (result.request.workflow === "patch-validation") {
          const input = result.request.input;
          expect(input.repoPath).toBe("/home/user/project");
          expect(input.baselineRef).toBe("v1.2.3");
          expect(input.candidateSource.kind).toBe("branch");
          expect(input.candidateSource.value).toBe("bugfix-123");
          expect(input.reproduceCommands).toEqual(["npm run reproduce-bug"]);
          expect(input.verificationCommands).toEqual(["npm test", "npm run integration"]);
          expect(input.reviewInstructions).toBe("Verify the bug is fixed");
          expect(input.approvalRequired).toBe(true);
        }
      }
    });

    it("defaults approvalRequired to false when not specified", () => {
      const brief = `
        Patch validation:
        repoPath: /project
        baseline: main
        candidate branch: fix-branch
        reproduce: ["./run-bug.sh"]
        verification: ["make test"]
        reviewInstructions: "Validate the fix"
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("draft_request");
      
      if (result.status === "draft_request") {
        expect(result.workflow).toBe("patch-validation");
        expect(Array.isArray(result.rationale)).toBe(true);
        expect(result.rationale.length).toBeGreaterThan(0);
        expect(result.warnings.some(w => w.includes("approvalRequired"))).toBe(true);
        
        if (result.request.workflow === "patch-validation") {
          expect(result.request.input.approvalRequired).toBe(false);
        }
      }
    });
  });

  describe("patch-validation with patch file", () => {
    it("extracts patchFile as candidate source", () => {
      const brief = `
        Validate this patch:
        repoPath: /code/project
        baseline: v2.0.0
        candidate: /patches/fix.patch
        reproduce commands: ["npm run fail"]
        verification commands: ["npm test"]
        reviewInstructions: "Validate the patch candidate"
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("draft_request");
      
      if (result.status === "draft_request") {
        expect(result.workflow).toBe("patch-validation");
        expect(Array.isArray(result.rationale)).toBe(true);
        expect(result.rationale.length).toBeGreaterThan(0);
        
        if (result.request.workflow === "patch-validation") {
          const input = result.request.input;
          expect(input.candidateSource.kind).toBe("patchFile");
          expect(input.candidateSource.value).toBe("/patches/fix.patch");
        }
      }
    });

    it("detects .diff file extension", () => {
      const brief = `
        Patch validation:
        repo: /app
        baseline: stable
        Apply change.diff
        reproduce: ["test-bug"]
        verify: ["test-suite"]
        reviewInstructions: "Review the diff-based fix"
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("draft_request");
      
      if (result.status === "draft_request") {
        expect(result.workflow).toBe("patch-validation");
        expect(Array.isArray(result.rationale)).toBe(true);
        expect(result.rationale.length).toBeGreaterThan(0);
        
        if (result.request.workflow === "patch-validation") {
          const input = result.request.input;
          expect(input.candidateSource.kind).toBe("patchFile");
          expect(input.candidateSource.value).toBe("change.diff");
        }
      }
    });
  });

  describe("patch-validation missing fields", () => {
    it("flags missing repoPath", () => {
      const brief = `
        Validate patch:
        baseline: main
        candidate branch: fix
        reproduce: ["bug"]
        verify: ["test"]
        reviewInstructions: "Validate the fix"
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("needs_clarification");
      
      if (result.status === "needs_clarification") {
        expect(result.candidateWorkflow).toBe("patch-validation");
        expect(result.missingFields).toContain("repoPath");
      }
    });

    it("flags missing baselineRef", () => {
      const brief = `
        Patch validation:
        repoPath: /code
        candidate branch: fix
        reproduce: ["bug"]
        verify: ["test"]
        reviewInstructions: "Validate the fix"
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("needs_clarification");
      
      if (result.status === "needs_clarification") {
        expect(result.candidateWorkflow).toBe("patch-validation");
        expect(result.missingFields).toContain("baselineRef");
      }
    });

    it("flags missing candidateSource", () => {
      const brief = `
        Validate this fix:
        repoPath: /app
        baseline: v1.0
        reproduce: ["fail"]
        verify: ["pass"]
        reviewInstructions: "Validate the fix"
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("needs_clarification");
      
      if (result.status === "needs_clarification") {
        expect(result.candidateWorkflow).toBe("patch-validation");
        expect(result.missingFields).toContain("candidateSource (branch or patchFile)");
      }
    });

    it("flags missing reproduceCommands", () => {
      const brief = `
        Patch validation:
        repoPath: /code
        baseline: main
        candidate branch: fix
        verify: ["test"]
        reviewInstructions: "Validate the fix"
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("needs_clarification");
      
      if (result.status === "needs_clarification") {
        expect(result.candidateWorkflow).toBe("patch-validation");
        expect(result.missingFields).toContain("reproduceCommands");
      }
    });

    it("flags missing verificationCommands", () => {
      const brief = `
        Validate patch:
        repoPath: /code
        baseline: main
        candidate branch: fix
        reproduce: ["bug"]
        reviewInstructions: "Validate the fix"
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("needs_clarification");
      
      if (result.status === "needs_clarification") {
        expect(result.candidateWorkflow).toBe("patch-validation");
        expect(result.missingFields).toContain("verificationCommands");
      }
    });
  });

  describe("ambiguous briefs", () => {
    it("rejects brief with both PR and patch signals", () => {
      const brief = `
        Review this PR and validate the patch:
        source branch: feature
        baseline: main
        candidate: fix.patch
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("needs_clarification");
      
      if (result.status === "needs_clarification") {
        expect(result.reasons[0]).toContain("Could not determine workflow type");
        expect(result.missingFields).toContain("workflow type");
        expect(result.candidateWorkflow).toBeUndefined();
        expect(Array.isArray(result.guidance)).toBe(true);
      }
    });

    it("rejects brief with no workflow signals", () => {
      const brief = `
        repoPath: /code/app
        Do some work on the codebase
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("needs_clarification");
      
      if (result.status === "needs_clarification") {
        expect(result.reasons[0]).toContain("Could not determine workflow type");
        expect(result.candidateWorkflow).toBeUndefined();
      }
    });

    it("rejects vague request", () => {
      const brief = "Check the code";
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("needs_clarification");
      
      if (result.status === "needs_clarification") {
        expect(result.missingFields).toContain("workflow type");
      }
    });
  });

  describe("approval flag extraction", () => {
    it("detects 'approval required' phrase", () => {
      const brief = `
        Patch validation with approval required:
        repo: /app
        baseline: v1
        candidate branch: fix
        reproduce: ["bug"]
        verify: ["test"]
        reviewInstructions: "Validate the fix"
      `;
      
      const result = planWorkflowRequest(brief);
      if (result.status === "draft_request" && result.request.workflow === "patch-validation") {
        expect(result.request.input.approvalRequired).toBe(true);
      }
    });

    it("detects 'approvalRequired: true' format", () => {
      const brief = `
        Validate patch:
        repoPath: /code
        baseline: stable
        candidate branch: hotfix
        reproduce: ["fail-test"]
        verify: ["pass-test"]
        reviewInstructions: "Validate the hotfix"
        approvalRequired: true
      `;
      
      const result = planWorkflowRequest(brief);
      if (result.status === "draft_request" && result.request.workflow === "patch-validation") {
        expect(result.request.input.approvalRequired).toBe(true);
      }
    });

    it("detects 'no approval' phrase", () => {
      const brief = `
        Patch validation, no approval needed:
        repo: /app
        baseline: v2
        candidate branch: auto-fix
        reproduce: ["bug"]
        verify: ["test"]
        reviewInstructions: "Validate the automatic fix"
      `;
      
      const result = planWorkflowRequest(brief);
      if (result.status === "draft_request" && result.request.workflow === "patch-validation") {
        expect(result.request.input.approvalRequired).toBe(false);
      }
    });

    it("detects 'approvalRequired: false' format", () => {
      const brief = `
        Validate:
        repoPath: /src
        baseline: main
        candidate branch: fix
        reproduce: ["fail"]
        verify: ["pass"]
        reviewInstructions: "Validate the fix"
        approvalRequired: false
      `;
      
      const result = planWorkflowRequest(brief);
      if (result.status === "draft_request" && result.request.workflow === "patch-validation") {
        expect(result.request.input.approvalRequired).toBe(false);
      }
    });
  });

  describe("request envelope compatibility", () => {
    it("returns ReferenceWorkflowRequest shape for pr-review-merge", () => {
      const brief = `
        PR review:
        repoPath: /test
        source branch: feat
        target branch: main
        reviewInstructions: "Review the feature branch"
        verify: ["test"]
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("draft_request");
      
      if (result.status === "draft_request") {
        expect(result.workflow).toBe("pr-review-merge");
        expect(result.request).toHaveProperty("workflow");
        expect(result.request).toHaveProperty("input");
        expect(result.request.workflow).toBe("pr-review-merge");
        expect(Array.isArray(result.rationale)).toBe(true);
        expect(result.rationale.length).toBeGreaterThan(0);
        expect(Array.isArray(result.warnings)).toBe(true);
        
        if (result.request.workflow === "pr-review-merge") {
          const input = result.request.input;
          expect(input).toHaveProperty("repoPath");
          expect(input).toHaveProperty("sourceBranch");
          expect(input).toHaveProperty("targetBranch");
          expect(input).toHaveProperty("reviewInstructions");
          expect(input).toHaveProperty("verificationCommands");
          expect(Array.isArray(input.verificationCommands)).toBe(true);
        }
      }
    });

    it("returns ReferenceWorkflowRequest shape for patch-validation", () => {
      const brief = `
        Validate patch:
        repo: /app
        baseline: v1
        candidate branch: fix
        reproduce: ["bug"]
        verify: ["test"]
        reviewInstructions: "Validate the candidate"
      `;
      
      const result = planWorkflowRequest(brief);
      expect(result.status).toBe("draft_request");
      
      if (result.status === "draft_request") {
        expect(result.workflow).toBe("patch-validation");
        expect(result.request).toHaveProperty("workflow");
        expect(result.request).toHaveProperty("input");
        expect(result.request.workflow).toBe("patch-validation");
        expect(Array.isArray(result.rationale)).toBe(true);
        expect(result.rationale.length).toBeGreaterThan(0);
        expect(Array.isArray(result.warnings)).toBe(true);
        
        if (result.request.workflow === "patch-validation") {
          const input = result.request.input;
          expect(input).toHaveProperty("repoPath");
          expect(input).toHaveProperty("baselineRef");
          expect(input).toHaveProperty("candidateSource");
          expect(input.candidateSource).toHaveProperty("kind");
          expect(input.candidateSource).toHaveProperty("value");
          expect(input).toHaveProperty("reproduceCommands");
          expect(input).toHaveProperty("verificationCommands");
          expect(input).toHaveProperty("reviewInstructions");
          expect(input).toHaveProperty("approvalRequired");
          expect(Array.isArray(input.reproduceCommands)).toBe(true);
          expect(Array.isArray(input.verificationCommands)).toBe(true);
          expect(typeof input.approvalRequired).toBe("boolean");
        }
      }
    });
  });
});
