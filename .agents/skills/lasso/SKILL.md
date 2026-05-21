# Lasso — Dynamic Harness Engine

## When to use this skill

Use when the user wants to:
- Plan, compile, run, or inspect Lasso workflows via slash commands
- Build custom `HarnessSpec` definitions programmatically
- Use Lasso as a TypeScript library (compiler, mutations, failure classification, memory, composition)
- Understand the HarnessSpec schema, validation rules, or node kinds
- Work with bundled workflows (`patch-validation`, `pr-review-merge`)
- Set up adaptive runtime, lineage persistence, or meta-harness generation

## Quick reference

### Two modes

| Mode | How | When |
| --- | --- | --- |
| **Chat mode** | `/lasso:plan`, `/lasso:run`, etc. inside pi | Interactive workflow planning and execution |
| **Library mode** | `import { compileHarnessSpec } from "lasso"` | Building custom tooling, CI pipelines, or extensions |

### Slash commands

| Command | Input | Output |
| --- | --- | --- |
| `/lasso:plan <brief>` | Freeform English brief | Draft JSON request or clarification |
| `/lasso:replan <JSON>` | Prior request + `observedOutcome` | Revised draft, `needs_operator_input`, or `stop` |
| `/lasso:compile <input>` | Workflow JSON, HarnessSpec JSON, or file path | Compile summary (nodes, CIR, registered) |
| `/lasso:run <input>` | Same as compile | Starts workflow, returns instance ID |
| `/lasso:inspect [name]` | Optional workflow name | Full spec, CIR, runtime state, adaptive lineage |

### Compile/run input shapes (4 forms)

1. **Bundled workflow request**: `{ "workflow": "patch-validation", "input": {...} }`
2. **Raw HarnessSpec JSON**: `{ "name": "...", "graph": {...} }`
3. **Envelope with spec/specPath**: `{ "spec": {...}, "input": {...} }` or `{ "specPath": "/abs/path.json" }`
4. **Direct absolute path**: `/tmp/custom-spec.json` or `path:/abs/spec.json`

## HarnessSpec schema

### Top-level shape

```typescript
interface HarnessSpec {
  name: string;                          // Required — unique workflow name
  graph: TaskGraph;                      // Required — node graph
  executionPolicy?: ExecutionPolicy;     // Optional — global limits
  humanPolicy?: HumanPolicy;             // Optional — human interaction defaults
  observabilityPolicy?: ObservabilityPolicy;  // Optional — tracing/logging
}
```

All top-level objects are **strict** — unknown fields are rejected.

### TaskGraph

```typescript
interface TaskGraph {
  entryNodeId: string;    // Must reference an existing node
  nodes: TaskNode[];      // All nodes (IDs must be unique)
  edges: TaskEdge[];      // from/to edges referencing existing nodes
}
```

### Node kinds

| Kind | Key fields | Maps to |
| --- | --- | --- |
| `tool` | `tool`, `args`, `env?`, `cwd?` | `ctx.pi.tool("bash", { command })` |
| `llm` | `provider`, `model`, `prompt`, `system?`, `temperature?`, `maxTokens?` | `ctx.pi.llm(messages, { model })` |
| `human` | `prompt`, `interactionType` (`"approval"|"input"|"choice"`), `options?`, `timeout?` | `ctx.waitForEvent(...)` |
| `condition` | `condition`, `thenNodeId`, `elseNodeId` | Branch evaluation |
| `merge` | `waitFor: string[]`, `strategy?` (`"all"|"any"|"majority"`) | Fork-join sync |
| `subworkflow` | `specRef`, `inputs?` | `ctx.scheduleSubOrchestration(...)` |

### Policies

```typescript
interface ExecutionPolicy {
  timeout?: number;             // seconds
  maxMemory?: number;           // MB
  maxSteps?: number;            // positive integer — resets on continueAsNew
  costLimitUsd?: number;        // positive — accumulates across versions
  continueOnFailure?: boolean;
  failureClassification?: FailureClassification[];
}

interface RetryPolicy {
  maxAttempts: number;
  backoff: "constant" | "linear" | "exponential";
  initialDelay?: number;        // seconds
  maxDelay?: number;            // seconds
  retryOn?: Array<"transient" | "resource">;
}

interface VerificationPolicy {
  rules: VerificationRule[];
  strategy?: "all-must-pass" | "first-pass" | "any-block";
}

type VerificationRule =
  | { kind: "tool"; checkNodeId: string; onFail: "block"|"warn"|"retry"; maxAttempts?: number }
  | { kind: "llm"; checkNodeId: string; onFail: "block"|"warn"|"retry"; maxAttempts?: number }
  | { kind: "expression"; checkNodeId: string; onFail: "block"|"warn"|"retry"; maxAttempts?: number };
```

