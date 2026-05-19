import { afterEach, describe, expect, it } from "vitest";
import { buildPatchValidationHarnessSpec } from "../../src/reference/patch-validation.js";
import { compileHarnessSpec } from "../../src/compiler/compile.js";
import { validateHarnessSpec } from "../../src/spec/validate.js";
import { createPatchValidationFixture } from "../helpers/createPatchValidationFixture.js";
import { runCompiledWorkflow } from "../helpers/runCompiledWorkflow.js";
import type { LocalPatchValidationBundle } from "../../src/reference/types.js";

const ALWAYS_PRESENT_TERMINAL_IDS = ["validated-fix", "not-reproduced", "apply-failed", "candidate-failed"];
const APPROVAL_ONLY_TERMINAL_IDS = ["rejected"];

describe("buildPatchValidationHarnessSpec", () => {
  it("builds a valid serial spec for a branch candidate source", () => {
    const bundle: LocalPatchValidationBundle = {
      repoPath: "/tmp/repo",
      baselineRef: "HEAD",
      candidateSource: { kind: "branch", value: "fix/bug-123" },
      reproduceCommands: ["npm test -- failing.spec.ts"],
      verificationCommands: ["npm test", "npm run build"],
      reviewInstructions: "Approve only if baseline fails and candidate passes.",
      approvalRequired: true,
    };

    const spec = buildPatchValidationHarnessSpec(bundle);

    expect(spec.name).toBe("patch-validation");
    expect(spec.graph.entryNodeId).toBeDefined();

    const nodeKinds = spec.graph.nodes.map(n => n.kind);
    expect(nodeKinds).not.toContain("merge");

    const nodeIds = spec.graph.nodes.map(n => n.id);
    for (const terminal of ALWAYS_PRESENT_TERMINAL_IDS) {
      expect(nodeIds).toContain(terminal);
    }
    for (const terminal of APPROVAL_ONLY_TERMINAL_IDS) {
      expect(nodeIds).toContain(terminal);
    }

    const allTerminalIds = [...ALWAYS_PRESENT_TERMINAL_IDS, ...APPROVAL_ONLY_TERMINAL_IDS];
    const terminalNodes = spec.graph.nodes.filter(n => allTerminalIds.includes(n.id));
    for (const node of terminalNodes) {
      expect(node.kind).toBe("subworkflow");
    }
  });

  it("builds a valid serial spec for a patch-file candidate source", () => {
    const bundle: LocalPatchValidationBundle = {
      repoPath: "/tmp/repo",
      baselineRef: "HEAD",
      candidateSource: { kind: "patchFile", value: "/patches/fix.patch" },
      reproduceCommands: ["cargo test buggy_test"],
      verificationCommands: ["cargo test", "cargo clippy"],
      reviewInstructions: "Validate the patch fixes the regression.",
      approvalRequired: false,
    };

    const spec = buildPatchValidationHarnessSpec(bundle);

    expect(spec.name).toBe("patch-validation");

    const nodeKinds = spec.graph.nodes.map(n => n.kind);
    expect(nodeKinds).not.toContain("merge");

    const nodeIds = spec.graph.nodes.map(n => n.id);
    for (const terminal of ALWAYS_PRESENT_TERMINAL_IDS) {
      expect(nodeIds).toContain(terminal);
    }
    for (const terminal of APPROVAL_ONLY_TERMINAL_IDS) {
      expect(nodeIds).not.toContain(terminal);
    }
  });

  it("includes a human gate node when approvalRequired is true", () => {
    const bundle: LocalPatchValidationBundle = {
      repoPath: "/tmp/repo",
      baselineRef: "HEAD",
      candidateSource: { kind: "branch", value: "fix/bug-123" },
      reproduceCommands: ["npm test"],
      verificationCommands: ["npm test"],
      reviewInstructions: "Review required.",
      approvalRequired: true,
    };

    const spec = buildPatchValidationHarnessSpec(bundle);
    const humanNodes = spec.graph.nodes.filter(n => n.kind === "human");
    expect(humanNodes.length).toBeGreaterThanOrEqual(1);
  });

  it("omits the human gate node when approvalRequired is false", () => {
    const bundle: LocalPatchValidationBundle = {
      repoPath: "/tmp/repo",
      baselineRef: "HEAD",
      candidateSource: { kind: "patchFile", value: "/patches/fix.patch" },
      reproduceCommands: ["npm test"],
      verificationCommands: ["npm test"],
      reviewInstructions: "No human review.",
      approvalRequired: false,
    };

    const spec = buildPatchValidationHarnessSpec(bundle);
    const humanNodes = spec.graph.nodes.filter(n => n.kind === "human");
    expect(humanNodes).toHaveLength(0);
  });

  it("has a linear edge chain with no merge node (serial ordering)", () => {
    const bundle: LocalPatchValidationBundle = {
      repoPath: "/tmp/repo",
      baselineRef: "HEAD",
      candidateSource: { kind: "branch", value: "fix/bug-123" },
      reproduceCommands: ["npm test"],
      verificationCommands: ["npm test"],
      reviewInstructions: "Approve.",
      approvalRequired: false,
    };

    const spec = buildPatchValidationHarnessSpec(bundle);

    // No merge nodes — the workflow must be serial
    const mergeNodes = spec.graph.nodes.filter(n => n.kind === "merge");
    expect(mergeNodes).toHaveLength(0);

    // No fan-in: no node should appear as an edge target more than once
    const edgeTargets = spec.graph.edges.map(e => e.to);
    const targetCounts = new Map<string, number>();
    for (const t of edgeTargets) {
      targetCounts.set(t, (targetCounts.get(t) ?? 0) + 1);
    }
    for (const [nodeId, count] of targetCounts) {
      expect(count, `node ${nodeId} has ${count} incoming edges (fan-in detected)`).toBe(1);
    }
  });

  it("produces a spec that passes schema validation when approvalRequired is true", () => {
    const bundle: LocalPatchValidationBundle = {
      repoPath: "/tmp/repo",
      baselineRef: "HEAD",
      candidateSource: { kind: "branch", value: "fix/bug-123" },
      reproduceCommands: ["npm test"],
      verificationCommands: ["npm test"],
      reviewInstructions: "Approve.",
      approvalRequired: true,
    };

    const result = validateHarnessSpec(buildPatchValidationHarnessSpec(bundle));
    expect(result.valid, (result as any).errors?.join(", ")).toBe(true);
  });

  it("produces a spec that passes schema validation when approvalRequired is false", () => {
    const bundle: LocalPatchValidationBundle = {
      repoPath: "/tmp/repo",
      baselineRef: "HEAD",
      candidateSource: { kind: "patchFile", value: "/patches/fix.patch" },
      reproduceCommands: ["npm test"],
      verificationCommands: ["npm test"],
      reviewInstructions: "No approval.",
      approvalRequired: false,
    };

    const result = validateHarnessSpec(buildPatchValidationHarnessSpec(bundle));
    expect(result.valid, (result as any).errors?.join(", ")).toBe(true);
  });

  it("baseline reproduce tool guards the checkout so a bad ref fails fast", () => {
    const bundle: LocalPatchValidationBundle = {
      repoPath: "/tmp/repo",
      baselineRef: "HEAD",
      candidateSource: { kind: "branch", value: "fix/bug-123" },
      reproduceCommands: ["npm test"],
      verificationCommands: ["npm test"],
      reviewInstructions: "Approve.",
      approvalRequired: false,
    };

    const spec = buildPatchValidationHarnessSpec(bundle);
    const baselineNode = spec.graph.nodes.find(n => n.id === "run-baseline");
    expect(baselineNode).toBeDefined();
    expect(baselineNode!.kind).toBe("tool");
    const script = (baselineNode as any).args[1] as string;
    expect(script).toMatch(/git checkout.*\|\|\s*exit 1/);
  });

  it("apply candidate tool emits JSON failure payload when baseline checkout fails", () => {
    const bundle: LocalPatchValidationBundle = {
      repoPath: "/tmp/repo",
      baselineRef: "HEAD",
      candidateSource: { kind: "patchFile", value: "/patches/fix.patch" },
      reproduceCommands: ["npm test"],
      verificationCommands: ["npm test"],
      reviewInstructions: "No approval.",
      approvalRequired: false,
    };

    const spec = buildPatchValidationHarnessSpec(bundle);
    const applyNode = spec.graph.nodes.find(n => n.id === "apply-candidate");
    expect(applyNode).toBeDefined();
    expect(applyNode!.kind).toBe("tool");
    const script = (applyNode as any).args[1] as string;
    expect(script).toMatch(/baseline checkout failed/);
    expect(script).toMatch(/"applied":false/);
  });

  it("summarise node prompt requests only a summary, not an approved field", () => {
    const bundle: LocalPatchValidationBundle = {
      repoPath: "/tmp/repo",
      baselineRef: "HEAD",
      candidateSource: { kind: "branch", value: "fix/bug-123" },
      reproduceCommands: ["npm test"],
      verificationCommands: ["npm test"],
      reviewInstructions: "Review carefully.",
      approvalRequired: true,
    };

    const spec = buildPatchValidationHarnessSpec(bundle);
    const summariseNode = spec.graph.nodes.find(n => n.id === "summarise");
    expect(summariseNode).toBeDefined();
    expect(summariseNode!.kind).toBe("llm");
    const prompt = (summariseNode as any).prompt as string;
    expect(prompt).toMatch(/summary/i);
    expect(prompt).not.toMatch(/\bapproved\b/);
  });

  it("throws when reproduceCommands is empty", () => {
    const bundle: LocalPatchValidationBundle = {
      repoPath: "/tmp/repo",
      baselineRef: "HEAD",
      candidateSource: { kind: "branch", value: "fix/bug-123" },
      reproduceCommands: [],
      verificationCommands: ["npm test"],
      reviewInstructions: "Approve.",
      approvalRequired: false,
    };

    expect(() => buildPatchValidationHarnessSpec(bundle)).toThrow(
      "Patch validation requires at least one reproduce command",
    );
  });

  it("human approval prompt explicitly references the prior summarise step output", () => {
    const bundle: LocalPatchValidationBundle = {
      repoPath: "/tmp/repo",
      baselineRef: "HEAD",
      candidateSource: { kind: "branch", value: "fix/bug-123" },
      reproduceCommands: ["npm test"],
      verificationCommands: ["npm test"],
      reviewInstructions: "Approve only if regression-free.",
      approvalRequired: true,
    };

    const spec = buildPatchValidationHarnessSpec(bundle);
    const humanNode = spec.graph.nodes.find(n => n.id === "human-approve");
    expect(humanNode).toBeDefined();
    expect(humanNode!.kind).toBe("human");
    const prompt = (humanNode as any).prompt as string;
    expect(prompt).toMatch(/summarise/);
    expect(prompt).toMatch(/summarise\.summary/);
  });

  it("throws when verificationCommands is empty", () => {
    const bundle: LocalPatchValidationBundle = {
      repoPath: "/tmp/repo",
      baselineRef: "HEAD",
      candidateSource: { kind: "branch", value: "fix/bug-123" },
      reproduceCommands: ["npm test"],
      verificationCommands: [],
      reviewInstructions: "Approve.",
      approvalRequired: false,
    };

    expect(() => buildPatchValidationHarnessSpec(bundle)).toThrow(
      "Patch validation requires at least one verification command",
    );
  });
});

