import type { FailureClass } from "./ontology.js";
import type { EnvironmentModel } from "../environment/types.js";
import type { HarnessSpec } from "../spec/types.js";
import type { Risk, RiskAssessment } from "./types.js";
import type { HarnessMutation } from "../mutation/types.js";

export interface FailureMode {
  id: string;
  description: string;
  failureClass: FailureClass;
  probability: "low" | "medium" | "high";
  triggers: string[];
  mitigations: string[];
  recoveryActions: string[];
}

export interface FailureModeGeneration {
  taskDescription: string;
  failureModes: FailureMode[];
  risks: Risk[];
  generatedAt: number;
  riskSummary: string;
}

interface PatternRule {
  keywords: RegExp[];
  failureClass: FailureClass;
  description: string;
  probability: "low" | "medium" | "high";
  triggers: string[];
  mitigations: string[];
  recoveryActions: string[];
}

const PATTERN_RULES: PatternRule[] = [
  {
    keywords: [/deploy/i, /release/i, /publish/i],
    failureClass: "auth",
    description: "Authentication failure during deployment",
    probability: "medium",
    triggers: ["Expired deployment credentials", "Missing API token", "Insufficient permissions for target environment"],
    mitigations: ["Verify credentials before deployment", "Use short-lived tokens with refresh"],
    recoveryActions: ["Refresh deployment credentials", "Check token scopes and permissions"],
  },
  {
    keywords: [/deploy/i, /release/i, /publish/i],
    failureClass: "network",
    description: "Network timeout during deployment",
    probability: "medium",
    triggers: ["Target service unreachable", "DNS resolution failure", "Firewall blocking outbound traffic"],
    mitigations: ["Check connectivity before deployment", "Use retry with exponential backoff"],
    recoveryActions: ["Retry deployment with backoff", "Verify target service health"],
  },
  {
    keywords: [/deploy/i, /release/i, /publish/i],
    failureClass: "environment-drift",
    description: "Configuration drift in target environment",
    probability: "medium",
    triggers: ["Environment variables changed", "Infrastructure config differs from expected", "Secrets rotated"],
    mitigations: ["Validate config before deployment", "Use infrastructure-as-code"],
    recoveryActions: ["Sync configuration to expected state", "Verify environment variables"],
  },
  {
    keywords: [/test/i, /spec/i, /check/i],
    failureClass: "resource",
    description: "Test timeout due to resource constraints",
    probability: "medium",
    triggers: ["Test exceeds time limit", "Insufficient memory for test runner", "CPU throttling"],
    mitigations: ["Set appropriate test timeouts", "Allocate sufficient resources"],
    recoveryActions: ["Increase timeout threshold", "Retry flaky tests with isolation"],
  },
  {
    keywords: [/test/i, /spec/i, /check/i],
    failureClass: "semantic",
    description: "Flaky test due to non-deterministic behavior",
    probability: "medium",
    triggers: ["Race conditions in test setup", "Shared mutable state", "Order-dependent test failures"],
    mitigations: ["Isolate test state", "Use deterministic fixtures"],
    recoveryActions: ["Retry with test isolation", "Review test setup and teardown"],
  },
  {
    keywords: [/test/i, /spec/i, /check/i],
    failureClass: "environment-drift",
    description: "Environment mismatch causing test failures",
    probability: "low",
    triggers: ["Missing test dependencies", "Different Node.js version", "OS-specific behavior"],
    mitigations: ["Pin dependency versions", "Use containerized test environment"],
    recoveryActions: ["Install missing dependencies", "Verify runtime version matches expected"],
  },
  {
    keywords: [/build/i, /compile/i, /bundle/i],
    failureClass: "environment-drift",
    description: "Dependency resolution failure during build",
    probability: "medium",
    triggers: ["Package registry unavailable", "Version conflict in dependency tree", "Lockfile out of date"],
    mitigations: ["Use lockfile for reproducible builds", "Cache dependencies locally"],
    recoveryActions: ["Run dependency install with fresh cache", "Verify package registry availability"],
  },
  {
    keywords: [/build/i, /compile/i, /bundle/i],
    failureClass: "resource",
    description: "Disk space exhausted during build",
    probability: "low",
    triggers: ["Build artifacts exceed available disk", "Cache directory grows unbounded", "Temporary files not cleaned"],
    mitigations: ["Monitor disk usage", "Clean build artifacts regularly"],
    recoveryActions: ["Free disk space and retry build", "Clear build cache"],
  },
  {
    keywords: [/build/i, /compile/i, /bundle/i],
    failureClass: "resource",
    description: "Out of memory during build",
    probability: "low",
    triggers: ["Build process exceeds memory limit", "Large bundle size", "Memory leak in build tooling"],
    mitigations: ["Increase Node.js heap size", "Optimize bundle splitting"],
    recoveryActions: ["Increase memory limit (--max-old-space-size)", "Split build into smaller chunks"],
  },
  {
    keywords: [/merge/i, /rebase/i, /integrate/i],
    failureClass: "semantic",
    description: "Merge conflict in source files",
    probability: "high",
    triggers: ["Concurrent changes to same files", "Divergent branch history", "Structural refactoring on both branches"],
    mitigations: ["Rebase frequently", "Communicate changes to shared files"],
    recoveryActions: ["Resolve conflicts manually", "Use merge tool for complex conflicts"],
  },
  {
    keywords: [/merge/i, /rebase/i, /integrate/i],
    failureClass: "semantic",
    description: "Post-merge verification failure",
    probability: "medium",
    triggers: ["Combined changes break tests", "Integration incompatibility", "Semantic conflict"],
    mitigations: ["Run full test suite before merge", "Use CI gates on PR"],
    recoveryActions: ["Revert merge and investigate", "Fix integration issues"],
  },
  {
    keywords: [/database/i, /migrat/i, /schema/i],
    failureClass: "network",
    description: "Database connection timeout",
    probability: "medium",
    triggers: ["Database server unreachable", "Connection pool exhausted", "DNS resolution failure for DB host"],
    mitigations: ["Verify database connectivity", "Use connection pooling with timeouts"],
    recoveryActions: ["Retry with exponential backoff", "Check database server health"],
  },
  {
    keywords: [/database/i, /migrat/i, /schema/i],
    failureClass: "semantic",
    description: "Migration failure due to schema conflict",
    probability: "medium",
    triggers: ["Migration script has syntax error", "Existing data violates new constraints", "Migration already partially applied"],
    mitigations: ["Test migrations on staging first", "Use idempotent migration scripts"],
    recoveryActions: ["Review migration logs", "Rollback to previous schema version"],
  },
  {
    keywords: [/database/i, /migrat/i, /schema/i],
    failureClass: "resource",
    description: "Data corruption risk during migration",
    probability: "low",
    triggers: ["Migration interrupted mid-way", "Insufficient disk for migration", "Concurrent writes during migration"],
    mitigations: ["Take backup before migration", "Schedule maintenance window"],
    recoveryActions: ["Restore from backup", "Run data integrity checks"],
  },
  {
    keywords: [/api/i, /endpoint/i, /request/i, /fetch/i, /call/i],
    failureClass: "resource",
    description: "API rate limit exceeded",
    probability: "medium",
    triggers: ["Too many requests in time window", "Shared rate limit across instances", "Burst traffic pattern"],
    mitigations: ["Implement rate limiting client-side", "Use exponential backoff"],
    recoveryActions: ["Wait and retry with backoff", "Request rate limit increase"],
  },
  {
    keywords: [/api/i, /endpoint/i, /request/i, /fetch/i, /call/i],
    failureClass: "auth",
    description: "API authentication token expired",
    probability: "medium",
    triggers: ["Token TTL exceeded", "Clock skew between client and server", "Token not refreshed before expiry"],
    mitigations: ["Implement token refresh logic", "Use tokens with appropriate TTL"],
    recoveryActions: ["Refresh authentication token", "Re-authenticate with API"],
  },
  {
    keywords: [/api/i, /endpoint/i, /request/i, /fetch/i, /call/i],
    failureClass: "semantic",
    description: "API schema mismatch",
    probability: "low",
    triggers: ["API version changed", "Response format differs from expected", "Breaking change in API contract"],
    mitigations: ["Pin API version", "Validate responses against schema"],
    recoveryActions: ["Check API changelog for breaking changes", "Update client to match new schema"],
  },
  {
    keywords: [/file/i, /copy/i, /write/i, /read/i, /path/i, /directory/i],
    failureClass: "tool",
    description: "File permission denied",
    probability: "medium",
    triggers: ["Insufficient file permissions", "File locked by another process", "Read-only filesystem"],
    mitigations: ["Verify file permissions before operation", "Use appropriate user context"],
    recoveryActions: ["Fix file permissions", "Run with elevated privileges if appropriate"],
  },
  {
    keywords: [/file/i, /copy/i, /write/i, /read/i, /path/i, /directory/i],
    failureClass: "resource",
    description: "Disk full during file operation",
    probability: "low",
    triggers: ["No space left on device", "Large file exceeds available space", "Disk quota exceeded"],
    mitigations: ["Check available disk space", "Clean up temporary files"],
    recoveryActions: ["Free disk space and retry", "Use external storage if available"],
  },
  {
    keywords: [/file/i, /copy/i, /write/i, /read/i, /path/i, /directory/i],
    failureClass: "tool",
    description: "File or path not found",
    probability: "medium",
    triggers: ["Path does not exist", "File was deleted or moved", "Incorrect relative path"],
    mitigations: ["Verify paths before operations", "Use absolute paths when possible"],
    recoveryActions: ["Check path exists", "Correct the file path"],
  },
];

