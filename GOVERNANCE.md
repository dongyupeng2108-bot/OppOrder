# OppRadar 治理文档（GOVERNANCE.md）

## 一、设计原则

1. **治理服务于开发，不是目的本身**：检查只保留能发现真实问题的，无法自动修复的检查不应阻断合并。
2. **失败必须可修复**：CI 红灯必须附带明确的修复命令，不允许出现"只能靠手工补文件"的死局。
3. **最小证据包**：只保留 result.json / git_meta / dod_evidence / notify / trae_snippet / envelope 六类核心证据，其余不强制。

---

## 二、PROTECTED 文件（绝对禁止修改）

以下文件未经 Owner 明确授权，任何任务不得修改：

| 文件 | 原因 |
|------|------|
| `scripts/run_task.ps1` | 任务执行入口，改动影响所有任务流程 |
| `scripts/safe_commit.ps1` | git 提交安全封装 |
| `scripts/safe_push.ps1` | git 推送安全封装 |
| `scripts/ops_hardstop_latch.mjs` | 硬停止机制，防止治理被绕过 |
| `scripts/postflight_validate_envelope.mjs` | envelope 完整性验证 |
| `PROTECTED.md` | 保护列表本身 |

**Owner 授权流程**：Owner 在对话中明确说"授权修改 XXX 文件"，PM 在胶囊中注明授权来源，Code 才可执行。

---

## 三、可自由迭代的文件

以下文件已移出保护，可在任务中直接修改：

| 文件 | 说明 |
|------|------|
| `scripts/gate_light_ci.mjs` | CI 门禁检查逻辑，需要持续迭代 |
| `scripts/assemble_evidence.mjs` | 证据组装，已精简 51% |
| `scripts/ci_parity_probe.mjs` | CI 一致性探针 |
| `scripts/check_protected.mjs` | 保护列表检查脚本 |
| `scripts/error_digest.mjs` | 错误摘要生成 |

---

## 四、CI Hard Gate（必须通过）

以下检查失败会阻断 PR 合并：

| 检查 | 说明 |
|------|------|
| Healthcheck | `GET /` 返回 HTTP 200 |
| rank_v2 合约 | `/opportunities/rank_v2` schema 验证通过 |
| export_v1 合约 | `/opportunities/runs/export_v1` schema 验证通过 |
| ledger_v0 合约 | `/opportunities/ledger/query_v0` schema 验证通过 |
| LATEST.json 一致性 | task_id 与分支/证据目录匹配 |
| WORM 检查 | 历史证据文件不可被篡改 |
| NoHistoricalEvidenceTouch | 不允许修改其他任务的证据文件 |

---

## 五、CI Soft Gate（警告但不阻断）

以下检查失败只输出警告，不阻断合并：

| 检查 | 说明 |
|------|------|
| Workspace Healer | CI 环境天然不存在此文件，缺失时 warn+skip |
| Error Digest | 生成报告有价值，但不强制存在 |
| trae_report_snippet 内容 | 只验证存在性，不验证内容 |
| Scope Lock | scope_lock 文件不存在时 warn+skip（向后兼容），存在时强制校验 |
| BTCQDD Healthcheck | `GET localhost:53123/` 返回 HTTP 200（条件启用：server.mjs 存在时检查，不存在时 warn+skip。不阻断 OppRadar 日常任务） |

---

## 六、证据最小集

每个任务 Integrate 后，以下文件必须存在：

```
rules/task-reports/2026-MM/
├── result_<task_id>.json          # 核心结果
├── git_meta_<task_id>.json        # commit/branch 元信息
├── dod_evidence_<task_id>.txt     # DoD 标记
├── gate_light_preview_<task_id>.log  # Gate Light 预览日志
├── notify_<task_id>.txt           # 通知文本
├── trae_report_snippet_<task_id>.txt  # Trae 报告片段
├── scope_lock_<task_id>.json      # Scope Lock（见 §十三）
└── <task_id>.envelope.json        # postflight 校验对象
```

以下文件**不再强制**（已从 assemble_evidence 硬依赖中移除）：
- ci_parity_*.json
- workspace_healer_*.json
- errors_*.jsonl / errors_summary_*.txt
- preflight_attestation_*.json
- run_*.log（speed profiling 用，非关键）

---

## 七、任务执行规范

### 角色边界

