import { describe, expect, it } from "vitest";
import { lowerHarnessSpecToCir } from "../../src/cir/lower.js";
import { validateCirWorkflow } from "../../src/cir/validate.js";
import type { HarnessSpec } from "../../src/spec/types.js";

function createCanonicalHarnessSpec(): HarnessSpec {
  return {
    name: "pr-review-merge",
    executionPolicy: {
      timeout: 300,
      continueOnFailure: false,
      failureClassification: [
        {
          pattern: "timeout",
          category: "transient",
          retry: true
        }
      ]
    },
    humanPolicy: {
      defaultTimeout: 900,
      allowAsync: true,
      notificationChannels: ["slack"]
    },
    observabilityPolicy: {
      tracing: true,
      metrics: true,
      logLevel: "info"
    },
    graph: {
      entryNodeId: "load-pr",
      nodes: [
        {
          id: "load-pr",
          kind: "tool",
          tool: "git",
          args: ["diff", "main...feature"],
          retryPolicy: {
            maxAttempts: 3,
            backoff: "exponential",
            initialDelay: 5,
            retryOn: ["transient"]
          }
        },
        {
          id: "verify-pr",
          kind: "tool",
          tool: "npm",
          args: ["test"],
          executionPolicy: {
            timeout: 60
          },
          verificationPolicy: {
            rules: [
              {
                checkNodeId: "post-verify-check",
                onFail: "retry",
                maxAttempts: 2
              }
            ]
          }
        },
        {
          id: "review-ok",
          kind: "condition",
          condition: "review.clean",
          thenNodeId: "human-approval",
          elseNodeId: "end-rejected"
        },
        {
          id: "human-approval",
          kind: "human",
          prompt: "Approve merge?",
          interactionType: "approval"
        },
        {
          id: "merge",
          kind: "merge",
          waitFor: ["post-verify-check", "human-approval"]
        },
        {
          id: "finish",
          kind: "subworkflow",
          specRef: "local-merge",
          inputs: {
            merge: {
              strategy: "squash"
            },
            dryRun: false
          }
        },
        {
          id: "end-rejected",
          kind: "subworkflow",
          specRef: "reject-pr"
        },
        {
          id: "post-verify-check",
          kind: "llm",
          provider: "anthropic",
          model: "claude-sonnet",
          prompt: "Did the verification output indicate success?"
        }
      ],
      edges: [
        { from: "load-pr", to: "verify-pr" },
        { from: "load-pr", to: "review-ok" },
        { from: "verify-pr", to: "post-verify-check" },
        { from: "post-verify-check", to: "merge" },
        { from: "human-approval", to: "merge" },
        { from: "merge", to: "finish" }
      ]
    }
  };
}

