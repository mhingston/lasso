import type { HarnessSpec } from "../spec/types.js";
import type { HarnessExecutionTrace } from "../versioning/types.js";
import type { HarnessMutation } from "./types.js";
import type { ExecutionTraceEntry } from "../compiler/runtime-helpers.js";
import type { FailureSignature, FailureContext, FailureClass } from "../failures/ontology.js";

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

export function deriveMutationsFromFailure(
  signature: FailureSignature,
  currentSpec: HarnessSpec,
  context?: FailureContext,
): HarnessMutation[] {
  const nodeId = context?.nodeId;
  if (!nodeId) {
    return [];
  }

  const node = currentSpec.graph.nodes.find((n) => n.id === nodeId);
  if (!node) {
    return [];
  }

  const mutations: HarnessMutation[] = [];

  switch (signature.class) {
    case "auth":
      mutations.push(createAuthCheckMutation(nodeId, currentSpec));
      break;

    case "tool":
      mutations.push(createToolAvailabilityCheckMutation(nodeId, currentSpec));
      break;

    case "resource":
      mutations.push(createResourceProvisioningCheckMutation(nodeId, currentSpec));
      break;

    case "network":
      if (signature.retryable && !node.retryPolicy) {
        mutations.push(createRetryBackoffMutation(nodeId));
      }
      break;

    case "semantic":
      if (!node.verificationPolicy) {
        mutations.push(createVerificationMutation(nodeId));
      }
      break;

    case "human":
      mutations.push({
        type: "toggle-approval",
        params: { approvalRequired: true },
      });
      break;

    case "environment-drift":
      mutations.push(createEnvironmentCheckMutation(nodeId, currentSpec));
      break;

    case "unknown":
      if (!node.verificationPolicy) {
        mutations.push(createVerificationMutation(nodeId));
      }
      break;
  }

  return mutations;
}

function createAuthCheckMutation(
  nodeId: string,
  spec: HarnessSpec,
): HarnessMutation {
  const authCheckId = `${nodeId}-auth-check`;
  const incomingEdge = spec.graph.edges.find((e) => e.to === nodeId);

  return {
    type: "add-node",
    params: {
      node: {
        id: authCheckId,
        label: `Auth check for ${nodeId}`,
        kind: "tool" as const,
        tool: "bash",
        args: ["-c", "git remote -v >/dev/null 2>&1 || echo 'AUTH_FAILED'"],
      },
      edges: [
        {
          from: incomingEdge?.from ?? spec.graph.entryNodeId,
          to: authCheckId,
        },
        { from: authCheckId, to: nodeId },
      ],
    },
  };
}

function createToolAvailabilityCheckMutation(
  nodeId: string,
  spec: HarnessSpec,
): HarnessMutation {
  const checkId = `${nodeId}-tool-check`;
  const incomingEdge = spec.graph.edges.find((e) => e.to === nodeId);

  return {
    type: "add-node",
    params: {
      node: {
        id: checkId,
        label: `Tool availability check for ${nodeId}`,
        kind: "tool" as const,
        tool: "bash",
        args: ["-c", "command -v node >/dev/null 2>&1 || echo 'TOOL_MISSING'"],
      },
      edges: [
        {
          from: incomingEdge?.from ?? spec.graph.entryNodeId,
          to: checkId,
        },
        { from: checkId, to: nodeId },
      ],
    },
  };
}

function createResourceProvisioningCheckMutation(
  nodeId: string,
  spec: HarnessSpec,
): HarnessMutation {
  const checkId = `${nodeId}-resource-check`;
  const incomingEdge = spec.graph.edges.find((e) => e.to === nodeId);

  return {
    type: "add-node",
    params: {
      node: {
        id: checkId,
        label: `Resource check for ${nodeId}`,
        kind: "tool" as const,
        tool: "bash",
        args: ["-c", "df -h / | awk 'NR==2 {print $5}' | sed 's/%//' | awk '{if ($1 > 90) print \"DISK_FULL\"}'"],
      },
      edges: [
        {
          from: incomingEdge?.from ?? spec.graph.entryNodeId,
          to: checkId,
        },
        { from: checkId, to: nodeId },
      ],
    },
  };
}

function createRetryBackoffMutation(nodeId: string): HarnessMutation {
  return {
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
  };
}

function createVerificationMutation(nodeId: string): HarnessMutation {
  return {
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
  };
}

function createEnvironmentCheckMutation(
  nodeId: string,
  spec: HarnessSpec,
): HarnessMutation {
  const checkId = `${nodeId}-env-check`;
  const incomingEdge = spec.graph.edges.find((e) => e.to === nodeId);

  return {
    type: "add-node",
    params: {
      node: {
        id: checkId,
        label: `Environment check for ${nodeId}`,
        kind: "tool" as const,
        tool: "bash",
        args: ["-c", "uname -a >/dev/null 2>&1 || echo 'ENV_CHECK_FAILED'"],
      },
      edges: [
        {
          from: incomingEdge?.from ?? spec.graph.entryNodeId,
          to: checkId,
        },
        { from: checkId, to: nodeId },
      ],
    },
  };
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
