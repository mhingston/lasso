import { describe, expect, it } from "vitest";
import { validateCirWorkflow } from "../../src/cir/validate.js";
import type { CirWorkflow } from "../../src/cir/types.js";

function createValidCirWorkflow(): CirWorkflow {
  return {
    name: "manual-cir",
    entryNodeId: "start",
    nodes: [
      {
        id: "start",
        kind: "tool",
        source: {
          specNodeId: "start",
          specNodeKind: "tool",
          specPath: "graph.nodes[0]"
        },
        action: {
          tool: "echo",
          args: ["start"]
        }
      },
      {
        id: "check",
        kind: "condition",
        source: {
          specNodeId: "check",
          specNodeKind: "condition",
          specPath: "graph.nodes[1]"
        },
        action: {
          conditionExpr: "result.ok"
        }
      },
      {
        id: "approve",
        kind: "human",
        source: {
          specNodeId: "approve",
          specNodeKind: "human",
          specPath: "graph.nodes[2]"
        },
        action: {
          prompt: "Approve?",
          interactionType: "approval"
        }
      },
      {
        id: "verify",
        kind: "tool",
        source: {
          specNodeId: "verify",
          specNodeKind: "tool",
          specPath: "graph.nodes[3]"
        },
        action: {
          tool: "npm",
          args: ["test"]
        }
      },
      {
        id: "join",
        kind: "merge",
        source: {
          specNodeId: "join",
          specNodeKind: "merge",
          specPath: "graph.nodes[4]"
        },
        action: {
          join: {
            waitFor: ["approve", "verify"],
            strategy: "all"
          }
        }
      },
      {
        id: "finish",
        kind: "subworkflow",
        source: {
          specNodeId: "finish",
          specNodeKind: "subworkflow",
          specPath: "graph.nodes[5]"
        },
        action: {
          specRef: "finish"
        },
        terminal: true
      },
      {
        id: "reject",
        kind: "subworkflow",
        source: {
          specNodeId: "reject",
          specNodeKind: "subworkflow",
          specPath: "graph.nodes[6]"
        },
        action: {
          specRef: "reject"
        },
        terminal: true
      }
    ],
    transitions: [
      {
        from: "start",
        to: "check",
        when: "success",
        source: {
          kind: "graph-edge",
          specPath: "graph.edges[0]"
        }
      },
      {
        from: "start",
        to: "verify",
        when: "success",
        source: {
          kind: "graph-edge",
          specPath: "graph.edges[1]"
        }
      },
      {
        from: "check",
        to: "approve",
        when: "condition-true",
        source: {
          kind: "condition-then",
          specNodeId: "check",
          specPath: "graph.nodes[1].thenNodeId"
        }
      },
      {
        from: "check",
        to: "reject",
        when: "condition-false",
        source: {
          kind: "condition-else",
          specNodeId: "check",
          specPath: "graph.nodes[1].elseNodeId"
        }
      },
      {
        from: "approve",
        to: "join",
        when: "success",
        source: {
          kind: "graph-edge",
          specPath: "graph.edges[2]"
        }
      },
      {
        from: "verify",
        to: "join",
        when: "success",
        source: {
          kind: "graph-edge",
          specPath: "graph.edges[3]"
        }
      },
      {
        from: "join",
        to: "finish",
        when: "success",
        source: {
          kind: "graph-edge",
          specPath: "graph.edges[4]"
        }
      }
    ]
  };
}

function cloneWorkflow(workflow: CirWorkflow): CirWorkflow {
  return structuredClone(workflow);
}

