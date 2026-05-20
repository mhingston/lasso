import { randomUUID } from "node:crypto";
import type { RegisteredCommand, SourceInfo } from "@mariozechner/pi-coding-agent";
import { type WorkflowRegistry } from "pi-duroxide";
import { compileHarnessSpec, type CompiledHarnessWorkflow } from "../compiler/compile.js";
import { planWorkflowRequest } from "../planner/synthesize.js";
import type { PlannerResult } from "../planner/types.js";
import { parseReplanRequest, replanWorkflowRequest } from "../replanner/synthesize.js";
import type { ReplanResult } from "../replanner/types.js";
import { buildReferenceHarnessSpec, parseWorkflowRequest, type ReferenceWorkflowRequest } from "../reference/catalog.js";

const compiledHarnesses = new Map<string, CompiledHarnessWorkflow>();
let lastCompiledHarnessName: string | undefined;

export function createLassoCommands(registry: WorkflowRegistry): RegisteredCommand[] {
  const compileCommand: RegisteredCommand = {
    name: "lasso:compile",
    sourceInfo: extSourceInfo(),
    description: "Compile the simulated/local PR review + merge reference workflow from a LocalPrBundle JSON payload.",
    handler: async (args, ctx) => {
      try {
        const request = parseRequestArgs(args);
        const compiled = compileReferenceHarness(request);
        ctx.ui.notify(
          [
            `Compiled \`${compiled.name}\``,
            `- spec nodes: ${compiled.spec.graph.nodes.length}`,
            `- cir nodes: ${compiled.cir.nodes.length}`,
            `- registered workflows: ${compiled.workflows.length}`,
          ].join("\n"),
          "info",
        );
      } catch (error) {
        ctx.ui.notify(formatCommandError(error), "error");
      }
    },
  };

  const runCommand: RegisteredCommand = {
    name: "lasso:run",
    sourceInfo: extSourceInfo(),
    description: "Compile, register, and start the simulated/local PR review + merge workflow from a LocalPrBundle JSON payload.",
    handler: async (args, ctx) => {
      try {
        const request = parseRequestArgs(args);
        const compiled = compileReferenceHarness(request);
        compiled.register();

        const runtime = registry.getRuntime();
        if (!runtime) {
          ctx.ui.notify("Workflow runtime not available", "error");
          return;
        }

        const client = runtime.getClient();
        if (!client) {
          ctx.ui.notify("Workflow runtime not started", "error");
          return;
        }

        const instanceId = randomUUID();
        await client.startOrchestration(instanceId, compiled.name, {});
        ctx.ui.notify(`Started \`${compiled.name}\` (${instanceId})`, "info");
      } catch (error) {
        ctx.ui.notify(formatCommandError(error), "error");
      }
    },
  };

  const inspectCommand: RegisteredCommand = {
    name: "lasso:inspect",
    sourceInfo: extSourceInfo(),
    description: "Show the compiled spec, CIR, and workflow runtime state for the latest or named Lasso workflow.",
    handler: async (args, ctx) => {
      try {
        const name = args.trim() || lastCompiledHarnessName;
        if (!name) {
          ctx.ui.notify("No compiled Lasso workflow available. Run /lasso:compile or /lasso:run first.", "error");
          return;
        }

        const compiled = compiledHarnesses.get(name);
        if (!compiled) {
          ctx.ui.notify(`No compiled Lasso workflow named \`${name}\` is available.`, "error");
          return;
        }

        const runtime = registry.getRuntime();
        const client = runtime?.getClient();
        const instances = client ? await client.listAllInstances() : [];
        const matchingInstances = instances.filter(instance => {
          const record = instance as { name?: string };
          return !record.name || record.name === compiled.name;
        });

        ctx.ui.notify(
          [
            `### Lasso Workflow \`${compiled.name}\``,
            "",
            "#### Spec",
            "```json",
            JSON.stringify(compiled.spec, null, 2),
            "```",
            "",
            "#### CIR",
            "```json",
            JSON.stringify(compiled.cir, null, 2),
            "```",
            "",
            "#### Runtime State",
            "```json",
            JSON.stringify(matchingInstances, null, 2),
            "```",
          ].join("\n"),
          "info",
        );
      } catch (error) {
        ctx.ui.notify(formatCommandError(error), "error");
      }
    },
  };

  const planCommand: RegisteredCommand = {
    name: "lasso:plan",
    sourceInfo: extSourceInfo(),
    description: "Draft a reference workflow request envelope from a freeform brief without compiling or running it.",
    handler: async (args, ctx) => {
      try {
        if (!args.trim()) {
          ctx.ui.notify("Usage: /lasso:plan <freeform brief>", "error");
          return;
        }

        const result = planWorkflowRequest(args);
        ctx.ui.notify(renderPlannerResult(result), "info");
      } catch (error) {
        ctx.ui.notify(formatCommandError(error), "error");
      }
    },
  };

  const replanCommand: RegisteredCommand = {
    name: "lasso:replan",
    sourceInfo: extSourceInfo(),
    description: "Draft a revised workflow request from a prior request plus explicit outcome signals without compiling or running it.",
    handler: async (args, ctx) => {
      try {
        if (!args.trim()) {
          ctx.ui.notify("Usage: /lasso:replan <replan request JSON>", "error");
          return;
        }

        const request = parseReplanRequest(args);
        const result = replanWorkflowRequest(request);
        ctx.ui.notify(renderReplannerResult(result), "info");
      } catch (error) {
        ctx.ui.notify(formatCommandError(error), "error");
      }
    },
  };

  return [compileCommand, runCommand, inspectCommand, planCommand, replanCommand];
}

