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

1.  **Development Phase (Dev)**:
    *   **Focus**: Coding, local testing, unit tests, smoke tests.
    *   **Constraints**:
        *   **NO** evidence generation (`envelope_build.mjs`).
        *   **NO** `LATEST.json` updates.
        *   **NO** `rules/task-reports/**` writes.
    *   **Command**: Use `scripts/dev_batch_mode.ps1 -Mode Dev`.

2.  **Integration Phase (Integrate)**:
    *   **Focus**: Final validation, evidence generation, PR creation.
    *   **Constraints**:
        *   Run **ONCE** at the end of the task.
        *   **Clean State**: MUST NOT run with uncommitted code changes (only evidence/docs allowed).
        *   Generates evidence, updates `LATEST.json`, runs postflight & pre-pr checks.
    *   **Command**: Use `scripts/dev_batch_mode.ps1 -Mode Integrate`.

### Conflict Minimization
*   **LATEST.json**: Only update during the Integration Phase (1 modification per PR).
*   **Task Reports**: Only write to `rules/task-reports/**` during the Integration Phase.
*   **Repo Operation Budget**: Limit git operations to ≤ 8 steps per task.
*   **Fail-Fast**:
    *   If a conflict, lock file, or abnormal state occurs -> **STOP IMMEDIATELY**.
    *   Do not attempt complex interactive recovery.
    *   Preferred recovery: Discard branch -> New branch -> Re-apply changes.

### Avoid Trae High-Risk Confirmation
*   **No Chained Commands**: Do NOT use `;` or `&&` to chain multiple high-risk commands (e.g., `git add . ; git commit ... ; git push ...`) in a single line. This triggers Trae's "High Risk" confirmation dialog.
*   **Solution**:
    *   Execute commands step-by-step in separate tool calls.
    *   OR encapsulate them in a script (like `dev_batch_mode.ps1`) and run the script.

## PR Creation Standards (Agent/Dev)
### Anti-Duplicate & Noise Control (Hard Guard)
1. **Mandatory Pre-Check**: Before starting any task execution (especially Integrate phase), MUST run `pre_pr_check`:
   ```powershell
   node scripts/pre_pr_check.mjs --task_id <task_id>
   ```
2. **Duplicate Detection & Rejection**:
   - The script checks `origin/main` for existing `task_id` (files or LATEST.json occupation).
   - If found, it outputs a 3-line REJECT block:
     ```text
     REJECT_DUPLICATE_TASK_ID: <task_id>
     REJECT_REASON: task_id already exists in origin/main
     EXECUTION_ABORTED=1
     ```
   - Exits with **Code 21**.
3. **Integrate Phase Interception**:
   - `scripts/dev_batch_mode.ps1` (Integrate mode) MUST run this check as the **FIRST STEP** (step 0).
   - If check fails (Exit Code 21), the script MUST abort immediately with **0 side effects** (no files written).
   - **Action**: Agent MUST abort immediately. Do NOT generate evidence. Do NOT create PR.


3. **Fail-Fast Logic**:
   - If `git diff --name-only origin/main...HEAD` shows only `rules/task-reports/**` changes AND the task_id exists in `origin/main`, the PR is considered "Duplicate Noise". Abort.

### Task ID Lifecycle
- **Definition**: A `task_id` is considered **"Published"** once it appears in a TraeTask message.
- **Rule**: **"Published = Reserved, Never Reuse"**.
  - Once a `task_id` is published, it is permanently consumed.
  - Even for "Docs-only" or "Fix" tasks, if the original task was merged or even just attempted and abandoned with artifacts left behind, you MUST use a **NEW** `task_id` for the next attempt.
- **Conflict Handling**:
  - If you encounter a `task_id` conflict (e.g., folder exists in `rules/task-reports/`), **IMMEDIATELY STOP**.
  - **Action**: Switch to a new `task_id`.
  - **History**: Do NOT overwrite old evidence. Keep it as history.

### PR Hygiene
- **Prohibited**:
  - **Duplicate PRs**: Do not open a second PR for the same `task_id` if one was already merged.
  - **Duplicate Task ID PRs**: Do not open a PR with a `task_id` that already exists in `main`.
