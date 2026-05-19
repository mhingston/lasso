import type { LocalPrBundle } from "./types.js";

export const prReviewMergeNodeIds = {
  loadPr: "load-pr",
  reviewPr: "review-pr",
  runVerification: "run-verification",
  mergeResults: "merge-results",
  gateMerge: "gate-merge",
  humanApprove: "human-approve",
  checkHumanApproval: "check-human-approval",
  mergeBranch: "merge-branch",
  checkMergeResult: "check-merge-result",
  postMergeCheck: "post-merge-check",
  verifyPostMerge: "verify-post-merge",
  completeSuccess: "complete-success",
  rejectVerification: "reject-verification",
  rejectHuman: "reject-human",
  mergeConflict: "merge-conflict",
} as const;

export function buildReviewPrompt(bundle: LocalPrBundle): string {
  return [
    "Review this local pull request and return JSON with a single boolean field `approved` and a short `summary`.",
    `Repository: ${bundle.repoPath}`,
    `Target branch: ${bundle.targetBranch}`,
    `Source branch: ${bundle.sourceBranch}`,
    `Instructions: ${bundle.reviewInstructions}`,
  ].join("\n");
}

export function buildLoadDiffTool(bundle: LocalPrBundle) {
  return buildBashTool(
    [
      `git checkout ${shellQuote(bundle.sourceBranch)} >/dev/null 2>&1`,
      `git diff --stat ${shellQuote(`${bundle.targetBranch}...${bundle.sourceBranch}`)}`,
    ].join("\n"),
    bundle.repoPath,
  );
}

export function buildVerificationTool(bundle: LocalPrBundle) {
  const lines = [
    `git checkout ${shellQuote(bundle.sourceBranch)} >/dev/null 2>&1`,
    ...bundle.verificationCommands.flatMap(command => [
      `if ! (${command}); then`,
      `  printf '%s\\n' ${shellQuote(JSON.stringify({ passed: false, command }))}`,
      "  exit 0",
      "fi",
    ]),
    `printf '%s\\n' ${shellQuote(JSON.stringify({ passed: true }))}`,
  ];

  return buildBashTool(lines.join("\n"), bundle.repoPath);
}

export function buildMergeTool(bundle: LocalPrBundle) {
  return buildBashTool(
    [
      `git checkout ${shellQuote(bundle.targetBranch)} >/dev/null 2>&1`,
      `if git merge --no-ff --no-edit ${shellQuote(bundle.sourceBranch)} >/dev/null 2>&1; then`,
      `  printf '%s\\n' ${shellQuote(JSON.stringify({ success: true, conflict: false }))}`,
      "  exit 0",
      "fi",
      "if git status --porcelain | grep -Eq '^(AA|DD|UU|AU|UA|DU|UD) '; then",
      "  git merge --abort >/dev/null 2>&1 || true",
      `  printf '%s\\n' ${shellQuote(JSON.stringify({ success: false, conflict: true }))}`,
      "  exit 0",
      "fi",
      `printf '%s\\n' ${shellQuote(JSON.stringify({ success: false, conflict: false }))}`,
      "exit 1",
    ].join("\n"),
    bundle.repoPath,
  );
}

export function buildPostMergeCheckTool(bundle: LocalPrBundle) {
  return buildBashTool(
    [
      `git checkout ${shellQuote(bundle.targetBranch)} >/dev/null 2>&1`,
      "if [ -f .lasso-post-merge-fail ]; then",
      "  echo 'retryable post-merge failure' >&2",
      "  exit 1",
      "fi",
      `printf '%s\\n' ${shellQuote(JSON.stringify({ passed: true }))}`,
    ].join("\n"),
    bundle.repoPath,
  );
}

export function buildVerifyPostMergeTool(bundle: LocalPrBundle) {
  return buildBashTool(
    [
      `git checkout ${shellQuote(bundle.targetBranch)} >/dev/null 2>&1`,
      `printf '%s\\n' ${shellQuote(JSON.stringify({ passed: true }))}`,
    ].join("\n"),
    bundle.repoPath,
  );
}

export function buildVerificationPassedCondition(): string {
  return `${prReviewMergeNodeIds.mergeResults}.${prReviewMergeNodeIds.runVerification}.passed`;
}

export function buildHumanApprovedCondition(): string {
  return `${prReviewMergeNodeIds.humanApprove}.approved`;
}

export function buildMergeSucceededCondition(): string {
  return `${prReviewMergeNodeIds.mergeBranch}.success`;
}

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
