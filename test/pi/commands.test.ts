import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", () => ({
  randomUUID: () => "instance-123",
}));

vi.mock("../../src/reference/catalog.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/reference/catalog.js")>();
  return {
    ...mod,
    buildReferenceHarnessSpec: vi.fn(),
  };
});

vi.mock("../../src/compiler/compile.js", () => ({
  compileHarnessSpec: vi.fn(),
}));

vi.mock("../../src/planner/synthesize.js", () => ({
  planWorkflowRequest: vi.fn(),
}));

vi.mock("../../src/replanner/synthesize.js", () => ({
  parseReplanRequest: vi.fn(),
  replanWorkflowRequest: vi.fn(),
}));

import { compileHarnessSpec } from "../../src/compiler/compile.js";
import { planWorkflowRequest } from "../../src/planner/synthesize.js";
import { parseReplanRequest, replanWorkflowRequest } from "../../src/replanner/synthesize.js";
import { buildReferenceHarnessSpec } from "../../src/reference/catalog.js";
import { createLassoCommands, clearCompiledHarnesses } from "../../src/pi/commands.js";

describe("Lasso pi commands", () => {
  const prBundle = {
    repoPath: "/tmp/repo",
    sourceBranch: "feature/pr-change",
    targetBranch: "main",
    reviewInstructions: "Review carefully.",
    verificationCommands: ['node -e "process.exit(0)"'],
  };

  const patchRequest = {
    workflow: "patch-validation",
    input: {
      repoPath: "/tmp/repo",
      baselineRef: "HEAD",
      candidateSource: { kind: "branch", value: "fix/bug-123" },
      reproduceCommands: ["npm test -- failing.spec.ts"],
      verificationCommands: ["npm test"],
      reviewInstructions: "Approve only if the bug reproduces on baseline and all checks pass on the candidate.",
      approvalRequired: true,
    },
  };

  const replanInput = {
    workflow: "patch-validation" as const,
    originalRequest: patchRequest,
    observedOutcome: {
      terminalNodeId: "validated-fix" as const,
      notes: ["prod hotfix"],
    },
  };

  const prSpec = { name: "pr-review-merge", graph: { entryNodeId: "start", nodes: [], edges: [] } };
  const patchSpec = { name: "patch-validation", graph: { entryNodeId: "run-baseline", nodes: [], edges: [] } };

  const prCompiled = {
    name: "pr-review-merge",
    spec: prSpec,
    cir: { name: "pr-review-merge", entryNodeId: "start", nodes: [], transitions: [] },
    workflows: [],
    register: vi.fn(),
  };

  const patchCompiled = {
    name: "patch-validation",
    spec: patchSpec,
    cir: { name: "patch-validation", entryNodeId: "run-baseline", nodes: [], transitions: [] },
    workflows: [],
    register: vi.fn(),
  };

  beforeEach(() => {
    clearCompiledHarnesses();
    vi.mocked(buildReferenceHarnessSpec).mockReset();
    vi.mocked(compileHarnessSpec).mockReset();
    vi.mocked(planWorkflowRequest).mockReset();
    vi.mocked(parseReplanRequest).mockReset();
    vi.mocked(replanWorkflowRequest).mockReset();
    vi.mocked(buildReferenceHarnessSpec).mockReturnValue(prSpec as any);
    vi.mocked(compileHarnessSpec).mockReturnValue(prCompiled as any);
    prCompiled.register.mockReset();
    patchCompiled.register.mockReset();
  });

  it("creates compile, run, inspect, plan, and replan commands", () => {
    const commands = createLassoCommands(createMockRegistry() as any);

    expect(commands.map(command => command.name)).toEqual([
      "lasso:compile",
      "lasso:run",
      "lasso:inspect",
      "lasso:plan",
      "lasso:replan",
    ]);
  });

  it("compile command routes legacy raw LocalPrBundle to the pr-review-merge builder", async () => {
    const commands = createLassoCommands(createMockRegistry() as any);
    const compileCommand = commands.find(command => command.name === "lasso:compile");
    const ctx = createCommandContext();

    await compileCommand?.handler(JSON.stringify(prBundle), ctx as any);

    expect(buildReferenceHarnessSpec).toHaveBeenCalledWith({ workflow: "pr-review-merge", input: prBundle });
    expect(compileHarnessSpec).toHaveBeenCalledWith(prSpec);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Compiled `pr-review-merge`"), "info");
  });

  it("compile command routes explicit patch-validation envelope to the patch-validation builder", async () => {
    vi.mocked(buildReferenceHarnessSpec).mockReturnValue(patchSpec as any);
    vi.mocked(compileHarnessSpec).mockReturnValue(patchCompiled as any);

    const commands = createLassoCommands(createMockRegistry() as any);
    const compileCommand = commands.find(command => command.name === "lasso:compile");
    const ctx = createCommandContext();

    await compileCommand?.handler(JSON.stringify(patchRequest), ctx as any);

    expect(buildReferenceHarnessSpec).toHaveBeenCalledWith(patchRequest);
    expect(compileHarnessSpec).toHaveBeenCalledWith(patchSpec);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Compiled `patch-validation`"), "info");
  });

  it("run command compiles, registers, and starts the pr-review-merge workflow from a legacy bundle", async () => {
    const registry = createMockRegistry();
    const commands = createLassoCommands(registry as any);
    const runCommand = commands.find(command => command.name === "lasso:run");
    const ctx = createCommandContext();

    await runCommand?.handler(JSON.stringify(prBundle), ctx as any);

    expect(buildReferenceHarnessSpec).toHaveBeenCalledWith({ workflow: "pr-review-merge", input: prBundle });
    expect(compileHarnessSpec).toHaveBeenCalledWith(prSpec);
    expect(prCompiled.register).toHaveBeenCalledWith();
    expect(registry.client.startOrchestration).toHaveBeenCalledWith("instance-123", "pr-review-merge", {});
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Started `pr-review-merge`"), "info");
  });

  it("run command compiles, registers, and starts a patch-validation workflow", async () => {
    vi.mocked(buildReferenceHarnessSpec).mockReturnValue(patchSpec as any);
    vi.mocked(compileHarnessSpec).mockReturnValue(patchCompiled as any);

    const registry = createMockRegistry();
    const commands = createLassoCommands(registry as any);
    const runCommand = commands.find(command => command.name === "lasso:run");
    const ctx = createCommandContext();

    await runCommand?.handler(JSON.stringify(patchRequest), ctx as any);

    expect(buildReferenceHarnessSpec).toHaveBeenCalledWith(patchRequest);
    expect(patchCompiled.register).toHaveBeenCalledWith();
    expect(registry.client.startOrchestration).toHaveBeenCalledWith("instance-123", "patch-validation", {});
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Started `patch-validation`"), "info");
  });

  it("inspect command prints the spec, cir, and workflow state", async () => {
    const registry = createMockRegistry();
    const commands = createLassoCommands(registry as any);
    const compileCommand = commands.find(command => command.name === "lasso:compile");
    const inspectCommand = commands.find(command => command.name === "lasso:inspect");
    const ctx = createCommandContext();

    await compileCommand?.handler(JSON.stringify(prBundle), ctx as any);
    await inspectCommand?.handler("pr-review-merge", ctx as any);

    expect(registry.client.listAllInstances).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("### Lasso Workflow `pr-review-merge`"),
      "info",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining('"name": "pr-review-merge"'),
      "info",
    );
  });

  it("compile command reports malformed JSON cleanly", async () => {
    const commands = createLassoCommands(createMockRegistry() as any);
    const compileCommand = commands.find(command => command.name === "lasso:compile");
    const ctx = createCommandContext();

    await compileCommand?.handler("{not-json", ctx as any);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Invalid workflow request JSON", "error");
  });

  it("compile command reports malformed patch-validation envelope cleanly", async () => {
    const commands = createLassoCommands(createMockRegistry() as any);
    const compileCommand = commands.find(command => command.name === "lasso:compile");
    const ctx = createCommandContext();

    await compileCommand?.handler(JSON.stringify({ workflow: "patch-validation", input: {} }), ctx as any);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Invalid patch-validation input", "error");
  });

  it("plan command renders a draft request without compiling or running anything", async () => {
    vi.mocked(planWorkflowRequest).mockReturnValue({
      status: "draft_request",
      workflow: "patch-validation",
      request: patchRequest as any,
      rationale: ["Classified as patch-validation workflow", "Baseline: HEAD"],
      warnings: ["approvalRequired not specified; defaulting to false"],
    });

    const commands = createLassoCommands(createMockRegistry() as any);
    const planCommand = commands.find(command => command.name === "lasso:plan");
    const ctx = createCommandContext();
    const brief = "Validate the fix in /tmp/repo against HEAD";

    await planCommand?.handler(brief, ctx as any);

    expect(planWorkflowRequest).toHaveBeenCalledWith(brief);
    expect(buildReferenceHarnessSpec).not.toHaveBeenCalled();
    expect(compileHarnessSpec).not.toHaveBeenCalled();

    const [message, level] = ctx.ui.notify.mock.calls[0];
    expect(level).toBe("info");
    expect(message).toContain("### Planner Draft `patch-validation`");
    expect(message).toContain("#### Rationale");
    expect(message).toContain("#### Warnings");
    expect(message).toContain("```json");
    expect(message).toContain('"workflow": "patch-validation"');
    expect(message).toContain("/lasso:compile");
    expect(message).toContain("/lasso:run");
  });

  it("plan command renders clarification output without emitting partial JSON", async () => {
    vi.mocked(planWorkflowRequest).mockReturnValue({
      status: "needs_clarification",
      candidateWorkflow: "pr-review-merge",
      reasons: ["PR review/merge workflow requires: repoPath, verificationCommands"],
      missingFields: ["repoPath", "verificationCommands"],
      guidance: ["Provide repoPath", "Provide verificationCommands"],
    });

    const commands = createLassoCommands(createMockRegistry() as any);
    const planCommand = commands.find(command => command.name === "lasso:plan");
    const ctx = createCommandContext();

    await planCommand?.handler("Review and merge this branch", ctx as any);

    expect(planWorkflowRequest).toHaveBeenCalledWith("Review and merge this branch");
    expect(buildReferenceHarnessSpec).not.toHaveBeenCalled();
    expect(compileHarnessSpec).not.toHaveBeenCalled();

    const [message, level] = ctx.ui.notify.mock.calls[0];
    expect(level).toBe("info");
    expect(message).toContain("### Planner Needs Clarification");
    expect(message).toContain("Likely workflow: `pr-review-merge`");
    expect(message).toContain("#### Missing Fields");
    expect(message).toContain("repoPath");
    expect(message).toContain("verificationCommands");
    expect(message).not.toContain("```json");
  });

  it("plan command reports usage for an empty brief", async () => {
    const commands = createLassoCommands(createMockRegistry() as any);
    const planCommand = commands.find(command => command.name === "lasso:plan");
    const ctx = createCommandContext();

    await planCommand?.handler("   ", ctx as any);

    expect(planWorkflowRequest).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /lasso:plan <freeform brief>", "error");
  });

  it("plan command reports unexpected planner failures cleanly", async () => {
    vi.mocked(planWorkflowRequest).mockImplementation(() => {
      throw new Error("Internal planner error");
    });

    const commands = createLassoCommands(createMockRegistry() as any);
    const planCommand = commands.find(command => command.name === "lasso:plan");
    const ctx = createCommandContext();

    await planCommand?.handler("Review and merge this branch", ctx as any);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Internal planner error", "error");
  });

  it("replan command renders a revised draft request without compiling or running anything", async () => {
    vi.mocked(parseReplanRequest).mockReturnValue(replanInput);
    vi.mocked(replanWorkflowRequest).mockReturnValue({
      status: "draft_request",
      workflow: "patch-validation",
      request: {
        workflow: "patch-validation",
        input: {
          ...patchRequest.input,
          approvalRequired: true,
        },
      },
      trigger: "risk-escalation",
      riskLevel: "high",
      rationale: ["Patch-file candidates are treated as high risk for adaptive replanning."],
      warnings: [],
      changes: ["approvalRequired: false -> true"],
    });

    const commands = createLassoCommands(createMockRegistry() as any);
    const replanCommand = commands.find(command => command.name === "lasso:replan");
    const ctx = createCommandContext();
    const requestJson = JSON.stringify(replanInput);

    await replanCommand?.handler(requestJson, ctx as any);

    expect(parseReplanRequest).toHaveBeenCalledWith(requestJson);
    expect(replanWorkflowRequest).toHaveBeenCalledWith(replanInput);
    expect(buildReferenceHarnessSpec).not.toHaveBeenCalled();
    expect(compileHarnessSpec).not.toHaveBeenCalled();

    const [message, level] = ctx.ui.notify.mock.calls[0];
    expect(level).toBe("info");
    expect(message).toContain("### Replan Draft `patch-validation`");
    expect(message).toContain("Trigger: `risk-escalation`");
    expect(message).toContain("Risk level: `high`");
    expect(message).toContain("#### Changes");
    expect(message).toContain("approvalRequired: false -> true");
    expect(message).toContain("```json");
    expect(message).toContain('"workflow": "patch-validation"');
    expect(message).toContain("/lasso:compile");
    expect(message).toContain("/lasso:run");
  });

  it("replan command renders operator-input guidance without emitting partial JSON", async () => {
    vi.mocked(parseReplanRequest).mockReturnValue(replanInput);
    vi.mocked(replanWorkflowRequest).mockReturnValue({
      status: "needs_operator_input",
      candidateWorkflow: "pr-review-merge",
      riskLevel: "medium",
      reasons: ["Verification failed before merge."],
      missingFields: ["sourceBranch", "verificationCommands"],
      guidance: ["Update the branch", "Review the verification commands"],
    });

    const commands = createLassoCommands(createMockRegistry() as any);
    const replanCommand = commands.find(command => command.name === "lasso:replan");
    const ctx = createCommandContext();

    await replanCommand?.handler(JSON.stringify(replanInput), ctx as any);

    const [message, level] = ctx.ui.notify.mock.calls[0];
    expect(level).toBe("info");
    expect(message).toContain("### Replan Needs Operator Input");
    expect(message).toContain("Likely workflow: `pr-review-merge`");
    expect(message).toContain("Risk level: `medium`");
    expect(message).toContain("#### Missing Fields");
    expect(message).not.toContain("```json");
  });

  it("replan command renders stop output without emitting partial JSON", async () => {
    vi.mocked(parseReplanRequest).mockReturnValue(replanInput);
    vi.mocked(replanWorkflowRequest).mockReturnValue({
      status: "stop",
      workflow: "patch-validation",
      riskLevel: "high",
      reasons: ["The previous attempt was rejected by a human reviewer."],
      guidance: ["Review the candidate manually before retrying."],
    });

    const commands = createLassoCommands(createMockRegistry() as any);
    const replanCommand = commands.find(command => command.name === "lasso:replan");
    const ctx = createCommandContext();

    await replanCommand?.handler(JSON.stringify(replanInput), ctx as any);

    const [message, level] = ctx.ui.notify.mock.calls[0];
    expect(level).toBe("info");
    expect(message).toContain("### Replan Stop");
    expect(message).toContain("Workflow: `patch-validation`");
    expect(message).toContain("Risk level: `high`");
    expect(message).not.toContain("```json");
  });

  it("replan command reports usage for an empty request", async () => {
    const commands = createLassoCommands(createMockRegistry() as any);
    const replanCommand = commands.find(command => command.name === "lasso:replan");
    const ctx = createCommandContext();

    await replanCommand?.handler("   ", ctx as any);

    expect(parseReplanRequest).not.toHaveBeenCalled();
    expect(replanWorkflowRequest).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /lasso:replan <replan request JSON>", "error");
  });

  it("replan command reports malformed replan JSON cleanly", async () => {
    vi.mocked(parseReplanRequest).mockImplementation(() => {
      throw new Error("Invalid replan request JSON");
    });

    const commands = createLassoCommands(createMockRegistry() as any);
    const replanCommand = commands.find(command => command.name === "lasso:replan");
    const ctx = createCommandContext();

    await replanCommand?.handler("{not-json", ctx as any);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Invalid replan request JSON", "error");
  });
});

function createMockRegistry() {
  const client = {
    startOrchestration: vi.fn().mockResolvedValue(undefined),
    listAllInstances: vi.fn().mockResolvedValue([
      { instanceId: "instance-123", name: "pr-review-merge", status: "Running" },
    ]),
  };

  return {
    client,
    getRuntime: () => ({
      getClient: () => client,
      isRunning: () => true,
    }),
  };
}

function createCommandContext() {
  return {
    pi: {},
    ui: {
      notify: vi.fn(),
    },
  };
}
