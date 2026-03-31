# TraeTask_260330_020 实施记录（结果块字段链真值定位）

## 范围与方式

- 本单仅做测试与定位，不做业务修复。
- 未改业务逻辑、结算逻辑、订单执行/撤单、PNL 计算、UI 文案/布局、三大文档结构。

## 审计脚本

- 新增：`scripts/truth_audit_result_blocks_fields_260330_020.mjs`
- 护栏：
  - `MAX_WALL_TIME=25min`
  - `MAX_SILENCE=120s`
  - `LOG_TAIL=120`
- 输出：
  - 两块 UI 完整字段清单（从 `ui/js/strategy-editor.js` 实际 DOM 模板抽取，含显示顺序）
  - real runtime 连续样本（窗口切换后结果块刷新）
  - debug control 对照样本
  - 逐字段对账表（含窗口归属字段）

## 字段与来源核对结论

- 上一窗口结果：
  - `已成交总数` <- `postmortem.filled_total ?? last_run_snapshot.filled_total`
  - `已撤单总数` <- `postmortem.cancelled_total ?? last_run_snapshot.cancelled_total ?? 0`
  - `PNL` <- `postmortem.realized_gross_pnl_total ?? last_run_snapshot.realized_gross_pnl_total`
- 近期表现摘要：
  - `统计区间/窗口数/胜率/总成交单数/总计PNL/平均每窗口盈亏/说明` <- `performance.summary` 及 rows 派生
  - `总计PNL` 使用 `fixed1`（1 位小数）显示

## 定位结论

- verdict：`A：通过`
- first_break_layer：`NONE_CHAIN_PASS`
- real/debug 分叉：`none`
- 说明：
  - 未见上一窗口块混入 running/current 的窗口归属错误；
  - 未见近期摘要误取上一窗口单值；
  - PNL 投影与格式化口径符合现有实现（上一窗口 PNL 为状态格式化，近期总计PNL 为 1 位小数）。
