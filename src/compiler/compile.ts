import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerWorkflow, type RegisteredWorkflow, type WorkflowContext, type WorkflowOptions, type YieldItem } from "pi-duroxide";
import type { CirMergeNode, CirNode, CirTransition, CirWorkflow } from "../cir/types.js";
import { lowerHarnessSpecToCir } from "../cir/lower.js";
import { optimizeCirWorkflow } from "../cir/optimize.js";
import { validateCirWorkflow } from "../cir/validate.js";
import type { HarnessSpec } from "../spec/types.js";
import { validateHarnessSpec } from "../spec/validate.js";
import { addFailure, createHarnessState, recordNodeResult, updateMetrics } from "../state/snapshots.js";
import type { HarnessState } from "../state/types.js";
import {
  buildShellCommand,
  evaluateConditionExpression,
  recordTrace,
  runWithRetry,
  type ExecutionState,
} from "./runtime-helpers.js";
import { runVerification } from "../verification/engine.js";
import { unwrapAdaptiveInput, prepareRuntimeReplan, type AdaptiveRuntimeMetadata } from "../replanner/runtime.js";
import type { LineageEntry } from "../versioning/types.js";
import type { HarnessExecutionTrace } from "../versioning/types.js";
import { buildReferenceHarnessSpec } from "../reference/catalog.js";

export interface CompiledHarnessResult {
  status: "completed";
  terminalNodeId: string;
  result: unknown;
  outputs: Record<string, unknown>;
  trace: HarnessExecutionTrace;
  harnessState: HarnessState;
  adaptiveMetadata?: AdaptiveRuntimeMetadata;
  lineage?: LineageEntry[];
}

export interface CompiledHarnessWorkflow {
  name: string;
  spec: HarnessSpec;
  cir: CirWorkflow;
  workflows: RegisteredWorkflow[];
  optimizations?: string[];
  adaptive?: {
    currentVersion: { version: number; parentVersion?: number; reason: string };
    lineage: LineageEntry[];
  };
  register(pi?: ExtensionAPI): void;
}

interface ParallelMergePlan {
  mergeNodeId: string;
  branchNodeIds: string[];
}

export function compileHarnessSpec(spec: HarnessSpec): CompiledHarnessWorkflow {
  const specValidation = validateHarnessSpec(spec);
  if (!specValidation.valid) {
    throw new Error(`HarnessSpec validation failed:\n- ${specValidation.errors.join("\n- ")}`);
  }

  const cir = lowerHarnessSpecToCir(spec);
  const { optimized: optimizedCir, passes: optimizationPasses } = optimizeCirWorkflow(cir);
  const cirValidation = validateCirWorkflow(optimizedCir);
  if (!cirValidation.valid) {
    throw new Error(`CIR validation failed:\n- ${cirValidation.errors.join("\n- ")}`);
  }

  const compiledSpec = structuredClone(spec);
  const compiledCir = structuredClone(optimizedCir);
  const nodeMap = new Map(compiledCir.nodes.map(node => [node.id, node]));
  const outgoingTransitions = buildTransitionMap(compiledCir.transitions);
  const incomingTransitions = buildIncomingTransitionMap(compiledCir.transitions);
  validateVerificationSupport(nodeMap);
  const parallelMergePlans = buildParallelMergePlans(compiledCir, nodeMap, outgoingTransitions);
  validateMergeSupport(nodeMap, incomingTransitions, parallelMergePlans);

  const workflows: RegisteredWorkflow[] = [
    {
      name: compiledCir.name,
      generator: createWorkflowGenerator(compiledCir, nodeMap, outgoingTransitions, parallelMergePlans, compiledSpec, compiledCir),
      options: buildWorkflowOptions(compiledSpec),
      sourceInfo: {
        source: "lasso",
      },
    },
  ];

  return {
    name: compiledSpec.name,
    spec: compiledSpec,
    cir: compiledCir,
    workflows,
    optimizations: optimizationPasses.length > 0 ? optimizationPasses : undefined,
    register(_pi?: ExtensionAPI) {
      for (const workflow of workflows) {
        registerWorkflow(workflow.name, workflow.generator, workflow.options);
      }
    },
  };
}