- **Mandatory Pre-PR Check**:
  - You **MUST** run `node scripts/pre_pr_check.mjs --task_id <task_id>` before creating a PR.
  - If it fails (Exit Code 21), you are violating the "No Reuse" rule. **STOP** and get a new ID.

## 合并职责说明 (Merge Responsibility)
**PR 合并需要老板手工执行**。Trae 严禁自动合并 PR。

### 最小合并步骤清单 (Minimal Merge Checklist)
1. **进入 PR 页面**: 打开 GitHub PR 链接。
2. **确认 Gate Light**: 检查 "Checks" 部分，确认 `gate-light` 工作流显示为 ✅ Pass。这是必需检查项。
3. **Merge**: 点击 "Merge pull request" -> "Confirm merge"。
4. **删除分支 (可选)**: 确认合并后，可点击 "Delete branch" 清理远程分支。
5. **本地同步**: 在本地终端执行：
   ```bash
   git checkout main
   git pull --rebase origin main
   ```
   *注意：必须使用 `--rebase` 以保持提交历史整洁。*

### 冲突处理 (Conflict Handling)
若遇到合并冲突，请按以下原则处理：

#### `rules/LATEST.json` 冲突
- **原则**: **保留最新**。
- **操作**: 选取 `task_id` 最大的版本，并确保文件内容是合法的 JSON 格式。
- **说明**: 此文件仅用于记录最新任务状态，不影响历史功能。

#### 其他文件冲突
- **原则**: 仔细比对，确保不丢失关键业务逻辑或文档更新。
- **操作**: 手工解决冲突 -> 提交 -> 等待 CI 通过 -> 合并。

## 消息头驱动的双模式协议 (Message Header Protocol)

为避免标准任务（Standard Task）与临时修复/讨论（Maintenance/Discussion）的上下文混淆，本项目强制实行**消息头驱动**的沟通协议。

### 1. 合法消息头 (Valid Headers)
所有下发指令必须以以下三种消息头之一开头，否则**默认拒绝**。

*   **`TraeTask_`**: 标准任务模式。
    *   **定义**: 完整的增量开发/文档任务，必须包含 `task_id`、`milestone`、`branch` 等元数据。
    *   **行为**: 严格执行 WORKFLOW 全闭环（Plan -> Code -> Verify -> Notify）。
    *   **产出**: 必须生成完整的证据包（Report/Log/Notify/Snippet），必须更新 `PROJECT_MASTER_PLAN.md`。
    *   **约束**: 遇到 Gate Light 红灯必须停下，**不得**自行切换模式或“为了过而过”。

*   **`FIX:`**: 维护/热修复模式。
    *   **定义**: 针对特定错误（如 CI 失败、证据缺失、Hash 漂移）的外科手术式修复。
    *   **行为**: 仅修复指定问题，**禁止**扩大需求、**禁止**重构、**禁止**更新 Master Plan。
    *   **产出**: 修复后必须提供“可复制的事实块”（如 grep 输出、Gate Light 关键行 + `GATE_LIGHT_EXIT=0`）。
    *   **约束**: 修复完成后**立即交回控制权**，不得自动尝试完成原来的父任务。

*   **`讨论:`**: 纯讨论模式。
    *   **定义**: 咨询、澄清、复盘或纯文本交流。
    *   **行为**: 只讨论，**不执行**任何命令（除了只读命令如 `ls`, `cat`），**不产出**任何文件改动或 PR。
    *   **约束**: 禁止在讨论中悄悄执行代码修改。

### 2. 默认拒绝规则 (Default Reject Policy)
若用户的指令未带上述合法消息头（例如直接发 "把这个改了" 或 "继续"）：
*   **Action**: Agent 必须**拒绝执行**。
*   **Response**: 仅回复：“消息头不明确：请用 `TraeTask_` / `FIX:` / `讨论:` 开头下发。”
*   **禁止**: 禁止执行任何命令，禁止修改任何文件，禁止产出任何证据。

### 3. 模式切换规则 (Mode Switching)
*   **不得自行切换**: Agent 不得在未收到明确指令的情况下，从 `FIX` 模式跳回 `TraeTask` 模式，反之亦然。
*   **异常处理**: 若 `TraeTask` 执行中遇到 Gate Light 失败：
    1.  **停止**当前任务流程。
    2.  **报告**错误详情。
    3.  **请求**用户以 `FIX:` 消息头下发修复指令。

