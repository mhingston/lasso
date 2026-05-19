/**
 * JSON Schema for HarnessSpec validation using Ajv
 */

export const harnessSpecSchema = {
  type: "object",
  required: ["name", "graph"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1 },
    graph: {
      type: "object",
      required: ["entryNodeId", "nodes", "edges"],
      additionalProperties: false,
      properties: {
        entryNodeId: { type: "string", minLength: 1 },
        nodes: {
          type: "array",
          items: {
            oneOf: [
              {
                type: "object",
                required: ["id", "kind", "tool", "args"],
                additionalProperties: false,
                properties: {
                  id: { type: "string", minLength: 1 },
                  kind: { const: "tool" },
                  tool: { type: "string", minLength: 1 },
                  args: { type: "array", items: { type: "string" } },
                  env: { 
                    type: "object",
                    additionalProperties: { type: "string" }
                  },
                  cwd: { type: "string" },
                  label: { type: "string" },
                  executionPolicy: { $ref: "#/$defs/executionPolicy" },
                  retryPolicy: { $ref: "#/$defs/retryPolicy" },
                  verificationPolicy: { $ref: "#/$defs/verificationPolicy" }
                }
              },
              {
                type: "object",
                required: ["id", "kind", "provider", "model", "prompt"],
                additionalProperties: false,
                properties: {
                  id: { type: "string", minLength: 1 },
                  kind: { const: "llm" },
                  provider: { type: "string", minLength: 1 },
                  model: { type: "string", minLength: 1 },
                  prompt: { type: "string", minLength: 1 },
                  system: { type: "string" },
                  temperature: { type: "number" },
                  maxTokens: { type: "number" },
                  label: { type: "string" },
                  executionPolicy: { $ref: "#/$defs/executionPolicy" },
                  retryPolicy: { $ref: "#/$defs/retryPolicy" },
                  verificationPolicy: { $ref: "#/$defs/verificationPolicy" }
                }
              },
              {
                type: "object",
                required: ["id", "kind", "prompt", "interactionType"],
                additionalProperties: false,
                properties: {
                  id: { type: "string", minLength: 1 },
                  kind: { const: "human" },
                  prompt: { type: "string", minLength: 1 },
                  interactionType: { enum: ["approval", "input", "choice"] },
                  options: { type: "array", items: { type: "string" } },
                  timeout: { type: "number" },
                  label: { type: "string" },
                  executionPolicy: { $ref: "#/$defs/executionPolicy" },
                  verificationPolicy: { $ref: "#/$defs/verificationPolicy" }
                }
              },
              {
                type: "object",
                required: ["id", "kind", "condition", "thenNodeId", "elseNodeId"],
                additionalProperties: false,
                properties: {
                  id: { type: "string", minLength: 1 },
                  kind: { const: "condition" },
                  condition: { type: "string", minLength: 1 },
                  thenNodeId: { type: "string", minLength: 1 },
                  elseNodeId: { type: "string", minLength: 1 },
                  label: { type: "string" },
                  executionPolicy: { $ref: "#/$defs/executionPolicy" },
                  verificationPolicy: { $ref: "#/$defs/verificationPolicy" }
                }
              },
              {
                type: "object",
                required: ["id", "kind", "waitFor"],
                additionalProperties: false,
                properties: {
                  id: { type: "string", minLength: 1 },
                  kind: { const: "merge" },
                  waitFor: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
                  strategy: { enum: ["all", "any", "majority"] },
                  label: { type: "string" },
                  executionPolicy: { $ref: "#/$defs/executionPolicy" },
                  verificationPolicy: { $ref: "#/$defs/verificationPolicy" }
                }
              },
              {
                type: "object",
                required: ["id", "kind", "specRef"],
                additionalProperties: false,
                properties: {
                  id: { type: "string", minLength: 1 },
                  kind: { const: "subworkflow" },
                  specRef: { type: "string", minLength: 1 },
                  inputs: { type: "object" },
                  label: { type: "string" },
                  executionPolicy: { $ref: "#/$defs/executionPolicy" },
                  retryPolicy: { $ref: "#/$defs/retryPolicy" },
                  verificationPolicy: { $ref: "#/$defs/verificationPolicy" }
                }
              }
            ]
          }
        },
        edges: {
          type: "array",
          items: {
            type: "object",
            required: ["from", "to"],
            additionalProperties: false,
            properties: {
              from: { type: "string", minLength: 1 },
              to: { type: "string", minLength: 1 }
            }
          }
        }
      }
    },
    executionPolicy: { $ref: "#/$defs/executionPolicy" },
    humanPolicy: { $ref: "#/$defs/humanPolicy" },
    observabilityPolicy: { $ref: "#/$defs/observabilityPolicy" }
  },
  $defs: {
    executionPolicy: {
      type: "object",
      additionalProperties: false,
      properties: {
        timeout: { type: "number" },
        maxMemory: { type: "number" },
        continueOnFailure: { type: "boolean" },
        failureClassification: {
          type: "array",
          items: {
            type: "object",
            required: ["pattern", "category", "retry"],
            additionalProperties: false,
            properties: {
              pattern: { type: "string", minLength: 1 },
              category: { enum: ["transient", "permanent", "resource", "configuration"] },
              retry: { type: "boolean" }
            }
          }
        }
      }
    },
    retryPolicy: {
      type: "object",
      required: ["maxAttempts", "backoff"],
      additionalProperties: false,
      properties: {
        maxAttempts: { type: "number", minimum: 1 },
        backoff: { enum: ["constant", "linear", "exponential"] },
        initialDelay: { type: "number" },
        maxDelay: { type: "number" },
        retryOn: {
          type: "array",
          items: { enum: ["transient", "resource"] }
        }
      }
    },
    verificationPolicy: {
      type: "object",
      required: ["rules"],
      additionalProperties: false,
      properties: {
        rules: {
          type: "array",
          items: {
            type: "object",
            required: ["checkNodeId", "onFail"],
            additionalProperties: false,
            properties: {
              checkNodeId: { type: "string", minLength: 1 },
              onFail: { enum: ["block", "warn", "retry"] },
              maxAttempts: { type: "number" }
            }
          }
        }
      }
    },
    humanPolicy: {
      type: "object",
      additionalProperties: false,
      properties: {
        defaultTimeout: { type: "number" },
        allowAsync: { type: "boolean" },
        notificationChannels: {
          type: "array",
          items: { type: "string" }
        }
      }
    },
    observabilityPolicy: {
      type: "object",
      additionalProperties: false,
      properties: {
        tracing: { type: "boolean" },
        metrics: { type: "boolean" },
        logLevel: { enum: ["debug", "info", "warn", "error"] },
        logDestinations: {
          type: "array",
          items: { type: "string" }
        }
      }
    }
  }
};
