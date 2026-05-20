import type { HarnessExecutionTrace } from "../versioning/types.js";
import type { HarnessSpec } from "../spec/types.js";
import type { ExecutionTraceEntry } from "../compiler/runtime-helpers.js";

interface NodeSequence {
  nodeId: string;
  phases: ExecutionTraceEntry["phase"][];
}

export function extractPatternsFromTrace(
  trace: HarnessExecutionTrace,
  spec: HarnessSpec,
): { successful: string[]; failed: string[] } {
  if (trace.entries.length === 0) {
    return { successful: [], failed: [] };
  }

  const successful: string[] = [];
  const failed: string[] = [];

  const nodeSequences = buildNodeSequences(trace.entries);
  const nodeOrder = extractNodeOrder(trace.entries);

  for (const sequence of nodeSequences) {
    const hasSuccess = sequence.phases.includes("success");
    const hasFailure = sequence.phases.includes("failure");
    const hasRetry = sequence.phases.includes("retry");
    const hasVerificationFail = sequence.phases.includes("verification-fail");

    if (hasSuccess && !hasFailure) {
      successful.push(`${sequence.nodeId}-succeeds`);
    }

    if (hasFailure) {
      failed.push(`${sequence.nodeId}-fails`);
    }

    if (hasRetry && hasSuccess) {
      successful.push(`${sequence.nodeId}-retry-succeeds`);
    }

    if (hasVerificationFail) {
      failed.push(`${sequence.nodeId}-verification-fails`);
    }
  }

  const orderingPatterns = extractOrderingPatterns(nodeOrder, trace.entries);
  successful.push(...orderingPatterns.successful);
  failed.push(...orderingPatterns.failed);

  const specOrderingPatterns = extractSpecOrderingPatterns(nodeOrder, spec, trace.entries);
  successful.push(...specOrderingPatterns);

  return {
    successful: deduplicate(successful),
    failed: deduplicate(failed),
  };
}

function buildNodeSequences(entries: ExecutionTraceEntry[]): NodeSequence[] {
  const sequences = new Map<string, NodeSequence>();

  for (const entry of entries) {
    if (!sequences.has(entry.nodeId)) {
      sequences.set(entry.nodeId, { nodeId: entry.nodeId, phases: [] });
    }
    sequences.get(entry.nodeId)!.phases.push(entry.phase);
  }

  return Array.from(sequences.values());
}

function extractNodeOrder(entries: ExecutionTraceEntry[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];

  for (const entry of entries) {
    if (!seen.has(entry.nodeId)) {
      seen.add(entry.nodeId);
      order.push(entry.nodeId);
    }
  }

  return order;
}

function extractOrderingPatterns(
  nodeOrder: string[],
  entries: ExecutionTraceEntry[],
): { successful: string[]; failed: string[] } {
  const successful: string[] = [];
  const failed: string[] = [];

  const nodeOutcomes = new Map<string, { success: boolean; failure: boolean }>();

  for (const entry of entries) {
    if (!nodeOutcomes.has(entry.nodeId)) {
      nodeOutcomes.set(entry.nodeId, { success: false, failure: false });
    }
    const outcome = nodeOutcomes.get(entry.nodeId)!;
    if (entry.phase === "success") outcome.success = true;
    if (entry.phase === "failure") outcome.failure = true;
  }

  for (let i = 0; i < nodeOrder.length - 1; i++) {
    const current = nodeOrder[i];
    const next = nodeOrder[i + 1];
    const currentOutcome = nodeOutcomes.get(current);
    const nextOutcome = nodeOutcomes.get(next);

    if (!currentOutcome || !nextOutcome) continue;

    if (currentOutcome.success && nextOutcome.success) {
      successful.push(`${current}-before-${next}-succeeds`);
    }

    if (currentOutcome.success && nextOutcome.failure) {
      failed.push(`${current}-before-${next}-fails`);
    }

    if (currentOutcome.failure && nextOutcome.success) {
      successful.push(`${current}-fails-but-${next}-succeeds`);
    }
  }

  return { successful, failed };
}

function extractSpecOrderingPatterns(
  nodeOrder: string[],
  spec: HarnessSpec,
  entries: ExecutionTraceEntry[],
): string[] {
  const patterns: string[] = [];

  const hasTerminalPhases = entries.some(
    (e) => e.phase === "success" || e.phase === "failure" || e.phase === "verification-fail",
  );

  if (!hasTerminalPhases) {
    return patterns;
  }

  for (const edge of spec.graph.edges) {
    const fromIdx = nodeOrder.indexOf(edge.from);
    const toIdx = nodeOrder.indexOf(edge.to);

    if (fromIdx !== -1 && toIdx !== -1 && fromIdx < toIdx) {
      const fromNode = spec.graph.nodes.find((n) => n.id === edge.from);
      const toNode = spec.graph.nodes.find((n) => n.id === edge.to);

      if (fromNode && toNode) {
        const fromKind = fromNode.kind;
        if (fromKind === "tool" || fromKind === "condition") {
          patterns.push(`${edge.from}-before-${edge.to}`);
        }
      }
    }
  }

  return patterns;
}

function deduplicate(arr: string[]): string[] {
  return [...new Set(arr)];
}
