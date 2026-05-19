import type { LocalCandidateSource, LocalPatchValidationBundle } from "./types.js";

// ============================================================================
// Node ID constants
// ============================================================================

export const patchValidationNodeIds = {
  runBaseline: "run-baseline",
  gateNotReproduced: "gate-not-reproduced",
  applyCandidate: "apply-candidate",
  gateApplyFailed: "gate-apply-failed",
  runCandidateReproduce: "run-candidate-reproduce",
  gateCandidateStillFails: "gate-candidate-still-fails",
  runVerification: "run-verification",
  gateCandidateVerification: "gate-candidate-verification",
  summarise: "summarise",
  humanApprove: "human-approve",
  checkHumanApproval: "check-human-approval",
  validatedFix: "validated-fix",
  notReproduced: "not-reproduced",
  applyFailed: "apply-failed",
  candidateFailed: "candidate-failed",
  rejected: "rejected",
} as const;

// ============================================================================
// Bash tool builders
// ============================================================================

/**
 * Runs the reproduce commands on the baseline ref.
 * Emits { reproduced: true } when they fail (expected baseline signal)
 * and { reproduced: false } when they unexpectedly pass on the baseline.
 *
 * Precondition: `bundle.baselineRef` must resolve cleanly in the repo.
 * A checkout failure is a hard setup/precondition error — the tool exits
 * non-zero and aborts the workflow rather than routing to a terminal node.
 */
export function buildBaselineReproduceTool(bundle: LocalPatchValidationBundle) {
  const lines = [
    `git checkout ${shellQuote(bundle.baselineRef)} >/dev/null 2>&1 || exit 1`,
    "reproduced=true",
    ...bundle.reproduceCommands.flatMap(cmd => [
      `if (${cmd}) >/dev/null 2>&1; then`,
      "  reproduced=false",
      "fi",
    ]),
    `printf '%s\\n' "{\\"reproduced\\":$reproduced}"`,
  ];

  return buildBashTool(lines.join("\n"), bundle.repoPath);
}

/** Applies the candidate source (branch checkout or patch application) to the repo.
 * Emits { applied: true } on success, { applied: false, reason: "..." } on failure.
 */
export function buildApplyCandidateTool(bundle: LocalPatchValidationBundle) {
  const lines = [
    `if ! git checkout ${shellQuote(bundle.baselineRef)} >/dev/null 2>&1; then`,
    `  printf '%s\\n' ${shellQuote(JSON.stringify({ applied: false, reason: "baseline checkout failed" }))}`,
    "  exit 0",
    "fi",
    ...buildCandidateApplicationLines(bundle.candidateSource),
  ];

  return buildBashTool(lines.join("\n"), bundle.repoPath);
}

function buildCandidateApplicationLines(source: LocalCandidateSource): string[] {
  if (source.kind === "branch") {
    return [
      `if git checkout ${shellQuote(source.value)} >/dev/null 2>&1; then`,
      `  printf '%s\\n' ${shellQuote(JSON.stringify({ applied: true }))}`,
      "else",
      `  printf '%s\\n' ${shellQuote(JSON.stringify({ applied: false, reason: "branch checkout failed" }))}`,
      "fi",
    ];
  }

  return [
    `if git apply ${shellQuote(source.value)} >/dev/null 2>&1; then`,
    `  printf '%s\\n' ${shellQuote(JSON.stringify({ applied: true }))}`,
    "else",
    `  printf '%s\\n' ${shellQuote(JSON.stringify({ applied: false, reason: "patch apply failed" }))}`,
    "fi",
  ];
}

/** Reruns the reproduce commands after the candidate has been applied.
 * Emits { reproduced: false } when the bug is fixed, { reproduced: true } when it still fails.
 */
export function buildCandidateReproduceTool(bundle: LocalPatchValidationBundle) {
  const lines = [
    "reproduced=false",
    ...bundle.reproduceCommands.flatMap(cmd => [
      `if ! (${cmd}) >/dev/null 2>&1; then`,
      "  reproduced=true",
      "fi",
    ]),
    `printf '%s\\n' "{\\"reproduced\\":$reproduced}"`,
  ];

  return buildBashTool(lines.join("\n"), bundle.repoPath);
}

/** Runs verification commands (regression guard) after the candidate is applied.
 * Emits { passed: true } when all pass, { passed: false, command: "..." } on first failure.
 */
export function buildVerificationTool(bundle: LocalPatchValidationBundle) {
  const lines = [
    ...bundle.verificationCommands.flatMap(cmd => [
      `if ! (${cmd}) >/dev/null 2>&1; then`,
      `  printf '%s\\n' ${shellQuote(JSON.stringify({ passed: false, command: cmd }))}`,
      "  exit 0",
      "fi",
    ]),
    `printf '%s\\n' ${shellQuote(JSON.stringify({ passed: true }))}`,
  ];

  return buildBashTool(lines.join("\n"), bundle.repoPath);
}

// ============================================================================
// Condition helpers
// ============================================================================

/** True when baseline reproduction produced { reproduced: true }. */
export function buildBaselineReproducedCondition(): string {
  return `${patchValidationNodeIds.runBaseline}.reproduced`;
}

/** True when candidate application produced { applied: true }. */
export function buildCandidateAppliedCondition(): string {
  return `${patchValidationNodeIds.applyCandidate}.applied`;
}

/** True when candidate reproduction produced { reproduced: false } (bug no longer reproduces). */
export function buildCandidateFixedCondition(): string {
  return `!${patchValidationNodeIds.runCandidateReproduce}.reproduced`;
}

/** True when verification produced { passed: true }. */
export function buildVerificationPassedCondition(): string {
  return `${patchValidationNodeIds.runVerification}.passed`;
}

/** True when human approval produced { approved: true }. */
export function buildHumanApprovedCondition(): string {
  return `${patchValidationNodeIds.humanApprove}.approved`;
}

// ============================================================================
// Internal helpers
// ============================================================================

function buildBashTool(script: string, cwd: string) {
  return {
    tool: "bash",
    args: ["-lc", script],
    cwd,
  };
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}
