import { describe, expect, it } from "vitest";
import {
  classifyAuthFailure,
  classifyToolFailure,
  classifyResourceFailure,
  classifySemanticFailure,
  classifyHumanFailure,
  classifyEnvironmentDriftFailure,
  classifyNetworkFailure,
} from "../../src/failures/classifiers.js";

describe("Failure classifiers", () => {
  describe("classifyAuthFailure", () => {
    it("should match 401 status code", () => {
      const result = classifyAuthFailure(new Error("Request failed with status code 401"));
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("HTTP 401");
    });

    it("should match 403 status code", () => {
      const result = classifyAuthFailure(new Error("Forbidden: status 403"));
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("HTTP 403");
    });

    it("should match 'unauthorized' message", () => {
      const result = classifyAuthFailure(new Error("Unauthorized access denied"));
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("unauthorized");
    });

    it("should match 'authentication required' message", () => {
      const result = classifyAuthFailure(new Error("Authentication required to proceed"));
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("authentication required");
    });

    it("should match 'token expired' message", () => {
      const result = classifyAuthFailure(new Error("Token expired, please refresh"));
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("token expired");
    });

    it("should not match unrelated errors", () => {
      const result = classifyAuthFailure(new Error("File not found"));
      expect(result.matched).toBe(false);
    });

    it("should match case-insensitive patterns", () => {
      const result = classifyAuthFailure(new Error("UNAUTHORIZED: access denied"));
      expect(result.matched).toBe(true);
    });

    it("should match string errors", () => {
      const result = classifyAuthFailure("401 Unauthorized");
      expect(result.matched).toBe(true);
    });
  });

  describe("classifyToolFailure", () => {
    it("should match 'command not found'", () => {
      const result = classifyToolFailure(new Error("bash: git: command not found"));
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("command not found");
    });

    it("should match non-zero exit code", () => {
      const result = classifyToolFailure(new Error("Process exited with code 1"));
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("exit code 1");
    });

    it("should match stderr patterns", () => {
      const result = classifyToolFailure(
        new Error("stderr: fatal: not a git repository"),
      );
      expect(result.matched).toBe(true);
    });

    it("should not match successful tool execution", () => {
      const result = classifyToolFailure(new Error("Tool completed successfully"));
      expect(result.matched).toBe(false);
    });

    it("should match 'no such file or directory' for tool paths", () => {
      const result = classifyToolFailure(
        new Error("spawn ENOENT: no such file or directory, git"),
      );
      expect(result.matched).toBe(true);
    });
  });

  describe("classifyResourceFailure", () => {
    it("should match disk full", () => {
      const result = classifyResourceFailure(new Error("No space left on device"));
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("disk full");
    });

    it("should match OOM", () => {
      const result = classifyResourceFailure(
        new Error("JavaScript heap out of memory"),
      );
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("out of memory");
    });

    it("should match rate limit exceeded", () => {
      const result = classifyResourceFailure(
        new Error("Rate limit exceeded: too many requests"),
      );
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("rate limit");
    });

    it("should match memory allocation failure", () => {
      const result = classifyResourceFailure(
        new Error("Cannot allocate memory"),
      );
      expect(result.matched).toBe(true);
    });

    it("should not match unrelated errors", () => {
      const result = classifyResourceFailure(new Error("Connection refused"));
      expect(result.matched).toBe(false);
    });
  });

  describe("classifySemanticFailure", () => {
    it("should match assertion failed", () => {
      const result = classifySemanticFailure(
        new Error("Assertion failed: expected 5, got 3"),
      );
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("assertion failed");
    });

    it("should match unexpected output", () => {
      const result = classifySemanticFailure(
        new Error("Unexpected output: received JSON instead of YAML"),
      );
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("unexpected output");
    });

    it("should match schema mismatch", () => {
      const result = classifySemanticFailure(
        new Error("Schema validation error: missing required field 'id'"),
      );
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("schema");
    });

    it("should match type mismatch", () => {
      const result = classifySemanticFailure(
        new Error("Type mismatch: expected string, got number"),
      );
      expect(result.matched).toBe(true);
    });

    it("should not match tool errors", () => {
      const result = classifySemanticFailure(new Error("command not found"));
      expect(result.matched).toBe(false);
    });
  });

  describe("classifyHumanFailure", () => {
    it("should match rejected", () => {
      const result = classifyHumanFailure(
        new Error("Human rejected the proposed changes"),
      );
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("rejected");
    });

    it("should match timeout waiting for human", () => {
      const result = classifyHumanFailure(
        new Error("Timed out waiting for human approval"),
      );
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("human timeout");
    });

    it("should match no response", () => {
      const result = classifyHumanFailure(
        new Error("No response from human operator"),
      );
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("no response");
    });

    it("should match declined", () => {
      const result = classifyHumanFailure(new Error("Request declined by user"));
      expect(result.matched).toBe(true);
    });

    it("should not match network timeout", () => {
      const result = classifyHumanFailure(
        new Error("Connection timed out after 30s"),
      );
      expect(result.matched).toBe(false);
    });
  });

  describe("classifyEnvironmentDriftFailure", () => {
    it("should match version mismatch", () => {
      const result = classifyEnvironmentDriftFailure(
        new Error("Node.js version mismatch: expected 18, got 16"),
      );
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("version mismatch");
    });

    it("should match missing dependency", () => {
      const result = classifyEnvironmentDriftFailure(
        new Error("Cannot find module 'lodash'"),
      );
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("missing dependency");
    });

    it("should match config changed", () => {
      const result = classifyEnvironmentDriftFailure(
        new Error("Configuration changed: API_URL differs from expected"),
      );
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("config changed");
    });

    it("should match incompatible version", () => {
      const result = classifyEnvironmentDriftFailure(
        new Error("Incompatible Python version: 3.9 required"),
      );
      expect(result.matched).toBe(true);
    });

    it("should not match runtime errors", () => {
      const result = classifyEnvironmentDriftFailure(
        new Error("Assertion failed"),
      );
      expect(result.matched).toBe(false);
    });
  });

  describe("classifyNetworkFailure", () => {
    it("should match timeout", () => {
      const result = classifyNetworkFailure(
        new Error("Connection timed out after 30000ms"),
      );
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("timeout");
    });

    it("should match connection refused", () => {
      const result = classifyNetworkFailure(
        new Error("connect ECONNREFUSED 127.0.0.1:8080"),
      );
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("connection refused");
    });

    it("should match DNS failure", () => {
      const result = classifyNetworkFailure(
        new Error("getaddrinfo ENOTFOUND api.example.com"),
      );
      expect(result.matched).toBe(true);
      expect(result.evidence).toContain("DNS");
    });

    it("should match network unreachable", () => {
      const result = classifyNetworkFailure(
        new Error("Network is unreachable"),
      );
      expect(result.matched).toBe(true);
    });

    it("should match socket hang up", () => {
      const result = classifyNetworkFailure(new Error("socket hang up"));
      expect(result.matched).toBe(true);
    });

    it("should not match auth errors", () => {
      const result = classifyNetworkFailure(new Error("401 Unauthorized"));
      expect(result.matched).toBe(false);
    });
  });
});
