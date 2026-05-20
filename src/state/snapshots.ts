import type { FailureRecord } from "../failures/types.js";
import type { HarnessState } from "./types.js";

export function createHarnessState(input: unknown): HarnessState {
  return {
    inputs: input && typeof input === "object" && !Array.isArray(input) 
      ? { ...input as Record<string, unknown> } 
      : {},
    outputs: {},
    nodeResults: {},
    failures: [],
    metrics: {
      retries: 0,
      durationMs: 0,
    },
  };
}

export function addFailure(state: HarnessState, failure: FailureRecord): void {
  state.failures.push(failure);
}

export function recordNodeResult(state: HarnessState, nodeId: string, result: unknown): void {
  state.nodeResults[nodeId] = result;
}

export function updateMetrics(
  state: HarnessState,
  metrics: { retries?: number; durationMs?: number },
): void {
  if (metrics.retries !== undefined) {
    state.metrics.retries = metrics.retries;
  }
  if (metrics.durationMs !== undefined) {
    state.metrics.durationMs = metrics.durationMs;
  }
}

export function captureSnapshot(state: HarnessState): HarnessState {
  return structuredClone(state);
}
