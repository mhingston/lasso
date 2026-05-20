/**
 * Lasso Harness Specification Types
 *
 * Declarative contract for defining autonomous task workflows.
 */

// ============================================================================
// Core Harness Spec
// ============================================================================

export interface HarnessSpec {
  /** Unique name for this harness */
  name: string;

  /** Task graph defining the workflow */
  graph: TaskGraph;

  /** Global execution policies (optional) */
  executionPolicy?: ExecutionPolicy;

  /** Human intervention policies (optional) */
  humanPolicy?: HumanPolicy;

  /** Observability configuration (optional) */
  observabilityPolicy?: ObservabilityPolicy;
}

// ============================================================================
// Task Graph
// ============================================================================

export interface TaskGraph {
  /** ID of the entry node where execution begins */
  entryNodeId: string;

  /** All nodes in the graph */
  nodes: TaskNode[];

  /** Edges connecting nodes */
  edges: TaskEdge[];
}

export interface TaskEdge {
  /** Source node ID */
  from: string;

  /** Target node ID */
  to: string;
}

// ============================================================================
// Node Types
// ============================================================================

export type TaskNode =
  | ToolNode
  | LlmNode
  | HumanNode
  | ConditionNode
  | MergeNode
  | SubworkflowNode;

export interface BaseNode {
  /** Unique node identifier */
  id: string;

  /** Optional human-readable label */
  label?: string;

  /** Execution policy for this node */
  executionPolicy?: ExecutionPolicy;

  /** Retry policy for this node (only valid for tool, llm, subworkflow nodes) */
  retryPolicy?: RetryPolicy;

  /** Verification policy for this node */
  verificationPolicy?: VerificationPolicy;
}

/** Execute a tool command */
export interface ToolNode extends BaseNode {
  kind: "tool";

  /** Tool name or path */
  tool: string;

  /** Arguments to pass to the tool */
  args: string[];

  /** Environment variables (optional) */
  env?: Record<string, string>;

  /** Working directory (optional) */
  cwd?: string;
}

/** Execute an LLM prompt */
export interface LlmNode extends BaseNode {
  kind: "llm";

  /** LLM provider identifier */
  provider: string;

  /** Model name */
  model: string;

  /** Prompt template or literal */
  prompt: string;

  /** Optional system message */
  system?: string;

  /** Temperature (optional) */
  temperature?: number;

  /** Max tokens (optional) */
  maxTokens?: number;
}

/** Wait for human input/approval */
export interface HumanNode extends BaseNode {
  kind: "human";

  /** Prompt to show the human */
  prompt: string;

  /** Type of human interaction */
  interactionType: "approval" | "input" | "choice";

  /** For choice interactions, the available options */
  options?: string[];

  /** Timeout in seconds (optional) */
  timeout?: number;
}

/** Conditional branching based on expression */
export interface ConditionNode extends BaseNode {
  kind: "condition";

  /** Condition expression to evaluate */
  condition: string;

  /** Node ID to execute if condition is true */
  thenNodeId: string;

  /** Node ID to execute if condition is false */
  elseNodeId: string;
}

/** Merge point for parallel branches */
export interface MergeNode extends BaseNode {
  kind: "merge";

  /** List of node IDs to wait for */
  waitFor: string[];

  /** Merge strategy */
  strategy?: "all" | "any" | "majority";
}

/** Execute a sub-workflow */
export interface SubworkflowNode extends BaseNode {
  kind: "subworkflow";

  /** Reference to another harness spec */
  specRef: string;

  /** Input parameters to pass to the subworkflow */
  inputs?: Record<string, any>;
}

// ============================================================================
// Execution Policies
// ============================================================================

export interface ExecutionPolicy {
  /** Timeout in seconds (optional) */
  timeout?: number;

  /** Maximum memory in MB (optional) */
  maxMemory?: number;

  /** Whether to continue on failure */
  continueOnFailure?: boolean;

  /** Failure classification rules */
  failureClassification?: FailureClassification[];
}

export interface FailureClassification {
  /** Pattern to match against error messages */
  pattern: string;

  /** Classification category */
  category: "transient" | "permanent" | "resource" | "configuration";

  /** Whether to retry on this classification */
  retry: boolean;
}

// ============================================================================
// Retry Policy
// ============================================================================

export interface RetryPolicy {
  /** Maximum number of retry attempts */
  maxAttempts: number;

  /** Backoff strategy */
  backoff: "constant" | "linear" | "exponential";

  /** Initial delay in seconds (optional) */
  initialDelay?: number;

  /** Maximum delay in seconds (optional) */
  maxDelay?: number;

  /** Retry only on specific failure categories (optional) */
  retryOn?: Array<"transient" | "resource">;
}

// ============================================================================
// Verification Policy
// ============================================================================

export interface VerificationPolicy {
  /** Verification rules */
  rules: VerificationRule[];
}

export type VerificationRule =
  | ToolVerificationRule
  | LlmVerificationRule
  | ExpressionVerificationRule;

export interface ToolVerificationRule {
  /** Verification kind - tool verifier */
  kind: "tool";

  /** Node ID of the tool verification check to run */
  checkNodeId: string;

  /** Action to take on verification failure */
  onFail: "block" | "warn" | "retry";

  /** Maximum verification attempts (optional) */
  maxAttempts?: number;
}

export interface LlmVerificationRule {
  /** Verification kind - LLM verifier */
  kind: "llm";

  /** Node ID of the LLM verification check to run */
  checkNodeId: string;

  /** Action to take on verification failure */
  onFail: "block" | "warn" | "retry";

  /** Maximum verification attempts (optional) */
  maxAttempts?: number;
}

export interface ExpressionVerificationRule {
  /** Verification kind - expression verifier */
  kind: "expression";

  /** Node ID of the condition verification check to run */
  checkNodeId: string;

  /** Action to take on verification failure */
  onFail: "block" | "warn" | "retry";

  /** Maximum verification attempts (optional) */
  maxAttempts?: number;
}

// ============================================================================
// Human Policy
// ============================================================================

export interface HumanPolicy {
  /** Default timeout for human interactions in seconds */
  defaultTimeout?: number;

  /** Whether to allow asynchronous human interactions */
  allowAsync?: boolean;

  /** Notification channels for human interventions */
  notificationChannels?: string[];
}

// ============================================================================
// Observability Policy
// ============================================================================

export interface ObservabilityPolicy {
  /** Whether to collect traces */
  tracing?: boolean;

  /** Whether to collect metrics */
  metrics?: boolean;

  /** Log level */
  logLevel?: "debug" | "info" | "warn" | "error";

  /** Custom log destinations */
  logDestinations?: string[];
}