function generateId(cls: FailureClass, index: number): string {
  return `gen-${cls}-${index}-${Date.now().toString(36)}`;
}

function matchesKeywords(description: string, keywords: RegExp[]): boolean {
  return keywords.some(kw => kw.test(description));
}

function deduplicate(modes: FailureMode[]): FailureMode[] {
  const seen = new Map<string, FailureMode>();
  for (const mode of modes) {
    const key = `${mode.failureClass}:${mode.description}`;
    if (!seen.has(key)) {
      seen.set(key, mode);
    }
  }
  return [...seen.values()];
}

function applyEnvironmentConstraints(
  modes: FailureMode[],
  env: EnvironmentModel,
): FailureMode[] {
  const enhanced = [...modes];
  const constraintClasses = new Set<string>();

  for (const constraint of env.constraints) {
    if (constraint.type === "auth") {
      constraintClasses.add("auth");
      if (!enhanced.some(m => m.failureClass === "auth")) {
        enhanced.push({
          id: generateId("auth", enhanced.length),
          description: `Auth constraint detected: ${constraint.description}`,
          failureClass: "auth",
          probability: constraint.severity === "high" ? "high" : "medium",
          triggers: [constraint.description],
          mitigations: ["Address auth constraint before execution"],
          recoveryActions: ["Resolve authentication issue", "Verify credentials"],
        });
      }
    }

    if (constraint.type === "network") {
      constraintClasses.add("network");
      if (!enhanced.some(m => m.failureClass === "network")) {
        enhanced.push({
          id: generateId("network", enhanced.length),
          description: `Network constraint detected: ${constraint.description}`,
          failureClass: "network",
          probability: constraint.severity === "high" ? "high" : "medium",
          triggers: [constraint.description],
          mitigations: ["Verify network connectivity before execution"],
          recoveryActions: ["Check network access", "Retry with backoff"],
        });
      }
    }

    if (constraint.type === "rate-limit") {
      if (!enhanced.some(m => m.description.toLowerCase().includes("rate"))) {
        enhanced.push({
          id: generateId("resource", enhanced.length),
          description: `Rate limit constraint detected: ${constraint.description}`,
          failureClass: "resource",
          probability: constraint.severity === "high" ? "high" : "medium",
          triggers: [constraint.description],
          mitigations: ["Implement client-side rate limiting"],
          recoveryActions: ["Wait and retry with backoff"],
        });
      }
    }
  }

  for (const resource of env.resources) {
    if (!resource.available) {
      if (!enhanced.some(m => m.failureClass === "resource" && m.description.toLowerCase().includes(resource.type))) {
        enhanced.push({
          id: generateId("resource", enhanced.length),
          description: `Resource unavailable: ${resource.name} (${resource.type})`,
          failureClass: "resource",
          probability: "high",
          triggers: [`${resource.type} resource is not available`],
          mitigations: [`Provision ${resource.name} before execution`],
          recoveryActions: [`Free up ${resource.type} resource`, "Retry after resource cleanup"],
        });
      }
    }
  }

  for (const auth of env.authState) {
    if (!auth.authenticated) {
      if (!enhanced.some(m => m.failureClass === "auth" && m.description.toLowerCase().includes(auth.system.toLowerCase()))) {
        enhanced.push({
          id: generateId("auth", enhanced.length),
          description: `Not authenticated with ${auth.system}`,
          failureClass: "auth",
          probability: "high",
          triggers: [`${auth.system} authentication missing or expired`],
          mitigations: [`Authenticate with ${auth.system} before execution`],
          recoveryActions: [`Authenticate with ${auth.system}`, "Check credentials"],
        });
      }
    }
  }

  // Boost probability when env constraints match existing modes
  for (const mode of enhanced) {
    if (mode.probability !== "high") {
      if (mode.failureClass === "auth" && (env.constraints.some(c => c.type === "auth") || env.authState.some(a => !a.authenticated))) {
        mode.probability = "high";
      }
      if (mode.failureClass === "network" && env.constraints.some(c => c.type === "network")) {
        mode.probability = "high";
      }
      if (mode.failureClass === "resource" && env.resources.some(r => !r.available)) {
        mode.probability = "high";
      }
    }
  }

  return enhanced;
}

