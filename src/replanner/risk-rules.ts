import type { LocalPatchValidationBundle, LocalPrBundle } from "../reference/types.js";
import type {
  PatchValidationObservedOutcome,
  PrReviewMergeObservedOutcome,
  ReplanAbortReason,
  RiskLevel,
} from "./types.js";

const HIGH_RISK_KEYWORDS = ["prod", "production", "hotfix", "security", "critical"];
const MEDIUM_RISK_KEYWORDS = ["regression", "verification", "verify", "customer"];

export interface RiskAssessment {
  riskLevel: RiskLevel;
  reasons: string[];
  warnings: string[];
}

export function classifyPatchValidationRisk(
  request: LocalPatchValidationBundle,
  outcome: PatchValidationObservedOutcome,
): RiskAssessment {
  const notes = normalizeNotes(outcome.notes);
  const highKeywords = collectMatchedKeywords(notes, HIGH_RISK_KEYWORDS);
  const mediumKeywords = collectMatchedKeywords(notes, MEDIUM_RISK_KEYWORDS);
  const reasons: string[] = [];
  const warnings: string[] = [];
  let riskLevel: RiskLevel = "low";

  if (request.candidateSource.kind === "patchFile") {
    riskLevel = "high";
    reasons.push("Patch-file candidates are treated as high risk for adaptive replanning.");
  }

  if (highKeywords.length > 0) {
    riskLevel = "high";
    reasons.push(`Operator notes mention high-risk terms: ${highKeywords.join(", ")}.`);
  } else if (mediumKeywords.length > 0 && riskLevel === "low") {
    riskLevel = "medium";
    reasons.push(`Operator notes mention elevated-risk terms: ${mediumKeywords.join(", ")}.`);
  }

  if (outcome.terminalNodeId === "rejected") {
    riskLevel = "high";
    reasons.push("The previous attempt was explicitly rejected by a human reviewer.");
  } else if (
    outcome.terminalNodeId === "not-reproduced"
    || outcome.terminalNodeId === "apply-failed"
    || outcome.terminalNodeId === "candidate-failed"
  ) {
    riskLevel = escalateRisk(riskLevel, "medium");
    reasons.push(`The previous attempt ended at \`${outcome.terminalNodeId}\`.`);
  }

  if (outcome.aborted) {
    riskLevel = escalateRisk(riskLevel, outcome.abortReason === "manual-stop" ? "high" : "medium");
    reasons.push(`The previous attempt aborted due to ${describeAbortReason(outcome.abortReason)}.`);
    if (outcome.abortReason === "unknown") {
      warnings.push("Abort reason is unknown; operator notes may be needed before retrying safely.");
    }
  }

  if (reasons.length === 0) {
    reasons.push("No elevated risk signals were detected from the previous patch-validation attempt.");
  }

  return { riskLevel, reasons, warnings };
}

export function classifyPrReviewMergeRisk(
  request: LocalPrBundle,
  outcome: PrReviewMergeObservedOutcome,
): RiskAssessment {
  const notes = normalizeNotes(outcome.notes);
  const highKeywords = collectMatchedKeywords(notes, HIGH_RISK_KEYWORDS);
  const mediumKeywords = collectMatchedKeywords(notes, MEDIUM_RISK_KEYWORDS);
  const reasons: string[] = [];
  const warnings: string[] = [];
  let riskLevel: RiskLevel = "low";

  if (highKeywords.length > 0) {
    riskLevel = "high";
    reasons.push(`Operator notes mention high-risk terms: ${highKeywords.join(", ")}.`);
  } else if (mediumKeywords.length > 0) {
    riskLevel = "medium";
    reasons.push(`Operator notes mention elevated-risk terms: ${mediumKeywords.join(", ")}.`);
  }

  if (outcome.terminalNodeId === "reject-human") {
    riskLevel = "high";
    reasons.push("The previous attempt was explicitly rejected by a human reviewer.");
  } else if (
    outcome.terminalNodeId === "reject-verification"
    || outcome.terminalNodeId === "merge-conflict"
  ) {
    riskLevel = escalateRisk(riskLevel, "medium");
    reasons.push(`The previous attempt ended at \`${outcome.terminalNodeId}\`.`);
  } else if (outcome.terminalNodeId === "complete-success") {
    reasons.push("The previous PR review + merge attempt completed successfully.");
  }

  if (outcome.aborted) {
    riskLevel = escalateRisk(riskLevel, outcome.abortReason === "manual-stop" ? "high" : "medium");
    reasons.push(`The previous attempt aborted due to ${describeAbortReason(outcome.abortReason)}.`);
    if (outcome.abortReason === "retry-exhaustion") {
      warnings.push("Retry exhaustion usually needs human diagnosis before another merge attempt.");
    } else if (outcome.abortReason === "unknown") {
      warnings.push("Abort reason is unknown; operator notes may be needed before retrying safely.");
    }
  }

  if (reasons.length === 0) {
    reasons.push(
      `No elevated risk signals were detected for merging \`${request.sourceBranch}\` into \`${request.targetBranch}\`.`,
    );
  }

  return { riskLevel, reasons, warnings };
}

export function normalizeNotes(notes?: string[]): string[] {
  return (notes ?? []).map(note => note.trim()).filter(note => note.length > 0);
}

export function notesContainAny(notes: string[] | undefined, keywords: string[]): boolean {
  const normalized = normalizeNotes(notes).map(note => note.toLowerCase());
  return keywords.some(keyword => normalized.some(note => note.includes(keyword)));
}

export function describeAbortReason(reason: ReplanAbortReason | undefined): string {
  switch (reason) {
    case "setup-failure":
      return "a setup failure";
    case "retry-exhaustion":
      return "retry exhaustion";
    case "timeout":
      return "a timeout";
    case "manual-stop":
      return "a manual stop";
    case "unknown":
    default:
      return "an unknown abort";
  }
}

function collectMatchedKeywords(notes: string[], keywords: string[]): string[] {
  const loweredNotes = notes.map(note => note.toLowerCase());
  const matches = new Set<string>();

  for (const keyword of keywords) {
    if (loweredNotes.some(note => note.includes(keyword))) {
      matches.add(keyword);
    }
  }

  return Array.from(matches);
}

function escalateRisk(current: RiskLevel, next: RiskLevel): RiskLevel {
  const order: RiskLevel[] = ["low", "medium", "high"];
  return order[Math.max(order.indexOf(current), order.indexOf(next))];
}
