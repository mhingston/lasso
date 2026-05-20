import type { HarnessSpec } from "../spec/types.js";
import { buildPatchValidationHarnessSpec } from "../reference/patch-validation.js";
import { buildPrReviewMergeHarnessSpec } from "../reference/pr-review-merge.js";
import type { LocalPatchValidationBundle, LocalPrBundle } from "../reference/types.js";
import type { TaskGraph } from "./graph-builder.js";
import type { RiskModel } from "./risk-analyzer.js";
import { synthesizePolicy } from "./policy-builder.js";

interface HarnessSynthesisResult {
  spec: HarnessSpec;
  rationale: string[];
  warnings: string[];
}

function synthesizeHarnessResult(
  graph: TaskGraph,
  risks: RiskModel
): HarnessSynthesisResult {
  // Derive policy from graph and risks
  const policyResult = synthesizePolicy(graph, risks);
  
  if (!policyResult.success) {
    throw new Error(`Policy synthesis failed: ${policyResult.reasons.join(", ")}`);
  }
  
  const policy = policyResult.policy;
  let spec: HarnessSpec;
  
  if (policy.workflow === "patch-validation") {
    spec = buildPatchValidationHarnessSpec(policy.bundle as LocalPatchValidationBundle);
  } else if (policy.workflow === "pr-review-merge") {
    spec = buildPrReviewMergeHarnessSpec(policy.bundle as LocalPrBundle);
  } else {
    throw new Error(`Unsupported workflow family: ${policy.workflow}`);
  }
  
  return {
    spec,
    rationale: policy.rationale,
    warnings: policy.warnings
  };
}

export function synthesizeHarness(graph: TaskGraph, risks: RiskModel): HarnessSpec {
  return synthesizeHarnessResult(graph, risks).spec;
}
