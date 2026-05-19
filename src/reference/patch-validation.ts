import type { HarnessSpec } from "../spec/types.js";
import {
  buildApplyCandidateTool,
  buildBaselineReproducedCondition,
  buildBaselineReproduceTool,
  buildCandidateAppliedCondition,
  buildCandidateFixedCondition,
  buildCandidateReproduceTool,
  buildHumanApprovedCondition,
  buildVerificationPassedCondition,
  buildVerificationTool,
  patchValidationNodeIds,
} from "./patch-validation-strategies.js";
import type { LocalPatchValidationBundle } from "./types.js";

export function buildPatchValidationHarnessSpec(bundle: LocalPatchValidationBundle): HarnessSpec {
  if (bundle.reproduceCommands.length === 0) {
    throw new Error("Patch validation requires at least one reproduce command");
  }

  if (bundle.verificationCommands.length === 0) {
    throw new Error("Patch validation requires at least one verification command");
  }

  const ids = patchValidationNodeIds;

  const afterVerification = bundle.approvalRequired ? ids.summarise : ids.validatedFix;

  return {
    name: "patch-validation",
    executionPolicy: {
      timeout: 300,
    },
    humanPolicy: {
      defaultTimeout: 300,
    },
    observabilityPolicy: {
      tracing: true,
      logLevel: "info",
    },
    graph: {
      entryNodeId: ids.runBaseline,
      nodes: [
        {
          id: ids.runBaseline,
          label: "Run baseline reproduction",
          kind: "tool",
          ...buildBaselineReproduceTool(bundle),
        },
        {
          id: ids.gateNotReproduced,
          kind: "condition",
          condition: buildBaselineReproducedCondition(),
          thenNodeId: ids.applyCandidate,
          elseNodeId: ids.notReproduced,
        },
        {
          id: ids.applyCandidate,
          label: "Apply candidate",
          kind: "tool",
          ...buildApplyCandidateTool(bundle),
        },
        {
          id: ids.gateApplyFailed,
          kind: "condition",
          condition: buildCandidateAppliedCondition(),
          thenNodeId: ids.runCandidateReproduce,
          elseNodeId: ids.applyFailed,
        },
        {
          id: ids.runCandidateReproduce,
          label: "Rerun reproduction on candidate",
          kind: "tool",
          ...buildCandidateReproduceTool(bundle),
        },
        {
          id: ids.gateCandidateStillFails,
          kind: "condition",
          condition: buildCandidateFixedCondition(),
          thenNodeId: ids.runVerification,
          elseNodeId: ids.candidateFailed,
        },
        {
          id: ids.runVerification,
          label: "Run verification commands",
          kind: "tool",
          ...buildVerificationTool(bundle),
        },
        {
          id: ids.gateCandidateVerification,
          kind: "condition",
          condition: buildVerificationPassedCondition(),
          thenNodeId: afterVerification,
          elseNodeId: ids.candidateFailed,
        },
        ...(bundle.approvalRequired
          ? [
              {
                id: ids.summarise,
                kind: "llm" as const,
                provider: "anthropic",
                model: "claude-sonnet",
                prompt: buildSummaryPrompt(bundle),
              },
              {
                id: ids.humanApprove,
                kind: "human" as const,
                prompt: `Review the patch-validation summary produced by the '${ids.summarise}' step (available in workflow state as '${ids.summarise}.summary') and approve or reject the candidate fix.\n\nInstructions: ${bundle.reviewInstructions}`,
                interactionType: "approval" as const,
              },
              {
                id: ids.checkHumanApproval,
                kind: "condition" as const,
                condition: buildHumanApprovedCondition(),
                thenNodeId: ids.validatedFix,
                elseNodeId: ids.rejected,
              },
            ]
          : []),
        {
          id: ids.validatedFix,
          kind: "subworkflow",
          specRef: ids.validatedFix,
        },
        {
          id: ids.notReproduced,
          kind: "subworkflow",
          specRef: ids.notReproduced,
        },
        {
          id: ids.applyFailed,
          kind: "subworkflow",
          specRef: ids.applyFailed,
        },
        {
          id: ids.candidateFailed,
          kind: "subworkflow",
          specRef: ids.candidateFailed,
        },
        ...(bundle.approvalRequired
          ? [
              {
                id: ids.rejected,
                kind: "subworkflow" as const,
                specRef: ids.rejected,
              },
            ]
          : []),
      ],
      edges: [
        { from: ids.runBaseline, to: ids.gateNotReproduced },
        { from: ids.applyCandidate, to: ids.gateApplyFailed },
        { from: ids.runCandidateReproduce, to: ids.gateCandidateStillFails },
        { from: ids.runVerification, to: ids.gateCandidateVerification },
        ...(bundle.approvalRequired
          ? [
              { from: ids.summarise, to: ids.humanApprove },
              { from: ids.humanApprove, to: ids.checkHumanApproval },
            ]
          : []),
      ],
    },
  };
}

function buildSummaryPrompt(bundle: LocalPatchValidationBundle): string {
  return [
    "Summarise the patch-validation run and return JSON with a single string field `summary`.",
    `Repository: ${bundle.repoPath}`,
    `Baseline ref: ${bundle.baselineRef}`,
    `Candidate source: ${JSON.stringify(bundle.candidateSource)}`,
    `Instructions: ${bundle.reviewInstructions}`,
  ].join("\n");
}
