import type { CompiledHarnessResult } from "../compiler/compile.js";
import type { HarnessSpec } from "../spec/types.js";
import { buildReferenceHarnessSpec, type ReferenceWorkflowRequest } from "../reference/catalog.js";
import { replanWorkflowRequest, type ReplanRequest, type ReplanResult } from "./synthesize.js";
import { createInitialVersion, createNextVersion, createLineageEntry } from "../versioning/history.js";
import type { HarnessVersion, LineageEntry, HarnessExecutionTrace } from "../versioning/types.js";
import { deriveMutationsFromTrace } from "../mutation/derive.js";
import { mutateHarness } from "../mutation/engine.js";
import type { HarnessMutation, MutationResult } from "../mutation/types.js";
import type { MemoryStore, HarnessMemory, MemoryAdvice, MemoryUpdate } from "../memory/types.js";
import { extractPatternsFromTrace } from "../memory/extractor.js";
import { adviseFromMemory } from "../memory/advisor.js";
import type { ExecutionTrace, HarnessSynthesisResult } from "../metaharness/types.js";
import type { EnvironmentModel } from "../environment/types.js";

export const MAX_ADAPTIVE_VERSIONS = 5;

export interface AdaptiveRuntimeMetadata {
  currentRequest: ReferenceWorkflowRequest;
  currentVersion: HarnessVersion;
  lineage: LineageEntry[];
  pendingMutations?: HarnessMutation[];
}

export interface AdaptiveRuntimeInput {
  input: unknown;
  __lassoAdaptiveRuntime: AdaptiveRuntimeMetadata;
}

export type UnwrappedAdaptiveInput =
  | { hasAdaptive: true; metadata: AdaptiveRuntimeMetadata; input: unknown }
  | { hasAdaptive: false; metadata: null; input: unknown };

export type RuntimeReplanDecision =
  | {
      decision: "continue_as_new";
      nextRequest: ReferenceWorkflowRequest;
      nextVersion: HarnessVersion;
      nextInput: AdaptiveRuntimeInput;
      lineageEntry: LineageEntry;
    }
  | {
      decision: "needs_operator_input";
      lineageEntry: LineageEntry;
      replanResult: ReplanResult;
    }
  | {
      decision: "stop";
      lineageEntry: LineageEntry;
      replanResult: ReplanResult;
    }
  | {
      decision: "trace_synthesis";
      lineageEntry: LineageEntry;
      synthesisResult: HarnessSynthesisResult;
      nextRequest?: ReferenceWorkflowRequest;
      nextVersion?: HarnessVersion;
      nextInput?: AdaptiveRuntimeInput;
    };

export function prepareInitialAdaptiveInput(
  request: ReferenceWorkflowRequest,
  spec: HarnessSpec,
  runtimeInput: unknown,
): AdaptiveRuntimeInput {
  const initialVersion = createInitialVersion(spec);

  return {
    input: structuredClone(runtimeInput),
    __lassoAdaptiveRuntime: {
      currentRequest: structuredClone(request),
      currentVersion: initialVersion,
      lineage: [],
    },
  };
}

export function unwrapAdaptiveInput(input: unknown): UnwrappedAdaptiveInput {
  if (
    input
    && typeof input === "object"
    && "__lassoAdaptiveRuntime" in input
    && isAdaptiveMetadata(input.__lassoAdaptiveRuntime)
  ) {
    const record = input as Record<string, unknown>;
    return {
      hasAdaptive: true,
      metadata: input.__lassoAdaptiveRuntime as AdaptiveRuntimeMetadata,
      input: Object.prototype.hasOwnProperty.call(record, "input") ? record.input : {},
    };
  }

  return { hasAdaptive: false, metadata: null, input };
}

