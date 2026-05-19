import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalPatchValidationBundle } from "../../src/reference/types.js";

export interface PatchValidationFixtureOptions {
  reviewInstructions?: string;
  /**
   * When true, add a human approval gate to the bundle and spec.
   * Defaults to false.
   */
  approvalRequired?: boolean;
  /**
   * The baseline reproduce command already passes (exits 0), meaning the bug is
   * not present. Routes the workflow to the `not-reproduced` terminal.
   */
  baselineAlwaysPasses?: boolean;
  /**
   * Produces a branch or patch-file candidate that cannot be applied cleanly.
   * Routes to the `apply-failed` terminal.
   * When combined with `candidateKind: "patchFile"` the patch file is malformed;
   * when combined with `candidateKind: "branch"` the branch simply does not exist.
   */
  applyFailure?: boolean;
  /**
   * The fix is applied successfully but the reproduce command still fails after
   * the candidate is applied. Routes to the `candidate-failed` terminal.
   */
  fixDoesNotFixBug?: boolean;
  /**
   * The fix resolves the reproduce command but the broader verification commands
   * fail after the candidate is applied. Routes to the `candidate-failed` terminal.
   */
  verificationFailure?: boolean;
  /**
   * Which candidate source kind the bundle should expose.
   * Defaults to "branch".
   */
  candidateKind?: "branch" | "patchFile";
}

export interface PatchValidationFixture {
  bundle: LocalPatchValidationBundle;
  /** Absolute path to the generated patch file (only populated for patchFile fixtures). */
  patchFilePath: string;
  cleanup: () => void;
}

const BASELINE_REF = "main";
const FIX_BRANCH = "fix/bug";

export function createPatchValidationFixture(options: PatchValidationFixtureOptions = {}): PatchValidationFixture {
  const repoPath = mkdtempSync(join(tmpdir(), "lasso-pv-"));
  const candidateKind = options.candidateKind ?? "branch";

  runGit(repoPath, ["init", "-q"]);
  runGit(repoPath, ["checkout", "-b", BASELINE_REF]);
  runGit(repoPath, ["config", "user.name", "Lasso Test"]);
  runGit(repoPath, ["config", "user.email", "lasso@example.com"]);

  // reproduce.sh: exits 1 on baseline (bug present) unless baselineAlwaysPasses
  const baselineReproduceContent = options.baselineAlwaysPasses ? "exit 0\n" : "exit 1\n";
  writeFileSync(join(repoPath, "reproduce.sh"), baselineReproduceContent);
  // verify.sh: always passes on baseline
  writeFileSync(join(repoPath, "verify.sh"), "exit 0\n");
  runGit(repoPath, ["add", "reproduce.sh", "verify.sh"]);
  runGit(repoPath, ["commit", "-qm", "Initial commit with known bug"]);

  let patchFilePath: string;

  if (options.baselineAlwaysPasses) {
    // Workflow routes to not-reproduced before attempting to apply the candidate,
    // so the candidate source is never exercised. Use a dummy patch path.
    patchFilePath = join(repoPath, "unused.patch");
    writeFileSync(patchFilePath, "");
  } else if (options.applyFailure) {
    // Do not create a real fix branch. For the patchFile case write a malformed patch.
    patchFilePath = join(repoPath, "bad.patch");
    writeFileSync(patchFilePath, "this is not a valid patch\n");
  } else {
    runGit(repoPath, ["checkout", "-b", FIX_BRANCH]);

    if (options.fixDoesNotFixBug) {
      // Cosmetic change only — bug still present after applying
      writeFileSync(join(repoPath, "reproduce.sh"), "# attempted fix\nexit 1\n");
      runGit(repoPath, ["add", "reproduce.sh"]);
    } else if (options.verificationFailure) {
      // Bug is fixed but verification breaks
      writeFileSync(join(repoPath, "reproduce.sh"), "exit 0\n");
      writeFileSync(join(repoPath, "verify.sh"), "exit 1\n");
      runGit(repoPath, ["add", "reproduce.sh", "verify.sh"]);
    } else {
      // Clean fix
      writeFileSync(join(repoPath, "reproduce.sh"), "exit 0\n");
      runGit(repoPath, ["add", "reproduce.sh"]);
    }

    runGit(repoPath, ["commit", "-qm", "Fix: resolve the bug"]);

    // Generate a patch file from the baseline to the fix branch.
    // NOTE: Do NOT trim the output — git apply requires the trailing newline.
    const patchContent = execFileSync("git", ["diff", `${BASELINE_REF}..${FIX_BRANCH}`], {
      cwd: repoPath,
      encoding: "utf8",
    });
    patchFilePath = join(repoPath, "fix.patch");
    writeFileSync(patchFilePath, patchContent);

    // Return to baseline so the workflow starts clean
    runGit(repoPath, ["checkout", BASELINE_REF]);
  }

  const candidateSource =
    candidateKind === "patchFile"
      ? ({ kind: "patchFile", value: patchFilePath } as const)
      : options.applyFailure
        ? ({ kind: "branch", value: "nonexistent-branch" } as const)
        : ({ kind: "branch", value: FIX_BRANCH } as const);

  const bundle: LocalPatchValidationBundle = {
    repoPath,
    baselineRef: BASELINE_REF,
    candidateSource,
    reproduceCommands: ["bash reproduce.sh"],
    verificationCommands: ["bash verify.sh"],
    reviewInstructions:
      options.reviewInstructions ?? "Approve only if the fix is clean and regression-free.",
    approvalRequired: options.approvalRequired ?? false,
  };

  return {
    bundle,
    patchFilePath,
    cleanup: () => rmSync(repoPath, { recursive: true, force: true }),
  };
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
  }).trim();
}
