import type { CirFailureRoutingHint, CirNode, CirVerificationHook } from "../cir/types.js";
import type { WorkflowContext, YieldItem } from "pi-duroxide";
import { addFailure, updateMetrics } from "../state/snapshots.js";
import type { HarnessState } from "../state/types.js";

export type TracePhase =
  | "enter"
  | "success"
  | "failure"
  | "retry"
  | "verification-pass"
  | "verification-fail"
  | "merge"
  | "condition-true"
  | "condition-false";

export interface ExecutionTraceEntry {
  nodeId: string;
  source: CirNode["source"];
  phase: TracePhase;
  details?: Record<string, unknown>;
  startedAt?: number;
  completedAt?: number;
  inputSnapshot?: unknown;
  outputSnapshot?: unknown;
}

export interface ExecutionState {
  input: unknown;
  outputs: Record<string, unknown>;
  trace: ExecutionTraceEntry[];
  harnessState: HarnessState;
  startTimeMs: number;
  stepCount: number;
  estimatedCostUsd: number;
}

export interface GuardrailState {
  stepCount: number;
  estimatedCostUsd: number;
  maxSteps?: number;
  costLimitUsd?: number;
}

export interface GuardrailResult {
  withinLimits: boolean;
  reason?: string;
}

export class GuardrailExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardrailExceededError";
  }
}

export function checkGuardrails(state: GuardrailState): GuardrailResult {
  if (state.maxSteps !== undefined && state.stepCount >= state.maxSteps) {
    return {
      withinLimits: false,
      reason: `Step limit reached (${state.stepCount}/${state.maxSteps})`,
    };
  }

  if (state.costLimitUsd !== undefined && state.estimatedCostUsd > state.costLimitUsd) {
    return {
      withinLimits: false,
      reason: `Cost limit exceeded ($${state.estimatedCostUsd.toFixed(2)}/$${state.costLimitUsd.toFixed(2)})`,
    };
  }

  return { withinLimits: true };
}

export interface FailureClassificationResult {
  category: CirFailureRoutingHint["category"] | "permanent";
  retryable: boolean;
  matchedPattern?: string;
}

export type VerificationOutcome =
  | { status: "pass" }
  | { status: "warn"; hook: CirVerificationHook }
  | { status: "block"; hook: CirVerificationHook; message: string }
  | { status: "retry"; hook: CirVerificationHook; maxAttempts: number };

