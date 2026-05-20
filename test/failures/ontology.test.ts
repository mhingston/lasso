import { describe, expect, it } from "vitest";
import type { FailureRecord } from "../../src/failures/types.js";
import {
  classifyFailureRecord,
  isRetryableFailure,
  classifyFailure,
  type FailureSignature,
  type FailureClass,
  type FailureContext,
} from "../../src/failures/ontology.js";
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

  describe("classifyFailure (new ontology)", () => {
    describe("auth failures", () => {
      it("should classify 401 errors as auth", () => {
        const result = classifyFailure(
          new Error("Request failed with status code 401"),
        );
        expect(result.class).toBe("auth");
        expect(result.confidence).toBeGreaterThan(0.5);
        expect(result.retryable).toBe(false);
        expect(result.requiresHumanIntervention).toBe(true);
      });

      it("should classify unauthorized messages as auth", () => {
        const result = classifyFailure(
          new Error("Unauthorized: invalid credentials"),
        );
        expect(result.class).toBe("auth");
        expect(result.evidence.length).toBeGreaterThan(0);
      });

      it("should classify token expired as auth", () => {
        const result = classifyFailure(
          new Error("Token expired, please refresh"),
        );
        expect(result.class).toBe("auth");
      });
    });

    describe("tool failures", () => {
      it("should classify command not found as tool", () => {
        const result = classifyFailure(
          new Error("bash: git: command not found"),
        );
        expect(result.class).toBe("tool");
        expect(result.retryable).toBe(false);
      });

      it("should classify non-zero exit codes as tool", () => {
        const result = classifyFailure(
          new Error("Process exited with code 1"),
        );
        expect(result.class).toBe("tool");
      });
    });

    describe("resource failures", () => {
      it("should classify disk full as resource", () => {
        const result = classifyFailure(
          new Error("No space left on device"),
        );
        expect(result.class).toBe("resource");
        expect(result.retryable).toBe(true);
      });

      it("should classify OOM as resource", () => {
        const result = classifyFailure(
          new Error("JavaScript heap out of memory"),
        );
        expect(result.class).toBe("resource");
      });

      it("should classify rate limit as resource", () => {
        const result = classifyFailure(
          new Error("Rate limit exceeded: too many requests"),
        );
        expect(result.class).toBe("resource");
        expect(result.retryable).toBe(true);
      });
    });

    describe("semantic failures", () => {
      it("should classify assertion failures as semantic", () => {
        const result = classifyFailure(
          new Error("Assertion failed: expected 5, got 3"),
        );
        expect(result.class).toBe("semantic");
        expect(result.retryable).toBe(false);
      });

      it("should classify schema mismatches as semantic", () => {
        const result = classifyFailure(
          new Error("Schema validation error: missing field 'id'"),
        );
        expect(result.class).toBe("semantic");
      });
    });

    describe("human failures", () => {
      it("should classify rejected as human", () => {
        const result = classifyFailure(
          new Error("Human rejected the proposed changes"),
        );
        expect(result.class).toBe("human");
        expect(result.requiresHumanIntervention).toBe(true);
      });

      it("should classify human timeout as human", () => {
        const result = classifyFailure(
          new Error("Timed out waiting for human approval"),
        );
        expect(result.class).toBe("human");
      });
    });

    describe("environment-drift failures", () => {
      it("should classify version mismatch as environment-drift", () => {
        const result = classifyFailure(
          new Error("Node.js version mismatch: expected 18, got 16"),
        );
        expect(result.class).toBe("environment-drift");
        expect(result.retryable).toBe(false);
      });

      it("should classify missing dependency as environment-drift", () => {
        const result = classifyFailure(
          new Error("Cannot find module 'lodash'"),
        );
        expect(result.class).toBe("environment-drift");
      });
    });

    describe("network failures", () => {
      it("should classify connection timeout as network", () => {
        const result = classifyFailure(
          new Error("Connection timed out after 30000ms"),
        );
        expect(result.class).toBe("network");
        expect(result.retryable).toBe(true);
      });

      it("should classify connection refused as network", () => {
        const result = classifyFailure(
          new Error("connect ECONNREFUSED 127.0.0.1:8080"),
        );
        expect(result.class).toBe("network");
      });

      it("should classify DNS failure as network", () => {
        const result = classifyFailure(
          new Error("getaddrinfo ENOTFOUND api.example.com"),
        );
        expect(result.class).toBe("network");
      });
    });

    describe("unknown failures", () => {
      it("should classify unrecognizable errors as unknown", () => {
        const result = classifyFailure(
          new Error("Something completely unexpected happened"),
        );
        expect(result.class).toBe("unknown");
        expect(result.confidence).toBeLessThan(0.5);
      });

      it("should handle non-Error objects", () => {
        const result = classifyFailure("string error");
        expect(result.class).toBe("unknown");
      });

      it("should handle null errors", () => {
        const result = classifyFailure(null);
        expect(result.class).toBe("unknown");
      });
    });

    describe("confidence scores", () => {
      it("should have high confidence for exact pattern matches", () => {
        const result = classifyFailure(
          new Error("401 Unauthorized"),
        );
        expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      });

      it("should have lower confidence for partial matches", () => {
        const result = classifyFailure(
          new Error("maybe unauthorized? not sure"),
        );
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
      });
    });

    describe("evidence extraction", () => {
      it("should extract evidence from error message", () => {
        const result = classifyFailure(
          new Error("401 Unauthorized: token expired"),
        );
        expect(result.evidence.length).toBeGreaterThan(0);
      });

      it("should include multiple evidence items for multi-pattern matches", () => {
        const result = classifyFailure(
          new Error("401 Unauthorized: authentication required, token expired"),
        );
        expect(result.evidence.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe("suggested recovery", () => {
      it("should suggest recovery steps for auth failures", () => {
        const result = classifyFailure(
          new Error("401 Unauthorized"),
        );
        expect(result.suggestedRecovery.length).toBeGreaterThan(0);
      });

      it("should suggest recovery steps for network failures", () => {
        const result = classifyFailure(
          new Error("Connection timed out"),
        );
        expect(result.suggestedRecovery.length).toBeGreaterThan(0);
      });
    });

    describe("with context", () => {
      it("should use context nodeId in evidence", () => {
        const ctx: FailureContext = { nodeId: "fetch-data" };
        const result = classifyFailure(
          new Error("Connection refused"),
          ctx,
        );
        expect(result.evidence.some(e => e.includes("fetch-data"))).toBe(true);
      });

      it("should classify with additional context information", () => {
        const ctx: FailureContext = {
          nodeId: "auth-check",
          attemptNumber: 3,
        };
        const result = classifyFailure(
          new Error("401 Unauthorized"),
          ctx,
        );
        expect(result.class).toBe("auth");
      });
    });
  });
});