```
Owner  ── 决策者，在 Claude.ai 和 Code 之间传话
PM     ── 理解需求、出胶囊、控验收（不写代码，不操作仓库）
Code   ── Claude Code，在终端执行，只写代码，不做产品决策
```

**三条铁律：**
1. PM 不写代码，不直接操作仓库
2. PM 只出胶囊和修正指令，不出其他命令
3. Code 只执行，发现产品决策类问题必须停下来问 Owner

### 胶囊必备结构

每个胶囊必须包含以下结构，顺序不得颠倒：

1. **前置硬检查**：切回 main、git pull、git status 确认工作区干净
2. **建分支**：`git checkout -b <task_id>`
3. **写入 Scope Lock**：`node scripts/write_scope_lock.mjs`（见 §十三）
4. **代码实现步骤**（逐步，每步可独立验证，不给 Code 留"自由发挥"空间）
5. **验收自测**：列出具体的验证命令和期望输出
6. **Dev 模式验证**：`.\scripts\run_task.ps1 -TaskId <id> -Mode Dev -Header "TraeTask_<id>"`
7. **Integrate**：`.\scripts\run_task.ps1 -TaskId <id> -Mode Integrate -Header "TraeTask_<id>"`
8. **根目录硬验证**（见下）
9. **停止条件**
10. **禁止操作清单**
11. **回报模板**（见 §十五）

### 根目录硬验证（每个胶囊 Integrate 后必须执行）

```powershell
Get-ChildItem -Path E:\OppRadar -MaxDepth 1 -File |
  Where-Object { $_.Name -match "<task_id>" }
# → 必须为空
```

### run_task.ps1 使用规范

所有任务必须通过 `run_task.ps1` 执行，**禁止手动 git commit / git push / gh pr create**。

| 模式 | 命令 | 用途 |
|------|------|------|
| Dev | `.\scripts\run_task.ps1 -TaskId <id> -Mode Dev -Header "TraeTask_<id>"` | 本地验证：跑 CI 预览、检查证据格式，不提交不推送 |
| Integrate | `.\scripts\run_task.ps1 -TaskId <id> -Mode Integrate -Header "TraeTask_<id>"` | 正式集成：组装证据、自动提交、推送、创建 PR |

**Dev 模式**：不产生 git 提交，不影响 LATEST.json，可反复运行直到通过。  
**Integrate 模式**：自动完成 assemble_evidence → postflight → git commit → push → gh pr create，全流程一次性完成。

> ⚠️ 证据文件（notify、result、envelope 等）必须由 run_task.ps1 生成，**禁止手动创建**。手动创建的证据文件会缺少 postflight 要求的段标记（RESULT_JSON / LOG_HEAD / LOG_TAIL / INDEX），导致 CI 失败。

### PR 账号规范

- **PR 创建**：必须由 bot 账号（`dongyupeng2108-bot`）通过 `gh pr create` 自动完成
- **PR 审批**：由 Owner 账号在 GitHub 上 Approve + Merge
- **禁止**：Owner 账号创建 PR（GitHub 不允许自己 approve 自己的 PR）
- 执行前确认：`gh auth status` 应显示 bot 账号
- **PR 合并时机**：每个任务 Integrate 成功后立即合并，不要积压

### Integrate 停止条件（遇到立即停）

- Workspace Healer 第 2 次拦截
- Non-self-healable 错误
- Budget 耗尽（2 次 Integrate 失败）→ 换新 Task ID
- 根目录出现任务相关文件
- HARD_STOP 触发

### 禁止操作
- `git add -f`（强制 stage）
- `>` 重定向写文件（用 `fs.writeFileSync` 代替）
- 链式命令（`&&` 连接多个危险操作）
- 修改 PROTECTED 文件（未经授权）
- 手动篡改 evidence 文件
- 手动执行 `git commit` / `git push` / `gh pr create`（统一走 run_task.ps1）
- **模糊清理指令**：禁止对 Code 发出"清理垃圾数据"、"清理测试数据"等模糊描述，必须精确指定表名、字段条件、操作范围（见第十一条）
- 清理 `data/` 目录下任何文件（除非胶囊明确指定）
- 删除任何数据库表或记录（除非胶囊明确指定）

### Task ID 规范
- 格式：`YYMMDD_NNN`（如 `260302_001`）
- 每个 ID 只有 1 次 Integrate 机会，失败换新 ID，**不要重试同一个 ID**
- 同前缀连续 3 个后缀触发 LOOP_DETECTED，必须换完全不同的 ID（换日期前缀）
- Budget 耗尽换 ID 前必须先 `git checkout main && git pull origin main`

