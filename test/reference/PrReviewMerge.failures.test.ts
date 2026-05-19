import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { buildPrReviewMergeHarnessSpec } from "../../src/reference/pr-review-merge.js";
import { compileHarnessSpec } from "../../src/compiler/compile.js";
import { createFixtureRepo } from "../helpers/createFixtureRepo.js";
import { runCompiledWorkflow } from "../helpers/runCompiledWorkflow.js";

describe("buildPrReviewMergeHarnessSpec failures", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("routes verification failures to the rejection terminal", async () => {
    const fixture = createFixtureRepo({
      verificationCommands: ['node -e "process.exit(1)"'],
    });
    cleanups.push(fixture.cleanup);

    const compiled = compileHarnessSpec(buildPrReviewMergeHarnessSpec(fixture.bundle));
    const result = await runCompiledWorkflow(compiled, fixture.bundle, {
      llmResult: {
        approved: true,
      },
      humanResponse: {
        approved: true,
      },
    });

    expect(result.status).toBe("completed");
    expect(result.terminalNodeId).toBe("reject-verification");
  });

  it("routes merge conflicts to the conflict terminal", async () => {
    const fixture = createFixtureRepo({
      createMergeConflict: true,
    });
    cleanups.push(fixture.cleanup);

    const compiled = compileHarnessSpec(buildPrReviewMergeHarnessSpec(fixture.bundle));
    const result = await runCompiledWorkflow(compiled, fixture.bundle, {
      llmResult: {
        approved: true,
      },
      humanResponse: {
        approved: true,
      },
    });

    expect(result.status).toBe("completed");
    expect(result.terminalNodeId).toBe("merge-conflict");

    const currentBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: fixture.bundle.repoPath,
      encoding: "utf8",
    }).trim();
    expect(currentBranch).toBe(fixture.bundle.targetBranch);
  });

  it("routes both-added merge conflicts to the conflict terminal", async () => {
    const fixture = createFixtureRepo({
      createMergeConflict: true,
      mergeConflictMode: "both_added",
    });
    cleanups.push(fixture.cleanup);

    const compiled = compileHarnessSpec(buildPrReviewMergeHarnessSpec(fixture.bundle));
    const result = await runCompiledWorkflow(compiled, fixture.bundle, {
      llmResult: {
        approved: true,
      },
      humanResponse: {
        approved: true,
      },
    });

    expect(result.status).toBe("completed");
    expect(result.terminalNodeId).toBe("merge-conflict");
  });

  it("surfaces retry exhaustion when post-merge verification keeps failing", async () => {
    const fixture = createFixtureRepo({
      createPostMergeFailureMarker: true,
    });
    cleanups.push(fixture.cleanup);

    const compiled = compileHarnessSpec(buildPrReviewMergeHarnessSpec(fixture.bundle));

    await expect(
      runCompiledWorkflow(compiled, fixture.bundle, {
        llmResult: {
          approved: true,
        },
        humanResponse: {
          approved: true,
        },
      }),
    ).rejects.toThrow(/retryable post-merge failure|Verification retry exhausted|post-merge/i);
  });

  it("routes human rejection to the rejection terminal", async () => {
    const fixture = createFixtureRepo();
    cleanups.push(fixture.cleanup);

    const compiled = compileHarnessSpec(buildPrReviewMergeHarnessSpec(fixture.bundle));
    const result = await runCompiledWorkflow(compiled, fixture.bundle, {
      llmResult: {
        approved: true,
      },
      humanResponse: {
        approved: false,
      },
    });

    expect(result.status).toBe("completed");
    expect(result.terminalNodeId).toBe("reject-human");
  });
});
