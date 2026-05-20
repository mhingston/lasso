import type {
  EnvironmentModel,
  EnvironmentAnalysis,
  ToolCapability,
  Constraint,
} from "./types.js";

export function analyzeEnvironment(
  model: EnvironmentModel,
  requiredTools?: string[]
): EnvironmentAnalysis {
  const matchedTools: ToolCapability[] = [];
  const missingTools: string[] = [];

  if (requiredTools && requiredTools.length > 0) {
    for (const toolName of requiredTools) {
      const found = model.tools.find(t => t.name === toolName);
      if (found && found.available) {
        matchedTools.push(found);
      } else {
        missingTools.push(toolName);
      }
    }
  }

  const highRiskConstraints = model.constraints.filter(c => c.severity === "high");

  const totalRequired = requiredTools?.length ?? 0;
  let readinessScore = totalRequired > 0
    ? Math.round((matchedTools.length / totalRequired) * 100)
    : 100;

  for (const constraint of highRiskConstraints) {
    readinessScore = Math.max(0, readinessScore - 20);
  }

  const preparatorySteps: string[] = [];

  for (const missing of missingTools) {
    preparatorySteps.push(`Install missing tool: ${missing}`);
  }

  for (const constraint of model.constraints) {
    if (constraint.severity === "high" || constraint.severity === "medium") {
      preparatorySteps.push(`Address constraint: ${constraint.description}`);
    }
  }

  return {
    matchedTools,
    missingTools,
    highRiskConstraints,
    readinessScore,
    preparatorySteps,
  };
}