describe("validateCirWorkflow", () => {
  it("accepts a well-formed CIR workflow", () => {
    const result = validateCirWorkflow(createValidCirWorkflow());

    expect(result.valid).toBe(true);
  });

  it("rejects dangling transitions", () => {
    const workflow = cloneWorkflow(createValidCirWorkflow());
    workflow.transitions[0] = {
      ...workflow.transitions[0],
      to: "missing-node"
    };

    const result = validateCirWorkflow(workflow);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(error => error.includes("missing-node"))).toBe(true);
    }
  });

  it("allows unreachable verifier nodes when referenced by verification hooks", () => {
    const workflow = cloneWorkflow(createValidCirWorkflow());
    workflow.nodes.push({
      id: "orphan-check",
      kind: "tool",
      source: {
        specNodeId: "orphan-check",
        specNodeKind: "tool",
        specPath: "graph.nodes[99]"
      },
      action: {
        tool: "echo",
        args: ["orphan"]
      },
      terminal: true
    });

    const startNode = workflow.nodes.find(node => node.id === "start");
    if (!startNode || startNode.kind !== "tool") {
      throw new Error("start node is missing");
    }

    startNode.verification = [
      {
        kind: "tool",
        checkNodeId: "orphan-check",
        onFail: "block"
      }
    ];

    const result = validateCirWorkflow(workflow);

    expect(result.valid).toBe(true);
  });

  it("rejects non-terminal nodes with no follow-on transition", () => {
    const workflow = cloneWorkflow(createValidCirWorkflow());
    workflow.transitions = workflow.transitions.filter(transition => !(transition.from === "join" && transition.to === "finish"));

    const result = validateCirWorkflow(workflow);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(error => error.includes("join") && error.includes("outgoing"))).toBe(true);
    }
  });

  it("rejects condition nodes that branch to themselves", () => {
    const workflow = cloneWorkflow(createValidCirWorkflow());
    workflow.transitions = workflow.transitions.map(transition =>
      transition.from === "check" && transition.when === "condition-true"
        ? {
            ...transition,
            to: "check"
          }
        : transition,
    );

    const result = validateCirWorkflow(workflow);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(error => error.includes("Condition node check cannot branch to itself"))).toBe(true);
    }
  });

  it("rejects retry metadata on unsupported node kinds", () => {
    const workflow = cloneWorkflow(createValidCirWorkflow());
    const approveNode = workflow.nodes.find(node => node.id === "approve");
    if (!approveNode || approveNode.kind !== "human") {
      throw new Error("approve node is missing");
    }

    approveNode.retry = {
      maxAttempts: 2,
      backoff: "linear"
    };

    const result = validateCirWorkflow(workflow);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(error => error.includes("retry") && error.includes("approve"))).toBe(true);
    }
  });

  it("rejects merge nodes fed by non-success transitions", () => {
    const workflow = cloneWorkflow(createValidCirWorkflow());
    workflow.transitions = workflow.transitions.map(transition =>
      transition.from === "approve" && transition.to === "join"
        ? {
            ...transition,
            when: "condition-true"
          }
        : transition,
    );

    const result = validateCirWorkflow(workflow);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          error => error.includes("Merge node join can only receive success transitions") && error.includes("approve"),
        ),
      ).toBe(true);
    }
  });

  it("rejects verification hooks attached to nodes without post-node outputs", () => {
    const workflow = cloneWorkflow(createValidCirWorkflow());
    const joinNode = workflow.nodes.find(node => node.id === "join");
    if (!joinNode || joinNode.kind !== "merge") {
      throw new Error("join node is missing");
    }

    joinNode.verification = [
      {
        checkNodeId: "verify",
        onFail: "block"
      }
    ];

    const result = validateCirWorkflow(workflow);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(error => error.includes("verification") && error.includes("join"))).toBe(true);
    }
  });

  it("rejects verification hooks that target unsupported verifier node kinds", () => {
    const workflow = cloneWorkflow(createValidCirWorkflow());
    const startNode = workflow.nodes.find(node => node.id === "start");
    if (!startNode || startNode.kind !== "tool") {
      throw new Error("start node is missing");
    }

    startNode.verification = [
      {
        checkNodeId: "check",
        onFail: "block"
      }
    ];

    const result = validateCirWorkflow(workflow);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(error => error.includes("check") && error.toLowerCase().includes("verification"))).toBe(true);
    }
  });

  it("rejects merge joins whose waitFor set does not match incoming transitions", () => {
    const workflow = cloneWorkflow(createValidCirWorkflow());
    const joinNode = workflow.nodes.find(node => node.id === "join");
    if (!joinNode || joinNode.kind !== "merge") {
      throw new Error("join node is missing");
    }

    joinNode.action.join.waitFor = ["approve", "start"];

    const result = validateCirWorkflow(workflow);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(error => error.includes("waitFor") && error.includes("start"))).toBe(true);
    }
  });
});
