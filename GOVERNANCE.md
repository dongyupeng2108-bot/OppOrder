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

### 胶囊必备结构
1. **Step 0**：备份（大范围修改核心脚本时必须执行）
2. 前置硬检查（工作区干净、分支正确）
3. 逐步执行步骤
4. 停止条件
5. 验收 CheckList
6. 回报模板

### 禁止操作
- `git add -f`（强制 stage）
- `>` 重定向写文件（用 `fs.writeFileSync` 代替）
- 链式命令（`&&` 连接多个危险操作）
- 修改 PROTECTED 文件（未经授权）
- 手动篡改 evidence 文件
- **模糊清理指令**：禁止对 Code 发出"清理垃圾数据"、"清理测试数据"等模糊描述，必须精确指定表名、字段条件、操作范围（见第十一条）

### Task ID 规范
- 格式：`YYMMDD_NNN`（如 `260302_001`）
- 每个 ID 只有 1 次 Integrate 机会，失败换新 ID
- 同前缀连续 3 个后缀触发 LOOP_DETECTED，必须换完全不同的 ID

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
| AutoPR 失败 | `gh auth status` 检查认证状态 |
| FAIL_BUDGET_EXCEEDED | 换新 task_id 重新运行 `run_task.ps1` |
| LOOP_DETECTED | 换日期前缀的全新 task_id |
| PR 冲突（LATEST.json / error_stats.jsonl） | `git rebase origin/main` 后 `git push --force-with-lease` |
| 重复 PR（同分支多个 PR） | `gh pr close <重复PR号> --comment "Duplicate of #XXX"` |

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

## 十二、变更历史

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v1.0 | 260302 | 初始版本，M4.5 治理精简后输出 |
| v1.1 | 260304 | 更新版本，Polymarket 平台政策备忘 |
| v1.2 | 260307 | 新增第十条安全硬规则（M8）、第十一条清理类操作规范；第八条新增 PR 冲突/重复 PR 修复命令；第七条禁止操作新增模糊清理指令 |
| v1.3 | 260308 | BTCQDD 适配：§五 Soft Gate 新增 BTCQDD Healthcheck（条件启用，不阻断 OppRadar 任务）；§八 Healthcheck 修复指引泛化（覆盖 53122 + 53123）；新增 §九-B Binance 公开行情 API 政策备忘 |