export function prepareRuntimeReplan(
  adaptive: AdaptiveRuntimeMetadata,
  runtimeInput: unknown,
  result: CompiledHarnessResult,
): RuntimeReplanDecision {
  const lineageEntry = createLineageEntry(adaptive.currentVersion, result);

  if (adaptive.currentVersion.version >= MAX_ADAPTIVE_VERSIONS) {
    return {
        decision: "stop",
        lineageEntry,
        replanResult: {
          status: "stop",
          workflow: adaptive.currentRequest.workflow,
          riskLevel: "high",
          reasons: ["Max adaptive version limit reached"],
          guidance: ["Manual intervention required to continue workflow evolution"],
        },
      };
  }

  const replanRequest = buildReplanRequest(
    adaptive.currentRequest,
    result.terminalNodeId,
    result.harnessState,
  );

  const replanResult = replanWorkflowRequest(replanRequest);

  const mutationDecision = prepareRuntimeReplanWithMutations(adaptive, result, {
    entries: result.trace.entries,
    totalDurationMs: result.harnessState.metrics.durationMs,
    nodeCount: result.trace.entries.length,
    failureCount: result.harnessState.failures.length,
    startTimeMs: Date.now() - result.harnessState.metrics.durationMs,
    endTimeMs: Date.now(),
  });

  if (replanResult.status === "draft_request") {
    const baseSpec = mutationDecision.mutationResult
      ? mutationDecision.mutationResult.spec
      : buildReferenceHarnessSpec(replanResult.request);
    const mutationSuffix = mutationDecision.mutations
      ? ` + ${mutationDecision.mutations.length} structural mutation(s)`
      : "";
    const nextVersion = createNextVersion(
      adaptive.currentVersion,
      baseSpec,
      `${replanResult.trigger}: ${replanResult.rationale[0] || "workflow evolution"}${mutationSuffix}`,
    );

    const nextInput: AdaptiveRuntimeInput = {
      input: structuredClone(runtimeInput),
      __lassoAdaptiveRuntime: {
        currentRequest: structuredClone(replanResult.request),
        currentVersion: nextVersion,
        lineage: [...adaptive.lineage, lineageEntry],
        pendingMutations: mutationDecision.mutations,
      },
    };

    return {
      decision: "continue_as_new",
      nextRequest: replanResult.request,
      nextVersion,
      nextInput,
      lineageEntry,
    };
  }

  if (replanResult.status === "needs_operator_input") {
    return {
      decision: "needs_operator_input",
      lineageEntry,
      replanResult,
    };
  }

  return {
    decision: "stop",
    lineageEntry,
    replanResult,
  };
}

export interface MutationReplanDecision {
  decision: "mutate_spec" | "no_mutations";
  mutationResult?: MutationResult;
  mutations?: HarnessMutation[];
}

export function prepareRuntimeReplanWithMutations(
  adaptive: AdaptiveRuntimeMetadata,
  result: CompiledHarnessResult,
  trace: HarnessExecutionTrace,
): MutationReplanDecision {
  const currentSpec = adaptive.currentVersion.spec;
  const derivedMutations = deriveMutationsFromTrace(trace, currentSpec);

  if (derivedMutations.length === 0) {
    return { decision: "no_mutations" };
  }

  const mutationResult = mutateHarness(currentSpec, derivedMutations);

  return {
    decision: "mutate_spec",
    mutationResult,
    mutations: derivedMutations,
  };
}

export interface TraceSynthesisReplanInput {
  adaptive: AdaptiveRuntimeMetadata;
  runtimeInput: unknown;
  result: CompiledHarnessResult;
  environment: EnvironmentModel;
}

