import { execFileSync } from "node:child_process";
import type { CompiledHarnessResult, CompiledHarnessWorkflow } from "../../src/compiler/compile.js";

/** Minimal input shape required by the test runner — only `repoPath` is needed. */
export interface WorkflowInput {
  repoPath: string;
}

export interface RunCompiledWorkflowOptions {
  llmResult?: unknown;
  humanResponse?: unknown;
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
  const context = createRuntimeContext();
  const iterator = compiled.workflows[0].generator(context as any, input);

  let next = iterator.next();
  while (!next.done) {
    try {
      const resolved = executeYieldItem(next.value as YieldItem, input, options);
      next = iterator.next(resolved);
    } catch (error) {
      if (!iterator.throw) {
        throw error;
      }
      next = iterator.throw(error);
    }
  }

  return next.value;
}

function createRuntimeContext() {
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
    continueAsNew: () => {
      throw new Error("continueAsNew is not used in reference workflow tests");
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
): unknown {
  switch (item.kind) {
    case "tool-call":
      return executeToolCall(item.name, item.args.command, input.repoPath);
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
      return item.tasks.map(task => executeYieldItem(task, input, options));
    case "timer":
      return { delayMs: item.delayMs };
  }
}

function executeToolCall(name: string, command: string, cwd: string): unknown {
  if (name !== "bash") {
    throw new Error(`Unsupported tool in reference workflow tests: ${name}`);
  }

  try {
    const stdout = execFileSync("bash", ["-lc", command], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

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
