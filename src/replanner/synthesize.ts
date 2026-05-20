import { parseWorkflowRequest, type ReferenceWorkflowRequest } from "../reference/catalog.js";
import type { LocalPatchValidationBundle, LocalPrBundle } from "../reference/types.js";
import {
  classifyPatchValidationRisk,
  classifyPrReviewMergeRisk,
  describeAbortReason,
  normalizeNotes,
  notesContainAny,
} from "./risk-rules.js";
import type {
  PatchValidationObservedOutcome,
  PatchValidationTerminalNodeId,
  PrReviewMergeObservedOutcome,
  PrReviewMergeTerminalNodeId,
  ReplanAbortReason,
  ReplanRequest,
  ReplanResult,
  ReplanWorkflow,
  RiskLevel,
} from "./types.js";

const PATCH_VALIDATION_TERMINALS: PatchValidationTerminalNodeId[] = [
  "validated-fix",
  "not-reproduced",
  "apply-failed",
  "candidate-failed",
  "rejected",
];

const PR_REVIEW_TERMINALS: PrReviewMergeTerminalNodeId[] = [
  "complete-success",
  "reject-verification",
  "reject-human",
  "merge-conflict",
];

export function parseReplanRequest(args: string): ReplanRequest {
  const trimmed = args.trim();
  if (!trimmed) {
    throw new Error("Usage: /lasso:replan <replan request JSON>");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Invalid replan request JSON");
  }

  if (!isRecord(parsed)) {
    throw new Error("Invalid replan request shape");
  }

  const workflow = parseWorkflow(parsed.workflow);
  const originalRequest = parseOriginalRequest(workflow, parsed.originalRequest);
  const observedOutcome = parseObservedOutcome(workflow, parsed.observedOutcome);

  return {
    workflow,
    originalRequest,
    observedOutcome,
  } as ReplanRequest;
}

export function replanWorkflowRequest(request: ReplanRequest): ReplanResult {
  validateParsedRequest(request);

  if (request.workflow === "patch-validation") {
    return replanPatchValidation(request.originalRequest, request.observedOutcome);
  }

  return replanPrReviewMerge(request.originalRequest, request.observedOutcome);
}

