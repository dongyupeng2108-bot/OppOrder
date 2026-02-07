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
### Anti-Duplicate & Noise Control (Hard Rule)
1. **Unique Task ID**: If `rules/task-reports/**/result_<task_id>.json` already exists in **main** (or local main), **FORBID** re-execution of `envelope_build` and **FORBID** creating a new PR. You MUST use a new task_id.
2. **Pre-PR Check**: Before creating a PR, you **MUST** run the `pre_pr_check` script:
   ```powershell
   node scripts/pre_pr_check.mjs --task_id <task_id>
   ```
   - If it exits with code 2 (Duplicate), **STOP** immediately. Do not push. Do not create PR.
   - If it exits with code 0 (PASS), proceed.
3. **Fail-Fast Logic**:
   - If `git diff --name-only origin/main...HEAD` shows only `rules/task-reports/**` changes AND the task_id exists in `origin/main`, the PR is considered "Duplicate Noise". Abort.

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
