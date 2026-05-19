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

import { compileHarnessSpec } from "../../src/compiler/compile.js";
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
    vi.mocked(buildReferenceHarnessSpec).mockReturnValue(prSpec as any);
    vi.mocked(compileHarnessSpec).mockReturnValue(prCompiled as any);
    prCompiled.register.mockReset();
    patchCompiled.register.mockReset();
  });

  it("creates compile, run, and inspect commands", () => {
    const commands = createLassoCommands(createMockRegistry() as any);

    expect(commands.map(command => command.name)).toEqual([
      "lasso:compile",
      "lasso:run",
      "lasso:inspect",
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