function replanPatchValidation(
  originalRequest: { workflow: "patch-validation"; input: LocalPatchValidationBundle },
  observedOutcome: PatchValidationObservedOutcome,
): ReplanResult {
  const risk = classifyPatchValidationRisk(originalRequest.input, observedOutcome);
  const notes = normalizeNotes(observedOutcome.notes);

  if (observedOutcome.terminalNodeId === "rejected") {
    return {
      status: "stop",
      workflow: "patch-validation",
      riskLevel: "high",
      reasons: [
        ...risk.reasons,
        "Do not auto-replan a patch-validation request after explicit human rejection.",
      ],
      guidance: [
        "Review the candidate fix manually before deciding whether to produce a new request.",
        "If you retry, update the candidate itself or the review instructions intentionally rather than relying on automatic replanning.",
      ],
    };
  }

  if (observedOutcome.aborted) {
    return replanAbortedPatchValidation(originalRequest.input, observedOutcome, risk.riskLevel);
  }

  if (observedOutcome.terminalNodeId === "validated-fix") {
    if (!originalRequest.input.approvalRequired && risk.riskLevel === "high") {
      const request: ReferenceWorkflowRequest = {
        workflow: "patch-validation",
        input: {
          ...originalRequest.input,
          approvalRequired: true,
        },
      };

      return {
        status: "draft_request",
        workflow: "patch-validation",
        request,
        trigger: "risk-escalation",
        riskLevel: risk.riskLevel,
        rationale: [
          ...risk.reasons,
          "The previous attempt already validated the candidate, so the safest deterministic v1 replan is to rerun with a human approval gate.",
        ],
        warnings: risk.warnings,
        changes: ["approvalRequired: false -> true"],
      };
    }

    return {
      status: "stop",
      workflow: "patch-validation",
      riskLevel: ensureStopRiskLevel(risk.riskLevel),
      reasons: [
        ...risk.reasons,
        "The previous patch-validation attempt already succeeded and there is no further safe automatic mutation to make.",
      ],
      guidance: [
        "Reuse the existing request if you intentionally want to rerun it.",
        "If you need different behavior, edit the request explicitly before compiling or running again.",
      ],
    };
  }

  if (observedOutcome.terminalNodeId === "not-reproduced") {
    return {
      status: "needs_operator_input",
      candidateWorkflow: "patch-validation",
      riskLevel: ensureInteractiveRiskLevel(risk.riskLevel, "medium"),
      reasons: [
        ...risk.reasons,
        "The baseline reproduce commands did not fail, so Lasso cannot tell whether the requested bug is still present on the chosen baseline.",
      ],
      missingFields: ["baselineRef", "reproduceCommands"],
      guidance: [
        "Provide a baselineRef that still contains the bug, or tighten reproduceCommands so they fail on that baseline.",
        "Do not auto-retry until the baseline bug reproduction is explicit and trustworthy.",
      ],
    };
  }

  if (observedOutcome.terminalNodeId === "apply-failed") {
    return {
      status: "needs_operator_input",
      candidateWorkflow: "patch-validation",
      riskLevel: ensureInteractiveRiskLevel(risk.riskLevel, "medium"),
      reasons: [
        ...risk.reasons,
        "The candidate could not be applied cleanly, so automatic replanning cannot infer a corrected candidate source.",
      ],
      missingFields: ["candidateSource"],
      guidance: [
        "Provide a corrected branch name or patch file path for candidateSource.",
        "If the candidate failed because of repo setup, include operator notes describing that setup issue before retrying.",
      ],
    };
  }

  const candidateFailedFromVerification = notesContainAny(notes, ["verification", "verify", "regression"]);
  const candidateFailedFromReproduction = notesContainAny(notes, ["reproduce", "reproduction", "still failing"]);

  if (observedOutcome.terminalNodeId === "candidate-failed") {
    const missingFields = candidateFailedFromVerification
      ? ["candidateSource", "verificationCommands"]
      : candidateFailedFromReproduction
        ? ["candidateSource"]
        : ["candidateSource", "observedOutcome.notes"];

    const guidance = candidateFailedFromVerification
      ? [
          "Provide a revised candidateSource and review whether verificationCommands are too broad or now catching a real regression.",
          "Keep the previous verification details in observedOutcome.notes so the next attempt is explainable.",
        ]
      : candidateFailedFromReproduction
        ? [
            "Provide a different candidateSource because the previous fix still reproduced the bug.",
            "You can keep verificationCommands unchanged unless the next candidate changes the broader validation surface.",
          ]
        : [
            "Provide a revised candidateSource and add observedOutcome.notes explaining whether reproduction still failed or broader verification failed.",
            "Lasso will not guess whether this was a bug-reproduction failure or a regression failure.",
          ];

    return {
      status: "needs_operator_input",
      candidateWorkflow: "patch-validation",
      riskLevel: ensureInteractiveRiskLevel(risk.riskLevel, "medium"),
      reasons: [
        ...risk.reasons,
        "The previous candidate did not validate, and Lasso cannot infer a safe replacement candidate automatically.",
      ],
      missingFields,
      guidance,
    };
  }

  return {
    status: "needs_operator_input",
    candidateWorkflow: "patch-validation",
    riskLevel: ensureInteractiveRiskLevel(risk.riskLevel, "medium"),
    reasons: [
      ...risk.reasons,
      "The observed patch-validation outcome did not match a supported replanning rule.",
    ],
    missingFields: ["observedOutcome.notes"],
    guidance: [
      "Add operator notes explaining what happened so the next request can be revised intentionally.",
    ],
  };
}

