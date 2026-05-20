# Lasso

Lasso is a local-first workflow compiler and operator layer for pi. It sits on
top of `pi-duroxide` and gives you two things:

1. a compiler pipeline for turning a declarative `HarnessSpec` into a replay-safe durable workflow
2. bundled local workflows and slash commands for common repository automation tasks

Today, Lasso has two distinct operator layers:

1. `/lasso:plan` and `/lasso:replan` focus on the bundled local workflows
2. `/lasso:compile` and `/lasso:run` can now work with either bundled requests
   or arbitrary `HarnessSpec` workflows

If `pi-duroxide` is the durable runtime engine, **Lasso is the layer that helps
you author, package, and operate workflows on top of it**.

## Quick Start

Run Lasso directly from this repository:

```bash
pi -e ./src/index.ts
```

Or install it into pi:

```bash
pi install .
```

Then, inside pi:

1. Work against a **disposable repo or worktree**.
2. Use `/lasso:plan <brief>` if you want Lasso to draft one of the bundled
   workflows for you.
3. Pass either a bundled request, a raw `HarnessSpec`, a `{spec|specPath,input?}`
   envelope, or an absolute spec path into `/lasso:compile` or `/lasso:run`.
4. Use `/lasso:inspect` to inspect the compiled spec, CIR, and runtime state.

> **Safety:** Lasso checks out refs, applies patches, and merges branches in the
> target repo. Use a throwaway clone or disposable worktree, not your primary
> checkout.

---

## Table of Contents

