import { describe, expect, it } from "vitest";
import { validateHarnessSpec } from "../../src/spec/validate.js";
import type { HarnessSpec } from "../../src/spec/types.js";

describe("validateHarnessSpec", () => {
  it("accepts a valid minimal spec", () => {
    const spec: HarnessSpec = {
      name: "pr-review-merge",
      graph: {
        entryNodeId: "load-pr",
        nodes: [
          {
            id: "load-pr",
            kind: "tool",
            tool: "gh",
            args: ["pr", "view", "123"]
          }
        ],
        edges: []
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(true);
  });

  it("rejects spec with missing node ID", () => {
    const spec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            // missing id
            kind: "tool",
            tool: "echo",
            args: ["hello"]
          }
        ],
        edges: []
      }
    } as any;

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes("id"))).toBe(true);
    }
  });

  it("rejects spec with duplicate node IDs", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "node1",
        nodes: [
          {
            id: "node1",
            kind: "tool",
            tool: "echo",
            args: ["first"]
          },
          {
            id: "node1",
            kind: "tool",
            tool: "echo",
            args: ["second"]
          }
        ],
        edges: []
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("duplicate") || e.includes("node1"))).toBe(true);
    }
  });

  it("rejects spec with unreachable node", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "tool",
            tool: "echo",
            args: ["hello"]
          },
          {
            id: "orphan",
            kind: "tool",
            tool: "echo",
            args: ["unreachable"]
          }
        ],
        edges: []
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("unreachable") || e.includes("orphan"))).toBe(true);
    }
  });

  it("rejects spec with invalid edge target", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "tool",
            tool: "echo",
            args: ["hello"]
          }
        ],
        edges: [
          {
            from: "start",
            to: "nonexistent"
          }
        ]
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("nonexistent") || e.includes("invalid"))).toBe(true);
    }
  });

  it("rejects retry policy applied to unsupported node kinds", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "merge",
        nodes: [
          {
            id: "merge",
            kind: "merge",
            waitFor: ["branch1", "branch2"],
            retryPolicy: {
              maxAttempts: 3,
              backoff: "exponential"
            }
          },
          {
            id: "branch1",
            kind: "tool",
            tool: "echo",
            args: ["1"]
          },
          {
            id: "branch2",
            kind: "tool",
            tool: "echo",
            args: ["2"]
          }
        ],
        edges: []
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("retry") && e.includes("merge"))).toBe(true);
    }
  });

  it("rejects verification rule referencing a missing node", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "tool",
            tool: "echo",
            args: ["hello"],
            verificationPolicy: {
              rules: [
                {
                  checkNodeId: "nonexistent-check",
                  onFail: "block"
                }
              ]
            }
          }
        ],
        edges: []
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("nonexistent-check") || e.includes("verification"))).toBe(true);
    }
  });

  // Issue 1: Reject edges with condition property
  it("rejects edges with condition property", () => {
    const spec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "tool",
            tool: "echo",
            args: ["hello"]
          },
          {
            id: "next",
            kind: "tool",
            tool: "echo",
            args: ["world"]
          }
        ],
        edges: [
          {
            from: "start",
            to: "next",
            condition: "some.expr"
          }
        ]
      }
    } as any;

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("additional properties") && e.includes("edges"))).toBe(true);
    }
  });

  // Issue 2: Reject nodes with arbitrary extra properties
  it("rejects nodes with unsupported properties", () => {
    const spec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "tool",
            tool: "echo",
            args: ["hello"],
            unsupportedField: "should be rejected"
          }
        ],
        edges: []
      }
    } as any;

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("additional properties"))).toBe(true);
    }
  });

  // Issue 3: Reject verification self-reference
  it("rejects verification rule that references itself", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "tool",
            tool: "echo",
            args: ["hello"],
            verificationPolicy: {
              rules: [
                {
                  checkNodeId: "start",
                  onFail: "block"
                }
              ]
            }
          }
        ],
        edges: []
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("cannot reference itself"))).toBe(true);
    }
  });

  // Issue 3: Reject circular verification dependencies
  it("rejects circular verification dependencies", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "nodeA",
        nodes: [
          {
            id: "nodeA",
            kind: "tool",
            tool: "echo",
            args: ["A"],
            verificationPolicy: {
              rules: [
                {
                  checkNodeId: "nodeB",
                  onFail: "block"
                }
              ]
            }
          },
          {
            id: "nodeB",
            kind: "tool",
            tool: "echo",
            args: ["B"],
            verificationPolicy: {
              rules: [
                {
                  checkNodeId: "nodeA",
                  onFail: "block"
                }
              ]
            }
          }
        ],
        edges: []
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("Circular verification dependency"))).toBe(true);
    }
  });

  // Issue 1: Reject 3-node verification cycle
  it("rejects 3-node verification cycle", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "nodeA",
        nodes: [
          {
            id: "nodeA",
            kind: "tool",
            tool: "echo",
            args: ["A"],
            verificationPolicy: {
              rules: [
                {
                  checkNodeId: "nodeB",
                  onFail: "block"
                }
              ]
            }
          },
          {
            id: "nodeB",
            kind: "tool",
            tool: "echo",
            args: ["B"],
            verificationPolicy: {
              rules: [
                {
                  checkNodeId: "nodeC",
                  onFail: "block"
                }
              ]
            }
          },
          {
            id: "nodeC",
            kind: "tool",
            tool: "echo",
            args: ["C"],
            verificationPolicy: {
              rules: [
                {
                  checkNodeId: "nodeA",
                  onFail: "block"
                }
              ]
            }
          }
        ],
        edges: []
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("Circular verification dependency"))).toBe(true);
    }
  });

  // Issue 2: Reject empty string identifiers
  it("rejects empty node id", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "",
            kind: "tool",
            tool: "echo",
            args: ["hello"]
          }
        ],
        edges: []
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("fewer than 1 characters"))).toBe(true);
    }
  });

  it("rejects empty entryNodeId", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "",
        nodes: [
          {
            id: "start",
            kind: "tool",
            tool: "echo",
            args: ["hello"]
          }
        ],
        edges: []
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("fewer than 1 characters"))).toBe(true);
    }
  });

  it("rejects empty edge from/to", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "tool",
            tool: "echo",
            args: ["hello"]
          },
          {
            id: "next",
            kind: "tool",
            tool: "echo",
            args: ["world"]
          }
        ],
        edges: [
          {
            from: "",
            to: "next"
          }
        ]
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("fewer than 1 characters"))).toBe(true);
    }
  });

  it("rejects empty tool name", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "tool",
            tool: "",
            args: ["hello"]
          }
        ],
        edges: []
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("fewer than 1 characters"))).toBe(true);
    }
  });

  it("rejects empty LLM provider/model/prompt", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "llm",
            provider: "",
            model: "gpt-4",
            prompt: "test"
          }
        ],
        edges: []
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("fewer than 1 characters"))).toBe(true);
    }
  });

  it("rejects empty condition fields", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "condition",
            condition: "",
            thenNodeId: "then",
            elseNodeId: "else"
          },
          {
            id: "then",
            kind: "tool",
            tool: "echo",
            args: ["then"]
          },
          {
            id: "else",
            kind: "tool",
            tool: "echo",
            args: ["else"]
          }
        ],
        edges: []
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("fewer than 1 characters"))).toBe(true);
    }
  });

  it("rejects empty checkNodeId in verification", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "tool",
            tool: "echo",
            args: ["hello"],
            verificationPolicy: {
              rules: [
                {
                  checkNodeId: "",
                  onFail: "block"
                }
              ]
            }
          }
        ],
        edges: []
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("fewer than 1 characters"))).toBe(true);
    }
  });

  // Issue 3: Reject non-string env values
  it("rejects non-string env values", () => {
    const spec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "tool",
            tool: "echo",
            args: ["hello"],
            env: {
              VAR1: "string-value",
              VAR2: 123
            }
          }
        ],
        edges: []
      }
    } as any;

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("must be string") || e.includes("type"))).toBe(true);
    }
  });

  // Issue 1: Reject orphan subgraph
  it("rejects orphan subgraph disconnected from entry", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            kind: "tool",
            tool: "echo",
            args: ["connected"]
          },
          {
            id: "orphan",
            kind: "tool",
            tool: "echo",
            args: ["orphan1"]
          },
          {
            id: "orphan2",
            kind: "tool",
            tool: "echo",
            args: ["orphan2"]
          }
        ],
        edges: [
          {
            from: "orphan",
            to: "orphan2"
          }
        ]
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("Unreachable") && (e.includes("orphan") || e.includes("orphan2")))).toBe(true);
    }
  });

  // Issue 2: Reject choice interaction without options
  it("rejects choice interaction without options", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "ask",
        nodes: [
          {
            id: "ask",
            kind: "human",
            prompt: "Choose an option",
            interactionType: "choice"
          }
        ],
        edges: []
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("choice") && e.includes("options"))).toBe(true);
    }
  });

  it("rejects choice interaction with empty options", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "ask",
        nodes: [
          {
            id: "ask",
            kind: "human",
            prompt: "Choose an option",
            interactionType: "choice",
            options: []
          }
        ],
        edges: []
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("choice") && e.includes("options"))).toBe(true);
    }
  });

  // Issue 3: Reject empty waitFor array
  it("rejects merge node with empty waitFor", () => {
    const spec: HarnessSpec = {
      name: "test-workflow",
      graph: {
        entryNodeId: "merge",
        nodes: [
          {
            id: "merge",
            kind: "merge",
            waitFor: []
          }
        ],
        edges: []
      }
    };

    const result = validateHarnessSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("waitFor") || e.includes("minItems"))).toBe(true);
    }
  });

  describe("verification rule kind validation", () => {
    it("accepts tool verification rule pointing to tool node", () => {
      const spec: HarnessSpec = {
        name: "test-workflow",
        graph: {
          entryNodeId: "action",
          nodes: [
            {
              id: "action",
              kind: "tool",
              tool: "echo",
              args: ["test"],
              verificationPolicy: {
                rules: [
                  {
                    kind: "tool",
                    checkNodeId: "verifier",
                    onFail: "block",
                  },
                ],
              },
            },
            {
              id: "verifier",
              kind: "tool",
              tool: "test",
              args: ["-f", "output.txt"],
            },
          ],
          edges: [],
        },
      };

      const result = validateHarnessSpec(spec);
      expect(result.valid).toBe(true);
    });

    it("accepts llm verification rule pointing to llm node", () => {
      const spec: HarnessSpec = {
        name: "test-workflow",
        graph: {
          entryNodeId: "action",
          nodes: [
            {
              id: "action",
              kind: "tool",
              tool: "echo",
              args: ["test"],
              verificationPolicy: {
                rules: [
                  {
                    kind: "llm",
                    checkNodeId: "verifier",
                    onFail: "warn",
                  },
                ],
              },
            },
            {
              id: "verifier",
              kind: "llm",
              provider: "openai",
              model: "gpt-4",
              prompt: "Verify the output",
            },
          ],
          edges: [],
        },
      };

      const result = validateHarnessSpec(spec);
      expect(result.valid).toBe(true);
    });

    it("accepts expression verification rule pointing to condition node", () => {
      const spec: HarnessSpec = {
        name: "test-workflow",
        graph: {
          entryNodeId: "action",
          nodes: [
            {
              id: "action",
              kind: "tool",
              tool: "echo",
              args: ["test"],
              verificationPolicy: {
                rules: [
                  {
                    kind: "expression",
                    checkNodeId: "check-expr",
                    onFail: "retry",
                    maxAttempts: 3,
                  },
                ],
              },
            },
            {
              id: "check-expr",
              kind: "condition",
              condition: "outputs.action.exitCode === 0",
              thenNodeId: "success",
              elseNodeId: "failure",
            },
            {
              id: "success",
              kind: "tool",
              tool: "echo",
              args: ["success"],
            },
            {
              id: "failure",
              kind: "tool",
              tool: "echo",
              args: ["failure"],
            },
          ],
          edges: [],
        },
      };

      const result = validateHarnessSpec(spec);
      expect(result.valid).toBe(true);
    });

    it("rejects verification rule with missing kind", () => {
      const spec = {
        name: "test-workflow",
        graph: {
          entryNodeId: "action",
          nodes: [
            {
              id: "action",
              kind: "tool",
              tool: "echo",
              args: ["test"],
              verificationPolicy: {
                rules: [
                  {
                    // missing kind
                    checkNodeId: "verifier",
                    onFail: "block",
                  },
                ],
              },
            },
            {
              id: "verifier",
              kind: "tool",
              tool: "test",
              args: ["-f", "output.txt"],
            },
          ],
          edges: [],
        },
      } as any;

      const result = validateHarnessSpec(spec);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes("kind") && e.includes("verification"))).toBe(true);
      }
    });

    it("rejects tool verification rule pointing to llm node", () => {
      const spec: HarnessSpec = {
        name: "test-workflow",
        graph: {
          entryNodeId: "action",
          nodes: [
            {
              id: "action",
              kind: "tool",
              tool: "echo",
              args: ["test"],
              verificationPolicy: {
                rules: [
                  {
                    kind: "tool",
                    checkNodeId: "verifier",
                    onFail: "block",
                  },
                ],
              },
            },
            {
              id: "verifier",
              kind: "llm",
              provider: "openai",
              model: "gpt-4",
              prompt: "Check",
            },
          ],
          edges: [],
        },
      };

      const result = validateHarnessSpec(spec);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(
          result.errors.some(
            (e) => e.includes("verifier") && e.includes("kind") && e.includes("tool")
          )
        ).toBe(true);
      }
    });

    it("rejects llm verification rule pointing to tool node", () => {
      const spec: HarnessSpec = {
        name: "test-workflow",
        graph: {
          entryNodeId: "action",
          nodes: [
            {
              id: "action",
              kind: "tool",
              tool: "echo",
              args: ["test"],
              verificationPolicy: {
                rules: [
                  {
                    kind: "llm",
                    checkNodeId: "verifier",
                    onFail: "block",
                  },
                ],
              },
            },
            {
              id: "verifier",
              kind: "tool",
              tool: "test",
              args: ["-f", "output.txt"],
            },
          ],
          edges: [],
        },
      };

      const result = validateHarnessSpec(spec);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(
          result.errors.some(
            (e) => e.includes("verifier") && e.includes("kind") && e.includes("llm")
          )
        ).toBe(true);
      }
    });

    it("rejects expression verification rule pointing to tool node", () => {
      const spec: HarnessSpec = {
        name: "test-workflow",
        graph: {
          entryNodeId: "action",
          nodes: [
            {
              id: "action",
              kind: "tool",
              tool: "echo",
              args: ["test"],
              verificationPolicy: {
                rules: [
                  {
                    kind: "expression",
                    checkNodeId: "verifier",
                    onFail: "block",
                  },
                ],
              },
            },
            {
              id: "verifier",
              kind: "tool",
              tool: "test",
              args: ["-f", "output.txt"],
            },
          ],
          edges: [],
        },
      };

      const result = validateHarnessSpec(spec);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(
          result.errors.some(
            (e) => e.includes("verifier") && e.includes("kind") && e.includes("expression") && e.includes("condition")
          )
        ).toBe(true);
      }
    });
  });
});
