import { validateHarnessSpec } from "../spec/validate.js";
import type { ExecutionPolicy, HarnessSpec, TaskNode, VerificationRule } from "../spec/types.js";
import type {
  CirExecutionPolicy,
  CirFailureRoutingHint,
  CirGlobalPolicies,
  CirNode,
  CirTransition,
  CirVerificationHook,
  CirWorkflow,
} from "./types.js";

export function lowerHarnessSpecToCir(spec: HarnessSpec): CirWorkflow {
  const validation = validateHarnessSpec(spec);
  if (!validation.valid) {
    throw new Error(`HarnessSpec validation failed:\n- ${validation.errors.join("\n- ")}`);
  }

  const conditionNodeIds = new Set(
    spec.graph.nodes.filter((node): node is Extract<TaskNode, { kind: "condition" }> => node.kind === "condition").map(node => node.id),
  );

  for (const edge of spec.graph.edges) {
    if (conditionNodeIds.has(edge.from)) {
      throw new Error(`Condition node "${edge.from}" cannot declare outgoing graph edges; use thenNodeId/elseNodeId instead`);
    }
  }

  const transitions = [
    ...lowerGraphEdges(spec),
    ...lowerConditionTransitions(spec),
  ];

  const nodes = spec.graph.nodes.map((node, index) => lowerNode(spec, node, index, transitions));
  const globalPolicies = lowerGlobalPolicies(spec);

  return {
    name: spec.name,
    entryNodeId: spec.graph.entryNodeId,
    nodes,
    transitions,
    ...(globalPolicies ? { globalPolicies } : {}),
  };
}

function lowerGraphEdges(spec: HarnessSpec): CirTransition[] {
  return spec.graph.edges.map((edge, index) => ({
    from: edge.from,
    to: edge.to,
    when: "success",
    source: {
      kind: "graph-edge",
      specPath: `graph.edges[${index}]`,
    },
  }));
}

function lowerConditionTransitions(spec: HarnessSpec): CirTransition[] {
  return spec.graph.nodes.flatMap((node, index) => {
    if (node.kind !== "condition") {
      return [];
    }

    return [
      {
        from: node.id,
        to: node.thenNodeId,
        when: "condition-true" as const,
        source: {
          kind: "condition-then" as const,
          specNodeId: node.id,
          specPath: `graph.nodes[${index}].thenNodeId`,
        },
      },
      {
        from: node.id,
        to: node.elseNodeId,
        when: "condition-false" as const,
        source: {
          kind: "condition-else" as const,
          specNodeId: node.id,
          specPath: `graph.nodes[${index}].elseNodeId`,
        },
      },
    ];
  });
}