function buildRiskSummary(modes: FailureMode[]): string {
  if (modes.length === 0) {
    return "No significant risks identified.";
  }

  const high = modes.filter(m => m.probability === "high");
  const medium = modes.filter(m => m.probability === "medium");
  const low = modes.filter(m => m.probability === "low");

  const parts: string[] = [];

  if (high.length > 0) {
    const classes = [...new Set(high.map(m => m.failureClass))];
    parts.push(`${high.length} high-probability risk(s) in ${classes.join(", ")}`);
  }
  if (medium.length > 0) {
    parts.push(`${medium.length} medium-probability risk(s)`);
  }
  if (low.length > 0) {
    parts.push(`${low.length} low-probability risk(s)`);
  }

  const classCounts = new Map<FailureClass, number>();
  for (const mode of modes) {
    classCounts.set(mode.failureClass, (classCounts.get(mode.failureClass) ?? 0) + 1);
  }
  const topClasses = [...classCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cls, count]) => `${cls}(${count})`);

  return `${parts.join("; ")}. Top categories: ${topClasses.join(", ")}.`;
}

export function generateFailureModes(
  taskDescription: string,
  env?: EnvironmentModel,
  spec?: HarnessSpec,
): FailureModeGeneration {
  const matchedModes: FailureMode[] = [];

  for (const rule of PATTERN_RULES) {
    if (matchesKeywords(taskDescription, rule.keywords)) {
      matchedModes.push({
        id: generateId(rule.failureClass, matchedModes.length),
        description: rule.description,
        failureClass: rule.failureClass,
        probability: rule.probability,
        triggers: [...rule.triggers],
        mitigations: [...rule.mitigations],
        recoveryActions: [...rule.recoveryActions],
      });
    }
  }

  // For empty/unknown descriptions, add a baseline unknown mode
  if (matchedModes.length === 0) {
    matchedModes.push({
      id: generateId("unknown", 0),
      description: "Unrecognized task pattern — general execution risk",
      failureClass: "unknown",
      probability: "low",
      triggers: ["Task description does not match known patterns"],
      mitigations: ["Review task requirements carefully"],
      recoveryActions: ["Collect diagnostic information", "Escalate if unresolved"],
    });
  }

  let failureModes = deduplicate(matchedModes);

  if (env) {
    failureModes = applyEnvironmentConstraints(failureModes, env);
  }

  const riskSummary = buildRiskSummary(failureModes);
  const risks = failureModes.map(failureModeToRisk);

  return {
    taskDescription,
    failureModes,
    risks,
    generatedAt: Date.now(),
    riskSummary,
  };
}

