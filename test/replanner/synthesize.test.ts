import { describe, expect, it } from "vitest";
import { parseReplanRequest, replanWorkflowRequest } from "../../src/replanner/synthesize.js";

const patchRequest = {
  workflow: "patch-validation" as const,
  input: {
    repoPath: "/tmp/repo",
    baselineRef: "main",
    candidateSource: { kind: "branch" as const, value: "fix/bug-123" },
    reproduceCommands: ["npm test -- broken.spec.ts"],
    verificationCommands: ["npm test"],
    reviewInstructions: "Approve if the fix is safe.",
    approvalRequired: false,
  },
};

const patchFileRequest = {
  workflow: "patch-validation" as const,
  input: {
    ...patchRequest.input,
    candidateSource: { kind: "patchFile" as const, value: "/tmp/fix.patch" },
  },
};

const prRequest = {
  workflow: "pr-review-merge" as const,
  input: {
    repoPath: "/tmp/repo",
    sourceBranch: "feature/pr-change",
    targetBranch: "main",
    reviewInstructions: "Review carefully.",
    verificationCommands: ["npm test"],
  },
};

describe("parseReplanRequest", () => {
  it("rejects malformed JSON", () => {
    expect(() => parseReplanRequest("{not-json")).toThrow("Invalid replan request JSON");
  });

  it("rejects workflow mismatches", () => {
    expect(() =>
      parseReplanRequest(
        JSON.stringify({
          workflow: "patch-validation",
          originalRequest: prRequest,
          observedOutcome: {
            terminalNodeId: "reject-verification",
          },
        }),
      ),
    ).toThrow("Replan workflow does not match original request workflow");
  });

  it("rejects contradictory terminal and aborted state", () => {
    expect(() =>
      parseReplanRequest(
        JSON.stringify({
          workflow: "patch-validation",
          originalRequest: patchRequest,
          observedOutcome: {
            terminalNodeId: "candidate-failed",
            aborted: true,
            abortReason: "unknown",
          },
        }),
      ),
    ).toThrow("observedOutcome cannot include both terminalNodeId and aborted: true");
  });

  it("requires abortReason when aborted is true", () => {
    expect(() =>
      parseReplanRequest(
        JSON.stringify({
          workflow: "pr-review-merge",
          originalRequest: prRequest,
          observedOutcome: {
            aborted: true,
          },
        }),
      ),
    ).toThrow("observedOutcome.abortReason must be one of");
  });
});

