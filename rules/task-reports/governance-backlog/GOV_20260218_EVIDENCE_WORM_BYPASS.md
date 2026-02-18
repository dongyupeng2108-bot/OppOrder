# Governance Backlog: Evidence WORM Bypass

**Task ID**: 260218_015
**Date**: 2026-02-18
**Status**: OPEN (Governance Required)
**Priority**: M-G1 (Mechanism - Governance Level 1)

## 1. Issue Description
A process vulnerability exists where a user can bypass the "Immutable Integrate" rule (One-Shot) by manually deleting or modifying the `rules/task-reports/runs/` or `rules/task-reports/locks/` directories.
Although the current `run_task.ps1` checks for the existence of a lock file, it does not prevent a user from deleting that lock file (locally or in a commit) to force a re-run.
This undermines the integrity of the evidence chain and the "Write Once, Read Many" (WORM) principle for task artifacts.

## 2. Why this is Non-Blocking but Critical
This is not blocking the merge of PR #111 (Task 260218_014) because that task focused on CI Parity and Shallow Clone issues. However, leaving this loophole open allows for potential "evidence tampering" or "status resetting" in future tasks. It must be addressed immediately via this governance backlog item and subsequent fix (Task 260218_015).

## 3. Risks
- **Integrity Loss**: Evidence can be discarded or replaced after the fact.
- **Audit Failure**: "One-Shot" Integrate rule becomes unenforceable.
- **Bypass**: Users can treat Integrate as "Try-Catch" by deleting failures/locks.

## 4. Proposed Fix Strategy (WORM Defense)
We implement a "Defense in Depth" approach:

### Strategy A: Gate Light Audit (CI/PR Level)
- **Mechanism**: In `scripts/gate_light_ci.mjs`, analyze the `git diff --name-status` between `origin/main` and `HEAD`.
- **Rule**: Fail immediately if any file in `rules/task-reports/runs/**` or `rules/task-reports/locks/**` has a status of **D** (Deleted) or **M** (Modified).
- **Exception**: **A** (Added) is permitted for new task runs.
- **Error Class**: `EVIDENCE_WORM_BYPASS`.

### Strategy B: Integrate Preflight Check (Local Level)
- **Mechanism**: In `scripts/run_task.ps1` (Integrate Mode), before execution.
- **Rule**: Check if the lock file (`locks/<task_id>.lock.json`) has **ever existed** in the repository history (using `git log` or `git rev-list`).
- **Logic**: If `LockFile` is missing locally BUT exists in history -> **FAIL** (Tampering detected).
- **Error Class**: `EVIDENCE_WORM_BYPASS` (mapped via FAIL_ROOT_CAUSE_BLOCK).

### Strategy C: Error Governance
- Log these attempts to `error_stats.jsonl` under `EVIDENCE_WORM_BYPASS` to track frequency of bypass attempts.