---

## 八、CI 失败修复指引

gate_light_ci.mjs 每个检查点输出 `FIX_CMD`，查找方式：

```powershell
Select-String -Path 'rules/task-reports/2026-03/gate_light_preview_<task_id>.log' -Pattern 'FIX_CMD'
```

常见场景：

| 错误 | 修复命令 |
|------|----------|
| LATEST.json 不同步 | 更新 `rules/LATEST.json` 的 task_id 字段 |
| Healthcheck 失败 | 确认相关服务在运行（OppRadar: `node OppRadar/mock_server_53122.mjs`，BTCQDD: `node strategies/crypto_binary/server.mjs --strategy=btc_15m`） |
| Scope Lock 违规 | `git checkout main -- <超出范围的文件>`，或将文件加入 scope_lock 的 allowed_files |
| AutoPR 失败 | `gh auth status` 检查认证状态，确认是 bot 账号 |
| PR 由 Owner 创建导致无法 Approve | `gh pr close <PR号>`，确认切换到 bot 账号后重新 `gh pr create` |
| FAIL_BUDGET_EXCEEDED | 换新 task_id 重新运行 `run_task.ps1` |
| LOOP_DETECTED | 换日期前缀的全新 task_id |
| PR 冲突（LATEST.json / error_stats.jsonl） | `git checkout <branch>` → `git fetch origin` → `git rebase origin/main` → `git push --force-with-lease origin <branch>` |
| 重复 PR（同分支多个 PR） | `gh pr close <重复PR号> --comment "Duplicate of #XXX"` |
| Open PR Guard 拦截 | 先合并积压的旧 PR：`gh pr merge <N> --squash` |
| hardstop latch 残留 | `Remove-Item rules/task-reports/2026-03/.hardstop_latch_<task_id>.json` |

---

## 九、Polymarket 平台政策备忘（260302）

### API 限流政策
- CLOB 市场数据：500请求/10秒，超限被 Cloudflare 排队延迟，不封IP
- Gamma API：4000请求/10秒
- General上限：15000请求/10秒
- 超限机制：throttle（排队延迟）而非 drop（丢弃），无封号风险
- 建议并发：不超过5，批次间隔500ms（保守策略）

### 交易时间
- 全天候24小时，无交易时段限制（链上结算）

### 地理限制
- 已封锁33+国：法国、比利时、波兰、新加坡、瑞士、乌克兰、意大利等
- 中国大陆：受限
- 美国：2025年底通过CFTC监管重新开放，需KYC，目前邀请制

### 对本项目的影响
- API数据拉取（只读）：无地理限制，任何地方均可调用
- 交易执行：中国大陆受限，需评估合规路径，交易时不能使用VPN
- 封号风险：纯只读API查询风险极低；高频交易+VPN有违规风险

### API调用规范
- 只读查询并发上限：5
- 批次间隔：500ms
- 超限处理：捕获429/503，指数退避重试，最多3次

---

## 九-B、Binance 公开行情 API 政策备忘（260308 新增）

### API 限流政策
- 公开行情接口（/api/v3/ticker/price、/api/v3/klines）无需 API Key
- IP 限流：1200 请求/分钟（公开接口共享池）
- 超限返回 HTTP 429，需指数退避重试
- WebSocket 连接限制：单 IP 最多 300 个连接

### 地理限制
- 公开行情数据无地理限制，中国大陆可直接调用
- 交易接口需 API Key + KYC，本项目不使用交易接口

### BTCQDD 实际用量
- ticker/price：每 2s 一次（30 请求/分钟）
- klines：每 15min 一次（4 请求/小时）
- 总用量远低于 1200/min 限额，单实例无限流风险
- 多实例并行时需关注累计用量（4 实例 ≈ 120 请求/分钟，仍有 10x 余量）

### API调用规范
- REST 轮询间隔：不低于 2s（ticker/price）
- 超限处理：捕获 HTTP 429，指数退避重试，最多 3 次
- 后续可升级 WebSocket 推送（wss://stream.binance.com），降低轮询压力

---

## 十、安全硬规则（M8 交易系统，260307）

以下规则适用于所有涉及交易执行的代码，不可违反：

