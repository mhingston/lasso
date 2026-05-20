import type { HarnessSpec } from "../spec/types.js";
import { buildPatchValidationHarnessSpec } from "./patch-validation.js";
import { buildPrReviewMergeHarnessSpec } from "./pr-review-merge.js";
import type { LocalCandidateSource, LocalPatchValidationBundle, LocalPrBundle } from "./types.js";

export type ReferenceWorkflowRequest =
  | { workflow: "pr-review-merge"; input: LocalPrBundle }
  | { workflow: "patch-validation"; input: LocalPatchValidationBundle }
  | { workflow: string; input: Record<string, unknown> };

export function parseWorkflowRequest(args: string): ReferenceWorkflowRequest {
  const trimmed = args.trim();
  if (!trimmed) {
    throw new Error("Usage: /lasso:<compile|run> <workflow request JSON>");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Invalid workflow request JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid workflow request shape");
  }

  const record = parsed as Record<string, unknown>;

  if ("workflow" in record) {
    const workflow = record.workflow;

    if (workflow === "pr-review-merge") {
      if (!isPrBundleInput(record.input)) {
        throw new Error("Invalid pr-review-merge input");
      }
      return { workflow: "pr-review-merge", input: record.input };
    }

    if (workflow === "patch-validation") {
      if (!isPatchValidationInput(record.input)) {
        throw new Error("Invalid patch-validation input");
      }
      return { workflow: "patch-validation", input: record.input };
    }

    // Generic fallback for arbitrary workflow families
    if (typeof workflow === "string" && workflow.trim().length > 0) {
      const input = record.input;
      if (!input || typeof input !== "object") {
        throw new Error(`Invalid input for workflow: ${workflow}`);
      }
      return { workflow, input: input as Record<string, unknown> };
    }

    throw new Error(`Unknown workflow: ${String(workflow)}`);
  }

  // Legacy raw LocalPrBundle shorthand for pr-review-merge
  if (isLocalPrBundle(record)) {
    return { workflow: "pr-review-merge", input: record };
  }

  throw new Error("Invalid workflow request shape");
}

export function buildReferenceHarnessSpec(request: ReferenceWorkflowRequest): HarnessSpec {
  if (request.workflow === "pr-review-merge") {
    return buildPrReviewMergeHarnessSpec(request.input as LocalPrBundle);
  }
  if (request.workflow === "patch-validation") {
    return buildPatchValidationHarnessSpec(request.input as LocalPatchValidationBundle);
  }
  // Generic fallback for custom workflows
  const entryId = `${request.workflow}-entry`;
  return {
    name: request.workflow,
    graph: {
      entryNodeId: entryId,
      nodes: [{
        id: entryId,
        label: `Execute ${request.workflow}`,
        kind: "tool",
        tool: "echo",
        args: [`Running ${request.workflow} workflow`],
      }],
      edges: [],
    },
  };
}

function isLocalPrBundle(value: Record<string, unknown>): value is LocalPrBundle {
  return (
    typeof value.repoPath === "string"
    && typeof value.sourceBranch === "string"
    && typeof value.targetBranch === "string"
    && typeof value.reviewInstructions === "string"
    && Array.isArray(value.verificationCommands)
    && value.verificationCommands.every(c => typeof c === "string")
  );
}

function isPrBundleInput(value: unknown): value is LocalPrBundle {
  if (!value || typeof value !== "object") return false;
  return isLocalPrBundle(value as Record<string, unknown>);
}

function isPatchValidationInput(value: unknown): value is LocalPatchValidationBundle {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.repoPath === "string"
    && typeof r.baselineRef === "string"
    && isCandidateSource(r.candidateSource)
    && Array.isArray(r.reproduceCommands)
    && r.reproduceCommands.every(c => typeof c === "string")
    && Array.isArray(r.verificationCommands)
    && r.verificationCommands.every(c => typeof c === "string")
    && typeof r.reviewInstructions === "string"
    && typeof r.approvalRequired === "boolean"
  );
}

function isCandidateSource(value: unknown): value is LocalCandidateSource {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return typeof r.value === "string" && (r.kind === "branch" || r.kind === "patchFile");
}