describe("lowerHarnessSpecToCir", () => {
  it("lowers a canonical harness spec into explicit CIR actions and transitions", () => {
    const workflow = lowerHarnessSpecToCir(createCanonicalHarnessSpec());
    expect(validateCirWorkflow(workflow).valid).toBe(true);

    expect(workflow).toMatchObject({
      name: "pr-review-merge",
      entryNodeId: "load-pr",
      globalPolicies: {
        execution: {
          timeout: 300,
          continueOnFailure: false,
          failureClassification: [
            {
              pattern: "timeout",
              category: "transient",
              retry: true
            }
          ]
        },
        human: {
          defaultTimeout: 900,
          allowAsync: true,
          notificationChannels: ["slack"]
        },
        observability: {
          tracing: true,
          metrics: true,
          logLevel: "info"
        }
      }
    });

    const nodeMap = new Map(workflow.nodes.map(node => [node.id, node]));

    expect(nodeMap.get("load-pr")).toMatchObject({
      kind: "tool",
      source: {
        specNodeId: "load-pr",
        specNodeKind: "tool",
        specPath: "graph.nodes[0]"
      },
      retry: {
        maxAttempts: 3,
        backoff: "exponential",
        initialDelay: 5,
        retryOn: ["transient"]
      },
      execution: {
        timeout: 300,
        continueOnFailure: false
      },
      failureRouting: [
        {
          pattern: "timeout",
          category: "transient",
          retry: true
        }
      ],
      action: {
        tool: "git",
        args: ["diff", "main...feature"]
      }
    });

    expect(nodeMap.get("verify-pr")).toMatchObject({
      kind: "tool",
      execution: {
        timeout: 60,
        continueOnFailure: false
      },
      failureRouting: [
        {
          pattern: "timeout",
          category: "transient",
          retry: true
        }
      ],
      verification: [
        {
          checkNodeId: "post-verify-check",
          onFail: "retry",
          maxAttempts: 2
        }
      ]
    });

    expect(nodeMap.get("review-ok")).toMatchObject({
      kind: "condition",
      action: {
        conditionExpr: "review.clean"
      }
    });

    expect(nodeMap.get("human-approval")).toMatchObject({
      kind: "human",
      action: {
        prompt: "Approve merge?",
        interactionType: "approval",
        timeout: 900
      }
    });

    expect(nodeMap.get("merge")).toMatchObject({
      kind: "merge",
      action: {
        join: {
          waitFor: ["post-verify-check", "human-approval"],
          strategy: "all"
        }
      }
    });

    expect(nodeMap.get("finish")).toMatchObject({
      kind: "subworkflow",
      action: {
        inputs: {
          merge: {
            strategy: "squash"
          },
          dryRun: false
        }
      },
      terminal: true
    });

    expect(nodeMap.get("end-rejected")).toMatchObject({
      kind: "subworkflow",
      terminal: true
    });

    expect(workflow.transitions).toEqual(
      expect.arrayContaining([
        {
          from: "load-pr",
          to: "verify-pr",
          when: "success",
          source: {
            kind: "graph-edge",
            specPath: "graph.edges[0]"
          }
        },
        {
          from: "load-pr",
          to: "review-ok",
          when: "success",
          source: {
            kind: "graph-edge",
            specPath: "graph.edges[1]"
          }
        },
        {
          from: "review-ok",
          to: "human-approval",
          when: "condition-true",
          source: {
            kind: "condition-then",
            specNodeId: "review-ok",
            specPath: "graph.nodes[2].thenNodeId"
          }
        },
        {
          from: "review-ok",
          to: "end-rejected",
          when: "condition-false",
          source: {
            kind: "condition-else",
            specNodeId: "review-ok",
            specPath: "graph.nodes[2].elseNodeId"
          }
        },
        {
          from: "verify-pr",
          to: "post-verify-check",
          when: "success",
          source: {
            kind: "graph-edge",
            specPath: "graph.edges[2]"
          }
        },
        {
          from: "post-verify-check",
          to: "merge",
          when: "success",
          source: {
            kind: "graph-edge",
            specPath: "graph.edges[3]"
          }
        },
        {
          from: "human-approval",
          to: "merge",
          when: "success",
          source: {
            kind: "graph-edge",
            specPath: "graph.edges[4]"
          }
        },
        {
          from: "merge",
          to: "finish",
          when: "success",
          source: {
            kind: "graph-edge",
            specPath: "graph.edges[5]"
          }
        }
      ])
    );

    expect(
      workflow.transitions.filter(transition => transition.from === "review-ok").map(transition => transition.when),
    ).toEqual(["condition-true", "condition-false"]);
  });

  it("rejects condition nodes that also declare outgoing graph edges", () => {
    const spec: HarnessSpec = {
      name: "ambiguous-condition",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "tool",
            tool: "echo",
            args: ["start"]
          },
          {
            id: "branch",
            kind: "condition",
            condition: "result.ok",
            thenNodeId: "yes",
            elseNodeId: "no"
          },
          {
            id: "yes",
            kind: "tool",
            tool: "echo",
            args: ["yes"]
          },
          {
            id: "no",
            kind: "tool",
            tool: "echo",
            args: ["no"]
          }
        ],
        edges: [
          {
            from: "start",
            to: "branch"
          },
          {
            from: "branch",
            to: "yes"
          }
        ]
      }
    };

    expect(() => lowerHarnessSpecToCir(spec)).toThrow(/Condition node "branch" cannot declare outgoing graph edges/);
  });

  it("clones mutable retry and subworkflow input structures out of the spec", () => {
    const spec = createCanonicalHarnessSpec();
    const workflow = lowerHarnessSpecToCir(spec);
    const loadPrNode = spec.graph.nodes.find(node => node.id === "load-pr");
    const finishNode = spec.graph.nodes.find(node => node.id === "finish");

    if (!loadPrNode || loadPrNode.kind !== "tool" || !loadPrNode.retryPolicy?.retryOn) {
      throw new Error("load-pr retry policy is missing");
    }

    if (!finishNode || finishNode.kind !== "subworkflow" || !finishNode.inputs) {
      throw new Error("finish inputs are missing");
    }

    loadPrNode.retryPolicy.retryOn[0] = "resource";
    (finishNode.inputs as { merge: { strategy: string } }).merge.strategy = "merge-commit";

    const nodeMap = new Map(workflow.nodes.map(node => [node.id, node]));

    expect(nodeMap.get("load-pr")).toMatchObject({
      retry: {
        retryOn: ["transient"]
      }
    });

    expect(nodeMap.get("finish")).toMatchObject({
      action: {
        inputs: {
          merge: {
            strategy: "squash"
          },
          dryRun: false
        }
      }
    });
  });
});