function createWorkflowGenerator(
  cir: CirWorkflow,
  nodeMap: Map<string, CirNode>,
  outgoingTransitions: Map<string, CirTransition[]>,
  parallelMergePlans: Map<string, ParallelMergePlan>,
  compiledSpec: HarnessSpec,
  compiledCir: CirWorkflow,
) {
  return function* compiledHarnessWorkflow(
    ctx: WorkflowContext,
    input: unknown,
  ): Generator<YieldItem, CompiledHarnessResult, unknown> {
    const unwrapped = unwrapAdaptiveInput(input);
    const adaptiveMetadata = unwrapped.hasAdaptive ? unwrapped.metadata : undefined;
    const workflowInput = unwrapped.input;
    const effectiveSpec = adaptiveMetadata?.currentVersion.spec ?? compiledSpec;
    const effectiveCir = adaptiveMetadata ? lowerHarnessSpecToCir(effectiveSpec) : compiledCir;

    if (adaptiveMetadata) {
      const specValidation = validateHarnessSpec(effectiveSpec);
      if (!specValidation.valid) {
        throw new Error(`Adaptive HarnessSpec validation failed:\n- ${specValidation.errors.join("\n- ")}`);
      }

      const cirValidation = validateCirWorkflow(effectiveCir);
      if (!cirValidation.valid) {
        throw new Error(`Adaptive CIR validation failed:\n- ${cirValidation.errors.join("\n- ")}`);
      }
    }

    const effectiveNodeMap = adaptiveMetadata ? new Map(effectiveCir.nodes.map(node => [node.id, node])) : nodeMap;
    const effectiveOutgoingTransitions = adaptiveMetadata ? buildTransitionMap(effectiveCir.transitions) : outgoingTransitions;
    const effectiveParallelMergePlans = adaptiveMetadata ? buildParallelMergePlans(effectiveCir, effectiveNodeMap, effectiveOutgoingTransitions) : parallelMergePlans;

    if (adaptiveMetadata) {
      const adaptiveIncomingTransitions = buildIncomingTransitionMap(effectiveCir.transitions);
      validateVerificationSupport(effectiveNodeMap);
      validateMergeSupport(effectiveNodeMap, adaptiveIncomingTransitions, effectiveParallelMergePlans);
    }

    const startTimeMs = Date.now();
    const harnessState = createHarnessState(workflowInput);
    const state: ExecutionState = {
      input: workflowInput,
      outputs: {},
      trace: [],
      harnessState,
      startTimeMs,
    };
    let currentNodeId = effectiveCir.entryNodeId;

    while (true) {
      const node = getNode(effectiveNodeMap, currentNodeId);

      if (node.kind === "condition") {
        const matched = evaluateConditionExpression(node.action.conditionExpr, state);
        recordTrace(ctx, state, node, matched ? "condition-true" : "condition-false");
        currentNodeId = getConditionTransition(node, effectiveOutgoingTransitions, matched).to;
        continue;
      }

      if (node.kind === "merge") {
        const mergeOutput = buildMergeOutput(node, state.outputs);
        state.outputs[node.id] = mergeOutput;
        recordTrace(ctx, state, node, "merge", {
          waitFor: [...node.action.join.waitFor],
          strategy: node.action.join.strategy,
        });

        const successTransitions = getSuccessTransitions(node.id, effectiveOutgoingTransitions);
        if (successTransitions.length === 0) {
          return yield* buildCompletedResultWithContinuation(ctx, state, node.id, adaptiveMetadata);
        }

        currentNodeId = successTransitions[0].to;
        continue;
      }

      const output = yield* executeNodeWithPolicies(ctx, state, node, effectiveNodeMap, effectiveCir.name);
      state.outputs[node.id] = output;

      const parallelMergePlan = effectiveParallelMergePlans.get(node.id);
      if (parallelMergePlan) {
        const branchNodes = parallelMergePlan.branchNodeIds.map(branchNodeId => getNode(effectiveNodeMap, branchNodeId));
        const mergeNode = getNode(effectiveNodeMap, parallelMergePlan.mergeNodeId);
        for (const branchNode of branchNodes) {
          recordTrace(ctx, state, branchNode, "enter", {
            parallel: true,
          });
        }

        let branchResults: unknown[];
        try {
          branchResults = (yield ctx.all(
            branchNodes.map(branchNode => createActionYieldItem(ctx, branchNode, effectiveCir.name)),
          )) as unknown[];
        } catch (error) {
          state.outputs[mergeNode.id] = {
            status: "failed",
            error: formatUnknownError(error),
          };
          recordTrace(ctx, state, mergeNode, "failure", {
            parallel: true,
            message: formatUnknownError(error),
          });
          throw error;
        }

        branchNodes.forEach((branchNode, index) => {
          state.outputs[branchNode.id] = branchResults[index];
          recordTrace(ctx, state, branchNode, "success", {
            parallel: true,
          });
        });

        currentNodeId = parallelMergePlan.mergeNodeId;
        continue;
      }

      const successTransitions = getSuccessTransitions(node.id, effectiveOutgoingTransitions);
      if (successTransitions.length === 0) {
        return yield* buildCompletedResultWithContinuation(ctx, state, node.id, adaptiveMetadata);
      }

      currentNodeId = successTransitions[0].to;
    }
  };
}

