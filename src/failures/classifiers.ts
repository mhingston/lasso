export interface ClassifierResult {
  matched: boolean;
  evidence: string[];
}

const AUTH_PATTERNS = [
  { regex: /\b401\b/i, evidence: "HTTP 401" },
  { regex: /\b403\b/i, evidence: "HTTP 403" },
  { regex: /unauthorized/i, evidence: "unauthorized" },
  { regex: /authentication required/i, evidence: "authentication required" },
  { regex: /token expired/i, evidence: "token expired" },
  { regex: /invalid credentials/i, evidence: "invalid credentials" },
  { regex: /access denied/i, evidence: "access denied" },
  { regex: /forbidden/i, evidence: "forbidden" },
];

const TOOL_PATTERNS = [
  { regex: /command not found/i, evidence: "command not found" },
  { regex: /exit(?:ed)? with code (\d+)/i, evidence: "exit code" },
  { regex: /no such file or directory/i, evidence: "no such file or directory" },
  { regex: /stderr:/i, evidence: "stderr output" },
  { regex: /ENOENT/i, evidence: "ENOENT" },
  { regex: /not a valid/i, evidence: "not a valid" },
];

const RESOURCE_PATTERNS = [
  { regex: /no space left on device/i, evidence: "disk full" },
  { regex: /out of memory/i, evidence: "out of memory" },
  { regex: /heap.*memory/i, evidence: "heap memory" },
  { regex: /rate limit/i, evidence: "rate limit" },
  { regex: /too many requests/i, evidence: "too many requests" },
  { regex: /cannot allocate memory/i, evidence: "cannot allocate memory" },
  { regex: /resource.*exhaust/i, evidence: "resource exhausted" },
];

const SEMANTIC_PATTERNS = [
  { regex: /assertion failed/i, evidence: "assertion failed" },
  { regex: /unexpected output/i, evidence: "unexpected output" },
  { regex: /schema/i, evidence: "schema" },
  { regex: /type mismatch/i, evidence: "type mismatch" },
  { regex: /validation error/i, evidence: "validation error" },
  { regex: /invalid (?:format|json|yaml|xml)/i, evidence: "invalid format" },
];

const HUMAN_PATTERNS = [
  { regex: /reject(?:ed)?/i, evidence: "rejected" },
  { regex: /declined/i, evidence: "declined" },
  { regex: /no response/i, evidence: "no response" },
  { regex: /timed out waiting for human/i, evidence: "human timeout" },
  { regex: /human.*timeout/i, evidence: "human timeout" },
  { regex: /approval.*timeout/i, evidence: "approval timeout" },
];

const ENVIRONMENT_DRIFT_PATTERNS = [
  { regex: /version mismatch/i, evidence: "version mismatch" },
  { regex: /cannot find module/i, evidence: "missing dependency" },
  { regex: /module.*not found/i, evidence: "missing dependency" },
  { regex: /config(?:uration)? changed/i, evidence: "config changed" },
  { regex: /incompatible.*version/i, evidence: "incompatible version" },
  { regex: /required.*version/i, evidence: "required version" },
  { regex: /dependency.*missing/i, evidence: "missing dependency" },
];

const NETWORK_PATTERNS = [
  { regex: /(?:connection|request) timed out/i, evidence: "timeout" },
  { regex: /ECONNREFUSED/i, evidence: "connection refused" },
  { regex: /ENOTFOUND/i, evidence: "DNS" },
  { regex: /getaddrinfo/i, evidence: "DNS" },
  { regex: /network.*unreachable/i, evidence: "network unreachable" },
  { regex: /socket hang up/i, evidence: "socket hang up" },
  { regex: /ECONNRESET/i, evidence: "connection reset" },
  { regex: /ETIMEDOUT/i, evidence: "ETIMEDOUT" },
  { regex: /connect.*refused/i, evidence: "connection refused" },
];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

function matchPatterns(
  message: string,
  patterns: Array<{ regex: RegExp; evidence: string }>,
): ClassifierResult {
  const evidence: string[] = [];
  for (const pattern of patterns) {
    if (pattern.regex.test(message)) {
      if (pattern.regex.source.includes("(\\d+)")) {
        const match = message.match(pattern.regex);
        if (match) {
          evidence.push(`${pattern.evidence} ${match[1]}`);
        } else {
          evidence.push(pattern.evidence);
        }
      } else {
        evidence.push(pattern.evidence);
      }
    }
  }
  return { matched: evidence.length > 0, evidence };
}

export function classifyAuthFailure(error: unknown): ClassifierResult {
  return matchPatterns(getErrorMessage(error), AUTH_PATTERNS);
}

export function classifyToolFailure(error: unknown): ClassifierResult {
  return matchPatterns(getErrorMessage(error), TOOL_PATTERNS);
}

export function classifyResourceFailure(error: unknown): ClassifierResult {
  return matchPatterns(getErrorMessage(error), RESOURCE_PATTERNS);
}

export function classifySemanticFailure(error: unknown): ClassifierResult {
  return matchPatterns(getErrorMessage(error), SEMANTIC_PATTERNS);
}

export function classifyHumanFailure(error: unknown): ClassifierResult {
  return matchPatterns(getErrorMessage(error), HUMAN_PATTERNS);
}

export function classifyEnvironmentDriftFailure(error: unknown): ClassifierResult {
  return matchPatterns(getErrorMessage(error), ENVIRONMENT_DRIFT_PATTERNS);
}

export function classifyNetworkFailure(error: unknown): ClassifierResult {
  return matchPatterns(getErrorMessage(error), NETWORK_PATTERNS);
}
