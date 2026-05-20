# Lasso

Lasso is a local-first workflow compiler for pi. It sits on top of
`pi-duroxide` and gives you two things:

1. a compiler pipeline for turning a declarative `HarnessSpec` into a replay-safe durable workflow
2. bundled local workflows and slash commands for common repository automation tasks

Today, the built-in command surface focuses on **local validation and local merge flows**.
The underlying compiler API is broader.

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
2. Use `/lasso:plan <brief>` to draft a request for a bundled workflow.
3. Review the generated JSON, then pass it into `/lasso:compile` or `/lasso:run`.
4. Use `/lasso:inspect` to inspect the compiled spec, CIR, and runtime state.

> **Safety:** Lasso checks out refs, applies patches, and merges branches in the
> target repo. Use a throwaway clone or disposable worktree, not your primary
> checkout.

---

## Table of Contents

- [What Lasso does](#what-lasso-does)
- [When to use Lasso](#when-to-use-lasso)
- [Does it work with any workflow?](#does-it-work-with-any-workflow)
- [Bundled workflows](#bundled-workflows)
- [Slash commands](#slash-commands)
- [Request examples](#request-examples)
- [Custom workflows (advanced)](#custom-workflows-advanced)
- [How Lasso fits with pi-duroxide](#how-lasso-fits-with-pi-duroxide)
- [Non-goals](#non-goals)

---

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

## When to use Lasso

| Goal | Fit | Notes |
| --- | --- | --- |
| Validate an existing patch or branch locally | Excellent fit | Use `patch-validation` |
| Simulate a local PR review + merge flow | Excellent fit | Use `pr-review-merge` |
| Compile your own workflow from code | Good fit | Use the compiler API |
| Run live GitHub PR automation | Not yet | Lasso is local-only today |
| Ask Lasso to invent arbitrary new workflows from natural language | Not yet | Planner/replanner only understand bundled workflows |

## Does it work with any workflow?

**Short answer:** not from the built-in slash commands, but yes at the compiler
layer.

Lasso currently has two distinct surfaces:

| Surface | Scope today |
| --- | --- |
| `/lasso:plan`, `/lasso:replan`, `/lasso:compile`, `/lasso:run` | Only the bundled `patch-validation` and `pr-review-merge` workflows |
| `validateHarnessSpec`, `lowerHarnessSpecToCir`, `compileHarnessSpec` | Any workflow you can express as a valid `HarnessSpec` |

So if you are asking, **"Can I point the current README commands at any random
workflow shape?"** — no, not today.

If you are asking, **"Can Lasso compile more than the two examples in this
repo?"** — yes. The package exports the generic spec/validation/lowering/compiler
surface for custom workflows. What is still narrow is the operator-facing
request catalog and the planner/replanner logic.

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
| `/lasso:compile <workflow request JSON>` | You want to inspect what Lasso will register | Builds the bundled reference spec, validates it, lowers it to CIR, and stores the compiled artifact in memory |
| `/lasso:run <workflow request JSON>` | You want to execute a bundled workflow locally | Compiles, registers, and starts the workflow |
| `/lasso:inspect [workflow-name]` | You want to inspect the latest or named compiled workflow | Shows the compiled spec, CIR, and runtime state |

### `/lasso:plan`

The planner is deterministic and draft-only. It classifies a freeform brief into
either `patch-validation` or `pr-review-merge` and returns:

1. a draft workflow request JSON envelope you can pass into `compile` or `run`, or
2. a clarification result with missing fields and concrete next-step guidance

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
new branch names, candidate sources, or command lists.

## Request examples

Lasso commands accept either an explicit workflow envelope or the legacy raw
`pr-review-merge` shorthand.

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

## Custom workflows (advanced)

If you need more than the two bundled workflows, use Lasso as a library.

The generic package surface is:

- `HarnessSpec` types for authoring workflow specs
- `validateHarnessSpec(...)` to validate a spec
- `lowerHarnessSpecToCir(...)` to inspect the lowered internal workflow
- `compileHarnessSpec(...)` to produce a replay-safe workflow for `pi-duroxide`

That is the part of Lasso designed to work with **arbitrary workflow shapes**.
What is still intentionally narrow is the built-in request catalog and the
natural-language planning/replanning layer.

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