### 3.2 PR Task Lock & LATEST Consistency
**(CI 校验对象锁定与 LATEST 一致性)**

*   **PR 校验锁定**: 
    *   PR 门禁必须校验“本 PR 的 `task_id`”（优先从分支名解析，其次从 git diff 变更证据中提取），不得仅依赖 `rules/LATEST.json`。
    *   若 PR 无法解析出唯一 `task_id`（0 个或多个候选），CI 必须 **FAIL-fast** 并输出 `PR_TASK_ID_DETECT_FAILED=1`。

*   **LATEST 一致性硬规则**: 
    *   当 PR 解析出 `pr_task_id` 时，`rules/LATEST.json.task_id` 必须严格等于 `pr_task_id`。
    *   **Mismatch 必红灯**: 若不一致，门禁 FAIL 并输出 `LATEST_OUT_OF_SYNC=1`。这意味着 `LATEST.json` 过期，必须在 PR 中一并更新，而不是绕过。

*   **环境对齐**: 
    *   **本地 Integrate**: `dev_batch_mode.ps1` 必须通过 `--task_id <id>` 显式传参给 `gate_light_ci.mjs`，确保本地验证对象与 PR 一致。
    *   **CI**: `gate_light_ci.mjs` 自动执行 PR 锁定逻辑。

### 3.3 CI Parity & Acceptance Standard
**(CI 一致性与验收口径)**

1.  **Single Source of Truth (以 CI Checks 为准)**:
    *   本地 Gate Light 通过仅作为开发阶段的参考。
    *   **最终验收标准**必须是 GitHub Actions 的 `gate-light` 工作流全绿 (Pass)。
    *   若本地 Pass 但 CI Fail，视为**未完成**。必须以 CI 报错为准进行修复。

2.  **Parity Probe (一致性探针)**:
    *   验收证据必须包含 `=== CI_PARITY_PREVIEW ===` 块（由 `scripts/ci_parity_probe.mjs` 生成）。
    *   该探针必须展示 `origin/main` 基准、`merge-base`、`task_id` 解析来源等信息，证明本地运行上下文与 CI 环境一致。

3.  **Fail-Fast Hard Guard**:
    *   任何阶段（Pre-check, Integrate, CI）检测到 `task_id` 冲突、LATEST 不一致、或对象漂移，必须立即**Fail-fast**（退出码非 0），严禁尝试自动纠错。

### 4. Merge-Ready (可合并) 通知硬规则 (Hard Rule)
仅当满足以下所有条件时，Agent 才允许发送“PASS / 可合并”通知：

1.  **Gate Light 真实绿灯**: `scripts/gate_light_ci.mjs` 执行结果必须为 PASS，且退出码为 0。
2.  **回报最低证据要求 (Evidence Minimum)**:
    -   **三件套齐备**: `notify_<id>.txt`, `result_<id>.json`, `trae_report_snippet_<id>.txt` 必须同时存在。
    -   **Snippet 字段强制**: `trae_report_snippet` 必须包含以下字段：
        -   `BRANCH`, `COMMIT`, `GIT_SCOPE_DIFF`
        -   `=== DOD_EVIDENCE_STDOUT ===`
        -   `=== GATE_LIGHT_PREVIEW ===` (必须是真实日志子串)
        -   `GATE_LIGHT_EXIT=0` (必须显式存在且为 0)
3.  **禁止口头 PASS**: 任何未附带上述证据的“PASS”或基于“我运行了脚本没报错”的陈述均视为无效。
4.  **串行执行原则**: 在当前任务未生成完整证据包并回报之前，禁止接受或开始下一个 `TraeTask`（除非是 `FIX:` 模式）。

**违规后果**: 违反此规则提交的 PR 将被视为无效交付，必须回滚重做。

**示例回报格式**:
...
=== TRAE_REPORT_SNIPPET ===
...
=== GATE_LIGHT_PREVIEW ===
[Gate Light] PASS
GATE_LIGHT_EXIT=0
