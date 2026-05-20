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
