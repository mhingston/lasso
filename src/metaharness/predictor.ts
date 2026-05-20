import type { HarnessSpec, TaskNode } from "../spec/types.js";
import type { EnvironmentModel } from "../environment/types.js";
import type { FailureSignature } from "../failures/ontology.js";

const DISK_CRITICAL_THRESHOLD = 90;

export function predictFailuresFromEnvironment(
  spec: HarnessSpec,
  env: EnvironmentModel,
): FailureSignature[] {
  const failures: FailureSignature[] = [];

  for (const node of spec.graph.nodes) {
    const nodeFailures = predictNodeFailures(node, env);
    failures.push(...nodeFailures);
  }

  const constraintFailures = predictConstraintFailures(env);
  failures.push(...constraintFailures);

  const authFailures = predictAuthFailures(spec, env);
  failures.push(...authFailures);

  const resourceFailures = predictResourceFailures(env);
  failures.push(...resourceFailures);

  return failures;
}

function predictNodeFailures(
  node: TaskNode,
  env: EnvironmentModel,
): FailureSignature[] {
  if (node.kind !== "tool") {
    return [];
  }

  const toolName = node.tool;
  const availableTool = env.tools.find(t => t.name === toolName);

  if (!availableTool || !availableTool.available) {
    return [
      {
        class: "tool",
        confidence: 0.85,
        evidence: [
          `node: ${node.id}`,
          `tool "${toolName}" is not available in environment`,
        ],
        suggestedRecovery: [
          `Install "${toolName}" and ensure it is in PATH`,
          "Verify tool version compatibility",
        ],
        retryable: false,
        requiresHumanIntervention: true,
      },
    ];
  }

  return [];
}

function predictConstraintFailures(env: EnvironmentModel): FailureSignature[] {
  const failures: FailureSignature[] = [];

  for (const constraint of env.constraints) {
    if (constraint.severity === "high") {
      failures.push({
        class: constraint.type === "auth" ? "auth" : "unknown",
        confidence: 0.8,
        evidence: [
          `constraint: ${constraint.description}`,
          `severity: ${constraint.severity}`,
        ],
        suggestedRecovery: [
          `Address constraint: ${constraint.description}`,
          "Review environment configuration",
        ],
        retryable: false,
        requiresHumanIntervention: constraint.type === "auth" || constraint.type === "permission",
      });
    }
  }

  return failures;
}

function predictAuthFailures(
  spec: HarnessSpec,
  env: EnvironmentModel,
): FailureSignature[] {
  const failures: FailureSignature[] = [];

  for (const auth of env.authState) {
    if (!auth.authenticated) {
      failures.push({
        class: "auth",
        confidence: 0.9,
        evidence: [
          `system "${auth.system}" is not authenticated`,
        ],
        suggestedRecovery: [
          `Authenticate with "${auth.system}" before running harness`,
          "Check token expiry and renew if necessary",
          "Verify API keys or secrets are correctly configured",
        ],
        retryable: false,
        requiresHumanIntervention: true,
      });
    }
  }

  return failures;
}

function predictResourceFailures(env: EnvironmentModel): FailureSignature[] {
  const failures: FailureSignature[] = [];

  for (const resource of env.resources) {
    if (!resource.available) {
      failures.push({
        class: "resource",
        confidence: 0.9,
        evidence: [
          `resource "${resource.name}" is not available`,
          `type: ${resource.type}`,
        ],
        suggestedRecovery: [
          `Free up or provision "${resource.name}" resource`,
          "Check available disk space and clean up if necessary",
        ],
        retryable: true,
        requiresHumanIntervention: false,
      });
      continue;
    }

    if (resource.type === "disk" && resource.usage) {
      const usagePct = parseUsagePercentage(resource.usage);
      if (usagePct >= DISK_CRITICAL_THRESHOLD) {
        failures.push({
          class: "resource",
          confidence: 0.85,
          evidence: [
            `disk usage is critical: ${resource.usage}`,
            `threshold: ${DISK_CRITICAL_THRESHOLD}%`,
          ],
          suggestedRecovery: [
            "Clean up disk space before running harness",
            "Remove temporary files and unused artifacts",
          ],
          retryable: true,
          requiresHumanIntervention: false,
        });
      }
    }
  }

  return failures;
}

function parseUsagePercentage(usage: string): number {
  const match = usage.match(/(\d+)%/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return 0;
}