| 规则 | 说明 |
|------|------|
| SR-1 | `.oppradar-secrets/` 目录永远不放在 `E:\OppRadar\` 内 |
| SR-2 | 私钥文件永远不 `git add` |
| SR-3 | 代码中不硬编码私钥字符串 |
| SR-4 | 私钥不放入环境变量 |
| SA-1 | Signer Agent 只绑定 `127.0.0.1`，不暴露外网 |
| SA-6 | Signer Agent 路径/启动命令不出现在项目文档或胶囊中 |
| LG-5 | CLOB 提交后 signerHeaders 置 null |

---

## 十一、清理类操作规范（260307 新增）

**背景**：260307 发生 Code 将"清理测试脏数据"理解为大范围清理（900+ 缓存文件 + 82个run目录 + 22条git stash），虽核心 SQLite 数据未损，但属于严重超出指令范围的自主行为。

**规则**：

1. **Owner/PM 发出清理指令时，必须精确指定**：
   - 表名（如 `trading_orders`）
   - 过滤条件（如 `WHERE market_id = 'mkt_test'`）
   - 操作范围（如"仅删除该表中符合条件的行，不动其他表"）

2. **Code 收到模糊清理指令时，必须先列出拟删除内容并请求确认**，不得自行扩大范围。

3. **胶囊禁止操作清单必须包含**：
   ```
   × 清理 data/ 目录下任何文件
   × 删除任何数据库表或记录（除非胶囊明确指定）
   ```

4. **data/ 目录内容说明**：
   - `data/runtime/` — 扫描缓存 JSON，可再生，但不应被随意清理
   - `data/runs/` — run 输出目录，可再生，但不应被随意清理
   - `data/llm_cache/` — LLM 缓存，可再生
   - SQLite db 文件 — **不可再生，绝对不能删除**

---

## 十二、胶囊文件规范（260308 新增）

**背景**：B0 开发期间因胶囊直接在对话中粘贴，导致内容截断，后改为文件下发方式。

**规范**：

1. **胶囊统一以文件形式下发**，存放在 `E:\OppRadar\taskfiles\` 目录
2. **PM 生成胶囊文件后**，给 Owner 提供以下格式的执行指令（放在独立代码框中，方便一键复制）：
   ```
   请阅读 `E:\OppRadar\taskfiles\<文件名>`，按文件中的步骤执行。
   ```
3. **文件命名规范**：`capsule_<里程碑>_<task_id>.md`，例如 `capsule_B1b_260307_012.md`
4. **Owner 下载文件后**放入 `E:\OppRadar\taskfiles\`，再将执行指令发给 Claude Code
5. **设计文档**也必须放到 `E:\OppRadar\taskfiles\`，Code 无法访问 `/mnt/user-data/uploads/`

---

## 十三、Scope Lock 规范（260308 新增）

**作用**：声明本任务允许修改的文件范围，CI 检查实际修改文件是否超出范围，防止 Code 意外修改无关文件。文件列表越精确越好。

**生成命令**（每个胶囊 STEP 0 必须包含）：

```powershell
node scripts/write_scope_lock.mjs `
  --task_id=<task_id> `
  --evidence_dir=rules/task-reports/2026-03 `
  --files="允许修改的文件1,文件2,文件3"
```

**文件路径**：`rules/task-reports/2026-MM/scope_lock_<task_id>.json`

**格式示例**：
```json
{
  "task_id": "260307_008",
  "allowed_files": [
    "OppRadar/trading_routes.mjs",
    "tests/trading_account.test.mjs"
  ],
  "auto_exempt": [
    "rules/LATEST.json",
    "rules/task-reports/index/error_stats.jsonl"
  ],
  "created_at": "2026-03-07T00:10:47.042Z"
}
```

**字段说明**：
- `allowed_files`：本任务胶囊明确允许修改的代码文件（相对于仓库根目录）
- `auto_exempt`：固定豁免项，每个任务相同，write_scope_lock.mjs 自动填入
- `rules/task-reports/` 下的证据文件自动豁免，无需列入

**CI 行为**：
- scope_lock 文件存在 → CI 强制校验，超出 allowed_files 的修改会 FAIL
- scope_lock 文件不存在 → CI WARN+skip（向后兼容，但强烈建议每个任务都创建）

**违规修复**：
```powershell
# 方案 A：撤销超出范围的文件修改
git checkout main -- <超出范围的文件>

# 方案 B：将文件加入 scope_lock 的 allowed_files（需 PM 确认）
```

---

## 十四、Code 行为规律与应对策略

