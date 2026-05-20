import type { HarnessSpec } from "../spec/types.js";
import type { EnvironmentModel, EnvironmentAnalysis } from "../environment/types.js";
import type { FailureSignature } from "../failures/ontology.js";
import type { FailureModeGeneration } from "../failures/generator.js";
import type { MemoryAdvice, MemoryStore } from "../memory/types.js";
import type { CapabilityRegistry } from "../capabilities/types.js";
import type { MutationPolicy, HarnessMutation } from "../mutation/types.js";
import type { CompilerAnalysis, CompilerSuggestion } from "../compiler/feedback.js";
import type { HarnessStage, CompositionResult } from "../composition/types.js";

export interface MetaHarnessConfig {
  environmentModel?: EnvironmentModel;
  memoryStore?: MemoryStore;
  capabilityRegistry?: CapabilityRegistry;
  maxVersions?: number;
  mutationPolicy?: MutationPolicy;
}

export interface MetaHarnessResult {
  spec: HarnessSpec;
  environmentAnalysis?: EnvironmentAnalysis;
  memoryAdvice?: MemoryAdvice;
  predictedFailures: FailureSignature[];
  generatedFailureModes?: FailureModeGeneration;
  optimizations: string[];
  readinessScore: number;
  compilerAnalysis?: CompilerAnalysis;
  compilerOptimizations: string[];
  appliedMutations: HarnessMutation[];
}

export interface MetaHarness {
  discoverEnvironment(repoPath?: string): Promise<EnvironmentModel>;
  predictFailures(spec: HarnessSpec, env: EnvironmentModel): Promise<FailureSignature[]>;
  synthesizePolicies(spec: HarnessSpec, failures: FailureSignature[]): HarnessSpec;
  generateHarness(intent: string, config?: MetaHarnessConfig): Promise<MetaHarnessResult>;
  composeHarnesses(stages: HarnessStage[]): CompositionResult;
  composeParallel(harnesses: HarnessSpec[]): CompositionResult;
  composeConditional(condition: string, trueHarness: HarnessSpec, falseHarness?: HarnessSpec): CompositionResult;
}