describe("replanWorkflowRequest", () => {
  it("escalates successful high-risk patch validation to approvalRequired", () => {
    const result = replanWorkflowRequest({
      workflow: "patch-validation",
      originalRequest: patchFileRequest,
      observedOutcome: {
        terminalNodeId: "validated-fix",
      },
    });

    expect(result.status).toBe("draft_request");
    if (result.status === "draft_request") {
      expect(result.workflow).toBe("patch-validation");
      expect(result.trigger).toBe("risk-escalation");
      expect(result.riskLevel).toBe("high");
      expect(result.changes).toContain("approvalRequired: false -> true");
      expect(result.request.workflow).toBe("patch-validation");
      if (result.request.workflow === "patch-validation") {
        expect(result.request.input.approvalRequired).toBe(true);
      }
    }
  });

  it("stops after a low-risk successful patch validation", () => {
    const result = replanWorkflowRequest({
      workflow: "patch-validation",
      originalRequest: patchRequest,
      observedOutcome: {
        terminalNodeId: "validated-fix",
      },
    });

    expect(result.status).toBe("stop");
    if (result.status === "stop") {
      expect(result.workflow).toBe("patch-validation");
      expect(result.reasons.some(reason => reason.includes("already succeeded"))).toBe(true);
    }
  });

  it("stops after human rejection in patch validation", () => {
    const result = replanWorkflowRequest({
      workflow: "patch-validation",
      originalRequest: patchRequest,
      observedOutcome: {
        terminalNodeId: "rejected",
      },
    });

    expect(result.status).toBe("stop");
    if (result.status === "stop") {
      expect(result.riskLevel).toBe("high");
      expect(result.reasons.some(reason => reason.includes("rejected"))).toBe(true);
    }
  });

  it("requests stronger baseline evidence when patch validation does not reproduce", () => {
    const result = replanWorkflowRequest({
      workflow: "patch-validation",
      originalRequest: patchRequest,
      observedOutcome: {
        terminalNodeId: "not-reproduced",
      },
    });

    expect(result.status).toBe("needs_operator_input");
    if (result.status === "needs_operator_input") {
      expect(result.candidateWorkflow).toBe("patch-validation");
      expect(result.missingFields).toContain("baselineRef");
      expect(result.missingFields).toContain("reproduceCommands");
    }
  });

  it("asks for a corrected candidate source when patch application fails", () => {
    const result = replanWorkflowRequest({
      workflow: "patch-validation",
      originalRequest: patchRequest,
      observedOutcome: {
        terminalNodeId: "apply-failed",
      },
    });

    expect(result.status).toBe("needs_operator_input");
    if (result.status === "needs_operator_input") {
      expect(result.missingFields).toEqual(["candidateSource"]);
    }
  });

  it("asks for operator notes when candidate failure lacks enough detail", () => {
    const result = replanWorkflowRequest({
      workflow: "patch-validation",
      originalRequest: patchRequest,
      observedOutcome: {
        terminalNodeId: "candidate-failed",
      },
    });

    expect(result.status).toBe("needs_operator_input");
    if (result.status === "needs_operator_input") {
      expect(result.missingFields).toContain("candidateSource");
      expect(result.missingFields).toContain("observedOutcome.notes");
    }
  });

  it("routes aborted patch validation setup failures to operator input", () => {
    const result = replanWorkflowRequest({
      workflow: "patch-validation",
      originalRequest: patchRequest,
      observedOutcome: {
        aborted: true,
        abortReason: "setup-failure",
      },
    });

    expect(result.status).toBe("needs_operator_input");
    if (result.status === "needs_operator_input") {
      expect(result.missingFields).toContain("repoPath");
      expect(result.missingFields).toContain("baselineRef");
      expect(result.missingFields).toContain("candidateSource");
    }
  });

  it("stops after manual aborts in patch validation", () => {
    const result = replanWorkflowRequest({
      workflow: "patch-validation",
      originalRequest: patchRequest,
      observedOutcome: {
        aborted: true,
        abortReason: "manual-stop",
      },
    });

    expect(result.status).toBe("stop");
    if (result.status === "stop") {
      expect(result.workflow).toBe("patch-validation");
    }
  });

  it("requests branch and verification updates for PR verification rejection", () => {
    const result = replanWorkflowRequest({
      workflow: "pr-review-merge",
      originalRequest: prRequest,
      observedOutcome: {
        terminalNodeId: "reject-verification",
      },
    });

    expect(result.status).toBe("needs_operator_input");
    if (result.status === "needs_operator_input") {
      expect(result.candidateWorkflow).toBe("pr-review-merge");
      expect(result.missingFields).toContain("sourceBranch");
      expect(result.missingFields).toContain("verificationCommands");
    }
  });

  it("requests a refreshed source branch for merge conflicts", () => {
    const result = replanWorkflowRequest({
      workflow: "pr-review-merge",
      originalRequest: prRequest,
      observedOutcome: {
        terminalNodeId: "merge-conflict",
      },
    });

    expect(result.status).toBe("needs_operator_input");
    if (result.status === "needs_operator_input") {
      expect(result.missingFields).toEqual(["sourceBranch"]);
    }
  });

  it("stops after human rejection in PR review + merge", () => {
    const result = replanWorkflowRequest({
      workflow: "pr-review-merge",
      originalRequest: prRequest,
      observedOutcome: {
        terminalNodeId: "reject-human",
      },
    });

    expect(result.status).toBe("stop");
    if (result.status === "stop") {
      expect(result.workflow).toBe("pr-review-merge");
      expect(result.riskLevel).toBe("high");
    }
  });

  it("requests investigation details after PR retry exhaustion", () => {
    const result = replanWorkflowRequest({
      workflow: "pr-review-merge",
      originalRequest: prRequest,
      observedOutcome: {
        aborted: true,
        abortReason: "retry-exhaustion",
      },
    });

    expect(result.status).toBe("needs_operator_input");
    if (result.status === "needs_operator_input") {
      expect(result.missingFields).toContain("verificationCommands");
      expect(result.missingFields).toContain("observedOutcome.notes");
    }
  });

  it("stops after a successful PR review + merge run", () => {
    const result = replanWorkflowRequest({
      workflow: "pr-review-merge",
      originalRequest: prRequest,
      observedOutcome: {
        terminalNodeId: "complete-success",
      },
    });

    expect(result.status).toBe("stop");
    if (result.status === "stop") {
      expect(result.workflow).toBe("pr-review-merge");
      expect(result.reasons.some(reason => reason.includes("already succeeded"))).toBe(true);
    }
  });
});
