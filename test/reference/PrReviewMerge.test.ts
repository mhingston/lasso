import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { buildPrReviewMergeHarnessSpec } from "../../src/reference/pr-review-merge.js";
import { compileHarnessSpec } from "../../src/compiler/compile.js";
import { createFixtureRepo } from "../helpers/createFixtureRepo.js";
import { runCompiledWorkflow } from "../helpers/runCompiledWorkflow.js";

describe("buildPrReviewMergeHarnessSpec", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("builds and runs the happy-path simulated PR review + merge workflow", async () => {
    const fixture = createFixtureRepo();
    cleanups.push(fixture.cleanup);

    const spec = buildPrReviewMergeHarnessSpec(fixture.bundle);
    const compiled = compileHarnessSpec(spec);
    const result = await runCompiledWorkflow(compiled, fixture.bundle, {
      llmResult: {
        approved: true,
        summary: "Looks good to merge.",
      },
      humanResponse: {
        approved: true,
      },
    });

    expect(spec.graph.nodes.map(node => node.kind)).toEqual(
      expect.arrayContaining(["tool", "llm", "human", "condition", "merge", "subworkflow"]),
    );
    expect(result.status).toBe("completed");
    expect(result.terminalNodeId).toBe("complete-success");
    expect(result.result).toEqual({
      name: "complete-success",
      input: {},
    });

    const currentBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: fixture.bundle.repoPath,
      encoding: "utf8",
    }).trim();
    expect(currentBranch).toBe(fixture.bundle.targetBranch);

    const mergedFile = execFileSync("git", ["show", `${fixture.bundle.targetBranch}:app.txt`], {
      cwd: fixture.bundle.repoPath,
      encoding: "utf8",
    });
    expect(mergedFile).toContain("feature change");
  });
});
