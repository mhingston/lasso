import type { HarnessSpec } from "../spec/types.js";
import type { HarnessState } from "../state/types.js";
import type { ExecutionTraceEntry } from "../compiler/runtime-helpers.js";

export interface HarnessVersion {
  version: number;
  parentVersion?: number;
  reason: string;
  spec: HarnessSpec;
  generatedAt: number;
}

export interface HarnessExecutionTrace {
  entries: ExecutionTraceEntry[];
  totalDurationMs: number;
  nodeCount: number;
  failureCount: number;
  startTimeMs: number;
  endTimeMs: number;
}

export interface LineageEntry {
  version: number;
  terminalNodeId: string;
  outputs: Record<string, unknown>;
  nodeResults: Record<string, unknown>;
  failures: HarnessState["failures"];
  metrics: HarnessState["metrics"];
  trace: HarnessExecutionTrace;
  completedAt: number;
}
