import type { HarnessSpec } from "../spec/types.js";
import type { EnvironmentModel, EnvironmentAnalysis } from "../environment/types.js";
import type { FailureSignature } from "../failures/ontology.js";
import type { MemoryAdvice } from "../memory/types.js";
import type { CapabilityRegistry } from "../capabilities/types.js";
import type { MutationPolicy, HarnessMutation } from "../mutation/types.js";
import type { MetaHarnessConfig, MetaHarnessResult, MetaHarness, ExecutionTrace, HarnessSynthesisResult } from "./types.js";
import { buildTraceEntries } from "./trace-adapter.js";
import type { CompilerAnalysis } from "../compiler/feedback.js";
import type { HarnessStage, CompositionResult } from "../composition/types.js";
import { discoverEnvironment } from "../environment/discovery.js";
import { analyzeEnvironment } from "../environment/analyzer.js";
import { adviseFromMemory } from "../memory/advisor.js";
import { planWorkflowRequest } from "../planner/synthesize.js";
import { parsePromptOrSkill } from "../synthesis/skill-parser.js";
import { buildTaskGraph } from "../synthesis/graph-builder.js";
import { analyzeRisks } from "../synthesis/risk-analyzer.js";
import { synthesizeHarness } from "../synthesis/harness-builder.js";
import { compileHarnessSpec } from "../compiler/compile.js";
import { analyzeCompiledWorkflow } from "../compiler/feedback.js";
import { predictFailuresFromEnvironment } from "./predictor.js";
import { generateFailureModes } from "../failures/generator.js";
import { deriveMutationsFromFailure, deriveMutationsFromTrace } from "../mutation/derive.js";
import { mutateHarness } from "../mutation/engine.js";
import { chainHarnesses } from "../composition/chain.js";
import { parallelHarnesses } from "../composition/parallel.js";
import { conditionalHarness } from "../composition/conditional.js";
import { classifyFailure } from "../failures/ontology.js";

export class DefaultMetaHarness implements MetaHarness {
  constructor(private config: MetaHarnessConfig) {}

  async discoverEnvironment(repoPath?: string): Promise<EnvironmentModel> {
    return discoverEnvironment(repoPath);
  }

  async predictFailures(
    spec: HarnessSpec,
    env: EnvironmentModel,
  ): Promise<FailureSignature[]> {
    return predictFailuresFromEnvironment(spec, env);
  }

  synthesizePolicies(
    spec: HarnessSpec,
    failures: FailureSignature[],
  ): HarnessSpec {
    if (failures.length === 0) {
      return spec;
    }

    const allMutations = [];
    for (const failure of failures) {
      const nodeId = extractNodeIdFromFailure(failure) ?? spec.graph.entryNodeId;
      const ctx = { nodeId };
      const mutations = deriveMutationsFromFailure(failure, spec, ctx);
      allMutations.push(...mutations);
    }

    if (allMutations.length === 0) {
      return spec;
    }

    const limitedMutations = this.config.mutationPolicy
      ? enforceMutationPolicy(allMutations, this.config.mutationPolicy)
      : allMutations;

    const result = mutateHarness(spec, limitedMutations, this.config.mutationPolicy);
    return result.spec;
  }

