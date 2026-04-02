# TraeTask_260402_001 实施记录（上一窗口结果模块下线）

## 基线对齐

- 本任务分支基于 `011f8556`（包含 260330_045 的 PNL/平均每窗口盈亏两位小数显示行为）。
- 基线核验：`BASELINE_011f8556=YES`。

## 前置依赖审计结论

- 上一窗口结果前端消费：
  - 接口：`/bot/postmortem/latest`
  - 字段：`filled_total`、`cancelled_total`、`realized_gross_pnl_total`
  - 生产者：`server.mjs` 的 `queryLatestBotPostmortem + /bot/postmortem/latest route`
- 近期表现摘要前端消费：
  - 接口：`/bot/performance/summary?detail=1`
  - 字段：`window_count`、`filled_total`、`realized_gross_pnl_total`、`avg_realized_gross_pnl_per_window`、`participating_postmortem_rows`
  - 生产者：`queryBotPerformanceSummary + /bot/performance/summary route`
- 审计结论：两者**不共享** latest/selection 链，可安全拆分。

## 删除与迁移

- 前端（`ui/js/strategy-editor.js`）：
  - 删除“上一窗口结果”模块 DOM；
  - 删除 `/bot/postmortem/latest` 拉取与相关消费链；
  - 将“近期表现摘要”整体移动到原“上一窗口结果”位置（右侧卡片）；
  - 保留“近期表现摘要”显示表达式不变（含两位小数格式化）。
- 后端（`strategies/crypto_binary/server.mjs`）：
  - 删除 `queryLatestBotPostmortem` 及其异常行筛选 helper；
  - 删除 `GET /bot/postmortem/latest` route；
  - 保留 `GET /bot/performance/summary` 语义不变。

## 验证脚本

- 新增：`scripts/truth_audit_remove_prev_result_module_260402_001.mjs`
- 覆盖：
  - pre/post 模块存在性与位置对比；
  - pre/post 近期表现摘要核心显示表达式一致性；
  - 前端无残留 `/bot/postmortem/latest` 消费；
  - 后端 route 删除证明 + performance route 保留证明；
  - runtime 验证（`/bot/performance/summary=200`，`/bot/postmortem/latest=404`）；
  - healthcheck（`GET /`、`GET /pairs`）。

## 运行结果

- `node --check ui/js/strategy-editor.js`：通过
- `node --check strategies/crypto_binary/server.mjs`：通过
- `node --check scripts/truth_audit_remove_prev_result_module_260402_001.mjs`：通过
- 主审计：
  - `pass=true`
  - `first_break_layer=NONE_CHAIN_PASS`