经过 OppRadar 290+ 个 PR 的观察总结，供 PM 知己知彼。

**Code 擅长的：**
- 按精确指令写代码，质量稳定
- 发现小 bug 后自行修复
- 按模板格式输出内容

**Code 的局限：**
- 收到模糊指令会自行解读，往往范围偏大（见第十一条）
- 任务完成后有时不按回报模板，直接说"done"
- 对"范围"的理解偏宽松，倾向于"顺手"多做
- 窗口崩溃后需要重启，进度靠 git 保存

**应对策略：**
- 胶囊中明确说"只做 X，不做 Y"比只说"做 X"更有效
- 回报模板放在胶囊最后，加 ⚠ 醒目标记，缺字段直接打回补全
- 每个 Integrate 后立即检查：PR 数量、修改文件列表、范围锁对比

**Code 窗口崩溃恢复**：
```powershell
claude --dangerously-skip-permissions
# 然后直接跑 Integrate，进度靠 git 保存
```

---

## 十五、标准胶囊回报模板

每个胶囊末尾必须包含以下模板，**一字不差，不得省略任何字段**。PM 收到回报后：缺字段 → 打回补全；超出范围锁 → 立即关 PR 重做；有未申报的自主决定 → 评估影响。

```
⚠ 任务完成后必须按以下模板回报，不得省略任何字段，未完成的项标 ❌：

Task ID：YYMMDD_NNN（或实际使用的 ID）
PR 号：#XXX
Lock 文件：rules/task-reports/locks/YYMMDD_NNN.lock.json ✅/❌
Gate Light：GATE_LIGHT_EXIT=0 ✅/❌
CI 状态：✅/❌/⏳

【实际修改文件】（git diff --name-only 完整输出）
- 文件1
- 文件2

【与范围锁对比】
- 范围锁允许修改：[列出 allowed_files]
- 实际修改文件数：X
- 是否有超出范围锁的修改：是/否

【自主决定申报】
- 是否有任何超出胶囊指令的自主决定：是/否
- 如有，说明：

【测试结果】
- 测试命令：
- 结果：X/X PASS

【端到端验证】
- 验证命令及输出：

【DoD CheckList】
- [ ] 项目1：✅/❌
- [ ] 项目2：✅/❌
- [ ] CI Gate Light 通过：✅/❌
- [ ] 根目录无残留文件：✅/❌
```

---

## 十六、踩坑记录

### 🔴 严重级

**坑1：模糊清理指令**
- 事件：对 Code 说"清理测试产生的垃圾数据"
- 后果：Code 自行扩大边界，删了 900+ 缓存文件、82个run目录、22条git stash
- 教训：清理指令必须精确到表名+条件+范围（见第十一条）

**坑2：PR 漏合并导致 Open PR Guard 拦截**
- 事件：上一个任务 PR 未合并，下一个任务 Integrate 被 Open PR Guard 拦截
- 后果：Code 窗口卡住
- 教训：每个任务 Integrate 成功后立即合并 PR
- 修复：`gh pr merge <N> --squash`

**坑3：Budget 耗尽换 ID 后忘记 git pull**
- 事件：换新 Task ID 重跑，但 main 上已有新提交导致冲突
- 教训：换 ID 前先 `git checkout main && git pull origin main`

### 🟡 中等级

**坑4：Code 不按回报模板回报**
- 事件：任务完成后 Code 只说"PR 已创建"，不填模板
- 处理：直接发给 Code "按胶囊回报模板补全回报"

**坑5：同分支产生重复 PR**
- 事件：同一分支产生两个 PR
- 修复：`gh pr close <重复号> --comment "Duplicate of #XXX"`

**坑6：PR 由 Owner 账号创建导致无法 Approve**
- 事件：gh CLI 未切换到 bot 账号，PR 由 Owner 创建
- 后果：GitHub 不允许自己 approve 自己的 PR
- 修复：关闭 PR，切换到 bot 账号后重新创建

**坑7：已合并 PR 上显示 CI 红灯**
- 事件：PR 合并后 CI 显示红灯（healthcheck 文件缺失）
- 说明：PR 已合并后的 CI 红灯是历史记录，不影响 main，可忽略

### 🟢 轻微级

**坑8：Code 窗口崩溃**
- 原因：运行中调整了窗口大小
- 教训：启动前先最大化窗口，运行中不要调整大小
- 恢复：`claude --dangerously-skip-permissions`