function buildTransitionMap(transitions: CirTransition[]): Map<string, CirTransition[]> {
  const transitionMap = new Map<string, CirTransition[]>();

  for (const transition of transitions) {
    const items = transitionMap.get(transition.from) ?? [];
    items.push(transition);
    transitionMap.set(transition.from, items);
  }

  return transitionMap;
}

function buildIncomingTransitionMap(transitions: CirTransition[]): Map<string, CirTransition[]> {
  const transitionMap = new Map<string, CirTransition[]>();

  for (const transition of transitions) {
    const items = transitionMap.get(transition.to) ?? [];
    items.push(transition);
    transitionMap.set(transition.to, items);
  }

  return transitionMap;
}

function buildParallelMergePlans(
  cir: CirWorkflow,
  nodeMap: Map<string, CirNode>,
  outgoingTransitions: Map<string, CirTransition[]>,
): Map<string, ParallelMergePlan> {
  const plans = new Map<string, ParallelMergePlan>();

  for (const node of cir.nodes) {
    const successTransitions = getSuccessTransitions(node.id, outgoingTransitions);
    if (successTransitions.length <= 1) {
      continue;
    }

    const branchNodes = successTransitions.map(transition => getNode(nodeMap, transition.to));
    const branchSuccessTargets = branchNodes.map(branchNode => {
      if (branchNode.kind === "condition" || branchNode.kind === "merge") {
        throw new Error(`Unsupported parallel merge shape at node ${node.id}: branch node ${branchNode.id} is not directly executable`);
      }

      if (branchNode.retry || branchNode.verification || branchNode.failureRouting) {
        throw new Error(
          `Unsupported parallel merge shape at node ${node.id}: branch node ${branchNode.id} carries retry, verification, or failure-routing metadata`,
        );
      }

      const branchTransitions = outgoingTransitions.get(branchNode.id) ?? [];
      const directSuccessTransitions = branchTransitions.filter(transition => transition.when === "success");
      const branchConditionTransitions = branchTransitions.filter(transition => transition.when !== "success");

      if (branchConditionTransitions.length > 0 || directSuccessTransitions.length !== 1) {
        throw new Error(`Unsupported parallel merge shape at node ${node.id}: branch node ${branchNode.id} must transition directly to a single merge node`);
      }

      return directSuccessTransitions[0].to;
    });

    const mergeNodeId = branchSuccessTargets[0];
    if (!branchSuccessTargets.every(targetNodeId => targetNodeId === mergeNodeId)) {
      throw new Error(`Unsupported parallel merge shape at node ${node.id}: branches do not converge on the same merge node`);
    }

    const mergeNode = getNode(nodeMap, mergeNodeId);
    if (mergeNode.kind !== "merge") {
      throw new Error(`Unsupported parallel merge shape at node ${node.id}: target ${mergeNodeId} is not a merge node`);
    }

    const waitForSet = new Set(mergeNode.action.join.waitFor);
    const branchNodeIds = branchNodes.map(branchNode => branchNode.id);
    if (
      waitForSet.size !== branchNodeIds.length
      || branchNodeIds.some(branchNodeId => !waitForSet.has(branchNodeId))
    ) {
      throw new Error(`Unsupported parallel merge shape at node ${node.id}: merge node ${mergeNode.id} must wait for the forked branch nodes directly`);
    }

    plans.set(node.id, {
      mergeNodeId: mergeNode.id,
      branchNodeIds,
    });
  }

  return plans;
}