describe("buildPatchValidationHarnessSpec compiled workflow", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("runs to validated-fix when a branch candidate fixes the bug", async () => {
    const fixture = createPatchValidationFixture();
    cleanups.push(fixture.cleanup);

    const spec = buildPatchValidationHarnessSpec(fixture.bundle);
    const compiled = compileHarnessSpec(spec);
    const result = await runCompiledWorkflow(compiled, fixture.bundle, {});

    expect(result.status).toBe("completed");
    expect(result.terminalNodeId).toBe("validated-fix");

    const baselineOutput = result.outputs["run-baseline"] as { reproduced: boolean };
    expect(baselineOutput.reproduced).toBe(true);

    const candidateOutput = result.outputs["run-candidate-reproduce"] as { reproduced: boolean };
    expect(candidateOutput.reproduced).toBe(false);

    const verificationOutput = result.outputs["run-verification"] as { passed: boolean };
    expect(verificationOutput.passed).toBe(true);
  });

  it("runs to validated-fix when a patch-file candidate fixes the bug", async () => {
    const fixture = createPatchValidationFixture({ candidateKind: "patchFile" });
    cleanups.push(fixture.cleanup);

    const spec = buildPatchValidationHarnessSpec(fixture.bundle);
    const compiled = compileHarnessSpec(spec);
    const result = await runCompiledWorkflow(compiled, fixture.bundle, {});

    expect(result.status).toBe("completed");
    expect(result.terminalNodeId).toBe("validated-fix");

    const baselineOutput = result.outputs["run-baseline"] as { reproduced: boolean };
    expect(baselineOutput.reproduced).toBe(true);

    const candidateOutput = result.outputs["run-candidate-reproduce"] as { reproduced: boolean };
    expect(candidateOutput.reproduced).toBe(false);

    const verificationOutput = result.outputs["run-verification"] as { passed: boolean };
    expect(verificationOutput.passed).toBe(true);
  });
});
