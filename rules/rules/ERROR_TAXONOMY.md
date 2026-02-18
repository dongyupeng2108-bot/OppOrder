# Error Taxonomy (错误分类口径)

This document defines the standardized `ERROR_CLASS` enumeration for the OppRadar project.
These error classes are used for:
1.  Structured error logging in `FAIL_ROOT_CAUSE_BLOCK`.
2.  Automated error statistics recording (`rules/task-reports/index/error_stats.jsonl`).
3.  Governance Backlog generation (Three-Strike Rule).

## Enumeration

| ERROR_CLASS | Description | Typical Root Cause |
| :--- | :--- | :--- |
| **CI_PARITY_MERGEBASE_MISMATCH** | CI Parity Evidence (`merge_base`) does not match current git state. | Branch outdated, rebase/merge occurred after evidence generation. |
| **EVIDENCE_REQUIRED_INPUTS_MISSING** | PreAssemblePrecheck or other evidence checks failed due to missing files. | Script failure, interrupted execution, or file system issue. |
| **CMD_SYNTAX_BANNED** | Usage of prohibited cmd.exe syntax (e.g., `&&`, `||`, `>nul`) in PowerShell. | Legacy script copy-paste, non-compliance with SafeCmd protocol. |
| **WORKSPACE_DIRTY_TRACKED** | Workspace Healer found tracked changes in `EnforceClean` mode. | Uncommitted changes in working directory. |
| **FILE_LOCK_REMOVE_ITEM** | Attempt to delete a locked file (Immutable Integrate violation) or permission issue. | Trying to rerun a completed Integrate task, or file locked by process. |
| **SERVICE_HEALTHCHECK_FAIL** | Service port 53122 healthcheck failed (non-200 OK). | Service not started, crashed, or port conflict. |
| **STEP_TIMEOUT** | A script execution step exceeded its defined timeout. | Infinite loop, slow network, or resource exhaustion. |
| **UNKNOWN** | Unclassified error. | unexpected exception, script logic error without explicit class. |

## Usage Rule

In any `FAIL_ROOT_CAUSE_BLOCK` or error output, you MUST include:
```text
ERROR_CLASS=<CLASS_NAME>
ROOT_CAUSE_HINT=<Short description>
```

## Governance Trigger

*   **Trigger Condition**: 3 occurrences of the same `ERROR_CLASS` within the last 50 error records.
*   **Action**: Automatically generate a Governance Backlog item at `rules/task-reports/governance-backlog/GOV_<date>_<ERROR_CLASS>.md`.