### Validation rules (specs failing these are rejected)

1. Node IDs must be unique
2. `entryNodeId` must exist in nodes
3. Every edge `from`/`to` must reference an existing node
4. `condition.thenNodeId` and `condition.elseNodeId` must exist
5. `merge.waitFor` must not be empty
6. `human` nodes with `interactionType: "choice"` must have `options`
7. Unreachable nodes are rejected (BFS from entryNodeId, excluding verification nodes)
8. `retryPolicy` only on `tool`, `llm`, `subworkflow` nodes
9. Verification rules cannot reference missing nodes or self
10. Circular verification dependencies are rejected (DFS cycle detection)
11. Verification rule kind must match verifier node kind (`tool`→`tool`, `llm`→`llm`, `expression`→`condition`)
12. `maxSteps` must be a positive integer
13. `costLimitUsd` must be a positive number

## Bundled workflows

### `patch-validation`

Validates a candidate fix against a known-bad baseline.

**Terminal outcomes**: `validated-fix`, `not-reproduced`, `apply-failed`, `candidate-failed`, `rejected`

**Input shape** (branch candidate):
```json
{
  "workflow": "patch-validation",
  "input": {
    "repoPath": "/absolute/path/to/disposable-worktree",
    "baselineRef": "main",
    "candidateSource": { "kind": "branch", "value": "fix/bug" },
    "reproduceCommands": ["npm test -- --grep 'the broken test'"],
    "verificationCommands": ["npm test"],
    "reviewInstructions": "Approve if the patch applies cleanly and verification passes.",
    "approvalRequired": false
  }
}
```

**Input shape** (patch file candidate):
```json
{
  "workflow": "patch-validation",
  "input": {
    "repoPath": "/absolute/path/to/disposable-worktree",
    "baselineRef": "main",
    "candidateSource": { "kind": "patchFile", "value": "/path/to/fix.patch" },
    "reproduceCommands": ["npm test -- --grep 'the broken test'"],
    "verificationCommands": ["npm test"],
    "reviewInstructions": "Approve if the patch applies cleanly and verification passes.",
    "approvalRequired": false
  }
}
```

### `pr-review-merge`

Local rehearsal of a review-and-merge flow.

**Terminal outcomes**: `complete-success`, `reject-verification`, `reject-human`, `merge-conflict`

**Input shape**:
```json
{
  "workflow": "pr-review-merge",
  "input": {
    "repoPath": "/absolute/path/to/disposable-worktree",
    "sourceBranch": "feature/pr-change",
    "targetBranch": "main",
    "reviewInstructions": "Approve only if verification passes and the diff looks safe.",
    "verificationCommands": ["node -e \"process.exit(0)\""]
  }
}
```

### Replan outcomes

`/lasso:replan` returns one of three statuses:

| Status | Meaning |
| --- | --- |
| `draft_request` | Safe to compile/run — includes revised request JSON |
| `needs_operator_input` | Human must provide missing fields before retry |
| `stop` | Auto-retrying would be wrong (human rejection, max retries, etc.) |

**Replan input shape** (completed attempt):
```json
{
  "workflow": "patch-validation",
  "originalRequest": { "workflow": "patch-validation", "input": { "..." : "..." } },
  "observedOutcome": {
    "terminalNodeId": "validated-fix",
    "notes": ["prod hotfix"]
  }
}
```

**Replan input shape** (aborted attempt):
```json
{
  "workflow": "patch-validation",
  "originalRequest": { "workflow": "patch-validation", "input": { "..." : "..." } },
  "observedOutcome": {
    "aborted": true,
    "abortReason": "retry-exhaustion"
  }
}
```

For aborted attempts: `{ "aborted": true, "abortReason": "setup-failure"|"retry-exhaustion"|"timeout"|"manual-stop"|"unknown" }`