export function clearCompiledHarnesses(): void {
  compiledHarnesses.clear();
  lastCompiledHarnessName = undefined;
}

export function compileReferenceHarness(request: ReferenceWorkflowRequest): CompiledHarnessWorkflow {
  const spec = buildReferenceHarnessSpec(request);
  const compiled = compileHarnessSpec(spec);
  compiledHarnesses.set(compiled.name, compiled);
  lastCompiledHarnessName = compiled.name;
  return compiled;
}

function parseRequestArgs(args: string): ReferenceWorkflowRequest {
  return parseWorkflowRequest(args);
}

function extSourceInfo(): SourceInfo {
  return { path: "", source: "extension", scope: "temporary", origin: "top-level", baseDir: undefined };
}

function formatCommandError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function renderPlannerResult(result: PlannerResult): string {
  if (result.status === "draft_request") {
    const lines = [
      `### Planner Draft \`${result.workflow}\``,
      "",
      "#### Rationale",
      ...result.rationale.map(item => `- ${item}`),
    ];

    if (result.warnings.length > 0) {
      lines.push("", "#### Warnings", ...result.warnings.map(item => `- ${item}`));
    }

    lines.push(
      "",
      "#### Request JSON",
      "```json",
      JSON.stringify(result.request, null, 2),
      "```",
      "",
      "Next: pass this JSON into `/lasso:compile` or `/lasso:run` when you are ready.",
    );

    return lines.join("\n");
  }

  const lines = ["### Planner Needs Clarification"];

  if (result.candidateWorkflow) {
    lines.push("", `Likely workflow: \`${result.candidateWorkflow}\``);
  }

  lines.push("", "#### Reasons", ...result.reasons.map(item => `- ${item}`));

  if (result.missingFields.length > 0) {
    lines.push("", "#### Missing Fields", ...result.missingFields.map(item => `- ${item}`));
  }

  lines.push("", "#### Guidance", ...result.guidance.map(item => `- ${item}`));

  return lines.join("\n");
}

function renderReplannerResult(result: ReplanResult): string {
  if (result.status === "draft_request") {
    const lines = [
      `### Replan Draft \`${result.workflow}\``,
      "",
      `- Trigger: \`${result.trigger}\``,
      `- Risk level: \`${result.riskLevel}\``,
      "",
      "#### Rationale",
      ...result.rationale.map(item => `- ${item}`),
    ];

    if (result.warnings.length > 0) {
      lines.push("", "#### Warnings", ...result.warnings.map(item => `- ${item}`));
    }

    if (result.changes.length > 0) {
      lines.push("", "#### Changes", ...result.changes.map(item => `- ${item}`));
    }

    lines.push(
      "",
      "#### Request JSON",
      "```json",
      JSON.stringify(result.request, null, 2),
      "```",
      "",
      "Next: pass this JSON into `/lasso:compile` or `/lasso:run` when you are ready.",
    );

    return lines.join("\n");
  }

  if (result.status === "needs_operator_input") {
    const lines = ["### Replan Needs Operator Input"];

    if (result.candidateWorkflow) {
      lines.push("", `Likely workflow: \`${result.candidateWorkflow}\``);
    }

    lines.push(
      `Risk level: \`${result.riskLevel}\``,
      "",
      "#### Reasons",
      ...result.reasons.map(item => `- ${item}`),
    );

    if (result.missingFields.length > 0) {
      lines.push("", "#### Missing Fields", ...result.missingFields.map(item => `- ${item}`));
    }

    lines.push("", "#### Guidance", ...result.guidance.map(item => `- ${item}`));
    return lines.join("\n");
  }

  return [
    "### Replan Stop",
    "",
    `Workflow: \`${result.workflow}\``,
    `Risk level: \`${result.riskLevel}\``,
    "",
    "#### Reasons",
    ...result.reasons.map(item => `- ${item}`),
    "",
    "#### Guidance",
    ...result.guidance.map(item => `- ${item}`),
  ].join("\n");
}