function replanAbortedPatchValidation(
  input: LocalPatchValidationBundle,
  observedOutcome: PatchValidationObservedOutcome,
  riskLevel: RiskLevel,
): ReplanResult {
  switch (observedOutcome.abortReason) {
    case "manual-stop":
      return {
        status: "stop",
        workflow: "patch-validation",
        riskLevel: "high",
        reasons: [
          `The previous patch-validation attempt was stopped manually.`,
          "Automatic replanning should not override an explicit operator stop.",
        ],
        guidance: [
          "Review the prior run manually before deciding whether to construct a new request.",
        ],
      };
    case "setup-failure":
      return {
        status: "needs_operator_input",
        candidateWorkflow: "patch-validation",
        riskLevel: ensureInteractiveRiskLevel(riskLevel, "medium"),
        reasons: [
          `The previous patch-validation attempt aborted due to ${describeAbortReason(observedOutcome.abortReason)}.`,
          "Setup failures usually mean the repository path, baseline ref, or candidate source needs correction.",
        ],
        missingFields: ["repoPath", "baselineRef", "candidateSource"],
        guidance: [
          `Verify that repoPath points at a disposable repository, baselineRef resolves cleanly, and candidateSource still exists in ${input.repoPath}.`,
          "Add observedOutcome.notes if the setup failure came from a more specific cause such as a missing patch file.",
        ],
      };
    case "retry-exhaustion":
      return {
        status: "needs_operator_input",
        candidateWorkflow: "patch-validation",
        riskLevel: ensureInteractiveRiskLevel(riskLevel, "medium"),
        reasons: [
          `The previous patch-validation attempt aborted due to ${describeAbortReason(observedOutcome.abortReason)}.`,
          "Retry exhaustion usually means the verification environment or command set needs human diagnosis before another attempt.",
        ],
        missingFields: ["verificationCommands", "observedOutcome.notes"],
        guidance: [
          "Review verificationCommands for flaky or environment-sensitive checks before retrying.",
          "Use observedOutcome.notes to record what kept failing so the next request is auditable.",
        ],
      };
    case "timeout":
      return {
        status: "needs_operator_input",
        candidateWorkflow: "patch-validation",
        riskLevel: ensureInteractiveRiskLevel(riskLevel, "medium"),
        reasons: [
          `The previous patch-validation attempt aborted due to ${describeAbortReason(observedOutcome.abortReason)}.`,
          "The current request does not expose timeout tuning, so a human must decide whether the commands or environment need to change.",
        ],
        missingFields: ["observedOutcome.notes"],
        guidance: [
          "Record which step timed out in observedOutcome.notes and decide whether reproduceCommands or verificationCommands should be shortened or split.",
        ],
      };
    case "unknown":
    default:
      return {
        status: "needs_operator_input",
        candidateWorkflow: "patch-validation",
        riskLevel: ensureInteractiveRiskLevel(riskLevel, "medium"),
        reasons: [
          `The previous patch-validation attempt aborted due to ${describeAbortReason(observedOutcome.abortReason)}.`,
          "Lasso cannot safely revise the request until the operator explains what failed.",
        ],
        missingFields: ["observedOutcome.notes"],
        guidance: [
          "Provide observedOutcome.notes describing the failure before attempting another replan.",
        ],
      };
  }
}

function replanPrReviewMerge(
  originalRequest: { workflow: "pr-review-merge"; input: LocalPrBundle },
  observedOutcome: PrReviewMergeObservedOutcome,
): ReplanResult {
  const risk = classifyPrReviewMergeRisk(originalRequest.input, observedOutcome);

  if (observedOutcome.terminalNodeId === "reject-human") {
    return {
      status: "stop",
      workflow: "pr-review-merge",
      riskLevel: "high",
      reasons: [
        ...risk.reasons,
        "Do not auto-replan after an explicit human rejection of the merge.",
      ],
      guidance: [
        "Review the source branch manually before deciding whether to produce a new merge request.",
      ],
    };
  }

  if (observedOutcome.aborted) {
    return replanAbortedPrReviewMerge(originalRequest.input, observedOutcome, risk.riskLevel);
  }

  if (observedOutcome.terminalNodeId === "complete-success") {
    return {
      status: "stop",
      workflow: "pr-review-merge",
      riskLevel: "medium",
      reasons: [
        ...risk.reasons,
        "The previous PR review + merge attempt already succeeded and there is no safe automatic request mutation for the success path.",
      ],
      guidance: [
        "Reuse the existing request only if you intentionally want another local simulation.",
      ],
    };
  }

  if (observedOutcome.terminalNodeId === "reject-verification") {
    return {
      status: "needs_operator_input",
      candidateWorkflow: "pr-review-merge",
      riskLevel: ensureInteractiveRiskLevel(risk.riskLevel, "medium"),
      reasons: [
        ...risk.reasons,
        "Verification failed before merge, and Lasso cannot infer whether the fix is in the branch content or the verification command set.",
      ],
      missingFields: ["sourceBranch", "verificationCommands"],
      guidance: [
        "Update the source branch with the intended fixes and review verificationCommands before retrying.",
        "If the failure came from a broader environment issue, describe it in observedOutcome.notes.",
      ],
    };
  }

  if (observedOutcome.terminalNodeId === "merge-conflict") {
    return {
      status: "needs_operator_input",
      candidateWorkflow: "pr-review-merge",
      riskLevel: ensureInteractiveRiskLevel(risk.riskLevel, "medium"),
      reasons: [
        ...risk.reasons,
        "The merge hit a conflict, and Lasso cannot resolve or rename the source branch automatically.",
      ],
      missingFields: ["sourceBranch"],
      guidance: [
        "Update the source branch against the current target branch, then provide the refreshed sourceBranch for the next attempt.",
      ],
    };
  }

  return {
    status: "needs_operator_input",
    candidateWorkflow: "pr-review-merge",
    riskLevel: ensureInteractiveRiskLevel(risk.riskLevel, "medium"),
    reasons: [
      ...risk.reasons,
      "The observed PR review + merge outcome did not match a supported replanning rule.",
    ],
    missingFields: ["observedOutcome.notes"],
    guidance: [
      "Add observedOutcome.notes describing what happened so the next attempt can be revised intentionally.",
    ],
  };
}

