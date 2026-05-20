import type { HarnessSpec } from "../spec/types.js";
import type { EnvironmentModel, EnvironmentAnalysis } from "../environment/types.js";
import type { FailureSignature } from "../failures/ontology.js";
import type { MemoryAdvice, MemoryStore } from "../memory/types.js";
import type { CapabilityRegistry } from "../capabilities/types.js";
import type { MutationPolicy } from "../mutation/types.js";
import type { MetaHarnessConfig, MetaHarnessResult, MetaHarness } from "./types.js";
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
import { analyzeCompiledWorkflow, applyCompilerSuggestions } from "../compiler/feedback.js";
import { predictFailuresFromEnvironment } from "./predictor.js";
import { deriveMutationsFromFailure } from "../mutation/derive.js";
import { mutateHarness } from "../mutation/engine.js";
import { chainHarnesses } from "../composition/chain.js";
import { parallelHarnesses } from "../composition/parallel.js";
import { conditionalHarness } from "../composition/conditional.js";

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

    // 5. Synthesize policies (mutate spec)
    spec = this.synthesizePolicies(spec, predictedFailures);

    // 6. Compile, analyze, and apply feedback loop
    let optimizations: string[] = [];
    let compilerOptimizations: string[] = [];
    let compilerAnalysis: CompilerAnalysis | undefined;

    try {
      let compiled = compileHarnessSpec(spec);
      if (compiled.optimizations) {
        optimizations = compiled.optimizations;
      }

      // Analyze the compiled workflow
      compilerAnalysis = analyzeCompiledWorkflow(compiled);

      // Check for high-risk suggestions and apply them
      const highRiskSuggestions = compilerAnalysis.suggestions.filter(
        s => s.impact === "high" && (s.type === "add-retry" || s.type === "add-verification")
      );

      if (highRiskSuggestions.length > 0) {
        spec = applyCompilerSuggestions(spec, highRiskSuggestions);
        compilerOptimizations = highRiskSuggestions.map(s => s.description);

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
      optimizations,
      readinessScore,
      compilerAnalysis,
      compilerOptimizations,
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
