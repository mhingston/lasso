import type { HarnessExecutionTrace } from "../versioning/types.js";
import type { HarnessSpec } from "../spec/types.js";

export interface HarnessMemory {
  taskId: string;
  taskEmbedding?: string;
  successfulPatterns: string[];
  failedPatterns: string[];
  mutationHistory: MutationRecord[];
  effectivenessScore: number;
  lastUpdated: number;
}

export interface MutationRecord {
  mutation: string;
  triggeredBy: string;
  timestamp: number;
  outcome: "improved" | "no-change" | "worse";
}

export interface MemoryStore {
  getMemory(taskId: string): Promise<HarnessMemory | null>;
  saveMemory(memory: HarnessMemory): Promise<void>;
  updateMemory(taskId: string, update: MemoryUpdate): Promise<HarnessMemory>;
  searchMemories(query: MemoryQuery): Promise<HarnessMemory[]>;
}

export interface MemoryUpdate {
  successfulPattern?: string;
  failedPattern?: string;
  mutation?: MutationRecord;
  effectivenessDelta?: number;
}

export interface MemoryQuery {
  taskSignature?: string;
  minEffectiveness?: number;
  limit?: number;
}

export interface MemoryAdvice {
  suggestions: string[];
  warnings: string[];
  sourceTaskIds: string[];
  aggregateEffectiveness: number;
}

export interface TaskSignatureOptions {
  taskSignature?: string;
  minEffectiveness?: number;
}

export { HarnessExecutionTrace, HarnessSpec };
