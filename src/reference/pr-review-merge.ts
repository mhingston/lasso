import type { HarnessSpec } from "../spec/types.js";
import {
  buildHumanApprovedCondition,
  buildLoadDiffTool,
  buildMergeSucceededCondition,
  buildMergeTool,
  buildPostMergeCheckTool,
  buildReviewPrompt,
  buildVerificationPassedCondition,
  buildVerificationTool,
  buildVerifyPostMergeTool,
  prReviewMergeNodeIds,
} from "./strategies.js";
import type { LocalPrBundle } from "./types.js";

export function buildPrReviewMergeHarnessSpec(input: LocalPrBundle): HarnessSpec {
  return {
    name: "pr-review-merge",
    executionPolicy: {
      timeout: 180,
    },
    humanPolicy: {
      defaultTimeout: 300,
    },
    observabilityPolicy: {
      tracing: true,
      logLevel: "info",
    },
    graph: {
      entryNodeId: prReviewMergeNodeIds.loadPr,
      nodes: [
        {
          id: prReviewMergeNodeIds.loadPr,
          label: "Load PR context",
          kind: "tool",
          ...buildLoadDiffTool(input),
        },
        {
          id: prReviewMergeNodeIds.reviewPr,
          kind: "llm",
          provider: "anthropic",
          model: "claude-sonnet",
          prompt: buildReviewPrompt(input),
        },
        {
          id: prReviewMergeNodeIds.runVerification,
          kind: "tool",
          ...buildVerificationTool(input),
        },
        {
          id: prReviewMergeNodeIds.mergeResults,
          kind: "merge",
          waitFor: [prReviewMergeNodeIds.reviewPr, prReviewMergeNodeIds.runVerification],
        },
        {
          id: prReviewMergeNodeIds.gateMerge,
          kind: "condition",
          condition: buildVerificationPassedCondition(),
          thenNodeId: prReviewMergeNodeIds.humanApprove,
          elseNodeId: prReviewMergeNodeIds.rejectVerification,
        },
        {
          id: prReviewMergeNodeIds.humanApprove,
          kind: "human",
          prompt: `Approve merge of ${input.sourceBranch} into ${input.targetBranch}?`,
          interactionType: "approval",
        },
        {
          id: prReviewMergeNodeIds.checkHumanApproval,
          kind: "condition",
          condition: buildHumanApprovedCondition(),
          thenNodeId: prReviewMergeNodeIds.mergeBranch,
          elseNodeId: prReviewMergeNodeIds.rejectHuman,
        },
        {
          id: prReviewMergeNodeIds.mergeBranch,
          kind: "tool",
          ...buildMergeTool(input),
        },
        {
          id: prReviewMergeNodeIds.checkMergeResult,
          kind: "condition",
          condition: buildMergeSucceededCondition(),
          thenNodeId: prReviewMergeNodeIds.postMergeCheck,
          elseNodeId: prReviewMergeNodeIds.mergeConflict,
        },
        {
          id: prReviewMergeNodeIds.postMergeCheck,
          kind: "tool",
          ...buildPostMergeCheckTool(input),
          retryPolicy: {
            maxAttempts: 2,
            backoff: "constant",
            initialDelay: 0,
            retryOn: ["transient"],
          },
          executionPolicy: {
            failureClassification: [
              {
                pattern: "retryable post-merge failure",
                category: "transient",
                retry: true,
              },
            ],
          },
          verificationPolicy: {
            rules: [
              {
                checkNodeId: prReviewMergeNodeIds.verifyPostMerge,
                onFail: "block",
              },
            ],
          },
        },
        {
          id: prReviewMergeNodeIds.verifyPostMerge,
          kind: "tool",
          ...buildVerifyPostMergeTool(input),
        },
        {
          id: prReviewMergeNodeIds.completeSuccess,
          kind: "subworkflow",
          specRef: prReviewMergeNodeIds.completeSuccess,
        },
        {
          id: prReviewMergeNodeIds.rejectVerification,
          kind: "subworkflow",
          specRef: prReviewMergeNodeIds.rejectVerification,
        },
        {
          id: prReviewMergeNodeIds.rejectHuman,
          kind: "subworkflow",
          specRef: prReviewMergeNodeIds.rejectHuman,
        },
        {
          id: prReviewMergeNodeIds.mergeConflict,
          kind: "subworkflow",
          specRef: prReviewMergeNodeIds.mergeConflict,
        },
      ],
      edges: [
        { from: prReviewMergeNodeIds.loadPr, to: prReviewMergeNodeIds.reviewPr },
        { from: prReviewMergeNodeIds.loadPr, to: prReviewMergeNodeIds.runVerification },
        { from: prReviewMergeNodeIds.reviewPr, to: prReviewMergeNodeIds.mergeResults },
        { from: prReviewMergeNodeIds.runVerification, to: prReviewMergeNodeIds.mergeResults },
        { from: prReviewMergeNodeIds.mergeResults, to: prReviewMergeNodeIds.gateMerge },
        { from: prReviewMergeNodeIds.humanApprove, to: prReviewMergeNodeIds.checkHumanApproval },
        { from: prReviewMergeNodeIds.mergeBranch, to: prReviewMergeNodeIds.checkMergeResult },
        { from: prReviewMergeNodeIds.postMergeCheck, to: prReviewMergeNodeIds.verifyPostMerge },
        { from: prReviewMergeNodeIds.verifyPostMerge, to: prReviewMergeNodeIds.completeSuccess },
      ],
    },
  };
}