const PROBABILITY_MAP: Record<"low" | "medium" | "high", number> = {
  low: 0.2,
  medium: 0.5,
  high: 0.8,
};

const IMPACT_MAP: Record<FailureClass, number> = {
  auth: 0.7,
  network: 0.6,
  resource: 0.5,
  semantic: 0.4,
  tool: 0.6,
  "environment-drift": 0.3,
  unknown: 0.3,
  human: 0.5,
};

export function probabilityToNumber(probability: "low" | "medium" | "high"): number {
  return PROBABILITY_MAP[probability];
}

export function failureClassToImpact(failureClass: FailureClass): number {
  return IMPACT_MAP[failureClass];
}

export function failureModeToRisk(mode: FailureMode): Risk {
  const probability = probabilityToNumber(mode.probability);
  const impact = failureClassToImpact(mode.failureClass);

  const mitigations: HarnessMutation[] = mode.mitigations.map((description) => ({
    type: "add-verification" as const,
    params: {},
    description,
  }));

  return {
    id: mode.id,
    probability,
    impact,
    score: probability * impact,
    signals: [...mode.triggers],
    mitigations,
    failureClass: mode.failureClass,
    description: mode.description,
  };
}

export function assessRisks(
  risks: Risk[],
  options?: { highRiskThreshold?: number },
): RiskAssessment {
  const highRiskThreshold = options?.highRiskThreshold ?? 0.7;

  if (risks.length === 0) {
    return {
      risks: [],
      overallScore: 0,
      highRiskThreshold,
      risksAboveThreshold: [],
    };
  }

  const overallScore = risks.reduce((sum, r) => sum + r.score, 0) / risks.length;
  const risksAboveThreshold = risks.filter((r) => r.score >= highRiskThreshold);

  return {
    risks,
    overallScore,
    highRiskThreshold,
    risksAboveThreshold,
  };
}