## Library API

### Compiler pipeline

```typescript
import {
  validateHarnessSpec,
  lowerHarnessSpecToCir,
  compileHarnessSpec,
  type CompiledHarnessWorkflow,
  type CompiledHarnessResult,
} from "lasso";

// Full pipeline: validate → lower → optimize → validate CIR → build generator
const compiled = compileHarnessSpec(spec);
// compiled.name, compiled.spec, compiled.cir, compiled.optimizations
// compiled.workflows, compiled.adaptive
// compiled.register(pi) — registers with pi-duroxide

// Individual steps (for inspection/debugging):
validateHarnessSpec(spec);       // { valid: true } | { valid: false, errors: string[] }
lowerHarnessSpecToCir(spec);     // CirWorkflow
```

### Compiler feedback

```typescript
import { analyzeCompiledWorkflow, applyCompilerSuggestions } from "lasso";

const analysis = analyzeCompiledWorkflow(compiled);
// analysis.cost — { llmCallCount, toolCallCount, humanInteractionCount, estimatedDurationMs, estimatedCostUsd }
// analysis.risk — { costRisk, failureRisk, qualityRisk, complexityRisk, overallRisk }
// analysis.mutations — HarnessMutation[] with trigger/description
// analysis.suggestions — CompilerSuggestion[] (deprecated, use mutations)
```

### Guardrails

Enforced at runtime — throws `GuardrailExceededError` when exceeded:

```json
{
  "executionPolicy": {
    "maxSteps": 25,
    "costLimitUsd": 0.25,
    "timeout": 300000
  }
}
```

Step count resets on `continueAsNew`. Cost accumulates across versions.

### Failure classification

```typescript
import { classifyFailure, classifyFailureRecord, isRetryableFailure, suggestRecovery } from "lasso";

// Classify an error into a FailureSignature
const signature = classifyFailure(error, { nodeId: "deploy" });
// signature.class — "auth"|"tool"|"resource"|"semantic"|"human"|"environment-drift"|"network"|"unknown"
// signature.confidence — 0-1
// signature.evidence — string[]
// signature.suggestedRecovery — string[]
// signature.retryable — boolean
// signature.requiresHumanIntervention — boolean

// Classify a FailureRecord (from harness state)
const classification = classifyFailureRecord(failureRecord);
// { category: "transient"|"permanent", retryable: boolean }

const retryable = isRetryableFailure(failureRecord);

// Get a structured recovery plan
const recovery = suggestRecovery(signature, { attemptNumber: 4 });
// { steps: RecoveryStep[], estimatedSuccessRate: number, requiresHumanApproval: boolean }
```

### Failure mode prediction

```typescript
import { generateFailureModes } from "lasso";

const generation = generateFailureModes("Deploy my app to staging", env);
// generation.failureModes — FailureMode[]
// generation.riskSummary — "HIGH RISK: auth failures likely (env constraint detected)"
```

Task keywords map to failure modes: `deploy`→auth/network/config, `test`→flaky/timeout/env, `build`→dependency/disk/OOM, `merge`→conflict/verification, `database`→connection/migration, `api`→rate-limit/auth/schema, `file`→permission/disk/path.

### Harness mutations

```typescript
import {
  mutateHarness,
  deriveMutationsFromTrace,
  deriveMutationsFromFailure,
  diffSpecs,
} from "lasso";

// From execution trace
const mutations = deriveMutationsFromTrace(trace, spec);

// From classified failure
const mutations = deriveMutationsFromFailure(signature, spec, { nodeId: "deploy" });

// Apply mutations
const { spec: newSpec, diff } = mutateHarness(spec, mutations);
```

Mutation types: `add-node`, `remove-node`, `modify-node`, `add-edge`, `toggle-approval`, `add-verification`, `replace-node`, `tighten-guardrail`

Triggers: `node_failed`, `confidence_low`, `cost_high`, `loop_detected`, `retry_exhausted`, `verification_failed`, `tool_missing`, `auth_expired`

### CIR optimization

```typescript
import { optimizeCirWorkflow } from "lasso/cir/optimize";

const { optimized, passes } = optimizeCirWorkflow(cir);
// passes — ["dead-node-elimination", "single-branch-merge-elision", "adjacent-tool-node-fusion"]
```

