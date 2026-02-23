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

### Governance Principles（治理原则）
任何新增治理规则必须满足 Complexity Budget 与 Automation-Only Rule。

1. Complexity Budget（复杂度预算）：任何新增治理规则必须 **减少** 人工步骤或状态空间；若只增加人工步骤/例外判断，一律禁止落地。 
2. Automation-Only Rule（自动化优先）：任何新增规则若不能被脚本自动检查/自动生成，则不得新增（先补自动化再写规则）。 
3. Single Writer Boundary（单写入者边界）：受 git 跟踪的证据文件（notify/result/index/envelope/snippet 等）只允许 Integrate（集成）产出并提交；CI 角色必须是 verify-only（只验证）。 
4. No Split-Brain（禁止分裂脑）：禁止 CI 或脚本“重写已有受跟踪证据文件”造成本地/CI 证据互相覆盖；如需生成，仅允许生成临时日志或缺失文件（后续任务实现）。 
5. Evidence = Commit Snapshot（证据=提交快照）：代码（尤其门禁相关）一动即证据必须重建并提交；不得“改代码不刷新证据”。 
6. Fix-Front Only（只修最前失败点）：门禁失败按顺序逐层清零；一次修复=一次最小提交；禁止并行混修多个失败点。 
7. No Bypass（禁止绕过）：禁止为让 CI 过而削弱/删除校验；允许的紧急修复仅限“补字段/补 marker/增强可观测性”，不得夹带重构。 
8. Determinism First（确定性优先）：证据生成必须确定性（同输入同输出）；输出统一 LF（换行）与 UTF-8（无 BOM），避免跨平台哈希不一致。 
9. Source of Truth（事实来源）：工程状态以 GitHub Actions CI + 锁文件为准；文档必须明确 writer/verifier 边界与例外处理口径。 
10. Change Containment（变更收敛）：治理改动优先“新增自检/摘要/工具入口”，避免在多个位置同时修改规则与实现导致漂移。 

### Fix-Front 排查顺序（Front-of-Queue）
1. 只修当前最前失败点；一次修复=一次最小提交；禁止并行混修。
2. 修复后必须本地重建相关证据并触发 CI 复验。
3. 适用于 Integrate（集成）修复回环场景。

### Gate Light Evidence Standards (CI Parity)

task_id（任务标识）允许格式：`YYMMDD_NNN` + 可选 1 位字母后缀（用于 rerun/patch（重跑/补丁））。Gate Light（门禁）/CI（持续集成）必须解析完整 task_id（含后缀），作为 PR（拉取请求）任务锁定（task lock）与证据路径定位依据。

**Integrate 入口强绑定与前置缺口 fail-fast（快速失败）**：
*   **单一事实源**：分支/PR task_id 作为唯一事实源；`ARG_TASK_ID` 与 `rules/LATEST.json` 必须一致，不一致立即退出。
*   **入口强绑定**：`BRANCH_TASK_ID == ARG_TASK_ID == LATEST_TASK_ID` 必须在 Integrate 最前置校验，≤3秒 fail-fast。
*   **PreAssemble fail-fast**：在 Gate Light/Contract/CI Watch 前检查 `generate_evidence_<task_id>.mjs` 与最小三件套（`dod_evidence`/`git_meta`/`result`），任一缺失立即退出。

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
        *   **Defaults (Task >= 260219_001)**:
            *   `AutoPR`: **ON** (Enabled by default unless `-AutoPR:$false` is passed).
            *   `AutoFixMax`: **1** (Attempts 1 automatic fix loop unless `-AutoFixMax <N>` is passed).
        *   **Prerequisites**: Clean git working directory (committed code).
        *   **Actions**:
            *   **Preflight**: Checks port 53122, git status.
            *   **Evidence**: Generates full evidence set (including `auto_pr_*.json`).
            *   **AutoPR Loop**: Automatically creates PR, watches checks, and applies deterministic fixes (CI Parity, LATEST.json sync) up to `AutoFixMax` times.
            *   **Fail-Fast**: Exits immediately on Infra Error or when AutoFix limit is reached.
            *   **Gate Light**: Validates evidence existence and quality.
            *   **Preflight**: Enforces strict "One Task at a Time".
            *   **Pass 1**: Generates all evidence files (Result, Notify, Logs).
            *   **Pass 2**: Verifies evidence with Gate Light (Verify Mode).
            *   **Archive**: Moves evidence to `runs/<task_id>/` and creates Lock File.