function replanAbortedPrReviewMerge(
  input: LocalPrBundle,
  observedOutcome: PrReviewMergeObservedOutcome,
  riskLevel: RiskLevel,
): ReplanResult {
  switch (observedOutcome.abortReason) {
    case "manual-stop":
      return {
        status: "stop",
        workflow: "pr-review-merge",
        riskLevel: "high",
        reasons: [
          "The previous PR review + merge attempt was stopped manually.",
          "Automatic replanning should not override an explicit operator stop.",
        ],
        guidance: [
          "Review the attempted merge manually before constructing a new request.",
        ],
      };
    case "retry-exhaustion":
      return {
        status: "needs_operator_input",
        candidateWorkflow: "pr-review-merge",
        riskLevel: ensureInteractiveRiskLevel(riskLevel, "medium"),
        reasons: [
          `The previous PR review + merge attempt aborted due to ${describeAbortReason(observedOutcome.abortReason)}.`,
          "Post-merge verification kept failing or retrying, and Lasso cannot repair that automatically.",
        ],
        missingFields: ["verificationCommands", "observedOutcome.notes"],
        guidance: [
          "Inspect the post-merge verification behavior before retrying and capture the failure details in observedOutcome.notes.",
          "Adjust verificationCommands or fix the source branch intentionally rather than relying on automatic replanning.",
        ],
      };
    case "setup-failure":
      return {
        status: "needs_operator_input",
        candidateWorkflow: "pr-review-merge",
        riskLevel: ensureInteractiveRiskLevel(riskLevel, "medium"),
        reasons: [
          `The previous PR review + merge attempt aborted due to ${describeAbortReason(observedOutcome.abortReason)}.`,
          "Setup failures usually mean the repository path or branch mapping needs correction.",
        ],
        missingFields: ["repoPath", "sourceBranch", "targetBranch"],
        guidance: [
          `Verify that repoPath points at a disposable repository and that ${input.sourceBranch} and ${input.targetBranch} still resolve correctly.`,
        ],
      };
    case "timeout":
      return {
        status: "needs_operator_input",
        candidateWorkflow: "pr-review-merge",
        riskLevel: ensureInteractiveRiskLevel(riskLevel, "medium"),
        reasons: [
          `The previous PR review + merge attempt aborted due to ${describeAbortReason(observedOutcome.abortReason)}.`,
          "Timeout handling is not a request-level knob in v1, so a human must decide what to change before retrying.",
        ],
        missingFields: ["observedOutcome.notes"],
        guidance: [
          "Record which step timed out in observedOutcome.notes and decide whether the repo state or verification commands need to change before rerunning.",
        ],
      };
    case "unknown":
    default:
      return {
        status: "needs_operator_input",
        candidateWorkflow: "pr-review-merge",
        riskLevel: ensureInteractiveRiskLevel(riskLevel, "medium"),
        reasons: [
          `The previous PR review + merge attempt aborted due to ${describeAbortReason(observedOutcome.abortReason)}.`,
          "Lasso needs more operator context before it can suggest a safe next attempt.",
        ],
        missingFields: ["observedOutcome.notes"],
        guidance: [
          "Provide observedOutcome.notes explaining what failed before retrying.",
        ],
      };
  }
}