**坑9：设计文档 Code 无法读取**
- 原因：Code 无法访问 `/mnt/user-data/uploads/`
- 教训：设计文档必须放到 `E:\OppRadar\taskfiles\`

**坑10：PR 冲突（LATEST.json / error_stats.jsonl）**
- 原因：任务未串行执行，多个任务同时修改同一文件
- 教训：上一个 PR 合并后再出下一个胶囊
- 修复：`git checkout <branch>` → `git fetch origin` → `git rebase origin/main` → `git push --force-with-lease origin <branch>`

**坑11：Node.js fetch 不读系统代理**
- 现象：本地运行 Binance / Polymarket API 调用返回 451 地理限制，CI 环境正常通过
- 根因：Node.js 内置 fetch 底层是 undici，出于安全设计**不自动读取** `HTTP_PROXY` / `HTTPS_PROXY` 系统环境变量。与 Python requests、Go http.Client 行为不同，是经典陷阱
- 解法：调用 `OppRadar/proxy_agent.mjs` 的 `setGlobalDispatcher`，全局注入一次即覆盖整个进程所有 fetch
- **规范**：所有需要访问外部网络的 BTCQDD 模块，顶部必须加：
  ```javascript
  import '../../OppRadar/proxy_agent.mjs'; // 加载即生效，模块内自动执行 setGlobalDispatcher
  ```
- proxy_agent.mjs **没有具名导出**，是模块加载时自动执行副作用，import 语句本身即完成注入
- 只需 import 一次，重复 import 无副作用（ES module 缓存机制保证）
- 影响模块：price_feed.mjs / market_scanner.mjs / signal_engine.mjs 及后续所有发起网络请求的模块

---

## 十七、常用命令速查

```powershell
# 状态检查
git status
git branch --show-current
Get-Content rules/LATEST.json

# 清理残留
git restore --staged .
git restore .

# Integrate
.\scripts\run_task.ps1 -TaskId 260308_001 -Mode Integrate -Header "TraeTask_260308_001"

# 清除 hardstop latch
Remove-Item rules\task-reports\2026-03\.hardstop_latch_<task_id>.json

# PR 操作
gh pr merge <N> --squash
gh pr close <N> --comment "Duplicate of #XXX"
gh pr view <N>

# PR 冲突修复
git checkout <branch>
git fetch origin
git rebase origin/main
git push --force-with-lease origin <branch>

# Scope Lock 生成
node scripts/write_scope_lock.mjs `
  --task_id=260308_001 `
  --evidence_dir=rules/task-reports/2026-03 `
  --files="文件1,文件2"

# CI 失败查 FIX_CMD
Select-String -Path 'rules/task-reports/2026-03/gate_light_preview_<task_id>.log' -Pattern 'FIX_CMD'

# 启动服务
node OppRadar/mock_server_53122.mjs
node strategies/crypto_binary/server.mjs --strategy=btc_15m

# 启动 Code
claude --dangerously-skip-permissions
```

---

## 十八、变更历史

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v1.0 | 260302 | 初始版本，M4.5 治理精简后输出 |
| v1.1 | 260304 | 更新版本，Polymarket 平台政策备忘 |
| v1.2 | 260307 | 新增第十条安全硬规则（M8）、第十一条清理类操作规范；第八条新增 PR 冲突/重复 PR 修复命令；第七条禁止操作新增模糊清理指令 |
| v1.3 | 260308 | BTCQDD 适配：§五 Soft Gate 新增 BTCQDD Healthcheck；§八 Healthcheck 修复指引泛化；新增 §九-B Binance API 政策备忘 |
| v1.4 | 260308 | 治理流程标准化：§七新增 run_task.ps1 使用规范、PR 账号规范、禁止手动 git 操作；§八新增 Scope Lock 违规修复和 PR 账号问题修复；§五 Scope Lock 纳入 Soft Gate；§六证据最小集新增 scope_lock；新增 §十二胶囊文件规范；新增 §十三 Scope Lock 规范 |
| v1.5 | 260308 | PM 入职手册内容整合：§七新增角色边界、根目录硬验证、Integrate 停止条件；新增 §十四 Code 行为规律；新增 §十五 标准回报模板；新增 §十六 踩坑记录；新增 §十七 常用命令速查 |
| v1.6 | 260308 | §十六 新增坑11：Node.js fetch 不读系统代理，记录根因、解法及所有受影响模块的规范写法 |