function validateMergeSupport(
  nodeMap: Map<string, CirNode>,
  incomingTransitions: Map<string, CirTransition[]>,
  parallelMergePlans: Map<string, ParallelMergePlan>,
): void {
  const parallelMergeNodeIds = new Set(Array.from(parallelMergePlans.values(), plan => plan.mergeNodeId));

  for (const node of nodeMap.values()) {
    if (node.kind !== "merge") {
      continue;
    }

    for (const waitForNodeId of node.action.join.waitFor) {
      const waitForNode = getNode(nodeMap, waitForNodeId);
      if (waitForNode.kind === "condition" || waitForNode.kind === "merge") {
        throw new Error(
          `Merge node ${node.id} cannot wait for non-executable node ${waitForNodeId} of kind "${waitForNode.kind}"`,
        );
      }
    }

    if (parallelMergeNodeIds.has(node.id)) {
      continue;
    }

    const mergeIncomingTransitions = (incomingTransitions.get(node.id) ?? []).filter(transition => transition.when === "success");
    const isDirectSequentialMerge =
      node.action.join.waitFor.length === 1
      && mergeIncomingTransitions.length === 1
      && mergeIncomingTransitions[0]?.from === node.action.join.waitFor[0];

    if (!isDirectSequentialMerge) {
      throw new Error(`Unsupported merge execution shape for merge node ${node.id}`);
    }
  }
}

function validateVerificationSupport(nodeMap: Map<string, CirNode>): void {
  for (const node of nodeMap.values()) {
    if (!node.verification || node.verification.length === 0) {
      continue;
    }

    for (const hook of node.verification) {
      const verifierNode = getNode(nodeMap, hook.checkNodeId);
      if (verifierNode.verification && verifierNode.verification.length > 0) {
        throw new Error(`Verifier node ${verifierNode.id} cannot carry nested verification hooks`);
      }
    }
  }
}

function buildWorkflowOptions(spec: HarnessSpec): WorkflowOptions {
  return {
    description: `Compiled Lasso harness ${spec.name}`,
    ...(spec.executionPolicy?.timeout !== undefined
      ? { timeoutMs: spec.executionPolicy.timeout * 1000 }
      : {}),
  };
}

function getSuccessTransitions(
  nodeId: string,
  outgoingTransitions: Map<string, CirTransition[]>,
): CirTransition[] {
  return (outgoingTransitions.get(nodeId) ?? []).filter(transition => transition.when === "success");
}

function getConditionTransition(
  node: Extract<CirNode, { kind: "condition" }>,
  outgoingTransitions: Map<string, CirTransition[]>,
  matched: boolean,
): CirTransition {
  const when = matched ? "condition-true" : "condition-false";
  const transition = (outgoingTransitions.get(node.id) ?? []).find(item => item.when === when);
  if (!transition) {
    throw new Error(`Condition node ${node.id} is missing a ${when} transition`);
  }
  return transition;
}

function getNode(nodeMap: Map<string, CirNode>, nodeId: string): CirNode {
  const node = nodeMap.get(nodeId);
  if (!node) {
    throw new Error(`Compiled workflow is missing node ${nodeId}`);
  }
  return node;
}

function* executeNodeWithPolicies(
  ctx: WorkflowContext,
  state: ExecutionState,
  node: Exclude<CirNode, { kind: "condition" | "merge" }>,
  nodeMap: Map<string, CirNode>,
  workflowName: string,
): Generator<YieldItem, unknown, unknown> {
  const verificationRetryCounts = new Map<string, number>();

  while (true) {
    delete state.outputs[node.id];

    const output = yield* runWithRetry(ctx, state, node, function* () {
      recordTrace(ctx, state, node, "enter");
      const result = yield createActionYieldItem(ctx, node, workflowName);
      recordTrace(ctx, state, node, "success");
      return result;
    });

    state.outputs[node.id] = output;
    const verificationReport = yield* runVerification(node.id, node.verification ?? [], nodeMap, state, ctx);

    if (verificationReport.overallStatus === "pass") {
      return output;
    }

    if (verificationReport.overallStatus === "block") {
      const retryResult = verificationReport.hookResults.find(r => r.outcome.status === "retry");
      if (retryResult && retryResult.outcome.status === "retry") {
        const retryCount = verificationRetryCounts.get(retryResult.hook.checkNodeId) ?? 0;
        if (retryCount + 1 < retryResult.outcome.maxAttempts) {
          verificationRetryCounts.set(retryResult.hook.checkNodeId, retryCount + 1);
          recordTrace(ctx, state, node, "retry", {
            reason: "verification",
            hook: retryResult.hook.checkNodeId,
            attemptNumber: retryCount + 2,
          });
          continue;
        }
        const exhaustionMessage = `Verification retry exhausted for node ${node.id} via ${retryResult.hook.checkNodeId}`;
        addFailure(state.harnessState, {
          domainType: "lasso",
          rootCause: "verification_failed",
          nodeId: node.id,
          message: exhaustionMessage,
        });
        throw new Error(exhaustionMessage);
      }

      const blockResult = verificationReport.hookResults.find(r => r.outcome.status === "block");
      const message = blockResult?.outcome.status === "block"
        ? blockResult.outcome.message
        : `Verification failed for node ${node.id}`;
      addFailure(state.harnessState, {
        domainType: "lasso",
        rootCause: "verification_failed",
        nodeId: node.id,
        message,
      });
      throw new Error(message);
    }
  }
}

