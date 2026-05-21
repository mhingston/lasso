import { describe, expect, it } from "vitest";
import {
  generateFailureModes,
  assessRisks,
  failureModeToRisk,
  probabilityToNumber,
  failureClassToImpact,
} from "../../src/failures/generator.js";
import type { FailureMode } from "../../src/failures/generator.js";
import type { FailureClass } from "../../src/failures/ontology.js";

function makeFailureMode(overrides: Partial<FailureMode> = {}): FailureMode {
  return {
    id: "test-mode-1",
    description: "Test failure mode",
    failureClass: "auth",
    probability: "medium",
    triggers: ["trigger A"],
    mitigations: ["mitigation A"],
    recoveryActions: ["recovery A"],
    ...overrides,
  };
}

describe("probabilityToNumber", () => {
  it("should map low to 0.2", () => {
    expect(probabilityToNumber("low")).toBe(0.2);
  });

  it("should map medium to 0.5", () => {
    expect(probabilityToNumber("medium")).toBe(0.5);
  });

  it("should map high to 0.8", () => {
    expect(probabilityToNumber("high")).toBe(0.8);
  });
});

describe("failureClassToImpact", () => {
  it("should map auth to 0.7", () => {
    expect(failureClassToImpact("auth")).toBe(0.7);
  });

  it("should map network to 0.6", () => {
    expect(failureClassToImpact("network")).toBe(0.6);
  });

  it("should map resource to 0.5", () => {
    expect(failureClassToImpact("resource")).toBe(0.5);
  });

  it("should map semantic to 0.4", () => {
    expect(failureClassToImpact("semantic")).toBe(0.4);
  });

  it("should map tool to 0.6", () => {
    expect(failureClassToImpact("tool")).toBe(0.6);
  });

  it("should map environment-drift to 0.3", () => {
    expect(failureClassToImpact("environment-drift")).toBe(0.3);
  });

  it("should map unknown to 0.3", () => {
    expect(failureClassToImpact("unknown")).toBe(0.3);
  });

  it("should map human to 0.5", () => {
    expect(failureClassToImpact("human")).toBe(0.5);
  });
});

describe("failureModeToRisk", () => {
  it("should convert a FailureMode to a Risk with correct probability", () => {
    const mode = makeFailureMode({ probability: "high" });
    const risk = failureModeToRisk(mode);

    expect(risk.probability).toBe(0.8);
  });

  it("should compute score as probability * impact", () => {
    const mode = makeFailureMode({ failureClass: "auth", probability: "high" });
    const risk = failureModeToRisk(mode);

    expect(risk.score).toBeCloseTo(0.8 * 0.7);
  });

  it("should map triggers to signals", () => {
    const mode = makeFailureMode({ triggers: ["trigger A", "trigger B"] });
    const risk = failureModeToRisk(mode);

    expect(risk.signals).toEqual(["trigger A", "trigger B"]);
  });

  it("should map mitigations to HarnessMutation objects", () => {
    const mode = makeFailureMode({ mitigations: ["mitigation A"] });
    const risk = failureModeToRisk(mode);

    expect(risk.mitigations).toHaveLength(1);
    expect(risk.mitigations[0].type).toBe("add-verification");
    expect(risk.mitigations[0].description).toBe("mitigation A");
  });

  it("should preserve failureClass from the FailureMode", () => {
    const mode = makeFailureMode({ failureClass: "network" });
    const risk = failureModeToRisk(mode);

    expect(risk.failureClass).toBe("network");
  });

  it("should preserve description from the FailureMode", () => {
    const mode = makeFailureMode({ description: "Something broke" });
    const risk = failureModeToRisk(mode);

    expect(risk.description).toBe("Something broke");
  });

  it("should use the FailureMode id as the Risk id", () => {
    const mode = makeFailureMode({ id: "my-mode-42" });
    const risk = failureModeToRisk(mode);

    expect(risk.id).toBe("my-mode-42");
  });
});