function parseWorkflow(value: unknown): ReplanWorkflow {
  if (value === "patch-validation" || value === "pr-review-merge") {
    return value;
  }

  throw new Error("Invalid replan request workflow");
}

function parseOriginalRequest(workflow: ReplanWorkflow, value: unknown): ReplanRequest["originalRequest"] {
  const parsed = parseWorkflowRequest(JSON.stringify(value));
  if (parsed.workflow !== workflow) {
    throw new Error("Replan workflow does not match original request workflow");
  }

  return parsed;
}

function parseObservedOutcome(
  workflow: ReplanWorkflow,
  value: unknown,
): PatchValidationObservedOutcome | PrReviewMergeObservedOutcome {
  if (!isRecord(value)) {
    throw new Error("Invalid replan observedOutcome");
  }

  const notes = parseNotes(value.notes);
  const aborted = parseOptionalBoolean(value.aborted, "observedOutcome.aborted");
  const terminalNodeId = value.terminalNodeId;
  const abortReason = parseAbortReason(value.abortReason, aborted);

  if (terminalNodeId !== undefined && typeof terminalNodeId !== "string") {
    throw new Error("observedOutcome.terminalNodeId must be a string");
  }

  if (terminalNodeId !== undefined && aborted) {
    throw new Error("observedOutcome cannot include both terminalNodeId and aborted: true");
  }

  if (terminalNodeId === undefined && !aborted) {
    throw new Error("observedOutcome must include terminalNodeId or aborted: true");
  }

  if (workflow === "patch-validation") {
    if (terminalNodeId !== undefined && !PATCH_VALIDATION_TERMINALS.includes(terminalNodeId as PatchValidationTerminalNodeId)) {
      throw new Error(`Unsupported patch-validation terminalNodeId: ${terminalNodeId}`);
    }

    return {
      terminalNodeId: terminalNodeId as PatchValidationTerminalNodeId | undefined,
      aborted: aborted || undefined,
      abortReason,
      notes,
    };
  }

  if (terminalNodeId !== undefined && !PR_REVIEW_TERMINALS.includes(terminalNodeId as PrReviewMergeTerminalNodeId)) {
    throw new Error(`Unsupported pr-review-merge terminalNodeId: ${terminalNodeId}`);
  }

  return {
    terminalNodeId: terminalNodeId as PrReviewMergeTerminalNodeId | undefined,
    aborted: aborted || undefined,
    abortReason,
    notes,
  };
}

function parseNotes(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some(note => typeof note !== "string")) {
    throw new Error("observedOutcome.notes must be an array of strings");
  }

  const normalized = normalizeNotes(value);
  return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalBoolean(value: unknown, fieldName: string): boolean {
  if (value === undefined) {
    return false;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean`);
  }

  return value;
}

function parseAbortReason(value: unknown, aborted: boolean): ReplanAbortReason | undefined {
  if (!aborted) {
    if (value !== undefined) {
      throw new Error("observedOutcome.abortReason requires aborted: true");
    }
    return undefined;
  }

  if (
    value === "setup-failure"
    || value === "retry-exhaustion"
    || value === "timeout"
    || value === "manual-stop"
    || value === "unknown"
  ) {
    return value;
  }

  throw new Error("observedOutcome.abortReason must be one of: setup-failure, retry-exhaustion, timeout, manual-stop, unknown");
}

function validateParsedRequest(request: ReplanRequest): void {
  if (request.workflow !== request.originalRequest.workflow) {
    throw new Error("Replan workflow does not match original request workflow");
  }

  const observedOutcome = request.observedOutcome;
  if (observedOutcome.terminalNodeId !== undefined && observedOutcome.aborted) {
    throw new Error("observedOutcome cannot include both terminalNodeId and aborted: true");
  }

  if (observedOutcome.aborted && observedOutcome.abortReason === undefined) {
    throw new Error("observedOutcome.abortReason is required when aborted: true");
  }
}

function ensureInteractiveRiskLevel(current: RiskLevel, minimum: Exclude<RiskLevel, "low">): RiskLevel {
  if (minimum === "high" || current === "high") {
    return "high";
  }
  return current === "low" ? "medium" : current;
}

function ensureStopRiskLevel(current: RiskLevel): "medium" | "high" {
  return current === "high" ? "high" : "medium";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
