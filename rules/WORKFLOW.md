## Windows Environment Protocols

### Command & Environment Protocols
- **Explicit Environment**: All task templates MUST specify the execution environment (PowerShell or bash) using `ENV=PowerShell|bash`.
- **Cross-Platform Compatibility**:
  - **No `cd /d`**: The `cd /d` syntax is specific to `cmd.exe` and causes errors in PowerShell/bash. It is STRICTLY FORBIDDEN in documentation and scripts.
  - **PowerShell**: Use `cd E:\OppRadar` or `Set-Location E:\OppRadar`.
  - **Bash/WSL**: Use `cd /mnt/e/OppRadar` (adjust for actual mount point).
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