### Error Tiering + Escalation + Loop Detection（错误分层+升级报告+循环检测）
1. **Error Tiering（错误分层）**：错误分为“可自愈（Self-healable）/不可自愈（Non-self-healable）”，由硬编码表判定，不依赖 LLM。
2. **Bounded Auto-recovery（有限自救）**：仅对可自愈类执行自动修复，每个 ERROR_CLASS 最多 1 次，全局最多 1 次（对齐 AutoFixMax=1）。
3. **Loop Detection（循环检测）**：同一 ERROR_CLASS 或 FAIL_REASON 连续 ≥2 次，或同日同基号 task_id 后缀短窗口递增 ≥2，立即触发升级并停止。
4. **Escalation Report（升级报告）**：触发不可自愈或循环阈值时，生成 `rules/task-reports/<YYYY-MM>/escalation_<task_id>.md`，字段必须完整（见 PROJECT_RULES.md）。
5. **DoD**：错误摘要包含 tier；升级报告必须为 LF + UTF-8（无 BOM）；不可自愈/循环一律“停 + 报告”，禁止继续自动化动作。

### Stop-on-hardstop（硬停）
1. **触发条件**：ERROR_CLASS 或 FAIL_REASON 命中不可自愈（Non-self-healable）或硬停清单。
2. **立即停止**：外层流程立刻停止，不再执行 AutoPR（自动 PR）、AutoFix（自动修复）、Task ID（任务标识）自动变更或重跑。
3. **最短事实块**：仅输出三行：HARD_STOP=1；HARD_STOP_REASON=...；NEXT_ACTION=STOP_AND_REPORT。
4. **Dev 冒烟**：仅 Dev 模式允许 HARD_STOP_SIMULATE（硬停冒烟）环境变量触发；Integrate（集成）/CI（持续集成）禁止生效。

### Cleanup Discipline & Hard Stop Protocol (清理纪律与硬停协议)

To prevent phantom execution and UI blocking after a task failure or hard stop:

1.  **Forbidden Operations (禁止操作)**:
    *   **Post-Hard-Stop**: After `HARD_STOP=1` is triggered, NO further `Remove-Item`, `del`, `rm`, `rd`, or wildcard deletions are allowed in PowerShell/Shell.
    *   **Wildcard Deletion**: `Remove-Item *` or `del *` is STRICTLY PROHIBITED in the execution chain (run_task, dev_batch_mode) as it may trigger interactive confirmation dialogs in the Trae IDE.

2.  **Allowed & Recommended Cleanup (推荐清理方式)**:
    *   **Node.js Only**: ALL cleanup operations MUST use `scripts/ops_delete.mjs` (or `ops_cleanup_patterns.mjs` for batch).
    *   **Pattern**:
        ```powershell
        # Single Pattern
        node scripts/ops_delete.mjs "rules/task-reports/2026-02/*<task_id>*" --dry-run --max 200
        node scripts/ops_delete.mjs "rules/task-reports/2026-02/*<task_id>*" --force --max 200
        
        # Batch Pattern (Recommended)
        node scripts/ops_cleanup_patterns.mjs --max 200 --force "pattern1" "pattern2"
        ```
    *   **Why**: Node.js `fs.rm` / `fs.unlink` provides deterministic, non-interactive deletion without triggering OS/IDE shell confirmation popups.

### Standard Investigation/Audit Command Discipline (标准排查/审计命令纪律)

To reduce Trae Desktop popups and environment dependency risks, strict discipline is enforced for investigation and audit commands.

1.  **Mandatory Tool**:
    *   **Standard**: MUST use `node scripts/ops_scan_text.mjs ...` for all automated or standard procedure scanning/auditing.
    *   **Prohibition**: `grep`, `Select-String`, `findstr`, or other shell-native search commands are **FORBIDDEN** in standard task reports, scripts, or automated workflows.
    *   **Exception**: Temporary manual use in the terminal during ad-hoc debugging is allowed, but the output MUST NOT be used as the standard "Fact Block" in task reports.

2.  **Usage Pattern**:
    *   **Scan & Report**:
        ```bash
        # Scan for high-risk keywords in scripts
        node scripts/ops_scan_text.mjs --globs "scripts/*.ps1" --pattern "(Remove-Item|\\bdel\\b)" --json
        
        # Audit specific file types for patterns
        node scripts/ops_scan_text.mjs --globs "rules/rules/*.md" --pattern "echo\\s+.*\\s+>" --max_hits 50 --json
        ```
    *   **Why**: Node.js provides consistent, cross-platform behavior (regex, globbing) and avoids "High Risk Command" warnings in Trae Desktop.

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

## Hard Rule — Task Release Gate (One-at-a-time) 
未收到上一任务的正式回报且其中明确写出“DoD 达成/未达成”结论之前，禁止发布任何新的 TraeTask_* 任务。 
违反该规则的任务视为无效，必须撤回并在上一任务闭环后重新发布。 

除非显式发布 Workflow 升级任务，否则任务模板结构不可改变
