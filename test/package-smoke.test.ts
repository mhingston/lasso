import { describe, expect, it } from "vitest";
import lassoExtension, {
  validateHarnessSpec,
  lowerHarnessSpecToCir,
  compileHarnessSpec,
  planWorkflowRequest,
  replanWorkflowRequest,
  parsePromptOrSkill,
  buildTaskGraph,
  analyzeRisks,
  synthesizePolicy,
  synthesizeHarness,
} from "../src/index.js";

describe("lasso package scaffold", () => {
  it("exports the public entrypoints", () => {
    expect(typeof validateHarnessSpec).toBe("function");
    expect(typeof lowerHarnessSpecToCir).toBe("function");
    expect(typeof compileHarnessSpec).toBe("function");
    expect(typeof planWorkflowRequest).toBe("function");
    expect(typeof replanWorkflowRequest).toBe("function");
    expect(typeof parsePromptOrSkill).toBe("function");
    expect(typeof buildTaskGraph).toBe("function");
    expect(typeof analyzeRisks).toBe("function");
    expect(typeof synthesizePolicy).toBe("function");
    expect(typeof synthesizeHarness).toBe("function");
    expect(typeof lassoExtension).toBe("function");
  });
});