export function buildShellCommand(
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

export function evaluateConditionExpression(expression: string, state: ExecutionState): boolean {
  const trimmed = expression.trim();
  const negate = trimmed.startsWith("!");
  const path = negate ? trimmed.slice(1).trim() : trimmed;
  const value = resolveConditionValue(path, state);
  const result = normaliseBoolean(value);
  return negate ? !result : result;
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

export function classifyFailure(
  error: unknown,
  failureRouting: CirFailureRoutingHint[] | undefined,
): FailureClassificationResult {
  const message = getErrorMessage(error);

  if (failureRouting) {
    for (const hint of failureRouting) {
      if (message.includes(hint.pattern)) {
        return {
          category: hint.category,
          retryable: hint.retry,
          matchedPattern: hint.pattern,
        };
      }
    }
  }

  return {
    category: "permanent",
    retryable: false,
  };
}

export function computeRetryDelayMs(
  retryPolicy: NonNullable<CirNode["retry"]>,
  attemptNumber: number,
): number {
  const baseDelaySeconds = retryPolicy.initialDelay ?? 1;
  let delaySeconds = baseDelaySeconds;

  switch (retryPolicy.backoff) {
    case "constant":
      delaySeconds = baseDelaySeconds;
      break;
    case "linear":
      delaySeconds = baseDelaySeconds * attemptNumber;
      break;
    case "exponential":
      delaySeconds = baseDelaySeconds * 2 ** (attemptNumber - 1);
      break;
  }

  if (retryPolicy.maxDelay !== undefined) {
    delaySeconds = Math.min(delaySeconds, retryPolicy.maxDelay);
  }

  return delaySeconds * 1000;
}

export function shouldRetryFailure(
  retryPolicy: NonNullable<CirNode["retry"]>,
  classification: FailureClassificationResult,
): boolean {
  if (!classification.retryable) {
    return false;
  }

  if (!retryPolicy.retryOn || retryPolicy.retryOn.length === 0) {
    return true;
  }

  return retryPolicy.retryOn.includes(classification.category as "transient" | "resource");
}

export function recordTrace(
  ctx: WorkflowContext,
  state: ExecutionState,
  node: CirNode,
  phase: TracePhase,
  details?: Record<string, unknown>,
  inputSnapshot?: unknown,
  outputSnapshot?: unknown,
): void {
  const entry: ExecutionTraceEntry = {
    nodeId: node.id,
    source: node.source,
    phase,
    ...(details ? { details } : {}),
    ...(phase === "enter" ? { startedAt: Date.now() } : {}),
    ...(phase === "success" || phase === "failure" ? { completedAt: Date.now() } : {}),
    ...(inputSnapshot !== undefined ? { inputSnapshot: capSnapshot(inputSnapshot) } : {}),
    ...(outputSnapshot !== undefined ? { outputSnapshot: capSnapshot(outputSnapshot) } : {}),
  };

  state.trace.push(entry);
  ctx.setCustomStatus({
    currentNodeId: node.id,
    phase,
    trace: state.trace,
  });

  const message = `[lasso] ${node.id} ${phase}`;
  switch (phase) {
    case "failure":
    case "verification-fail":
      ctx.traceWarn(message);
      break;
    case "retry":
      ctx.traceInfo(message);
      break;
    default:
      ctx.traceDebug(message);
      break;
  }
}

const MAX_SNAPSHOT_BYTES = 1024;

function capSnapshot(value: unknown): unknown {
  const json = JSON.stringify(value);
  if (json.length <= MAX_SNAPSHOT_BYTES) {
    return value;
  }
  return json.slice(0, MAX_SNAPSHOT_BYTES) + "…(truncated)";
}

export function* runWithRetry<T>(
  ctx: WorkflowContext,
  state: ExecutionState,
  node: CirNode,
  executeAttempt: () => Generator<YieldItem, T, unknown>,
): Generator<YieldItem, T, unknown> {
  const maxAttempts = node.retry?.maxAttempts ?? 1;
  let attemptNumber = 1;

  while (true) {
    try {
      return yield* executeAttempt();
    } catch (error) {
      const classification = classifyFailure(error, node.failureRouting);
      const errorMessage = getErrorMessage(error);
      
      recordTrace(ctx, state, node, "failure", {
        attemptNumber,
        category: classification.category,
        message: errorMessage,
        ...(classification.matchedPattern ? { matchedPattern: classification.matchedPattern } : {}),
      });

      // Record normalized failure to harnessState
      const rootCause = mapClassificationToRootCause(classification, errorMessage);
      addFailure(state.harnessState, {
        domainType: "lasso",
        rootCause,
        nodeId: node.id,
        message: errorMessage,
      });

      if (!node.retry || attemptNumber >= maxAttempts || !shouldRetryFailure(node.retry, classification)) {
        throw error;
      }

      // Increment retry counter
      updateMetrics(state.harnessState, { 
        retries: state.harnessState.metrics.retries + 1,
      });

      const delayMs = computeRetryDelayMs(node.retry, attemptNumber);
      recordTrace(ctx, state, node, "retry", {
        nextAttempt: attemptNumber + 1,
        delayMs,
      });
      if (delayMs > 0) {
        yield ctx.scheduleTimer(delayMs);
      }
      attemptNumber += 1;
    }
  }
}

function mapClassificationToRootCause(
  classification: FailureClassificationResult,
  message: string,
): import("../failures/types.js").FailureRecord["rootCause"] {
  // Map CIR failure classification to normalized root causes
  if (classification.category === "transient") {
    if (message.toLowerCase().includes("timeout")) {
      return "tool_timeout";
    }
    if (message.toLowerCase().includes("rate limit")) {
      return "rate_limited";
    }
    return "unknown";
  }
  
  if (classification.category === "resource") {
    return "rate_limited";
  }
  
  // Permanent failures
  if (message.toLowerCase().includes("auth") || message.toLowerCase().includes("unauthorized")) {
    return "auth_required";
  }
  
  return "dependency_failure";
}

function resolveConditionValue(path: string, state: ExecutionState): unknown {
  const root = {
    input: state.input,
    outputs: state.outputs,
  };

  const directValue = tryResolvePath(root, path);
  if (directValue.found) {
    return directValue.value;
  }

  if (!path.startsWith("outputs.") && !path.startsWith("input.")) {
    const outputValue = tryResolvePath(root, `outputs.${path}`);
    if (outputValue.found) {
      return outputValue.value;
    }

    const inputValue = tryResolvePath(root, `input.${path}`);
    if (inputValue.found) {
      return inputValue.value;
    }
  }

  return undefined;
}

function tryResolvePath(root: Record<string, unknown>, path: string): { found: boolean; value: unknown } {
  const segments = path
    .split(".")
    .map(segment => segment.trim())
    .filter(Boolean);

  let current: unknown = root;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || !(segment in (current as Record<string, unknown>))) {
      return { found: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return { found: true, value: current };
}

function normaliseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  const signal = resolveBooleanSignal(value);
  if (signal !== undefined) {
    return signal;
  }

  return Boolean(value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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
