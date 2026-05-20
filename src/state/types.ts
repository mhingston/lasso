import type { FailureRecord } from "../failures/types.js";

export interface HarnessState {
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  nodeResults: Record<string, unknown>;
  failures: FailureRecord[];
  metrics: {
    retries: number;
    durationMs: number;
  };
}
