# Error Taxonomy

This document defines the standard `ERROR_CLASS` values used in `scripts/run_task.ps1`, `scripts/gate_light_ci.mjs`, and `rules/task-reports/index/error_stats.jsonl`.

## Core Error Classes

| ERROR_CLASS | Description |
| :--- | :--- |
| **CI_PARITY_MERGEBASE_MISMATCH** | CI environment `git merge-base` differs from local calculation (often due to shallow clone). |
| **EVIDENCE_REQUIRED_INPUTS_MISSING** | Required evidence files (e.g., `dod_evidence`, `git_meta`) are missing. |
| **CMD_SYNTAX_BANNED** | Usage of banned command syntax (e.g., chained commands `;`, `&&`, `\|\|`) in `run_task.ps1`. |
| **WORKSPACE_DIRTY_TRACKED** | Workspace has modified tracked files during a clean-required phase (Dev/Integrate). |
| **FILE_LOCK_REMOVE_ITEM** | Attempt to delete a lock file or run directory (WORM violation). |
| **SERVICE_HEALTHCHECK_FAIL** | Service healthcheck (port 53122) failed (non-200 OK). |
| **STEP_TIMEOUT** | A step in `run_task.ps1` exceeded its timeout limit. |
| **UNKNOWN** | Unclassified error. |
| **EVIDENCE_WORM_BYPASS** | **[NEW]** Attempt to modify or delete existing `rules/task-reports/runs/` or `rules/task-reports/locks/` files in PR diff or local workspace. |
| **OPEN_PR_GUARD_BLOCKED** | **[NEW]** Open PR Guard blocked execution due to existing Open PRs that are not superseded or ignored. |
| **COMMIT_DRIFT_REF_MISSING** | **[NEW]** Reference commit for drift check is missing (e.g., due to rebase/force-push) and fallback check detected code changes. |
| **CI_AUTOFIX_FAILED** | **[NEW]** AutoFix mechanism failed to resolve CI issues after maximum retries. |

## Usage
When an error occurs, the automation script MUST output a `FAIL_ROOT_CAUSE_BLOCK` containing:
```
FAIL_ROOT_CAUSE_BLOCK
ERROR_CLASS=<One of the above>
ROOT_CAUSE_HINT=<Brief explanation>
```