- [Why Lasso exists](#why-lasso-exists)
- [Example use cases](#example-use-cases)
- [What Lasso does](#what-lasso-does)
- [Adaptive runtime](#adaptive-runtime)
- [Lineage persistence](#lineage-persistence)
- [When to use Lasso](#when-to-use-lasso)
- [Does it work with any workflow?](#does-it-work-with-any-workflow)
- [Bundled workflows](#bundled-workflows)
- [Slash commands](#slash-commands)
- [Request examples](#request-examples)
- [Custom workflows (advanced)](#custom-workflows-advanced)
- [HarnessSpec reference](#harnessspec-reference)
- [How Lasso fits with pi-duroxide](#how-lasso-fits-with-pi-duroxide)
- [Non-goals](#non-goals)

---

## Why Lasso exists

`pi-duroxide` gives you a durable workflow runtime. That is the right layer when
you already know what workflow you want to run.

Lasso sits one level higher. It gives you:

1. a **workflow authoring format** (`HarnessSpec`)
2. a **compiler pipeline** that turns that format into a replay-safe workflow
3. **bundled workflow families** for common local automation tasks
4. a **command surface** for drafting, compiling, running, and inspecting workflows

Use Lasso when you want workflow automation to be:

- more reusable than an ad hoc prompt
- more inspectable than hidden agent logic
- safer to validate before execution
- easier to evolve into repeatable automation

## Example use cases

Lasso is a good fit when you want things like:

1. **Validate a candidate fix locally** — confirm a bug reproduces on a baseline, apply a branch or patch, rerun the repro, then run broader verification.
2. **Rehearse a PR-style merge flow locally** — review a branch, run checks, route through approval, and perform a local merge without live GitHub integration.
3. **Compile and run your own workflow** — author a custom `HarnessSpec` and execute it through `/lasso:compile` and `/lasso:run`.

Longer-term, the direction is to make it easier to go from **intent -> workflow**.
The planner now accepts arbitrary workflow families via skill markdown or
freeform briefs, in addition to the two bundled workflows.

## What Lasso does

Lasso takes a declarative `HarnessSpec`, validates it, lowers it to CIR, and
compiles it into a replay-safe workflow that runs on `pi-duroxide`.

Out of the box, it also ships with operator-ready local workflows and commands:

- `patch-validation` — validate a known fix against a known-bad baseline
- `pr-review-merge` — simulate review, approval, merge, and post-merge checks locally
- `/lasso:plan` — draft one of those workflows from a freeform brief
- `/lasso:replan` — revise a prior request after a concrete outcome

The current emphasis is **local, deterministic, reviewable automation** rather
than fully autonomous hosted integrations.

## Adaptive runtime

Reference workflows (`patch-validation`, `pr-review-merge`) run through
`/lasso:run` automatically get adaptive behavior. The runtime wraps the
workflow input with a `__lassoAdaptiveRuntime` metadata envelope that tracks
version lineage and enables automatic replanning after each run completes.

This means a reference workflow can evolve across multiple attempts without
manual intervention -- if the first attempt fails, the replanner decides
whether to retry with a revised spec, halt for operator input, or stop.

### How it works

Each run through the adaptive runtime goes through four stages:

1. **Version tracking** -- Every run gets a `HarnessVersion` record with a
   version number, parent version, the reason for the version, the full spec,
   and a timestamp. The first run starts at version 1.

2. **Workflow execution** -- The workflow runs normally on `pi-duroxide`. If
   the runtime detects an adaptive envelope in the input, it re-lowers the
   spec from the current version (allowing compiler-driven spec overrides).

3. **Lineage recording** -- When the workflow reaches a terminal node, the
   runtime creates a `LineageEntry` capturing outputs, per-node results,
   failures, metrics (duration, retry count), and the execution trace.

4. **Automatic replanning** -- The runtime replanner inspects the result and
   decides one of:
   - `continue_as_new` -- the workflow evolves and re-runs automatically
     with a new spec (up to the version cap)
   - `needs_operator_input` -- halts and waits for a human to provide new
     information
   - `stop` -- terminates evolution (including when the version cap is hit)

When `continue_as_new` fires, the compiler re-executes with the override spec
from the replanner's draft, producing a new workflow version without manual
compile or run steps.

### Version cap

Adaptive evolution is capped at **5 versions** (`MAX_ADAPTIVE_VERSIONS`). This
prevents unbounded automatic mutation. Once the cap is reached, the runtime
returns `stop` and requires manual intervention. The cap exists because
unbounded automatic spec changes carry risk -- after 5 attempts the operator
should review the lineage and decide the next step.

### Key types

```typescript
interface HarnessVersion {
  version: number;
  parentVersion?: number;   // undefined for the initial version
  reason: string;
  spec: HarnessSpec;
  generatedAt: number;      // epoch ms
}

interface LineageEntry {
  version: number;
  terminalNodeId: string;
  outputs: Record<string, unknown>;
  nodeResults: Record<string, unknown>;
  failures: HarnessState["failures"];
  metrics: HarnessState["metrics"];
  trace: ExecutionTraceEntry[];
  completedAt: number;      // epoch ms
}
```

Source: `src/versioning/types.ts`, `src/versioning/history.ts`,
`src/replanner/runtime.ts`.

### Custom workflows are unaffected

Adaptive behavior only activates when the runtime detects a `__lassoAdaptiveRuntime`
envelope in the workflow input. This envelope is only injected by Lasso for
reference workflows run through `/lasso:run`. If you compile and run a custom
`HarnessSpec` directly, no adaptive wrapping occurs and the workflow runs
exactly once with no replanning.

### Inspecting lineage

Use `/lasso:inspect` to view the compiled spec, CIR, and runtime state for
the latest or a named workflow. This includes adaptive metadata and lineage
entries when present.

## Lineage persistence

By default, adaptive runtime lineage is stored in-memory and lost when the
session ends. To persist lineage across sessions, use `FileLineageStore`:

```typescript
import { FileLineageStore } from "lasso";

const store = new FileLineageStore("/path/to/store");

// Save versions and lineage entries
await store.saveVersion(version);
await store.saveLineage(entry);

// Retrieve
const v = await store.getVersion(1);
const chain = await store.getLineageChain(3);

// Query with filters
const recent = await store.queryLineage({
  terminalNodeId: "validated-fix",
  since: Date.now() - 3600_000,
  limit: 10,
});
```

The store writes JSON files to `{storeDir}/versions/` and `{storeDir}/lineage/`.
The `LineageStore` interface can be implemented for other backends (SQLite,
remote API, etc.).

## When to use Lasso

| Goal | Fit | Notes |
| --- | --- | --- |
| Validate an existing patch or branch locally | Excellent fit | Use `patch-validation` |
| Simulate a local PR review + merge flow | Excellent fit | Use `pr-review-merge` |
| Compile or run your own workflow from CLI or code | Good fit | Use `/lasso:compile`, `/lasso:run`, or the compiler API |
| Run live GitHub PR automation | Not yet | Lasso is local-only today |
| Ask Lasso to invent arbitrary new workflows from natural language | Partial | Planner accepts custom families via skill markdown |

## Does it work with any workflow?

**Short answer:** yes. Lasso supports three paths to a workflow:

| Path | What you provide | What Lasso does |
| --- | --- | --- |
| Skill markdown | A markdown document with `## steps` | Parses steps, builds graph, compiles workflow |
| Freeform brief | An English description | Classifies into a known family or `custom`, extracts fields |
| Manual `HarnessSpec` | A full spec JSON | Validates, lowers, compiles directly |

The two bundled workflows (`patch-validation`, `pr-review-merge`) have
specialized planners with strict field validation. Custom families get a generic
pipeline that builds a sequential graph from the parsed steps.

If you are asking, **"Can Lasso compile or run more than the two examples in
this repo?"** — yes.

If you are asking, **"Can Lasso plan arbitrary workflows from skill markdown?"**
— yes. Provide a markdown document with `## steps` and an explicit `workflow`
name, and Lasso will parse the steps into a graph and compile it.

If you are asking, **"Can Lasso replan arbitrary workflows?"** — the replanner
still only supports the two bundled families. Custom workflows can use the
adaptive runtime for automatic version evolution, but the replanner's draft
logic is limited to `patch-validation` and `pr-review-merge`.

## Bundled workflows

Lasso ships two bundled workflows. Both operate entirely against a **local**
repository or worktree.

### `patch-validation`

Use this when you already have a candidate fix and want Lasso to verify it.
Lasso does **not** write the fix for you. It runs a structured gate:

1. Check out `baselineRef` and run `reproduceCommands` to confirm the bug exists.
2. Apply the candidate from `candidateSource`.
3. Re-run `reproduceCommands` and expect them to pass.
4. Run `verificationCommands` as a broader regression check.
5. Optionally generate a summary and route to human approval.

Terminal outcomes:

- `validated-fix`
- `not-reproduced`
- `apply-failed`
- `candidate-failed`
- `rejected`

### `pr-review-merge`

Use this when you want a local rehearsal of a review-and-merge flow. The
workflow inspects the repo, runs verification commands, generates an LLM review
summary, routes through a human approval gate, performs a local merge, and can
re-run verification after the merge.

This is useful when you want **the workflow shape of a PR automation** without
live GitHub integration.

## Slash commands

When the Lasso extension is loaded, it first boots `pi-duroxide` and then adds
these commands:

| Command | Use it when | What it does |
| --- | --- | --- |
| `/lasso:plan <freeform brief>` | You have an English brief and want a draft request | Returns a draft JSON request or a clarification result |
| `/lasso:replan <replan request JSON>` | You have a previous request plus a real outcome | Returns a revised draft, `needs_operator_input`, or `stop` |
| `/lasso:compile <input>` | You want to inspect what Lasso will register | Compiles either a bundled request or a custom `HarnessSpec`, then stores the compiled artifact in memory |
| `/lasso:run <input>` | You want to execute a workflow locally | Compiles, registers, and starts either a bundled request or a custom `HarnessSpec` |
| `/lasso:inspect [workflow-name]` | You want to inspect the latest or named compiled workflow | Shows the compiled spec, CIR, and runtime state |

### `/lasso:plan`

The planner is deterministic and draft-only. It classifies a freeform brief into
either `patch-validation`, `pr-review-merge`, or `custom` and returns:

1. a draft workflow request JSON envelope you can pass into `compile` or `run`, or
2. a clarification result with missing fields and concrete next-step guidance

For the two bundled families, it extracts structured fields with strict
validation. For custom families (via skill markdown with an explicit `workflow`
name), it builds a sequential graph from the parsed steps.

It does **not** compile, register, or run anything.

### `/lasso:replan`

The replanner is also deterministic and draft-only. It accepts:

1. the original workflow request envelope, and
2. a structured `observedOutcome` describing how that attempt behaved

It returns one of three outcomes:

1. a revised draft request JSON envelope
2. `needs_operator_input` when a human must provide new facts
3. `stop` when auto-retrying would be the wrong move

In v1, the replanner only supports the two bundled workflows. It never invents
new branch names, candidate sources, or command lists. Custom workflows can use
the adaptive runtime for automatic version evolution instead.

### Custom compile/run input shapes

`/lasso:compile` and `/lasso:run` now accept four input forms:

1. bundled workflow request JSON
2. raw `HarnessSpec` JSON
3. a generic custom-workflow envelope:

   ```json
   {
     "spec": { "...": "..." },
     "input": { "...": "optional runtime input" }
   }
   ```

   or

   ```json
   {
     "specPath": "/absolute/path/to/spec.json",
     "input": { "...": "optional runtime input" }
   }
   ```

4. a direct absolute spec path such as `/tmp/custom-spec.json` or
   `path:/tmp/custom-spec.json`

When you run a raw `HarnessSpec` or a direct spec path, Lasso treats that as a
shorthand for `input: {}`. If your workflow needs a real runtime input payload,
use the explicit `{spec|specPath,input}` envelope.

## Request examples

Lasso commands accept either an explicit workflow envelope or the legacy raw
`pr-review-merge` shorthand, and compile/run also accept custom `HarnessSpec`
inputs.

### Preferred explicit envelope

```json
{
  "workflow": "patch-validation",
  "input": { "...": "..." }
}
```

```json
{
  "workflow": "pr-review-merge",
  "input": { "...": "..." }
}
```

### `patch-validation`

`repoPath` must point at a **disposable local repository or worktree**.

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

The raw `LocalPrBundle` shape is still accepted and routes to
`pr-review-merge`:

```json
{
  "repoPath": "/absolute/path/to/disposable-worktree",
  "sourceBranch": "feature/pr-change",
  "targetBranch": "main",
  "reviewInstructions": "Approve only if verification passes and the diff looks safe.",
  "verificationCommands": ["node -e \"process.exit(0)\""]
}
```

The explicit envelope form is also accepted:

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

### `replan`

```json
{
  "workflow": "patch-validation",
  "originalRequest": {
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
  },
  "observedOutcome": {
    "terminalNodeId": "validated-fix",
    "notes": ["prod hotfix"]
  }
}
```

For aborted attempts, provide `aborted: true` plus an explicit `abortReason`
such as `setup-failure`, `retry-exhaustion`, `timeout`, `manual-stop`, or
`unknown`.

### Custom `HarnessSpec` compile

```json
{
  "name": "custom-echo",
  "graph": {
    "entryNodeId": "echo",
    "nodes": [
      {
        "id": "echo",
        "kind": "tool",
        "tool": "bash",
        "args": ["-lc", "echo hello"]
      }
    ],
    "edges": []
  }
}
```

### Custom `HarnessSpec` run with explicit runtime input

```json
{
  "specPath": "/absolute/path/to/custom-echo.json",
  "input": {
    "message": "hello from runtime input"
  }
}
```

## Custom workflows (advanced)

If you need more than the two bundled workflows, you now have two options:

1. use `/lasso:compile` and `/lasso:run` directly with a custom `HarnessSpec`
2. use Lasso as a library

The generic package surface is:

- `HarnessSpec` types for authoring workflow specs
- `validateHarnessSpec(...)` to validate a spec
- `lowerHarnessSpecToCir(...)` to inspect the lowered internal workflow
- `compileHarnessSpec(...)` to produce a replay-safe workflow for `pi-duroxide`

That is the part of Lasso designed to work with **arbitrary workflow shapes**.
The planner now also supports custom families via skill markdown, though the
replanner is still limited to the two bundled families.

## HarnessSpec reference

This section documents the actual `HarnessSpec` format accepted by
`validateHarnessSpec(...)`, `/lasso:compile`, and `/lasso:run`.

The canonical sources are:

- `src/spec/types.ts` for the public TypeScript types
- `src/spec/schema.ts` for the JSON schema enforced by validation
- `src/spec/validate.ts` for extra structural checks beyond the JSON schema

### Top-level shape

```json
{
  "name": "workflow-name",
  "graph": {
    "entryNodeId": "start",
    "nodes": [],
    "edges": []
  },
  "executionPolicy": {},
  "humanPolicy": {},
  "observabilityPolicy": {}
}
```

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `name` | Yes | `string` | Unique workflow name used when the workflow is registered |
| `graph` | Yes | `object` | Contains `entryNodeId`, `nodes`, and `edges` |
| `executionPolicy` | No | `object` | Global execution settings |
| `humanPolicy` | No | `object` | Defaults for human interaction behavior |
| `observabilityPolicy` | No | `object` | Trace / metrics / logging settings |

All top-level objects are **strict**. Unknown fields are rejected by schema
validation.

### Graph shape

```json
{
  "entryNodeId": "start",
  "nodes": [
    {
      "id": "start",
      "kind": "tool",
      "tool": "bash",
      "args": ["-lc", "echo hello"]
    }
  ],
  "edges": []
}
```

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `entryNodeId` | Yes | `string` | Must match an existing node `id` |
| `nodes` | Yes | `TaskNode[]` | Array of node definitions |
| `edges` | Yes | `TaskEdge[]` | Each edge is `{ "from": "node-a", "to": "node-b" }` |

### Shared node fields

Every node kind includes:

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `id` | Yes | `string` | Must be unique across the graph |
| `kind` | Yes | `string` | One of `tool`, `llm`, `human`, `condition`, `merge`, `subworkflow` |
| `label` | No | `string` | Human-readable label |
| `executionPolicy` | No | `object` | Per-node execution settings |
| `verificationPolicy` | No | `object` | Verification rules for this node |

`retryPolicy` is only valid on `tool`, `llm`, and `subworkflow` nodes.

### Node kinds

#### `tool`

```json
{
  "id": "run-tests",
  "kind": "tool",
  "tool": "bash",
  "args": ["-lc", "npm test"],
  "env": { "CI": "true" },
  "cwd": "/repo"
}
```

| Field | Required | Type |
| --- | --- | --- |
| `tool` | Yes | `string` |
| `args` | Yes | `string[]` |
| `env` | No | `Record<string, string>` |
| `cwd` | No | `string` |
| `retryPolicy` | No | `RetryPolicy` |

#### `llm`

```json
{
  "id": "summarize",
  "kind": "llm",
  "provider": "openai",
  "model": "gpt-4.1",
  "prompt": "Summarize the failing test output.",
  "system": "Be concise."
}
```

| Field | Required | Type |
| --- | --- | --- |
| `provider` | Yes | `string` |
| `model` | Yes | `string` |
| `prompt` | Yes | `string` |
| `system` | No | `string` |
| `temperature` | No | `number` |
| `maxTokens` | No | `number` |
| `retryPolicy` | No | `RetryPolicy` |

#### `human`

```json
{
  "id": "approve",
  "kind": "human",
  "prompt": "Approve this change?",
  "interactionType": "approval",
  "timeout": 600
}
```

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `prompt` | Yes | `string` | Prompt shown to the human |
| `interactionType` | Yes | `"approval" \| "input" \| "choice"` | |
| `options` | No | `string[]` | Required in practice when `interactionType` is `choice` |
| `timeout` | No | `number` | Seconds |

#### `condition`

```json
{
  "id": "check-result",
  "kind": "condition",
  "condition": "outputs.run-tests.exitCode == 0",
  "thenNodeId": "success",
  "elseNodeId": "failure"
}
```

| Field | Required | Type |
| --- | --- | --- |
| `condition` | Yes | `string` |
| `thenNodeId` | Yes | `string` |
| `elseNodeId` | Yes | `string` |

#### `merge`

```json
{
  "id": "join",
  "kind": "merge",
  "waitFor": ["branch-a", "branch-b"],
  "strategy": "all"
}
```

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `waitFor` | Yes | `string[]` | Must contain at least one node id |
| `strategy` | No | `"all" \| "any" \| "majority"` | Defaults are handled by runtime/compiler logic |

#### `subworkflow`

```json
{
  "id": "child",
  "kind": "subworkflow",
  "specRef": "shared-child-spec",
  "inputs": {
    "repoPath": "/repo"
  }
}
```

| Field | Required | Type |
| --- | --- | --- |
| `specRef` | Yes | `string` |
| `inputs` | No | `Record<string, unknown>` |
| `retryPolicy` | No | `RetryPolicy` |

### Policy objects

#### `executionPolicy`

| Field | Required | Type |
| --- | --- | --- |
| `timeout` | No | `number` |
| `maxMemory` | No | `number` |
| `continueOnFailure` | No | `boolean` |
| `failureClassification` | No | `FailureClassification[]` |

`failureClassification` items use:

```json
{
  "pattern": "timeout",
  "category": "transient",
  "retry": true
}
```

Where `category` is one of `transient`, `permanent`, `resource`, or
`configuration`.

#### `retryPolicy`

| Field | Required | Type |
| --- | --- | --- |
| `maxAttempts` | Yes | `number` |
| `backoff` | Yes | `"constant" \| "linear" \| "exponential"` |
| `initialDelay` | No | `number` |
| `maxDelay` | No | `number` |
| `retryOn` | No | `("transient" \| "resource")[]` |

#### `verificationPolicy`

```json
{
  "rules": [
    {
      "checkNodeId": "verify-tests",
      "onFail": "retry",
      "maxAttempts": 2
    }
  ]
}
```

| Field | Required | Type |
| --- | --- | --- |
| `rules` | Yes | `VerificationRule[]` |

Each rule uses:

| Field | Required | Type |
| --- | --- | --- |
| `checkNodeId` | Yes | `string` |
| `onFail` | Yes | `"block" \| "warn" \| "retry"` |
| `maxAttempts` | No | `number` |

#### `humanPolicy`

| Field | Required | Type |
| --- | --- | --- |
| `defaultTimeout` | No | `number` |
| `allowAsync` | No | `boolean` |
| `notificationChannels` | No | `string[]` |

#### `observabilityPolicy`

| Field | Required | Type |
| --- | --- | --- |
| `tracing` | No | `boolean` |
| `metrics` | No | `boolean` |
| `logLevel` | No | `"debug" \| "info" \| "warn" \| "error"` |
| `logDestinations` | No | `string[]` |

### Important validation rules

In addition to JSON schema validation, Lasso also enforces structural rules:

1. node ids must be unique
2. `entryNodeId` must exist
3. every edge `from` / `to` must reference an existing node
4. `condition.thenNodeId` and `condition.elseNodeId` must reference existing nodes
5. `merge.waitFor` must not be empty and must reference existing nodes
6. `human` nodes with `interactionType: "choice"` must include non-empty `options`
7. unreachable nodes are rejected
8. `retryPolicy` is rejected on unsupported node kinds
9. verification rules cannot reference missing nodes or the node itself
10. circular verification dependencies are rejected

## How Lasso fits with pi-duroxide

- `pi-duroxide` owns workflow lifecycle, replay, timers, events, and runtime registration
- Lasso owns spec validation, CIR lowering, compilation, bundled local workflow construction, and operator-facing commands

In other words: `pi-duroxide` is the durable runtime engine; Lasso is a compiler
and workflow package built on top of it.

## Non-goals

Lasso does **not** currently aim to provide:

- live GitHub or `gh` integration
- autonomous code authoring or patch generation
- LLM-backed planning or replanning
- automatic compile/run behavior from `/lasso:plan` or `/lasso:replan`
- adaptive mutation of already-running workflows
- arbitrary generated TypeScript
