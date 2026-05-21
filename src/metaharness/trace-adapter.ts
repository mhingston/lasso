import type { ExecutionTraceEntry } from "../compiler/runtime-helpers.js";
import type { ExecutionTrace } from "./types.js";

export function buildTraceEntries(trace: ExecutionTrace): ExecutionTraceEntry[] {
  const entries: ExecutionTraceEntry[] = [];

  for (const node of trace.completedNodes) {
    entries.push({
      nodeId: node.nodeId,
      source: undefined,
      phase: "success",
      startedAt: node.startedAt,
      completedAt: node.completedAt,
      outputSnapshot: node.output,
    });
  }

  for (const node of trace.failedNodes) {
    entries.push({
      nodeId: node.nodeId,
      source: undefined,
      phase: "failure",
      startedAt: node.startedAt,
      completedAt: node.failedAt,
      details: {
        error: node.error,
        category: node.failureClass ?? "unknown",
        retryCount: node.retryCount,
      },
    });
  }

  return entries;
}
