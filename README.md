# Lasso

Lasso is a workflow compiler layered on top of `pi-duroxide`. It validates a declarative `HarnessSpec`, lowers it to CIR, compiles it into replay-safe workflows, and exposes a thin pi adapter for compile/run/inspect operations.

## Standalone repository

Lasso is now its own repository. `pi-duroxide` is a dependency, not a sibling package.

- `pi-duroxide` owns workflow lifecycle, replay, timers, events, and runtime registration
- Lasso owns spec validation, CIR lowering, compilation, reference workflow construction, and operator-facing commands

Roadmap work continues here in the standalone `lasso` repository.

### Local development bridge

Currently, local development uses the cleaned `feature-lasso-mvp` worktree from the `pi-duroxide` repository as a temporary package-level bridge. This allows the standalone repo to build and test safely while the `pi-duroxide` package boundary stabilizes.

## Reference workflows

Lasso ships two reference workflows. Both operate entirely against a local repository or worktree — no live GitHub APIs are called.

### `patch-validation`

Validates a pre-existing candidate fix against a known-bad baseline. The workflow **does not author code**; it receives a fix that already exists (as a branch or a patch file) and runs a structured gate:

1. Checks out `baselineRef` and runs `reproduceCommands` — expects them to fail, confirming the bug is present.
2. Applies the candidate from `candidateSource`.
3. Re-runs `reproduceCommands` — expects them to pass now.
4. Runs `verificationCommands` as a regression guard.
5. Optionally produces an LLM summary and routes to a human approval gate when `approvalRequired` is `true`.

Terminal outcomes: `validated-fix`, `not-reproduced`, `apply-failed`, `candidate-failed`, `rejected`.

### `pr-review-merge` (legacy)

The original simulated PR review + merge flow. It uses tool nodes to inspect the repo, run verification commands, and perform a local merge, with an LLM review node, a human approval gate, and retry behavior after merge.

## Pi adapter commands

When the Lasso extension is loaded, it first boots the underlying `pi-duroxide` workflow extension and then adds three slash commands:

- `/lasso:compile <workflow request JSON>`
- `/lasso:run <workflow request JSON>`
- `/lasso:inspect [workflow-name]`

`compile` builds the reference `HarnessSpec`, validates it, lowers it to CIR, and stores the compiled artifact in memory.

`run` compiles the same reference workflow, registers it with `pi-duroxide`, and starts an orchestration instance.

`inspect` shows the compiled spec, the lowered CIR, and the current workflow instances reported by the durable runtime.

## Workflow request envelopes

Commands accept either an explicit workflow envelope or the legacy `pr-review-merge` shorthand.

### Explicit envelope (preferred)

```json
{
  "workflow": "patch-validation",
  "input": { ... }
}
```

```json
{
  "workflow": "pr-review-merge",
  "input": { ... }
}
```

### `patch-validation` input

`repoPath` must point at a **disposable local repository or worktree**. The workflow checks out refs and applies patches in-place; run it against a dedicated fixture or throwaway clone, never your primary working tree.

**Branch candidate example:**

```json
{
  "workflow": "patch-validation",
  "input": {
    "repoPath": "/absolute/path/to/disposable-worktree",
    "baselineRef": "main",
    "candidateSource": { "kind": "branch", "value": "fix/bug" },
    "reproduceCommands": ["npm test -- --grep 'the broken test'"],
    "verificationCommands": ["npm test"],
    "reviewInstructions": "Approve if the fix is minimal and all tests pass.",
    "approvalRequired": true
  }
}
```

**Patch-file candidate example:**

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

### `pr-review-merge` input (legacy shorthand)

The raw `LocalPrBundle` shape is still accepted without an explicit envelope and routes to `pr-review-merge`:

```json
{
  "repoPath": "/absolute/path/to/disposable-worktree",
  "sourceBranch": "feature/pr-change",
  "targetBranch": "main",
  "reviewInstructions": "Approve only if verification passes and the diff looks safe.",
  "verificationCommands": [
    "node -e \"process.exit(0)\""
  ]
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

## Non-goals

The MVP does **not** include:

- live GitHub or `gh` integration
- autonomous code authoring or patch generation (the workflow validates a fix you already have)
- planner or synthesis layers
- adaptive replanning
- arbitrary generated TypeScript

## Package structure

- `src/spec/` — public spec types, schema, and validator
- `src/cir/` — internal execution contract and lowering
- `src/compiler/` — replay-safe workflow compiler and runtime helpers
- `src/reference/` — simulated/local PR review + merge reference workflow
- `src/pi/` — thin pi adapter surface
