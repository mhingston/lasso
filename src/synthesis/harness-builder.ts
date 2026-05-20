import type { HarnessSpec } from "../spec/types.js";
import { buildPatchValidationHarnessSpec } from "../reference/patch-validation.js";
import { buildPrReviewMergeHarnessSpec } from "../reference/pr-review-merge.js";
import type { LocalPatchValidationBundle, LocalPrBundle } from "../reference/types.js";
import type { TaskGraph } from "./graph-builder.js";
import type { RiskModel } from "./risk-analyzer.js";
import type { PolicyBundle } from "./policy-builder.js";

export interface HarnessSynthesisResult {
  success: true;
  spec: HarnessSpec;
  rationale: string[];
  warnings: string[];
}

export function synthesizeHarness(
  graph: TaskGraph,
  risks: RiskModel,
  policy: PolicyBundle
): HarnessSynthesisResult {
  let spec: HarnessSpec;
  
  if (policy.workflow === "patch-validation") {
    spec = buildPatchValidationHarnessSpec(policy.bundle as LocalPatchValidationBundle);
  } else if (policy.workflow === "pr-review-merge") {
    spec = buildPrReviewMergeHarnessSpec(policy.bundle as LocalPrBundle);
  } else {
    throw new Error(`Unsupported workflow family: ${policy.workflow}`);
  }
  
  return {
    success: true,
    spec,
    rationale: policy.rationale,
    warnings: policy.warnings
  };
}