  async generateHarness(
    intent: string,
    config?: MetaHarnessConfig,
  ): Promise<MetaHarnessResult> {
    const effectiveConfig = config ?? this.config;

    // 1. Discover environment (use cached if provided)
    let env: EnvironmentModel;
    if (effectiveConfig.environmentModel) {
      env = effectiveConfig.environmentModel;
    } else {
      env = await this.discoverEnvironment();
    }

    const envAnalysis = analyzeEnvironment(env);

    // 2. Query memory for advice
    let memoryAdvice: MemoryAdvice | undefined;
    if (effectiveConfig.memoryStore) {
      memoryAdvice = await adviseFromMemory(intent, effectiveConfig.memoryStore);
      if (memoryAdvice.suggestions.length === 0 && memoryAdvice.warnings.length === 0) {
        memoryAdvice = undefined;
      }
    }

    // 3. Plan workflow from intent
    const plannerResult = planWorkflowRequest(
      intent,
      effectiveConfig.capabilityRegistry,
      env,
    );

    let spec: HarnessSpec;
    if (plannerResult.status === "draft_request") {
      const parsed = parsePromptOrSkill(intent);
      const taskGraph = buildTaskGraph(
        parsed.success ? parsed.intent : {
          family: "custom",
          goal: intent,
          inputs: {},
          requiredTools: [],
          humanCheckpoints: [],
          verificationTargets: [],
        },
        effectiveConfig.capabilityRegistry,
        env,
      );
      const risks = analyzeRisks(taskGraph, effectiveConfig.capabilityRegistry);
      spec = synthesizeHarness(taskGraph, risks);
    } else {
      spec = makeFallbackSpec(intent);
    }

    // 4. Predict failures
    const predictedFailures = await this.predictFailures(spec, env);

    // 4b. Generate failure modes from task description
    const generatedFailureModes = generateFailureModes(intent, env, spec);

    // 5. Synthesize policies (mutate spec)
    spec = this.synthesizePolicies(spec, predictedFailures);

    // 6. Compile, analyze, and apply feedback loop
    let optimizations: string[] = [];
    let compilerOptimizations: string[] = [];
    let compilerAnalysis: CompilerAnalysis | undefined;
    const appliedMutations: HarnessMutation[] = [];

    try {
      let compiled = compileHarnessSpec(spec);
      if (compiled.optimizations) {
        optimizations = compiled.optimizations;
      }

      // Analyze the compiled workflow
      compilerAnalysis = analyzeCompiledWorkflow(compiled);

      // Use mutations directly from the feedback engine
      const feedbackMutations = compilerAnalysis.mutations.filter(
        m => m.trigger === "retry_exhausted" || m.trigger === "verification_failed" || m.trigger === "cost_high"
      );

      if (feedbackMutations.length > 0) {
        const limitedMutations = this.config.mutationPolicy
          ? enforceMutationPolicy(feedbackMutations, this.config.mutationPolicy)
          : feedbackMutations;

        const mutationResult = mutateHarness(spec, limitedMutations);
        spec = mutationResult.spec;
        appliedMutations.push(...limitedMutations);
        compilerOptimizations = limitedMutations.map(m => m.description ?? m.type);

        // Recompile with the modified spec
        compiled = compileHarnessSpec(spec);
        if (compiled.optimizations) {
          optimizations = compiled.optimizations;
        }

        // Re-analyze after recompilation
        compilerAnalysis = analyzeCompiledWorkflow(compiled);
      }
    } catch {
      // If compilation fails, still return the spec without optimizations
    }

    // 7. Calculate readiness score
    const readinessScore = calculateReadinessScore(envAnalysis, predictedFailures);

    return {
      spec,
      environmentAnalysis: envAnalysis,
      memoryAdvice,
      predictedFailures,
      generatedFailureModes,
      optimizations,
      readinessScore,
      compilerAnalysis,
      compilerOptimizations,
      appliedMutations,
    };
  }

  async synthesizeFromTrace(
    trace: ExecutionTrace,
    currentSpec: HarnessSpec,
    environment: EnvironmentModel,
  ): Promise<HarnessSynthesisResult> {
    const rationale: string[] = [];
    const allMutations: HarnessMutation[] = [];

    // 1. Analyze trace for patterns
    const repeatedFailures = findRepeatedFailures(trace.failedNodes);
    const slowNodes = findSlowNodes(trace.completedNodes);
    const costSpike = detectCostSpike(trace);

    for (const [nodeId, count] of repeatedFailures) {
      rationale.push(`Repeated failures (${count}x) on node "${nodeId}"`);
    }
    for (const [nodeId, durationMs] of slowNodes) {
      rationale.push(`Slow node "${nodeId}": ${durationMs}ms duration`);
    }
    if (costSpike) {
      rationale.push(`cost spike detected: $${trace.totalCostUsd?.toFixed(2) ?? "0.00"} total`);
    }

    // 2. Classify each failure and derive mutations
    for (const failedNode of trace.failedNodes) {
      const signature = classifyFailure(failedNode.error, { nodeId: failedNode.nodeId });
      const mutations = deriveMutationsFromFailure(signature, currentSpec, { nodeId: failedNode.nodeId });
      allMutations.push(...mutations);

      if (mutations.length > 0) {
        rationale.push(
          `Classified failure on "${failedNode.nodeId}" as ${signature.class}, derived ${mutations.length} mutation(s)`,
        );
      }
    }

    // 3. Also derive mutations from the full trace using existing trace analysis
    const traceEntries = buildTraceEntries(trace);
    const traceMutations = deriveMutationsFromTrace(
      {
        entries: traceEntries,
        totalDurationMs: trace.completedNodes.reduce(
          (sum, n) => sum + (n.completedAt - n.startedAt), 0,
        ),
        nodeCount: trace.completedNodes.length + trace.failedNodes.length,
        failureCount: trace.failedNodes.length,
        startTimeMs: Math.min(
          ...[...trace.completedNodes, ...trace.failedNodes].map(n => n.startedAt),
          Date.now(),
        ),
        endTimeMs: trace.capturedAt,
      },
      currentSpec,
    );
    allMutations.push(...traceMutations);

    if (traceMutations.length > 0) {
      rationale.push(`Derived ${traceMutations.length} mutation(s) from execution trace patterns`);
    }

    // 4. Apply mutation policy if configured
    const limitedMutations = this.config.mutationPolicy
      ? enforceMutationPolicy(allMutations, this.config.mutationPolicy)
      : allMutations;

    // 5. Apply mutations
    let updatedSpec = currentSpec;
    if (limitedMutations.length > 0) {
      const result = mutateHarness(currentSpec, limitedMutations);
      updatedSpec = result.spec;
    }

    // 6. Determine decision
    const decision = determineDecision(trace, rationale);

    return {
      mutations: limitedMutations,
      spec: updatedSpec,
      rationale,
      decision,
    };
  }