export async function prepareRuntimeReplanWithTraceSynthesis(
  input: TraceSynthesisReplanInput,
): Promise<RuntimeReplanDecision> {
  const { adaptive, runtimeInput, result, environment } = input;
  const lineageEntry = createLineageEntry(adaptive.currentVersion, result);

  if (adaptive.currentVersion.version >= MAX_ADAPTIVE_VERSIONS) {
    return {
      decision: "stop",
      lineageEntry,
      replanResult: {
        status: "stop",
        workflow: adaptive.currentRequest.workflow,
        riskLevel: "high",
        reasons: ["Max adaptive version limit reached"],
        guidance: ["Manual intervention required to continue workflow evolution"],
      },
    };
  }

  const executionTrace: ExecutionTrace = buildExecutionTrace(result);

  const { DefaultMetaHarness } = await import("../metaharness/engine.js");
  const metaHarness = new DefaultMetaHarness({ environmentModel: environment });

  const synthesisResult = await metaHarness.synthesizeFromTrace(
    executionTrace,
    adaptive.currentVersion.spec,
    environment,
  );

  switch (synthesisResult.decision) {
    case "stop":
      return {
        decision: "stop",
        lineageEntry,
        replanResult: {
          status: "stop",
          workflow: adaptive.currentRequest.workflow,
          riskLevel: "high",
          reasons: synthesisResult.rationale,
          guidance: ["Trace synthesis determined execution should stop"],
        },
      };

    case "needs_operator_input":
      return {
        decision: "needs_operator_input",
        lineageEntry,
        replanResult: {
          status: "needs_operator_input",
          workflow: adaptive.currentRequest.workflow,
          riskLevel: "medium",
          reasons: synthesisResult.rationale,
          guidance: ["Trace synthesis requires operator input"],
        },
      };

    case "continue": {
      if (synthesisResult.mutations.length === 0) {
        const replanRequest = buildReplanRequest(
          adaptive.currentRequest,
          result.terminalNodeId,
          result.harnessState,
        );
        const replanResult = replanWorkflowRequest(replanRequest);

        if (replanResult.status === "draft_request") {
          const baseSpec = buildReferenceHarnessSpec(replanResult.request);
          const nextVersion = createNextVersion(
            adaptive.currentVersion,
            baseSpec,
            `trace-synthesis: ${synthesisResult.rationale[0] || "no mutations needed"}`,
          );
          const nextInput: AdaptiveRuntimeInput = {
            input: structuredClone(runtimeInput),
            __lassoAdaptiveRuntime: {
              currentRequest: structuredClone(replanResult.request),
              currentVersion: nextVersion,
              lineage: [...adaptive.lineage, lineageEntry],
            },
          };

          return {
            decision: "trace_synthesis",
            lineageEntry,
            synthesisResult,
            nextRequest: replanResult.request,
            nextVersion,
            nextInput,
          };
        }

        return {
          decision: "stop",
          lineageEntry,
          replanResult,
        };
      }

      const nextVersion = createNextVersion(
        adaptive.currentVersion,
        synthesisResult.spec,
        `trace-synthesis: ${synthesisResult.rationale.join("; ")}`,
      );

      const nextInput: AdaptiveRuntimeInput = {
        input: structuredClone(runtimeInput),
        __lassoAdaptiveRuntime: {
          currentRequest: structuredClone(adaptive.currentRequest),
          currentVersion: nextVersion,
          lineage: [...adaptive.lineage, lineageEntry],
          pendingMutations: synthesisResult.mutations,
        },
      };

      return {
        decision: "trace_synthesis",
        lineageEntry,
        synthesisResult,
        nextRequest: adaptive.currentRequest,
        nextVersion,
        nextInput,
      };
    }
  }
}

// NOTE: Timestamps here are approximations — the total harness duration is
// applied uniformly to all nodes. Per-node timing should be sourced from
// trace entries when available.
function buildExecutionTrace(result: CompiledHarnessResult): ExecutionTrace {
  const completedNodes: ExecutionTrace["completedNodes"] = [];
  const failedNodes: ExecutionTrace["failedNodes"] = [];

  for (const failure of result.harnessState.failures) {
    failedNodes.push({
      nodeId: failure.nodeId ?? "unknown",
      startedAt: Date.now() - (result.harnessState.metrics.durationMs ?? 0),
      failedAt: Date.now(),
      error: failure.message,
      retryCount: 0,
    });
  }

  for (const [nodeId, output] of Object.entries(result.harnessState.nodeResults ?? {})) {
    if (!failedNodes.some(f => f.nodeId === nodeId)) {
      completedNodes.push({
        nodeId,
        startedAt: Date.now() - (result.harnessState.metrics.durationMs ?? 0),
        completedAt: Date.now(),
        output,
      });
    }
  }

  return {
    completedNodes,
    failedNodes,
    currentNodeId: result.terminalNodeId,
    capturedAt: Date.now(),
  };
}

