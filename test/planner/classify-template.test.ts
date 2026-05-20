import { describe, it, expect } from "vitest";
import { classifyTemplate } from "../../src/planner/template-rules.js";

describe("classifyTemplate", () => {
  describe("existing behavior", () => {
    it("should return pr-review-merge for PR-related briefs", () => {
      expect(classifyTemplate("Review the pull request")).toBe("pr-review-merge");
    });

    it("should return patch-validation for patch-related briefs", () => {
      expect(classifyTemplate("Validate the patch against baseline")).toBe("patch-validation");
    });

    it("should return ambiguous for mixed signals", () => {
      expect(classifyTemplate("Review this PR and validate the patch baseline")).toBe("ambiguous");
    });
  });

  describe("custom workflow families", () => {
    it("should return 'custom' for unrecognized briefs with a workflow hint", () => {
      expect(classifyTemplate("Deploy to staging environment")).toBe("custom");
    });

    it("should return 'custom' for completely generic briefs", () => {
      expect(classifyTemplate("Run the data pipeline on the new dataset")).toBe("custom");
    });

    it("should return 'custom' for briefs with no workflow indicators", () => {
      expect(classifyTemplate("Do some stuff with the codebase")).toBe("custom");
    });
  });
});
