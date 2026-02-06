task_id: M0_OppRadar_Bootstrap_260206_001
milestone: M0
RUN:
  - CMD: node scripts/postflight_validate_envelope.mjs
sentinel: DONE

# Opportunity Radar (机会雷达) Workflow
*Note: OppRadar is the historical alias/reserved path (E:\OppRadar).*

# Evidence Envelope
- notify: RESULT_JSON + LOG_HEAD + LOG_TAIL + INDEX
- index: size > 0, sha256_short (8 chars)

# Healthcheck
- Port: 53122
- Notify excerpt: "/ -> 200", "/pairs -> 200"

## Gate Light (CI)
- **Definition**: A lightweight required check that runs on every PR/Push.
- **Mechanism**: Reads rules/LATEST.json to identify the most recent task evidence, then executes scripts/postflight_validate_envelope.mjs.
- **Naming**: The GitHub Actions workflow must be named gate-light.
- **Constraint**: Must PASS to merge.

## PR 合并（Merge/合并）职责与步骤（硬规则）

### 1) 职责
- PR（Pull Request/拉取请求）的最终 Merge（合并）由老板手工执行（网页或 gh CLI），Trae 不执行合并动作。
- 分支保护（Branch Protection/分支保护）+ 必需检查（Required Checks/必需检查）用于拦截不合格合并，但不会自动合并。

### 2) 合并前置条件（必须全部满足）
- Gate Light（Gate Light/门禁）检查为 Successful（成功）；
- 本次任务的证据包（Evidence Envelope/证据包）已生成，且 Postflight（Postflight/后验）为 PASS；
- 健康检查（Healthcheck/健康检查）已完成，且在任务回报中摘录：`/ -> 200` 与 `/pairs -> 200`（本项目端口约定：53122）；
- PR 的变更文件不允许超出任务范围（scope/范围）；一旦发现超范围，必须拆分或回滚后重跑证据闭环。

### 3) 合并操作（老板执行）
**方式 A：网页**
1. 打开 PR 页面 → 确认 Checks 全绿（包含 gate-light）。
2. 查看 Files changed（变更文件）是否符合 scope。
3. 点击 Merge pull request（合并拉取请求）。
4. 合并后删除分支（Delete branch/删除分支）。

**方式 B：gh CLI**
- `gh pr checks <PR_NUMBER>`
- `gh pr merge <PR_NUMBER> --merge --delete-branch`

### 4) 合并后的规则
- 合并完成后，下一条开发任务才允许开始（避免并行导致口径漂移）。
- 如需继续开发：本地必须 `git checkout main && git pull --rebase` 后再开新分支。

## 稳定性优先与范围控制（硬规则）

### 0) 原则
- **稳定优先**：一旦发现“任务范围漂移（scope drift）/夹带改动”，必须先停下当前功能推进，优先修补 WORKFLOW/PROJECT_RULES/PLAN 的约束与验收口径，再继续开发。
- **单一变更面**：一个 PR 只解决一个类别的问题（见下文分类）。混合类别即视为范围漂移。

### 1) 变更分类（每个任务/PR 必须明确属于且仅属于一个类别）
A. **业务功能类（Business）**：数据模型字段、fixtures、API、UI、页面交互等 
B. **基础设施类（Infra）**：脚手架、目录结构、启动方式、依赖、CI 运行环境 
C. **门禁/证据链路类（Gate/Evidence）**：Gate Light、Postflight、envelope、LATEST 指针、证据格式与校验规则

> **硬规则：业务功能类任务禁止改 Gate/Evidence 代码。** 
> 如确需改 Gate/Evidence：必须新开“修补任务（Patch）”先做，独立 PR，独立验收，通过后才能继续业务功能。

### 2) Gate/Evidence 保护清单（默认禁止在非 Patch 任务中修改）
以下文件/目录视为 Gate/Evidence 关键路径（非 Patch 任务不得修改）：
- `.github/workflows/gate-light.yml`（或 gate-light 工作流相关）
- `scripts/postflight_validate_envelope.mjs`
- `scripts/envelope_build.mjs`
- `rules/LATEST.json` 的语义与结构（内容更新属于证据生成流程的正常产物；但“结构/字段含义”属于 Gate/Evidence 改动）
- `rules/task-reports/envelopes/*` 证据结构定义与校验逻辑