### Verification engine

```typescript
import { runVerification, type VerificationStrategy } from "lasso/verification/engine";

// Strategies: "all-must-pass" (default), "first-pass", "any-block"
const report = yield* runVerification(nodeId, hooks, nodeMap, state, ctx, "first-pass");
// report.overallStatus — "pass" | "warn" | "block"
// report.hookResults — per-hook outcome + duration
```

### Adaptive runtime

```typescript
import { prepareRuntimeReplan, MAX_ADAPTIVE_VERSIONS } from "lasso";

const decision = await prepareRuntimeReplan(metadata, input, result);
// decision.type — "continue_as_new" | "needs_operator_input" | "stop"
```

Capped at 5 versions (`MAX_ADAPTIVE_VERSIONS`). Each version records a `HarnessVersion` with full lineage.

### Lineage persistence

```typescript
import { FileLineageStore, createInitialVersion, createNextVersion, createLineageEntry } from "lasso";

const store = new FileLineageStore("/path/to/store");
await store.saveVersion(version);
await store.saveLineage(entry);

const chain = await store.getLineageChain(3);
const recent = await store.queryLineage({ terminalNodeId: "validated-fix", limit: 10 });
```

### Harness memory

```typescript
import { FileMemoryStore, adviseFromMemory, extractPatternsFromTrace } from "lasso";

const store = new FileMemoryStore("/path/to/memory");
const advice = await adviseFromMemory("deploy-staging", store);
// advice.suggestions — "Previously, auth-check-before-deploy improved success rate"
// advice.warnings — "Pattern deploy-without-auth failed 6 times"

// Save patterns from a trace
const patterns = extractPatternsFromTrace(trace, spec);
```

### Environment model

```typescript
import { discoverEnvironment, analyzeEnvironment } from "lasso";

const env = await discoverEnvironment("/path/to/repo", {
  tools: ["bash", "git", "node"],
  externalSystems: ["api.example.com"],
  networkTimeoutMS: 3000,
});
// env.tools — ToolCapability[] with name/version/available
// env.constraints — Constraint[] with type/description/severity
// env.repoState — { branch, hasUncommittedChanges, remotes, tags }
// env.externalSystems — ExternalSystem[] with name/reachable/latencyMs

const analysis = analyzeEnvironment(env, ["git", "node"]);
// analysis.readinessScore — 0-100
// analysis.matchedTools, analysis.missingTools
// analysis.highRiskConstraints
// analysis.preparatorySteps — actionable prep steps
```

### Capabilities

```typescript
import { DefaultCapabilityRegistry, planWorkflowRequest } from "lasso";

const registry = new DefaultCapabilityRegistry();
// Pre-registered: bash, git, node, llm-review, human-approval

const result = planWorkflowRequest("Validate the bug fix works", registry, env);
// result.status — "draft_request" | "needs_clarification"
```

### Meta-harness (full generation pipeline)

```typescript
import { DefaultMetaHarness, DefaultCapabilityRegistry, FileMemoryStore } from "lasso";

const meta = new DefaultMetaHarness({
  capabilityRegistry: new DefaultCapabilityRegistry(),
  memoryStore: new FileMemoryStore("/path/to/memory"),
  mutationPolicy: { allowedMutations: ["add-verification", "modify-node"], maxMutations: 3 },
});

const result = await meta.generateHarness("Deploy my app to staging");
// result.spec — generated HarnessSpec
// result.environmentAnalysis — tool/resource availability
// result.memoryAdvice — suggestions/warnings from past runs
// result.predictedFailures — anticipated failures with confidence
// result.generatedFailureModes — task-keyword-based predictions
// result.optimizations — CIR optimization passes applied
// result.compilerAnalysis — cost, risk, mutations
// result.readinessScore — 0-100
// result.appliedMutations — what was changed

// Composition
const chained = meta.composeHarnesses([
  { name: "research", spec: researchSpec },
  { name: "plan", spec: planSpec },
  { name: "execute", spec: executeSpec },
]);

const parallel = meta.composeParallel([verificationSpec, notificationSpec]);

const conditional = meta.composeConditional("isProduction", prodSpec, stagingSpec);
```

Node IDs are prefixed with stage names to avoid collisions.

