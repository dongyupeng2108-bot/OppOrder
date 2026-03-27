# 版本测试与失败分流（Verify Playbook）

目标：巩固 **[`scripts/verify_all_manual.mjs`](../scripts/verify_all_manual.mjs)** 作为总入口的用法，并固定 **「先区分脚本 vs 业务」** 的处置顺序（与 [`PROJECT_RULES.md`](../rules/rules/PROJECT_RULES.md) §5 一致）。

## 总入口

```bash
node scripts/verify_all_manual.mjs --task_id=<YYMMDD_NNN>
```

- 产出：各子脚本 JSON 证据、汇总日志；路径见脚本内 `verifyTargets` 与 `rules/task-reports/` 约定。
- **通过定义**：`overall_pass` 与每子项 `pass` 均为真；且 **real runtime** 相关任务仍需按规则做人工复验（护栏不替代真实修复验收）。

## 失败时的决策树

1. **是否稳定复现？** 偶发 → 提高采样频率、检查 fresh start、生命周期前置（参见 `verify_order_scope_and_status` 历史补强）。
2. **是否仅某一脚本失败？** 读该脚本证据 JSON 中的 `message`、`first_break_layer`（若有）。
3. **先怀疑测试资产若：**
   - 前置条件未满足（未 stop/start、残留 run）。
   - 采样窗口过粗导致漏采。
   - 样本名与当前代码路径不一致。
4. **再怀疑业务若：**
   - real runtime 连续样本可稳定复现同一断裂层。
   - 与 `PROJECT_RULES` 高风险不变量直接冲突。

**历史锚点**：`verify_order_scope_and_status` 曾定性为 **测试脚本稳定性** 为主，而非已确认的业务回归——再失败时**不要默认先改 `bot_runner` / 订单语义**。

## 与 P0 主链相关的脚本（索引）

| 脚本 | 侧重 |
|------|------|
| `verify_anchor_bounds_lifecycle.mjs` | anchor / bounds / window init |
| `verify_context_truth.mjs` | context 真值（stopped / running 等） |
| `verify_executor_idempotency.mjs` | 执行层幂等 |
| `verify_order_scope_and_status.mjs` | 订单 scope / 状态（先查脚本） |
| `verify_btc_source_chain.mjs` | 行情 source chain |

完整列表以 `verify_all_manual.mjs` 内 `verifyTargets` 为准。

## 控制台触发

服务运行时可通过 UI **「版本测试」**或 `POST /bot/test/run`（见 `server.mjs`）拉起子进程跑 `verify_all_manual.mjs` — 行为与本地 CLI 一致性以实现为准。