### 3) 范围漂移的处理流程（必须执行）
当发现以下任一情况即判定为范围漂移：
- 业务任务 PR 内出现 Gate/Evidence 关键路径文件改动
- 为“让后验通过/让门禁通过”而顺手改了 postflight/envelope 逻辑
- 任务过程中删除/清理历史证据文件以“解决冲突”（除非 Patch 任务专门处理“归档策略”）

处理步骤（按顺序）：
1. **停止推进合并**：不合并该 PR。
2. **拆分**：将 Gate/Evidence 改动拆到独立 Patch 分支与 PR；业务 PR 回退这些改动保持纯净。
3. **Patch 先行验收**：Patch PR 必须严格验收通过（见下文），再继续业务 PR。
4. **更新规则**：如本次漂移暴露了规则缺口，必须先补 WORKFLOW/PROJECT_RULES/PLAN，再进入后续开发。

### 4) Patch 任务（门禁/证据链路修补）的严格验收口径
Patch 任务必须包含并在回报中给出结果：
- 站点健康检查：`/ -> 200` 与 `/pairs -> 200`（本项目端口约定：53122）
- 证据包生成：`envelope_build` 产物 + `rules/LATEST.json` 更新
- 后验校验：`postflight_validate_envelope` 必须 PASS
- CI 门禁：PR checks 中 `gate-light` 必须 Successful
- 回报必须写明：修补前的失败现象、最小复现命令、修补后的对照结果

> 未明确写出“验收通过”，不得进入后续业务开发。

### 5) 每个任务/PR 的“范围自检”必做项
提交 PR 前必须在回报中提供：
- `git diff --name-only origin/main...HEAD` 的文件清单
- 明确声明：本 PR 属于 A/B/C 哪一类
- 若为业务功能类（A），清单中不得出现 Gate/Evidence 保护清单里的文件

## TraeTask（任务消息）长度上限（硬规则）

### 1) 上限
- 发给 Trae（本地AI编码助手）的单条 TraeTask（任务）消息（从第一行 `TraeTask_...` 到最后一行 `本次任务发布完毕。`）**总长度必须 ≤ 6000 字符**（含空格与换行）。
- 超出即视为任务不可执行：必须回炉重写后再下发。

### 2) 超长内容的处理方式（必须二选一）
当任务内容预计会超过 6000 字符时：
- **优先压缩**：仅保留“目标/非目标/关键约束/验收口径/必跑命令/交付物/自检清单”。
- **或落盘引用**：把详细规范、长命令、长清单写入仓库文件（例如 `rules/task-specs/<task_id>.md` 或 `scripts/run_<task_id>.ps1`），TraeTask 里只保留：
  - `spec_file: <path>`（必填）
  - 关键验收口径与必须执行的最小命令
  - 交付物清单（含 spec_file 本身）

### 3) 模板自检项（必须加入自检清单）
- 自检清单中必须包含：`任务正文长度 ≤ 6000 字符`

## 禁止交互式命令（Y/N）（硬规则）

### 1) 原则
- **严禁交互**：Trae 执行的任何命令必须是无交互的（non-interactive）。禁止任何会弹出 `Y/N`、`Confirm`、`Are you sure?` 等提示框的操作。
- **Fail-Fast**：一旦命令出现交互式等待（卡住），视为任务失败。必须立即中止（Ctrl+C），修改为无交互命令后重试。

### 2) 常见场景与规范
- **删除目录/文件**：
  - **禁止**：`Remove-Item <path>`（默认会弹确认）。
  - **禁止**：`rm <path>`（PowerShell 下 rm 是 Remove-Item 的别名，默认也会弹）。
  - **必须使用**：`scripts/ps_safe_rm.ps1`（安全删除脚本）。
    - 命令：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ps_safe_rm.ps1 -Path "<path>"`
    - 该脚本内部已封装 `-Recurse -Force -Confirm:$false` 并在失败时回退到 `cmd /c rmdir`。
- **覆盖文件**：
  - 使用 `Set-Content -Force` 或 `New-Item -Force`。
  - 使用 `> ` 重定向时通常无需确认，但需注意 PowerShell 编码默认值。

### 3) 推荐做法
- 任何涉及文件系统变动（特别是删除）的操作，优先调用 `scripts/ps_safe_rm.ps1`。
- 必须在命令中显式加入 `-Force`、`-Confirm:$false` 等参数。
