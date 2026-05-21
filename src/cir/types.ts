import type {
  ExecutionPolicy,
  FailureClassification,
  HumanNode,
  HumanPolicy,
  LlmNode,
  MergeNode,
  NodeGuardrails,
  ObservabilityPolicy,
  RetryPolicy,
  SubworkflowNode,
  TaskNode,
  ToolNode,
  VerificationHook,
  VerificationRule,
} from "../spec/types.js";

export interface CirWorkflow {
  name: string;
  entryNodeId: string;
  nodes: CirNode[];
  transitions: CirTransition[];
  globalPolicies?: CirGlobalPolicies;
}

export interface CirGlobalPolicies {
  execution?: ExecutionPolicy;
  human?: HumanPolicy;
  observability?: ObservabilityPolicy;
}

export type CirExecutionPolicy = Omit<ExecutionPolicy, "failureClassification">;

export interface CirSourceRef {
  specNodeId: string;
  specNodeKind: TaskNode["kind"];
  specPath: string;
  label?: string;
}

export interface CirTransitionSource {
  kind: "graph-edge" | "condition-then" | "condition-else";
  specPath: string;
  specNodeId?: string;
}

export type CirTransitionWhen = "success" | "condition-true" | "condition-false";

export interface CirTransition {
  from: string;
  to: string;
  when: CirTransitionWhen;
  source: CirTransitionSource;
}

export type CirFailureRoutingHint = FailureClassification;

export interface CirVerificationHook {
  kind: "tool" | "llm" | "expression";
  checkNodeId: string;
  onFail: VerificationRule["onFail"];
  maxAttempts?: number;
}

export interface CirNodeBase<K extends TaskNode["kind"] = TaskNode["kind"]> {
  id: string;
  kind: K;
  source: CirSourceRef;
  execution?: CirExecutionPolicy;
  retry?: RetryPolicy;
  verification?: CirVerificationHook[];
  failureRouting?: CirFailureRoutingHint[];
  terminal?: boolean;
  /** Per-node guardrails from spec */
  guardrails?: NodeGuardrails;
  /** Per-node verification hooks from spec */
  verificationHooks?: VerificationHook[];
}

export interface CirToolNode extends CirNodeBase<"tool"> {
  action: {
    tool: ToolNode["tool"];
    args: ToolNode["args"];
    env?: ToolNode["env"];
    cwd?: ToolNode["cwd"];
  };
}

export interface CirLlmNode extends CirNodeBase<"llm"> {
  action: {
    provider: LlmNode["provider"];
    model: LlmNode["model"];
    prompt: LlmNode["prompt"];
    system?: LlmNode["system"];
    temperature?: LlmNode["temperature"];
    maxTokens?: LlmNode["maxTokens"];
  };
}

export interface CirHumanNode extends CirNodeBase<"human"> {
  action: {
    prompt: HumanNode["prompt"];
    interactionType: HumanNode["interactionType"];
    options?: HumanNode["options"];
    timeout?: number;
  };
}

export interface CirConditionNode extends CirNodeBase<"condition"> {
  action: {
    conditionExpr: string;
  };
}

export interface CirMergeNode extends CirNodeBase<"merge"> {
  action: {
    join: {
      waitFor: string[];
      strategy: NonNullable<MergeNode["strategy"]>;
    };
  };
}

export interface CirSubworkflowNode extends CirNodeBase<"subworkflow"> {
  action: {
    specRef: SubworkflowNode["specRef"];
    inputs?: Record<string, unknown>;
  };
}

export type CirNode =
  | CirToolNode
  | CirLlmNode
  | CirHumanNode
  | CirConditionNode
  | CirMergeNode
  | CirSubworkflowNode;