function createActionYieldItem(
  ctx: WorkflowContext,
  node: Exclude<CirNode, { kind: "condition" | "merge" }>,
  workflowName: string,
): YieldItem {
  switch (node.kind) {
    case "tool":
      return ctx.pi.tool("bash", {
        command: buildShellCommand(node.action.tool, node.action.args, node.action.cwd, node.action.env),
        description: `Lasso tool node ${node.id}`,
      });
    case "llm": {
      const messages = [];
      if (node.action.system) {
        messages.push({
          role: "system",
          content: [{ type: "text", text: node.action.system }],
        });
      }
      messages.push({
        role: "user",
        content: [{ type: "text", text: node.action.prompt }],
      });
      return ctx.pi.llm(messages, {
        model: node.action.model,
      });
    }
    case "human":
      return ctx.waitForEvent(`lasso:human:${workflowName}:${node.id}`);
    case "subworkflow":
      return ctx.scheduleSubOrchestration(node.action.specRef, node.action.inputs ?? {});
  }
}

function buildMergeOutput(node: CirMergeNode, outputs: Record<string, unknown>): Record<string, unknown> {
  const missingNodeIds = node.action.join.waitFor.filter(waitForNodeId => !(waitForNodeId in outputs));
  if (missingNodeIds.length > 0) {
    throw new Error(`Merge node ${node.id} is missing outputs for: ${missingNodeIds.join(", ")}`);
  }

  return Object.fromEntries(node.action.join.waitFor.map(waitForNodeId => [waitForNodeId, outputs[waitForNodeId]]));
}

function buildCompletedResult(
  state: ExecutionState,
  terminalNodeId: string,
  adaptiveMetadata?: AdaptiveRuntimeMetadata,
): CompiledHarnessResult {
  const endTimeMs = Date.now();
  const durationMs = endTimeMs - state.startTimeMs;
  
  updateMetrics(state.harnessState, { durationMs });
  
  state.harnessState.outputs = { ...state.outputs };
  
  for (const [nodeId, output] of Object.entries(state.outputs)) {
    recordNodeResult(state.harnessState, nodeId, output);
  }

  const trace: HarnessExecutionTrace = {
    entries: structuredClone(state.trace),
    totalDurationMs: durationMs,
    nodeCount: new Set(state.trace.map(e => e.nodeId)).size,
    failureCount: state.trace.filter(e => e.phase === "failure").length,
    startTimeMs: state.startTimeMs,
    endTimeMs,
  };

  const result: CompiledHarnessResult = {
    status: "completed",
    terminalNodeId,
    result: structuredClone(state.outputs[terminalNodeId]),
    outputs: structuredClone(state.outputs),
    trace,
    harnessState: state.harnessState,
  };

  if (adaptiveMetadata) {
    result.adaptiveMetadata = adaptiveMetadata;
    result.lineage = adaptiveMetadata.lineage;
  }
  
  return result;
}

function* buildCompletedResultWithContinuation(
  ctx: WorkflowContext,
  state: ExecutionState,
  terminalNodeId: string,
  adaptiveMetadata?: AdaptiveRuntimeMetadata,
): Generator<YieldItem, CompiledHarnessResult, unknown> {
  const result = buildCompletedResult(state, terminalNodeId, adaptiveMetadata);

  if (adaptiveMetadata) {
    const replanDecision = prepareRuntimeReplan(adaptiveMetadata, state.input, result);

    if (replanDecision.decision === "continue_as_new") {
      ctx.traceInfo(`Lasso adaptive runtime: continuing as new with version ${replanDecision.nextVersion.version}`);
      yield ctx.continueAsNew(replanDecision.nextInput);
    } else {
      ctx.traceInfo(`Lasso adaptive runtime: ${replanDecision.decision}`);
    }
  }

  return result;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
