import type { HarnessSpec, TaskNode, TaskEdge } from "../spec/types.js";

export type MutationType =
  | "add-node"
  | "remove-node"
  | "modify-node"
  | "add-edge"
  | "toggle-approval"
  | "add-verification"
  | "replace-node"
  | "tighten-guardrail";

export type MutationTrigger =
  | "node_failed"
  | "confidence_low"
  | "cost_high"
  | "loop_detected"
  | "retry_exhausted"
  | "verification_failed"
  | "tool_missing"
  | "auth_expired";

export interface HarnessMutation {
  type: MutationType;
  params: Record<string, unknown>;
  trigger?: MutationTrigger;
  description?: string;
}

export interface MutationPolicy {
  allowedMutations: MutationType[];
  maxMutations: number;
}

export interface MutationResult {
  spec: HarnessSpec;
  mutations: HarnessMutation[];
  diff: SpecDiff;
}

export interface SpecDiff {
  addedNodes: string[];
  removedNodes: string[];
  modifiedNodes: string[];
  addedEdges: Array<{ from: string; to: string }>;
  removedEdges: Array<{ from: string; to: string }>;
}

export interface AddNodeParams {
  node: TaskNode;
  edges?: TaskEdge[];
}

export interface RemoveNodeParams {
  nodeId: string;
}

export interface ModifyNodeParams {
  nodeId: string;
  changes: Partial<TaskNode>;
}

export interface AddEdgeParams {
  edge: TaskEdge;
}

export interface ToggleApprovalParams {
  approvalRequired?: boolean;
}

export interface AddVerificationParams {
  nodeId: string;
  verificationPolicy: NonNullable<TaskNode["verificationPolicy"]>;
}

export interface ReplaceNodeParams {
  nodeId: string;
  changes: Partial<TaskNode>;
}

export interface TightenGuardrailParams {
  nodeId: string;
  verificationPolicy: NonNullable<TaskNode["verificationPolicy"]>;
}
