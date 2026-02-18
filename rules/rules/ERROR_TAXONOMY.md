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
| **AUTO_PR_CI_FAIL** | **[NEW]** AutoPR loop detected CI failure (GitHub Actions checks failed). |
| **AUTO_PR_INFRA_FAIL** | **[NEW]** AutoPR loop failed due to infrastructure issues (git push failed, gh cli error). |
| **AUTO_PR_TIMEOUT** | **[NEW]** AutoPR loop timed out waiting for CI checks. |
| **AUTO_PR_EVIDENCE_MISSING** | **[NEW]** Gate Light failed because `auto_pr_*.json` is missing or invalid. |
| **AUTO_FIX_MAX_EXCEEDED** | **[NEW]** AutoPR loop exceeded maximum AutoFix attempts without success. |

## Usage
When an error occurs, the automation script MUST output a `FAIL_ROOT_CAUSE_BLOCK` containing:
```
FAIL_ROOT_CAUSE_BLOCK
ERROR_CLASS=<One of the above>
ROOT_CAUSE_HINT=<Brief explanation>
```
