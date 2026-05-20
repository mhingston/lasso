import type { CompiledHarnessResult } from "../compiler/compile.js";
import type { HarnessSpec } from "../spec/types.js";
import type { HarnessVersion, LineageEntry } from "./types.js";

export function createInitialVersion(spec: HarnessSpec): HarnessVersion {
  return {
    version: 1,
    parentVersion: undefined,
    reason: "initial",
    spec: structuredClone(spec),
    generatedAt: Date.now(),
  };
}

export function createNextVersion(
  parentVersion: HarnessVersion,
  spec: HarnessSpec,
  reason: string,
): HarnessVersion {
  return {
    version: parentVersion.version + 1,
    parentVersion: parentVersion.version,
    reason,
    spec: structuredClone(spec),
    generatedAt: Date.now(),
  };
}

export function createLineageEntry(
  version: HarnessVersion,
  result: CompiledHarnessResult,
): LineageEntry {
  return {
    version: version.version,
    terminalNodeId: result.terminalNodeId,
    outputs: structuredClone(result.outputs),
    nodeResults: structuredClone(result.harnessState.nodeResults),
    failures: structuredClone(result.harnessState.failures),
    metrics: structuredClone(result.harnessState.metrics),
    trace: structuredClone(result.trace),
    completedAt: Date.now(),
  };
}
