import type { CirNode, CirVerificationHook } from "../cir/types.js";
import { evaluateConditionExpression, type ExecutionState, type VerificationOutcome } from "../compiler/runtime-helpers.js";
import type { WorkflowContext, YieldItem } from "pi-duroxide";

export type VerificationStrategy = "all-must-pass" | "first-pass" | "any-block";

export interface VerificationReport {
  nodeId: string;
  hookResults: Array<{
    hook: CirVerificationHook;
    outcome: VerificationOutcome;
    durationMs: number;
  }>;
  overallStatus: "pass" | "warn" | "block";
}

export function isVerificationSuccess(result: unknown): boolean {
  if (typeof result === "boolean") {
    return result;
  }

  const signal = resolveBooleanSignal(result);
  if (signal !== undefined) {
    return signal;
  }

  return Boolean(result);
}

export function interpretVerificationResult(
  hook: CirVerificationHook,
  verifierResult: unknown,
): VerificationOutcome {
  if (isVerificationSuccess(verifierResult)) {
    return { status: "pass" };
  }

  switch (hook.onFail) {
    case "warn":
      return { status: "warn", hook };
    case "block":
      return {
        status: "block",
        hook,
        message: `Verification failed via ${hook.checkNodeId}`,
      };
    case "retry":
      return {
        status: "retry",
        hook,
        maxAttempts: hook.maxAttempts ?? 2,
      };
  }
}

export function* runVerification(
  nodeId: string,
  hooks: CirVerificationHook[],
  nodeMap: Map<string, CirNode>,
  state: ExecutionState,
  ctx: WorkflowContext,
  strategy: VerificationStrategy = "all-must-pass",
): Generator<YieldItem, VerificationReport, unknown> {
  const hookResults: VerificationReport["hookResults"] = [];

  if (!hooks || hooks.length === 0) {
    return { nodeId, hookResults: [], overallStatus: "pass" };
  }

  let terminalOutcome: VerificationOutcome | undefined;

  for (const hook of hooks) {
    const verifierNode = getNode(nodeMap, hook.checkNodeId);
    const startTimeMs = Date.now();
    let verifierOutput: unknown;

    if (hook.kind === "expression") {
      if (verifierNode.kind !== "condition") {
        throw new Error(`Expression verification ${hook.checkNodeId} must reference a condition node`);
      }
      verifierOutput = evaluateConditionExpression(verifierNode.action.conditionExpr, state);
      state.outputs[verifierNode.id] = {
        evaluated: true,
        result: verifierOutput,
        expression: verifierNode.action.conditionExpr,
      };
    } else {
      if (verifierNode.kind === "condition" || verifierNode.kind === "merge") {
        throw new Error(`Verification node ${verifierNode.id} is not directly executable`);
      }
      verifierOutput = yield createVerificationYieldItem(ctx, verifierNode);
      state.outputs[verifierNode.id] = verifierOutput;
    }

    const durationMs = Date.now() - startTimeMs;
    const outcome = interpretVerificationResult(hook, verifierOutput);
    hookResults.push({ hook, outcome, durationMs });

    const earlyExit = shouldStopEarly(outcome, strategy);
    if (earlyExit) {
      terminalOutcome = outcome;
      break;
    }
  }

  const overallStatus = terminalOutcome
    ? terminalOutcome.status === "block" || terminalOutcome.status === "retry" ? "block" : "pass"
    : computeFinalStatus(hookResults);

  return { nodeId, hookResults, overallStatus };
}

function shouldStopEarly(outcome: VerificationOutcome, strategy: VerificationStrategy): boolean {
  switch (strategy) {
    case "all-must-pass":
      return outcome.status === "block" || outcome.status === "retry";
    case "first-pass":
      return outcome.status === "pass";
    case "any-block":
      return outcome.status === "block" || outcome.status === "retry";
  }
}

function computeFinalStatus(hookResults: VerificationReport["hookResults"]): VerificationReport["overallStatus"] {
  const hasBlock = hookResults.some(r => r.outcome.status === "block");
  if (hasBlock) return "block";

  return "pass";
}

function createVerificationYieldItem(
  ctx: WorkflowContext,
  node: Exclude<CirNode, { kind: "condition" | "merge" }>,
): YieldItem {
  switch (node.kind) {
    case "tool":
      return ctx.pi.tool("bash", {
        command: buildShellCommand(node.action.tool, node.action.args, node.action.cwd, node.action.env),
        description: `Lasso verification node ${node.id}`,
      });
    case "llm": {
      const messages = [];
      if (node.action.system) {
        messages.push({
          role: "system",
          content: [{ type: "text", text: node.action.system }],
        });
      }
      messages.push({
        role: "user",
        content: [{ type: "text", text: node.action.prompt }],
      });
      return ctx.pi.llm(messages, {
        model: node.action.model,
      });
    }
    case "human":
      return ctx.waitForEvent(`lasso:verification:${node.id}`);
    case "subworkflow":
      return ctx.scheduleSubOrchestration(node.action.specRef, node.action.inputs ?? {});
  }
}

function buildShellCommand(
  tool: string,
  args: string[],
  cwd?: string,
  env?: Record<string, string>,
): string {
  const baseCommand = [tool, ...args].map(shellQuote).join(" ");
  const envPrefix =
    env && Object.keys(env).length > 0
      ? `env ${Object.entries(env)
          .map(([key, value]) => `${validateEnvironmentVariableName(key)}=${shellQuote(value)}`)
          .join(" ")} `
      : "";
  const command = `${envPrefix}${baseCommand}`.trim();

  if (!cwd) {
    return command;
  }

  return `cd ${shellQuote(cwd)} && ${command}`;
}

function getNode(nodeMap: Map<string, CirNode>, nodeId: string): CirNode {
  const node = nodeMap.get(nodeId);
  if (!node) {
    throw new Error(`Verification node ${nodeId} not found in node map`);
  }
  return node;
}

function resolveBooleanSignal(value: unknown): boolean | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const flags = ["passed", "ok", "success", "approved"]
    .filter(key => typeof record[key] === "boolean")
    .map(key => ({ key, value: record[key] as boolean }));

  if (flags.length === 0) {
    return undefined;
  }

  const uniqueValues = new Set(flags.map(flag => flag.value));
  if (uniqueValues.size > 1) {
    throw new Error(`Ambiguous boolean status fields: ${flags.map(flag => flag.key).join(", ")}`);
  }

  return flags[0]?.value;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function validateEnvironmentVariableName(key: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`Invalid environment variable name: ${key}`);
  }

  return key;
}
