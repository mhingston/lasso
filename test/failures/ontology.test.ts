import { describe, expect, it } from "vitest";
import type { FailureRecord } from "../../src/failures/types.js";
import { classifyFailureRecord, isRetryableFailure } from "../../src/failures/ontology.js";
import { mapReferenceFailure } from "../../src/failures/map-reference-failures.js";

describe("Failure ontology", () => {
  describe("FailureRecord type", () => {
    it("should represent a normalized failure with root cause", () => {
      const failure: FailureRecord = {
        domainType: "pr-review",
        rootCause: "tool_timeout",
        nodeId: "apply-patch",
        message: "Git apply timed out after 30s",
      };

      expect(failure.domainType).toBe("pr-review");
      expect(failure.rootCause).toBe("tool_timeout");
      expect(failure.nodeId).toBe("apply-patch");
      expect(failure.message).toBe("Git apply timed out after 30s");
    });

    it("should allow optional nodeId", () => {
      const failure: FailureRecord = {
        domainType: "generic",
        rootCause: "unknown",
        message: "Something went wrong",
      };

      expect(failure.nodeId).toBeUndefined();
    });

    it("should support all root cause types", () => {
      const rootCauses: FailureRecord["rootCause"][] = [
        "tool_timeout",
        "auth_required",
        "rate_limited",
        "invalid_output",
        "dependency_failure",
        "verification_failed",
        "human_block",
        "unknown",
      ];

      rootCauses.forEach(rootCause => {
        const failure: FailureRecord = {
          domainType: "test",
          rootCause,
          message: `Test ${rootCause}`,
        };
        expect(failure.rootCause).toBe(rootCause);
      });
    });
  });

  describe("classifyFailureRecord", () => {
    it("should identify retryable failures", () => {
      const toolTimeout: FailureRecord = {
        domainType: "test",
        rootCause: "tool_timeout",
        message: "Timeout",
      };

      const result = classifyFailureRecord(toolTimeout);
      expect(result.retryable).toBe(true);
      expect(result.category).toBe("transient");
    });

    it("should identify non-retryable failures", () => {
      const authRequired: FailureRecord = {
        domainType: "test",
        rootCause: "auth_required",
        message: "Authentication needed",
      };

      const result = classifyFailureRecord(authRequired);
      expect(result.retryable).toBe(false);
      expect(result.category).toBe("permanent");
    });

    it("should classify verification failures as permanent", () => {
      const verificationFailed: FailureRecord = {
        domainType: "test",
        rootCause: "verification_failed",
        message: "Verification check failed",
      };

      const result = classifyFailureRecord(verificationFailed);
      expect(result.retryable).toBe(false);
      expect(result.category).toBe("permanent");
    });

    it("should classify human blocks as permanent", () => {
      const humanBlock: FailureRecord = {
        domainType: "test",
        rootCause: "human_block",
        message: "Human intervention required",
      };

      const result = classifyFailureRecord(humanBlock);
      expect(result.retryable).toBe(false);
      expect(result.category).toBe("permanent");
    });

    it("should treat unknown as retryable", () => {
      const unknown: FailureRecord = {
        domainType: "test",
        rootCause: "unknown",
        message: "Unknown error",
      };

      const result = classifyFailureRecord(unknown);
      expect(result.retryable).toBe(true);
      expect(result.category).toBe("transient");
    });
  });

  describe("isRetryableFailure", () => {
    it("should return true for transient failures", () => {
      const failure: FailureRecord = {
        domainType: "test",
        rootCause: "rate_limited",
        message: "Rate limit hit",
      };

      expect(isRetryableFailure(failure)).toBe(true);
    });

    it("should return false for permanent failures", () => {
      const failure: FailureRecord = {
        domainType: "test",
        rootCause: "auth_required",
        message: "Auth needed",
      };

      expect(isRetryableFailure(failure)).toBe(false);
    });
  });

  describe("mapReferenceFailure", () => {
    it("should map workflow-specific failures to normalized failures", () => {
      const result = mapReferenceFailure(
        "pr-review",
        "apply-failed",
        "apply-patch",
        "Patch conflicts with target branch",
      );

      expect(result.domainType).toBe("pr-review");
      expect(result.rootCause).toBe("dependency_failure");
      expect(result.nodeId).toBe("apply-patch");
      expect(result.message).toBe("Patch conflicts with target branch");
    });

    it("should map candidate-failed to invalid_output", () => {
      const result = mapReferenceFailure(
        "pr-review",
        "candidate-failed",
        "generate-candidate",
        "LLM produced invalid patch format",
      );

      expect(result.domainType).toBe("pr-review");
      expect(result.rootCause).toBe("invalid_output");
      expect(result.nodeId).toBe("generate-candidate");
    });

    it("should map reject-human to human_block", () => {
      const result = mapReferenceFailure(
        "pr-review",
        "reject-human",
        "await-approval",
        "Human rejected the proposed changes",
      );

      expect(result.domainType).toBe("pr-review");
      expect(result.rootCause).toBe("human_block");
      expect(result.nodeId).toBe("await-approval");
    });

    it("should map unknown workflow failures to unknown root cause", () => {
      const result = mapReferenceFailure(
        "custom-workflow",
        "unknown-error-type",
        "some-node",
        "Something unexpected",
      );

      expect(result.domainType).toBe("custom-workflow");
      expect(result.rootCause).toBe("unknown");
      expect(result.nodeId).toBe("some-node");
      expect(result.message).toBe("Something unexpected");
    });
  });
});
