import { describe, expect, it } from "vitest";
import {
  suggestRecovery,
  type RecoveryPlan,
  type FailureSignature,
  type FailureContext,
} from "../../src/failures/recovery.js";

function makeSignature(
  cls: FailureSignature["class"],
  overrides?: Partial<FailureSignature>,
): FailureSignature {
  return {
    class: cls,
    confidence: 0.9,
    evidence: ["test evidence"],
    suggestedRecovery: [],
    retryable: true,
    requiresHumanIntervention: false,
    ...overrides,
  };
}

describe("Recovery plans", () => {
  describe("suggestRecovery", () => {
    describe("auth failure recovery", () => {
      it("should generate recovery plan for auth failures", () => {
        const signature = makeSignature("auth", {
          retryable: false,
          requiresHumanIntervention: true,
        });
        const plan = suggestRecovery(signature);
        expect(plan.steps.length).toBeGreaterThan(0);
        expect(plan.requiresHumanApproval).toBe(true);
      });

      it("should include credential refresh step", () => {
        const signature = makeSignature("auth", {
          evidence: ["token expired"],
        });
        const plan = suggestRecovery(signature);
        const stepText = plan.steps.map(s => s.action).join(" ").toLowerCase();
        expect(stepText).toMatch(/refresh|renew|credential|token|auth/i);
      });

      it("should have low estimated success rate for auth failures", () => {
        const signature = makeSignature("auth", {
          requiresHumanIntervention: true,
        });
        const plan = suggestRecovery(signature);
        expect(plan.estimatedSuccessRate).toBeLessThan(1);
      });
    });

    describe("tool failure recovery", () => {
      it("should generate recovery plan for tool failures", () => {
        const signature = makeSignature("tool", {
          retryable: false,
        });
        const plan = suggestRecovery(signature);
        expect(plan.steps.length).toBeGreaterThan(0);
      });

      it("should include tool installation step for command not found", () => {
        const signature = makeSignature("tool", {
          evidence: ["command not found"],
        });
        const plan = suggestRecovery(signature);
        const stepText = plan.steps.map(s => s.action).join(" ").toLowerCase();
        expect(stepText).toMatch(/install|availability|check/i);
      });

      it("should not require human approval for tool failures", () => {
        const signature = makeSignature("tool");
        const plan = suggestRecovery(signature);
        expect(plan.requiresHumanApproval).toBe(false);
      });
    });

    describe("resource failure recovery", () => {
      it("should generate recovery plan for resource failures", () => {
        const signature = makeSignature("resource", {
          retryable: false,
        });
        const plan = suggestRecovery(signature);
        expect(plan.steps.length).toBeGreaterThan(0);
      });

      it("should include cleanup step for disk full", () => {
        const signature = makeSignature("resource", {
          evidence: ["disk full"],
        });
        const plan = suggestRecovery(signature);
        const stepText = plan.steps.map(s => s.action).join(" ").toLowerCase();
        expect(stepText).toMatch(/cleanup|free|space|disk/i);
      });

      it("should require human approval for OOM", () => {
        const signature = makeSignature("resource", {
          evidence: ["out of memory"],
        });
        const plan = suggestRecovery(signature);
        expect(plan.requiresHumanApproval).toBe(true);
      });
    });

    describe("semantic failure recovery", () => {
      it("should generate recovery plan for semantic failures", () => {
        const signature = makeSignature("semantic", {
          retryable: false,
        });
        const plan = suggestRecovery(signature);
        expect(plan.steps.length).toBeGreaterThan(0);
      });

      it("should include validation step", () => {
        const signature = makeSignature("semantic", {
          evidence: ["schema mismatch"],
        });
        const plan = suggestRecovery(signature);
        const stepText = plan.steps.map(s => s.action).join(" ").toLowerCase();
        expect(stepText).toMatch(/validat|schema|output|format/i);
      });

      it("should require human approval for semantic failures", () => {
        const signature = makeSignature("semantic");
        const plan = suggestRecovery(signature);
        expect(plan.requiresHumanApproval).toBe(true);
      });
    });

    describe("human failure recovery", () => {
      it("should generate recovery plan for human failures", () => {
        const signature = makeSignature("human", {
          requiresHumanIntervention: true,
        });
        const plan = suggestRecovery(signature);
        expect(plan.steps.length).toBeGreaterThan(0);
        expect(plan.requiresHumanApproval).toBe(true);
      });

      it("should include escalation step for rejected", () => {
        const signature = makeSignature("human", {
          evidence: ["rejected"],
        });
        const plan = suggestRecovery(signature);
        const stepText = plan.steps.map(s => s.action).join(" ").toLowerCase();
        expect(stepText).toMatch(/escalat|review|reconsider|human/i);
      });
    });

    describe("environment-drift failure recovery", () => {
      it("should generate recovery plan for environment-drift failures", () => {
        const signature = makeSignature("environment-drift", {
          retryable: false,
        });
        const plan = suggestRecovery(signature);
        expect(plan.steps.length).toBeGreaterThan(0);
      });

      it("should include environment sync step", () => {
        const signature = makeSignature("environment-drift", {
          evidence: ["version mismatch"],
        });
        const plan = suggestRecovery(signature);
        const stepText = plan.steps.map(s => s.action).join(" ").toLowerCase();
        expect(stepText).toMatch(/sync|install|update|dependenc|version/i);
      });

      it("should require human approval for environment-drift", () => {
        const signature = makeSignature("environment-drift");
        const plan = suggestRecovery(signature);
        expect(plan.requiresHumanApproval).toBe(true);
      });
    });

    describe("network failure recovery", () => {
      it("should generate recovery plan for network failures", () => {
        const signature = makeSignature("network", {
          retryable: true,
        });
        const plan = suggestRecovery(signature);
        expect(plan.steps.length).toBeGreaterThan(0);
      });

      it("should include retry with backoff step", () => {
        const signature = makeSignature("network", {
          evidence: ["timeout"],
        });
        const plan = suggestRecovery(signature);
        const stepText = plan.steps.map(s => s.action).join(" ").toLowerCase();
        expect(stepText).toMatch(/retry|backoff|wait/i);
      });

      it("should not require human approval for retryable network failures", () => {
        const signature = makeSignature("network", {
          retryable: true,
        });
        const plan = suggestRecovery(signature);
        expect(plan.requiresHumanApproval).toBe(false);
      });
    });

    describe("unknown failure recovery", () => {
      it("should generate recovery plan for unknown failures", () => {
        const signature = makeSignature("unknown");
        const plan = suggestRecovery(signature);
        expect(plan.steps.length).toBeGreaterThan(0);
      });

      it("should require human approval for unknown failures", () => {
        const signature = makeSignature("unknown");
        const plan = suggestRecovery(signature);
        expect(plan.requiresHumanApproval).toBe(true);
      });

      it("should have low estimated success rate", () => {
        const signature = makeSignature("unknown", {
          confidence: 0.1,
        });
        const plan = suggestRecovery(signature);
        expect(plan.estimatedSuccessRate).toBeLessThan(0.5);
      });
    });

    describe("with context", () => {
      it("should incorporate context into recovery steps", () => {
        const signature = makeSignature("network", {
          evidence: ["timeout"],
        });
        const ctx: FailureContext = { nodeId: "api-call" };
        const plan = suggestRecovery(signature, ctx);
        expect(plan.steps.length).toBeGreaterThan(0);
      });

      it("should adjust recovery based on attempt number", () => {
        const signature = makeSignature("network", {
          retryable: true,
        });
        const ctx: FailureContext = { attemptNumber: 5 };
        const plan = suggestRecovery(signature, ctx);
        expect(plan.steps.length).toBeGreaterThan(0);
      });
    });

    describe("recovery step structure", () => {
      it("should have description for each step", () => {
        const signature = makeSignature("tool");
        const plan = suggestRecovery(signature);
        plan.steps.forEach(step => {
          expect(step.description).toBeDefined();
          expect(typeof step.description).toBe("string");
        });
      });

      it("should have action for each step", () => {
        const signature = makeSignature("auth");
        const plan = suggestRecovery(signature);
        plan.steps.forEach(step => {
          expect(step.action).toBeDefined();
          expect(typeof step.action).toBe("string");
        });
      });
    });

    describe("estimated success rate", () => {
      it("should be between 0 and 1", () => {
        const classes: FailureSignature["class"][] = [
          "auth",
          "tool",
          "resource",
          "semantic",
          "human",
          "environment-drift",
          "network",
          "unknown",
        ];

        classes.forEach(cls => {
          const signature = makeSignature(cls);
          const plan = suggestRecovery(signature);
          expect(plan.estimatedSuccessRate).toBeGreaterThanOrEqual(0);
          expect(plan.estimatedSuccessRate).toBeLessThanOrEqual(1);
        });
      });

      it("should be higher for retryable failures", () => {
        const retryableSig = makeSignature("network", { retryable: true });
        const nonRetryableSig = makeSignature("semantic", { retryable: false });

        const retryablePlan = suggestRecovery(retryableSig);
        const nonRetryablePlan = suggestRecovery(nonRetryableSig);

        expect(retryablePlan.estimatedSuccessRate).toBeGreaterThan(
          nonRetryablePlan.estimatedSuccessRate,
        );
      });
    });
  });
});
