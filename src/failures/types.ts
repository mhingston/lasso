import type { HarnessMutation } from "../mutation/types.js";
import type { FailureClass } from "./ontology.js";

export interface FailureRecord {
  domainType: string;
  rootCause:
    | "tool_timeout"
    | "auth_required"
    | "rate_limited"
    | "invalid_output"
    | "dependency_failure"
    | "verification_failed"
    | "human_block"
    | "unknown";
  nodeId?: string;
  message: string;
}

export interface Risk {
  id: string;
  probability: number;
  impact: number;
  score: number;
  signals: string[];
  mitigations: HarnessMutation[];
  failureClass: FailureClass;
  description: string;
}

export interface RiskAssessment {
  risks: Risk[];
  overallScore: number;
  highRiskThreshold: number;
  risksAboveThreshold: Risk[];
}