function buildReplanRequest(
  originalRequest: ReferenceWorkflowRequest,
  terminalNodeId: string,
  harnessState: CompiledHarnessResult["harnessState"],
): ReplanRequest {
  if (originalRequest.workflow === "patch-validation") {
    return {
      workflow: "patch-validation",
      originalRequest,
      observedOutcome: {
        terminalNodeId: terminalNodeId as any,
        notes: harnessState.failures.map(f => f.message),
      },
    };
  }

  return {
    workflow: "pr-review-merge",
    originalRequest,
    observedOutcome: {
      terminalNodeId: terminalNodeId as any,
      notes: harnessState.failures.map(f => f.message),
    },
  };
}

function isAdaptiveMetadata(value: unknown): value is AdaptiveRuntimeMetadata {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    "currentRequest" in record
    && typeof record.currentRequest === "object"
    && "currentVersion" in record
    && typeof record.currentVersion === "object"
    && "lineage" in record
    && Array.isArray(record.lineage)
  );
}

export interface MemoryAwareReplanInput {
  adaptive: AdaptiveRuntimeMetadata;
  runtimeInput: unknown;
  result: CompiledHarnessResult;
  memoryStore: MemoryStore;
  taskSignature?: string;
}

export interface MemoryAwareReplanOutput {
  advice: MemoryAdvice;
  updatedMemory?: HarnessMemory;
  decision: RuntimeReplanDecision;
}

export async function prepareMemoryAwareRuntimeReplan(
  input: MemoryAwareReplanInput,
): Promise<MemoryAwareReplanOutput> {
  const { adaptive, runtimeInput, result, memoryStore, taskSignature } = input;

  const trace: HarnessExecutionTrace = {
    entries: result.trace.entries,
    totalDurationMs: result.harnessState.metrics.durationMs,
    nodeCount: result.trace.entries.length,
    failureCount: result.harnessState.failures.length,
    startTimeMs: Date.now() - result.harnessState.metrics.durationMs,
    endTimeMs: Date.now(),
  };

  const advice = await adviseFromMemory(
    taskSignature ?? adaptive.currentRequest.workflow,
    memoryStore,
    { taskSignature },
    adaptive.currentVersion.spec,
  );

  const decision = prepareRuntimeReplan(adaptive, runtimeInput, result);

  let updatedMemory: HarnessMemory | undefined;

  if (decision.decision === "continue_as_new" || decision.decision === "stop") {
    const patterns = extractPatternsFromTrace(trace, adaptive.currentVersion.spec);

    const taskId = taskSignature ?? `${adaptive.currentRequest.workflow}-v${adaptive.currentVersion.version}`;
    const existingMemory = await memoryStore.getMemory(taskId);

    if (existingMemory) {
      const update: MemoryUpdate = {
        effectivenessDelta: result.harnessState.failures.length === 0 ? 0.05 : -0.05,
      };
      updatedMemory = await memoryStore.updateMemory(taskId, update);
    } else {
      const effectivenessScore = result.harnessState.failures.length === 0 ? 0.7 : 0.3;
      const memory: HarnessMemory = {
        taskId,
        taskEmbedding: taskSignature,
        successfulPatterns: patterns.successful,
        failedPatterns: patterns.failed,
        mutationHistory: [],
        effectivenessScore,
        lastUpdated: Date.now(),
      };
      await memoryStore.saveMemory(memory);
      updatedMemory = memory;
    }
  }

  return { advice, updatedMemory, decision };
}