describe("assessRisks", () => {
  it("should return empty risks and 0 overallScore for empty input", () => {
    const assessment = assessRisks([]);

    expect(assessment.risks).toEqual([]);
    expect(assessment.overallScore).toBe(0);
    expect(assessment.risksAboveThreshold).toEqual([]);
  });

  it("should compute overallScore as average of risk scores", () => {
    const risks = [
      failureModeToRisk(makeFailureMode({ id: "a", failureClass: "auth", probability: "high" })),
      failureModeToRisk(makeFailureMode({ id: "b", failureClass: "tool", probability: "low" })),
    ];

    const assessment = assessRisks(risks);

    expect(assessment.overallScore).toBeCloseTo((0.8 * 0.7 + 0.2 * 0.6) / 2);
  });

  it("should filter risksAboveThreshold using default threshold 0.7", () => {
    const risks = [
      failureModeToRisk(makeFailureMode({ id: "high-one", failureClass: "auth", probability: "high" })),
      failureModeToRisk(makeFailureMode({ id: "low-one", failureClass: "unknown", probability: "low" })),
    ];

    const assessment = assessRisks(risks);

    // auth+high score = 0.8 * 0.7 = 0.56, below 0.7 default threshold
    expect(assessment.risksAboveThreshold).toHaveLength(0);
  });

  it("should include risks above a custom threshold", () => {
    const risks = [
      failureModeToRisk(makeFailureMode({ id: "high-one", failureClass: "auth", probability: "high" })),
      failureModeToRisk(makeFailureMode({ id: "low-one", failureClass: "unknown", probability: "low" })),
    ];

    const assessment = assessRisks(risks, { highRiskThreshold: 0.5 });

    // auth+high = 0.56 > 0.5, unknown+low = 0.06 < 0.5
    expect(assessment.risksAboveThreshold).toHaveLength(1);
    expect(assessment.risksAboveThreshold[0].id).toBe("high-one");
  });

  it("should respect custom highRiskThreshold", () => {
    const risks = [
      failureModeToRisk(makeFailureMode({ id: "a", failureClass: "auth", probability: "medium" })),
      failureModeToRisk(makeFailureMode({ id: "b", failureClass: "tool", probability: "high" })),
    ];

    const assessment = assessRisks(risks, { highRiskThreshold: 0.4 });

    expect(assessment.risksAboveThreshold.length).toBeGreaterThanOrEqual(1);
  });

  it("should include all risks in the output", () => {
    const risks = [
      failureModeToRisk(makeFailureMode({ id: "a" })),
      failureModeToRisk(makeFailureMode({ id: "b" })),
      failureModeToRisk(makeFailureMode({ id: "c" })),
    ];

    const assessment = assessRisks(risks);

    expect(assessment.risks).toHaveLength(3);
  });

  it("should use default highRiskThreshold of 0.7", () => {
    const assessment = assessRisks([]);

    expect(assessment.highRiskThreshold).toBe(0.7);
  });
});

describe("generateFailureModes — risks integration", () => {
  it("should include risks array in the result", () => {
    const result = generateFailureModes("deploy application");

    expect(result.risks).toBeDefined();
    expect(Array.isArray(result.risks)).toBe(true);
    expect(result.risks.length).toBeGreaterThan(0);
  });

  it("should produce one risk per failure mode", () => {
    const result = generateFailureModes("deploy application");

    expect(result.risks.length).toBe(result.failureModes.length);
  });

  it("should produce risks with numeric probability values", () => {
    const result = generateFailureModes("deploy application");

    for (const risk of result.risks) {
      expect(typeof risk.probability).toBe("number");
      expect(risk.probability).toBeGreaterThanOrEqual(0);
      expect(risk.probability).toBeLessThanOrEqual(1);
    }
  });

  it("should produce risks with numeric impact values", () => {
    const result = generateFailureModes("deploy application");

    for (const risk of result.risks) {
      expect(typeof risk.impact).toBe("number");
      expect(risk.impact).toBeGreaterThanOrEqual(0);
      expect(risk.impact).toBeLessThanOrEqual(1);
    }
  });

  it("should produce risks with score = probability * impact", () => {
    const result = generateFailureModes("deploy application");

    for (const risk of result.risks) {
      expect(risk.score).toBeCloseTo(risk.probability * risk.impact);
    }
  });

  it("should produce risks with HarnessMutation mitigations", () => {
    const result = generateFailureModes("deploy application");

    for (const risk of result.risks) {
      expect(Array.isArray(risk.mitigations)).toBe(true);
      for (const m of risk.mitigations) {
        expect(m.type).toBeDefined();
        expect(typeof m.type).toBe("string");
      }
    }
  });

  it("should produce risks with signals from triggers", () => {
    const result = generateFailureModes("deploy application");

    for (const risk of result.risks) {
      expect(Array.isArray(risk.signals)).toBe(true);
      expect(risk.signals.length).toBeGreaterThan(0);
    }
  });

  it("should produce risks matching failure classes", () => {
    const result = generateFailureModes("deploy application");

    for (const risk of result.risks) {
      expect(typeof risk.failureClass).toBe("string");
    }
  });

  it("should remain backwards-compatible — failureModes still has original shape", () => {
    const result = generateFailureModes("deploy application");

    for (const mode of result.failureModes) {
      expect(typeof mode.id).toBe("string");
      expect(typeof mode.description).toBe("string");
      expect(["low", "medium", "high"]).toContain(mode.probability);
      expect(Array.isArray(mode.triggers)).toBe(true);
      expect(Array.isArray(mode.mitigations)).toBe(true);
      expect(Array.isArray(mode.recoveryActions)).toBe(true);
    }
  });
});