function lowerNode(spec: HarnessSpec, node: TaskNode, index: number, transitions: CirTransition[]): CirNode {
  const { execution, failureRouting } = resolveNodeExecution(spec.executionPolicy, node.executionPolicy);
  const verification = lowerVerification(node.verificationPolicy?.rules);
  const outgoingCount = transitions.filter(transition => transition.from === node.id).length;
  const resolvedHumanTimeout = node.kind === "human" ? node.timeout ?? spec.humanPolicy?.defaultTimeout : undefined;
  const baseNode = {
    id: node.id,
    kind: node.kind,
    source: {
      specNodeId: node.id,
      specNodeKind: node.kind,
      specPath: `graph.nodes[${index}]`,
      ...(node.label ? { label: node.label } : {}),
    },
    ...(execution ? { execution } : {}),
    ...(node.retryPolicy ? { retry: cloneRetryPolicy(node.retryPolicy) } : {}),
    ...(verification ? { verification } : {}),
    ...(failureRouting ? { failureRouting } : {}),
    ...(node.guardrails ? { guardrails: { ...node.guardrails } } : {}),
    ...(node.verificationHooks ? { verificationHooks: node.verificationHooks.map(h => ({ ...h })) } : {}),
    terminal: outgoingCount === 0,
  } as const;

  switch (node.kind) {
    case "tool":
      return {
        ...baseNode,
        kind: "tool",
        action: {
          tool: node.tool,
          args: [...node.args],
          ...(node.env ? { env: { ...node.env } } : {}),
          ...(node.cwd ? { cwd: node.cwd } : {}),
        },
      };
    case "llm":
      return {
        ...baseNode,
        kind: "llm",
        action: {
          provider: node.provider,
          model: node.model,
          prompt: node.prompt,
          ...(node.system ? { system: node.system } : {}),
          ...(node.temperature !== undefined ? { temperature: node.temperature } : {}),
          ...(node.maxTokens !== undefined ? { maxTokens: node.maxTokens } : {}),
        },
      };
    case "human":
      return {
        ...baseNode,
        kind: "human",
        action: {
          prompt: node.prompt,
          interactionType: node.interactionType,
          ...(node.options ? { options: [...node.options] } : {}),
          ...(resolvedHumanTimeout !== undefined ? { timeout: resolvedHumanTimeout } : {}),
        },
      };
    case "condition":
      return {
        ...baseNode,
        kind: "condition",
        action: {
          conditionExpr: node.condition,
        },
      };
    case "merge":
      return {
        ...baseNode,
        kind: "merge",
        action: {
          join: {
            waitFor: [...node.waitFor],
            strategy: node.strategy ?? "all",
          },
        },
      };
    case "subworkflow":
      return {
        ...baseNode,
        kind: "subworkflow",
        action: {
          specRef: node.specRef,
          ...(node.inputs ? { inputs: structuredClone(node.inputs as Record<string, unknown>) } : {}),
        },
      };
  }
}

function resolveNodeExecution(
  globalExecutionPolicy: ExecutionPolicy | undefined,
  nodeExecutionPolicy: ExecutionPolicy | undefined,
): {
  execution?: CirExecutionPolicy;
  failureRouting?: CirFailureRoutingHint[];
} {
  if (!globalExecutionPolicy && !nodeExecutionPolicy) {
    return {};
  }

  const mergedExecutionPolicy = {
    ...(globalExecutionPolicy ?? {}),
    ...(nodeExecutionPolicy ?? {}),
  };
  const { failureClassification, ...execution } = mergedExecutionPolicy;

  return {
    execution: Object.keys(execution).length > 0 ? execution : undefined,
    failureRouting: failureClassification?.map(classification => ({ ...classification })),
  };
}

function lowerVerification(rules: VerificationRule[] | undefined): CirVerificationHook[] | undefined {
  if (!rules || rules.length === 0) {
    return undefined;
  }

  return rules.map(rule => ({
    kind: rule.kind,
    checkNodeId: rule.checkNodeId,
    onFail: rule.onFail,
    ...(rule.maxAttempts !== undefined ? { maxAttempts: rule.maxAttempts } : {}),
  }));
}

function cloneRetryPolicy(retryPolicy: TaskNode["retryPolicy"]): NonNullable<TaskNode["retryPolicy"]> {
  return {
    ...retryPolicy,
    ...(retryPolicy.retryOn ? { retryOn: [...retryPolicy.retryOn] } : {}),
  };
}

function lowerGlobalPolicies(spec: HarnessSpec): CirGlobalPolicies | undefined {
  const globalPolicies: CirGlobalPolicies = {};

  if (spec.executionPolicy) {
    globalPolicies.execution = {
      ...spec.executionPolicy,
      ...(spec.executionPolicy.failureClassification
        ? {
            failureClassification: spec.executionPolicy.failureClassification.map(classification => ({ ...classification })),
          }
        : {}),
    };
  }

  if (spec.humanPolicy) {
    globalPolicies.human = {
      ...spec.humanPolicy,
      ...(spec.humanPolicy.notificationChannels
        ? { notificationChannels: [...spec.humanPolicy.notificationChannels] }
        : {}),
    };
  }

  if (spec.observabilityPolicy) {
    globalPolicies.observability = {
      ...spec.observabilityPolicy,
      ...(spec.observabilityPolicy.logDestinations
        ? { logDestinations: [...spec.observabilityPolicy.logDestinations] }
        : {}),
    };
  }

  return Object.keys(globalPolicies).length > 0 ? globalPolicies : undefined;
}
