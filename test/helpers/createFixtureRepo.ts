import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalPrBundle } from "../../src/reference/types.js";

export interface FixtureRepoOptions {
  reviewInstructions?: string;
  verificationCommands?: string[];
  createMergeConflict?: boolean;
  mergeConflictMode?: "both_modified" | "both_added";
  createPostMergeFailureMarker?: boolean;
}

export interface FixtureRepo {
  bundle: LocalPrBundle;
  cleanup: () => void;
}

export function createFixtureRepo(options: FixtureRepoOptions = {}): FixtureRepo {
  const repoPath = mkdtempSync(join(tmpdir(), "lasso-pr-"));
  const targetBranch = "main";
  const sourceBranch = "feature/pr-change";

  runGit(repoPath, ["init", "-q"]);
  runGit(repoPath, ["checkout", "-b", targetBranch]);
  runGit(repoPath, ["config", "user.name", "Lasso Test"]);
  runGit(repoPath, ["config", "user.email", "lasso@example.com"]);

  writeFileSync(join(repoPath, "app.txt"), "base\n");
  runGit(repoPath, ["add", "app.txt"]);
  runGit(repoPath, ["commit", "-qm", "Initial commit"]);

  runGit(repoPath, ["checkout", "-b", sourceBranch]);
  if (options.createMergeConflict && options.mergeConflictMode === "both_added") {
    writeFileSync(join(repoPath, "conflict.txt"), "feature branch version\n");
  } else {
    writeFileSync(join(repoPath, "app.txt"), options.createMergeConflict ? "feature branch change\n" : "base\nfeature change\n");
  }

  if (options.createPostMergeFailureMarker) {
    writeFileSync(join(repoPath, ".lasso-post-merge-fail"), "retry\n");
  }

  const filesToAdd = [
    ...(options.createMergeConflict && options.mergeConflictMode === "both_added" ? ["conflict.txt"] : ["app.txt"]),
    ...(options.createPostMergeFailureMarker ? [".lasso-post-merge-fail"] : []),
  ];
  runGit(repoPath, ["add", ...filesToAdd]);
  runGit(repoPath, ["commit", "-qm", "Feature change"]);

  if (options.createMergeConflict) {
    runGit(repoPath, ["checkout", targetBranch]);
    if (options.mergeConflictMode === "both_added") {
      writeFileSync(join(repoPath, "conflict.txt"), "main branch version\n");
      runGit(repoPath, ["add", "conflict.txt"]);
    } else {
      writeFileSync(join(repoPath, "app.txt"), "main branch change\n");
      runGit(repoPath, ["add", "app.txt"]);
    }
    runGit(repoPath, ["commit", "-qm", "Conflicting change on main"]);
    runGit(repoPath, ["checkout", sourceBranch]);
  }

  return {
    bundle: {
      repoPath,
      sourceBranch,
      targetBranch,
      reviewInstructions: options.reviewInstructions ?? "Approve only if verification passes and the diff looks safe.",
      verificationCommands: options.verificationCommands ?? ['node -e "process.exit(0)"'],
    },
    cleanup: () => {
      rmSync(repoPath, { recursive: true, force: true });
    },
  };
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
  }).trim();
}
