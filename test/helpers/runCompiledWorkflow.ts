import { execFileSync } from "node:child_process";
import type { CompiledHarnessResult, CompiledHarnessWorkflow } from "../../src/compiler/compile.js";

/** Minimal input shape required by the test runner — only `repoPath` is needed. */
export type WorkflowInput = unknown;

export interface RunCompiledWorkflowOptions {
  llmResult?: unknown;
  humanResponse?: unknown;
  maxContinuations?: number;
}

type YieldItem =
  | { kind: "tool-call"; name: string; args: { command: string } }
  | { kind: "llm-call"; messages: unknown[]; options?: unknown }
  | { kind: "wait-for-event"; eventName: string }
  | { kind: "subworkflow"; name: string; input: unknown }
  | { kind: "all"; tasks: YieldItem[] }
  | { kind: "timer"; delayMs: number };

export async function runCompiledWorkflow(
  compiled: CompiledHarnessWorkflow,
  input: WorkflowInput,
  options: RunCompiledWorkflowOptions,
): Promise<CompiledHarnessResult> {
  const maxContinuations = options.maxContinuations ?? 0;
  let currentInput: unknown = input;
  let continuationCount = 0;
  let lastResult: CompiledHarnessResult | undefined;

  while (continuationCount <= maxContinuations) {
    const context = createRuntimeContext(continuationCount < maxContinuations);
    const iterator = compiled.workflows[0].generator(context as any, currentInput);

    let next = iterator.next();
    let continuationTriggered = false;

    while (!next.done) {
      try {
        const resolved = executeYieldItem(next.value as YieldItem, currentInput, options, (nextInput) => {
          continuationTriggered = true;
          currentInput = nextInput;
        });
        next = iterator.next(resolved);
      } catch (error) {
        if (error instanceof ContinueAsNewError) {
          continuationTriggered = true;
          currentInput = error.input;
          break;
        }
        if (!iterator.throw) {
          throw error;
        }
        next = iterator.throw(error);
      }
    }

    if (!continuationTriggered) {
      return next.value;
    }

    lastResult = next.value;
    continuationCount++;
  }

  if (lastResult) {
    return lastResult;
  }

  throw new Error("Workflow did not complete");
}

class ContinueAsNewError extends Error {
  constructor(public input: unknown) {
    super("continueAsNew called");
  }
}

function createRuntimeContext(allowContinueAsNew: boolean = false) {
  return {
    scheduleActivity: () => {
      throw new Error("scheduleActivity is not used in reference workflow tests");
    },
    scheduleActivityWithRetry: () => {
      throw new Error("scheduleActivityWithRetry is not used in reference workflow tests");
    },
    scheduleTimer: (delayMs: number) => ({ kind: "timer", delayMs }),
    waitForEvent: (eventName: string) => ({ kind: "wait-for-event", eventName }),
    scheduleSubOrchestration: (name: string, input: unknown) => ({ kind: "subworkflow", name, input }),
    all: (tasks: YieldItem[]) => ({ kind: "all", tasks }),
    race: () => {
      throw new Error("race is not used in reference workflow tests");
    },
    utcNow: () => 0,
    newGuid: () => "guid-1",
    continueAsNew: (input: unknown) => {
      if (!allowContinueAsNew) {
        throw new Error("continueAsNew is not enabled in this test context");
      }
      throw new ContinueAsNewError(input);
    },
    setCustomStatus: () => {},
    traceInfo: () => {},
    traceWarn: () => {},
    traceError: () => {},
    traceDebug: () => {},
    kv: {
      get: () => undefined,
      set: () => undefined,
      clear: () => undefined,
    },
    pi: {
      tool: (name: string, args: { command: string }) => ({ kind: "tool-call", name, args }),
      llm: (messages: unknown[], options?: unknown) => ({ kind: "llm-call", messages, options }),
      skill: () => {
        throw new Error("skill is not used in reference workflow tests");
      },
      sendMessage: () => {
        throw new Error("sendMessage is not used in reference workflow tests");
      },
      prompt: () => {
        throw new Error("prompt is not used in reference workflow tests");
      },
    },
  };
}

function executeYieldItem(
  item: YieldItem,
  input: WorkflowInput,
  options: RunCompiledWorkflowOptions,
  onContinueAsNew?: (input: unknown) => void,
): unknown {
  switch (item.kind) {
    case "tool-call":
      return executeToolCall(item.name, item.args.command, resolveRepoPath(input));
    case "llm-call":
      return options.llmResult ?? { approved: true };
    case "wait-for-event":
      return options.humanResponse ?? { approved: true };
    case "subworkflow":
      return {
        name: item.name,
        input: item.input,
      };
    case "all":
      return item.tasks.map(task => executeYieldItem(task, input, options, onContinueAsNew));
    case "timer":
      return { delayMs: item.delayMs };
  }
}

function resolveRepoPath(input: WorkflowInput): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const record = input as Record<string, unknown>;
  if (typeof record.repoPath === "string") {
    return record.repoPath;
  }

  if (record.input && typeof record.input === "object") {
    const nested = record.input as Record<string, unknown>;
    if (typeof nested.repoPath === "string") {
      return nested.repoPath;
    }
  }

  return undefined;
}

function executeToolCall(name: string, command: string, cwd?: string): unknown {
  if (name !== "bash") {
    throw new Error(`Unsupported tool in reference workflow tests: ${name}`);
  }

  try {
    const stdout = execFileSync(
      "bash",
      ["-lc", command],
      {
        ...(cwd ? { cwd } : {}),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();

    if (stdout.length === 0) {
      return { stdout: "" };
    }

    try {
      return JSON.parse(stdout);
    } catch {
      return { stdout };
    }
  } catch (error) {
    const result = error as {
      stderr?: Buffer | string;
      stdout?: Buffer | string;
      message?: string;
    };
    const stderr = result.stderr?.toString().trim();
    const stdout = result.stdout?.toString().trim();
    throw new Error(stderr || stdout || result.message || "bash command failed");
  }
}
