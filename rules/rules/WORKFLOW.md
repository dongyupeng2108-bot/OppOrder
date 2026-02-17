# Workflow & Project Standards

## Core Documentation Path Standards
**(Canonical & Strict)**

To prevent path divergence and context loss, the following paths are **CANONICAL** and **MANDATORY**:

1.  **Canonical Path**: `E:\OppRadar\rules\rules\`
    -   Repository Relative: `rules/rules/`
    -   **ALL** core documentation changes MUST target files in this directory.

2.  **Core Documents**:
    -   `rules/rules/WORKFLOW.md` (This file)
    -   `rules/rules/PROJECT_RULES.md`
    -   `rules/rules/PROJECT_MASTER_PLAN.md`

3.  **Historical/Deprecated Path**:
    -   `E:\OppRadar\rules\` (root `rules/`) is **DEPRECATED** for core docs.
    -   Files found there are historical artifacts or temporary outputs. DO NOT edit them as the source of truth.

---

## Windows Environment Protocols

### Command & Environment Protocols
- **Explicit Environment**: All task templates MUST specify the execution environment (PowerShell or bash) using `ENV=PowerShell|bash`.
- **Default Syntax**: Task templates for `RUN` and `CMD` default to **PowerShell** syntax unless explicitly declared as CMD.
- **Cross-Platform Compatibility**:
  - **Hard Rule**: **Forbid `cd /d` in shell**. The `cd /d` syntax is specific to `cmd.exe` and causes fatal errors in PowerShell (`Set-Location : A positional parameter cannot be found...`).
  - **Standard Templates**:
    1. **PowerShell** (Default): `Set-Location 'E:\OppRadar'` or `cd 'E:\OppRadar'`.
    2. **CMD** (Legacy/Specific): `cd /d E:\OppRadar` (MUST explicitly state "Only for CMD").
    3. **Bash/zsh**: Use Windows Terminal/PowerShell preference, or in WSL: `cd /mnt/e/OppRadar`.
- **Interactive Commands**: Forbidden (no `pause`, `choice`, `read-host`, or interactive Y/N prompts).

### Command Templates
#### PowerShell (Recommended)
```powershell
# ENV=PowerShell
cd E:\OppRadar
# ... commands ...
```

#### Bash (WSL/Git Bash)
```bash
# ENV=bash
cd /mnt/e/OppRadar
# ... commands ...
```

### Anti-Locking Git Operations
- **Root Context**: ALWAYS execute `git` commands from the repository root (`E:\OppRadar`). NEVER execute `git` commands while the terminal CWD is inside a subdirectory (e.g., `OppRadar/`) that might be modified/deleted by the git operation.
- **Process Cleanup**: Before `git pull`, `git rebase`, or `git checkout`, ensure no background processes (like `node` servers) are holding locks on files in `OppRadar/` or `scripts/`.
- **Interactive Prompts**: Git for Windows may prompt "Should I try again? (y/n)" if a file is locked. To avoid this hanging the agent:
  - Ensure the CWD is safe (Root).
  - If it happens, the Agent must NOT try to interact (which fails). The Agent should have prevented it by ensuring clean state.
  - **Explicit Kill**: Before major git operations that change directory structure, explicitly kill potential locking processes (e.g., `Stop-Process -Name node -ErrorAction SilentlyContinue`).

### Two-Phase Rhythm (两段式节奏)
To reduce repository overhead and conflicts, we adopt a two-phase workflow for each task:

#### Preflight (Task Start)
Before starting any new task, the Agent MUST perform these checks:
1.  **Merge Status**: Ensure the *previous* task branch has been merged into `origin/main` (or explicitly abandoned). Do not start a new task on top of unmerged/stale branches.
2.  **Duplicate Task ID**: Check `rules/task-reports/` to ensure the current `task_id` does not already exist. Re-using IDs causes "nested doll" evidence and is FORBIDDEN.

1.  **Development Phase (Dev)**:
    *   **Focus**: Coding, local testing, unit tests, smoke tests.
    *   **Allowed Scope**: Code (`src/`, `scripts/`), Contracts (`contracts/`), Docs (`rules/rules/`).
    *   **Constraints**:
        *   **NO** evidence generation (`envelope_build.mjs`).
        *   **NO** `LATEST.json` updates.
        *   **NO** `rules/task-reports/**` writes.
    *   **Command**: Use `scripts/dev_batch_mode.ps1 -Mode Dev`.

2.  **Integration Phase (Integrate)**:
    *   **Focus**: Final validation, evidence generation, PR creation.
    *   **Allowed Scope**: Evidence (`rules/task-reports/`), Docs (`rules/rules/`), Metadata (`rules/LATEST.json`). NO Business Code changes.
    *   **Constraints**:
        *   Run **ONCE** at the end of the task.
        *   **Clean State**: MUST NOT run with uncommitted code changes (only evidence/docs allowed).
        *   Generates evidence, updates `LATEST.json`, runs postflight & pre-pr checks.
    *   **Command**: Use `scripts/dev_batch_mode.ps1 -Mode Integrate`.

### Gate Light Evidence Standards (CI Parity)

*   **Automation Pack V1 Workflow (Standard for M4+)**:
    The `scripts/run_task.ps1` pipeline automates the Two-Phase Rhythm.

    *   **Development (Dev Mode)**:
        *   **Command**: `scripts/run_task.ps1 -TaskId <id> -Mode Dev -Header <header>`
        *   **Actions**:
            *   **Preflight**: Checks port 53122, git status.
            *   **Pass 1**: Runs Gate Light in **Preview Mode** to verify code logic without enforcing evidence existence.
            *   **Skip**: Does NOT generate permanent evidence or git commits.

    *   **Integration (Integrate Mode)**:
        *   **Command**: `scripts/run_task.ps1 -TaskId <id> -Mode Integrate -Header <header>`
        *   **Prerequisites**: Clean git working directory (committed code).
        *   **Actions**:
            *   **Preflight**: Enforces strict "One Task at a Time".
            *   **Pass 1**: Generates all evidence files (Result, Notify, Logs).
            *   **Pass 2**: Verifies evidence with Gate Light (Verify Mode).
            *   **Archive**: Moves evidence to `runs/<task_id>/` and creates Lock File.

## Open PR Guard Protocols (One Task at a Time)

To maintain a linear, conflict-free history, we enforce a strict "One Task at a Time" policy.

### 1. The Rule
- **Blocking Condition**: If ANY open PR exists in the repository (excluding the current task's PR), the task execution is BLOCKED.
- **Resolution**: You must Merge or Close the blocking PRs before starting a new task.

### 2. Exceptions & Overrides
In rare cases (e.g., superseding an abandoned task), you may bypass the guard using **Precise Exemptions**.

#### A. Global Mock (Dev Only)
- **Env Var**: `OPEN_PR_GUARD_MOCK_JSON`
- **Scope**: **Strictly Limited to Dev Mode**.
- **Behavior**: Forces the guard to use a static JSON list of PRs instead of querying GitHub.
- **Prohibition**: FAILS IMMEDIATELY if used in `Integrate` mode or CI.

#### B. Precise Ignore & Supersede (Integrate/CI Allowed)
To ignore a specific blocking PR (e.g., PR #103), you must explicitly declare it AND the task it supersedes.

- **Env Vars**:
  - `OPEN_PR_GUARD_IGNORE_PR_NUMBERS="103,105"` (Comma-separated PR numbers)
  - `OPEN_PR_GUARD_SUPERSEDE_TASK_IDS="260216_006"` (Comma-separated Task IDs)
- **Logic**:
  1. The Guard fetches **REAL** open PRs from GitHub.
  2. It checks if the ignored PR #103 corresponds to a task in `SUPERSEDE_TASK_IDS` (e.g., title contains "260216_006").
  3. If matched, PR #103 is removed from the blocking list.
  4. **Self-Check**: The current task ID must NOT equal the superseded task ID.

### 3. Task Template Immutability
- **Rule**: The standard Task Template structure (as defined in `scripts/scaffold_task.js` or equivalent) is **IMMUTABLE** within a normal feature task.
- **Change Protocol**: Any change to the Task Template must be performed in a dedicated "Workflow Upgrade" task, explicitly titled as such.