  composeHarnesses(stages: HarnessStage[]): CompositionResult {
    return chainHarnesses(stages);
  }

  composeParallel(harnesses: HarnessSpec[]): CompositionResult {
    return parallelHarnesses(harnesses);
  }

  composeConditional(condition: string, trueHarness: HarnessSpec, falseHarness?: HarnessSpec): CompositionResult {
    return conditionalHarness(condition, trueHarness, falseHarness);
  }
}

function extractNodeIdFromFailure(failure: FailureSignature): string | undefined {
  for (const evidence of failure.evidence) {
    const match = evidence.match(/^node:\s*(.+)$/);
    if (match) {
      return match[1].trim();
    }
  }
  return undefined;
}

function enforceMutationPolicy(
  mutations: ReturnType<typeof deriveMutationsFromFailure>,
  policy: MutationPolicy,
): ReturnType<typeof deriveMutationsFromFailure> {
  const allowed = new Set(policy.allowedMutations);
  const filtered = mutations.filter(m => allowed.has(m.type));
  return filtered.slice(0, policy.maxMutations);
}

function makeFallbackSpec(intent: string): HarnessSpec {
  const safeName = intent.slice(0, 50).replace(/[^a-zA-Z0-9\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "meta-harness";
  return {
    name: safeName,
    graph: {
      entryNodeId: "intent-node",
      nodes: [
        {
          id: "intent-node",
          label: intent.slice(0, 100),
          kind: "tool",
          tool: "echo",
          args: [intent],
        },
      ],
      edges: [],
    },
  };
}

function calculateReadinessScore(
  envAnalysis: EnvironmentAnalysis,
  predictedFailures: FailureSignature[],
): number {
  let score = envAnalysis.readinessScore;

  for (const failure of predictedFailures) {
    const penalty = Math.round(failure.confidence * 15);
    score = Math.max(0, score - penalty);
  }

  return Math.min(100, Math.max(0, score));
}

function findRepeatedFailures(failedNodes: ExecutionTrace["failedNodes"]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of failedNodes) {
    counts.set(node.nodeId, (counts.get(node.nodeId) ?? 0) + 1);
  }
  const repeated = new Map<string, number>();
  for (const [nodeId, count] of counts) {
    if (count >= 2) {
      repeated.set(nodeId, count);
    }
  }
  return repeated;
}

const SLOW_NODE_THRESHOLD_MS = 30_000;

function findSlowNodes(
  completedNodes: ExecutionTrace["completedNodes"],
): Map<string, number> {
  const slow = new Map<string, number>();
  for (const node of completedNodes) {
    const duration = node.completedAt - node.startedAt;
    if (duration >= SLOW_NODE_THRESHOLD_MS) {
      slow.set(node.nodeId, duration);
    }
  }
  return slow;
}

const COST_SPIKE_THRESHOLD_USD = 5.0;

function detectCostSpike(trace: ExecutionTrace): boolean {
  return (trace.totalCostUsd ?? 0) >= COST_SPIKE_THRESHOLD_USD;
}

function determineDecision(
  trace: ExecutionTrace,
  rationale: string[],
): HarnessSynthesisResult["decision"] {
  const totalNodes = trace.completedNodes.length + trace.failedNodes.length;

  const requiresHuman = trace.failedNodes.some(
    n => n.error.toLowerCase().includes("approval required")
      || n.error.toLowerCase().includes("human intervention"),
  );
  if (requiresHuman) {
    rationale.push("Failure requires human intervention");
    return "needs_operator_input";
  }

  if (totalNodes > 0 && trace.failedNodes.length === totalNodes) {
    rationale.push("All nodes have failed — stopping execution");
    return "stop";
  }

  return "continue";
}
