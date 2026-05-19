import { describe, expect, it } from "vitest";
import lassoExtension, { validateHarnessSpec, lowerHarnessSpecToCir, compileHarnessSpec, planWorkflowRequest } from "../src/index.js";

describe("lasso package scaffold", () => {
  it("exports the public entrypoints", () => {
    expect(typeof validateHarnessSpec).toBe("function");
    expect(typeof lowerHarnessSpecToCir).toBe("function");
    expect(typeof compileHarnessSpec).toBe("function");
    expect(typeof planWorkflowRequest).toBe("function");
    expect(typeof lassoExtension).toBe("function");
  });
});
