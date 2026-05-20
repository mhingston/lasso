import type { MemoryStore, MemoryQuery, MemoryAdvice, TaskSignatureOptions } from "./types.js";
import type { HarnessSpec } from "../spec/types.js";

export async function adviseFromMemory(
  taskSignature: string,
  memoryStore: MemoryStore,
  options?: TaskSignatureOptions | HarnessSpec,
  currentSpec?: HarnessSpec,
): Promise<MemoryAdvice> {
  let queryOptions: TaskSignatureOptions | undefined;
  let spec: HarnessSpec | undefined;

  if (options && isHarnessSpec(options)) {
    spec = options;
  } else {
    queryOptions = options;
  }

  if (currentSpec) {
    spec = currentSpec;
  }

  const query: MemoryQuery = {
    taskSignature: queryOptions?.taskSignature,
    minEffectiveness: queryOptions?.minEffectiveness,
  };

  const memories = await memoryStore.searchMemories(query);

  if (memories.length === 0) {
    return {
      suggestions: [],
      warnings: [],
      sourceTaskIds: [],
      aggregateEffectiveness: 0,
    };
  }

  const suggestions: string[] = [];
  const warnings: string[] = [];
  const sourceTaskIds: string[] = [];
  let totalEffectiveness = 0;

  const existingNodeIds = spec ? new Set(spec.graph.nodes.map((n) => n.id)) : new Set<string>();

  for (const memory of memories) {
    sourceTaskIds.push(memory.taskId);
    totalEffectiveness += memory.effectivenessScore;

    for (const pattern of memory.successfulPatterns) {
      const patternNodes = extractNodeIdsFromPattern(pattern);
      const hasAllNodes = patternNodes.every((id) => existingNodeIds.has(id));

      if (hasAllNodes && patternNodes.length > 0) {
        suggestions.push(`Pattern "${pattern}" already exists in current spec`);
      } else {
        const effectivenessPct = Math.round(memory.effectivenessScore * 100);
        suggestions.push(
          `Previously, "${pattern}" improved success rate (${effectivenessPct}% effectiveness in task ${memory.taskId})`,
        );
      }
    }

    for (const pattern of memory.failedPatterns) {
      warnings.push(
        `Pattern "${pattern}" failed in task ${memory.taskId} (effectiveness: ${Math.round(memory.effectivenessScore * 100)}%)`,
      );
    }

    for (const record of memory.mutationHistory) {
      if (record.outcome === "improved") {
        suggestions.push(
          `Mutation "${record.mutation}" previously improved outcomes (triggered by: ${record.triggeredBy})`,
        );
      } else if (record.outcome === "worse") {
        warnings.push(
          `Mutation "${record.mutation}" previously worsened outcomes (triggered by: ${record.triggeredBy}) - avoid this approach`,
        );
      }
    }
  }

  const aggregateEffectiveness = memories.length > 0
    ? totalEffectiveness / memories.length
    : 0;

  const uniqueSuggestions = [...new Set(suggestions)];
  const uniqueWarnings = [...new Set(warnings)];

  uniqueSuggestions.sort((a, b) => {
    const aHasAlready = a.includes("already");
    const bHasAlready = b.includes("already");
    if (aHasAlready && !bHasAlready) return 1;
    if (!aHasAlready && bHasAlready) return -1;
    return 0;
  });

  return {
    suggestions: uniqueSuggestions,
    warnings: uniqueWarnings,
    sourceTaskIds,
    aggregateEffectiveness,
  };
}

function isHarnessSpec(value: unknown): value is HarnessSpec {
  return (
    value !== null &&
    typeof value === "object" &&
    "name" in value &&
    "graph" in value &&
    typeof (value as Record<string, unknown>).graph === "object" &&
    "nodes" in ((value as Record<string, unknown>).graph as Record<string, unknown>)
  );
}

function extractNodeIdsFromPattern(pattern: string): string[] {
  const nodePattern = /([a-zA-Z0-9_-]+)-before-([a-zA-Z0-9_-]+)/;
  const match = pattern.match(nodePattern);

  if (match) {
    return [match[1], match[2]];
  }

  const singleNodePattern = /^([a-zA-Z0-9_-]+)-/;
  const singleMatch = pattern.match(singleNodePattern);
  if (singleMatch) {
    return [singleMatch[1]];
  }

  return [];
}
