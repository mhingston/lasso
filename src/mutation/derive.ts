import type { HarnessSpec } from "../spec/types.js";
import type { HarnessExecutionTrace } from "../versioning/types.js";
import type { HarnessMutation } from "./types.js";
import type { ExecutionTraceEntry } from "../compiler/runtime-helpers.js";

const FAILURE_THRESHOLD_FOR_VERIFICATION = 2;
const TRANSIENT_FAILURE_THRESHOLD = 2;

export function deriveMutationsFromTrace(
  trace: HarnessExecutionTrace,
  currentSpec: HarnessSpec,
): HarnessMutation[] {
  if (trace.entries.length === 0) {
    return [];
  }

  const mutations: HarnessMutation[] = [];
  const failuresByNode = groupFailuresByNode(trace.entries);

  for (const [nodeId, failures] of failuresByNode) {
    const node = currentSpec.graph.nodes.find((n) => n.id === nodeId);
    if (!node) continue;

    if (
      failures.length > FAILURE_THRESHOLD_FOR_VERIFICATION &&
      !node.verificationPolicy
    ) {
      mutations.push({
        type: "add-verification",
        params: {
          nodeId,
          verificationPolicy: {
            rules: [
              {
                kind: "expression",
                checkNodeId: `${nodeId}-verify`,
                onFail: "retry",
                maxAttempts: 2,
              },
            ],
          },
        },
      });
    }

    const transientFailures = failures.filter(
      (f) => f.details && (f.details as Record<string, unknown>).category === "transient",
    );
    if (
      transientFailures.length >= TRANSIENT_FAILURE_THRESHOLD &&
      !node.retryPolicy
    ) {
      mutations.push({
        type: "modify-node",
        params: {
          nodeId,
          changes: {
            retryPolicy: {
              maxAttempts: 3,
              backoff: "exponential",
              initialDelay: 1,
            },
          },
        },
      });
    }
  }

  if (
    trace.failureCount > 0 &&
    currentSpec.humanPolicy &&
    !(currentSpec.humanPolicy as Record<string, unknown>).approvalRequired
  ) {
    mutations.push({
      type: "toggle-approval",
      params: { approvalRequired: true },
    });
  }

  return mutations;
}

function groupFailuresByNode(
  entries: ExecutionTraceEntry[],
): Map<string, ExecutionTraceEntry[]> {
  const grouped = new Map<string, ExecutionTraceEntry[]>();

  for (const entry of entries) {
    if (entry.phase === "failure") {
      const existing = grouped.get(entry.nodeId) ?? [];
      existing.push(entry);
      grouped.set(entry.nodeId, existing);
    }
  }

  return grouped;
}