### Planner and replanner (standalone)

```typescript
import { planWorkflowRequest, parseReplanRequest, replanWorkflowRequest } from "lasso";

// Plan from brief
const plan = planWorkflowRequest("Validate fix.patch against main");
// plan.status — "draft_request" | "needs_clarification"
// plan.request — { workflow, input } (when draft_request)

// Replan from outcome
const request = parseReplanRequest(jsonString);
const result = replanWorkflowRequest(request);
// result.status — "draft_request" | "needs_operator_input" | "stop"
```

### State snapshots

```typescript
import { createHarnessState, addFailure, recordNodeResult, updateMetrics, captureSnapshot } from "lasso";

const state = createHarnessState(input);
addFailure(state, { domainType: "lasso", rootCause: "tool_timeout", nodeId: "deploy", message: "..." });
recordNodeResult(state, "deploy", { status: "success" });
updateMetrics(state, { durationMs: 1500 });
```

## Workflow compilation pipeline

```
Intent (brief or skill markdown)
  ↓
parsePromptOrSkill() → IntentIR
  ↓
buildTaskGraph() → TaskGraph
  ↓
analyzeRisks() → RiskModel
  ↓
synthesizePolicy() → PolicyBundle
  ↓
synthesizeHarness() → HarnessSpec
  ↓
validateHarnessSpec() → ValidationResult
  ↓
lowerHarnessSpecToCir() → CirWorkflow
  ↓
optimizeCirWorkflow() → { optimized, passes }
  ↓
validateCirWorkflow() → ValidationResult
  ↓
compileHarnessSpec() → CompiledHarnessWorkflow → pi-duroxide
```

## Adaptation loop

```
Workflow executes
  ↓
Execution trace captured (timestamps, I/O snapshots, failures)
  ↓
deriveMutationsFromTrace() → HarnessMutation[]
  ↓
mutateHarness(spec, mutations) → new spec
  ↓
prepareRuntimeReplan() → continue_as_new / needs_operator_input / stop
  ↓
New version with repaired harness (max 5 versions)
```

## Compiler feedback loop

```
compileHarnessSpec()
  ↓
analyzeCompiledWorkflow()
  → CostEstimate (LLM calls, duration, USD)
  → RiskAssessment (cost, failure, quality, complexity)
  → HarnessMutation[] (executable, with triggers)
  ↓
mutateHarness(spec, mutations)
  → replace expensive models
  → add retry policies
  → add verification hooks
  ↓
Recompile with improvements
```

## Key files

- `src/spec/types.ts` — HarnessSpec type definitions
- `src/spec/validate.ts` — Validation logic
- `src/spec/schema.ts` — JSON Schema for HarnessSpec
- `src/compiler/compile.ts` — Main compiler
- `src/compiler/feedback.ts` — Cost/risk analysis and mutation generation
- `src/cir/lower.ts` — HarnessSpec → CIR lowering
- `src/cir/optimize.ts` — CIR optimization passes
- `src/mutation/engine.ts` — Mutation application
- `src/mutation/derive.ts` — Trace/failure → mutation derivation
- `src/failures/ontology.ts` — Failure classification
- `src/failures/recovery.ts` — Recovery plan generation
- `src/metaharness/engine.ts` — Meta-harness generation
- `src/composition/` — Chain, parallel, conditional composition
- `src/memory/` — Harness memory store and advisor
- `src/environment/` — Environment discovery and analysis
- `src/versioning/` — Lineage persistence
- `src/replanner/` — Runtime replanning and adaptive versions
- `src/pi/commands.ts` — Slash command implementations
- `src/reference/` — Bundled workflow specs

## Important notes

- Lasso operates entirely against **local** repositories or worktrees — no live GitHub/`gh` integration
- All planning is **deterministic** — no LLM-backed planning or replanning
- `/lasso:plan` and `/lasso:replan` are **draft-only** — they do not compile or run
- Safety: Lasso checks out refs, applies patches, and merges branches — use a disposable worktree
- `compileHarnessSpec` automatically runs the full pipeline (validate → lower → optimize → validate CIR → build generator)
- CIR optimizations: dead-node elimination, single-branch merge elision, adjacent tool-node fusion
- Verification nodes referenced by other nodes' verification policies are excluded from reachability checks
