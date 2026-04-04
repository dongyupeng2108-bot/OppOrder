## TraeTask_260404_004 验收摘要（UI 轻任务）

### 结论块
- 结论：通过
- 唯一 first_break_layer：`NONE_CHAIN_PASS`
- 任务性质：仅 UI 展示口径修复，不改业务计算逻辑

### 修改文件清单
- `ui/js/strategy-editor.js`
- `scripts/260404_004/truth_audit_ui_scope_and_price_semantics_260404_004.mjs`
- `rules/task-reports/2026-04/260404_004/*`
- `rules/LATEST.json`

### BUG-1（胜率口径）修复结果
- 修前标签：`胜率`
- 修后标签：`窗口胜率`
- 修后说明含“按已完成窗口计算（非按成交单数）”

### BUG-2（标题作用域）修复结果
- 修后标题按 scope 动态：
  - current_window -> 当前窗口订单状态
  - last_window -> 上一窗口订单状态
  - none -> 无活动窗口订单状态
- 本次 API 事实块：`scope=last_window`

### BUG-3（价格可解释性）修复结果
- 订单接口存在 `fill_price` 字段（未命中停止条件）。
- 修后价格列展示为“挂单价/成交价”。
- 已成交样本事实块：`order_price=0.27`，`fill_price=0.26`。

### 修前/修后 DOM 最小事实块
- 修前（定位基线）：
  - 胜率标签：`胜率`
  - 标题：`当前窗口订单状态`（写死）
  - 价格列：`价格`，单值来源 `o.price`
- 修后（代码与审计脚本）：
  - 胜率标签：`窗口胜率`
  - 标题：按 scope 动态切换
  - 价格列：`挂单价/成交价`，值为 `o.price / o.fill_price`

### 不改计算证明
- today/7d/30 数值来源未变，审计快照：
  - today: window_count=4, filled_total=3, realized=0.98, avg=0.245
  - last_7d: window_count=1471, filled_total=1860, realized=6034.488796720972, avg=4.102303736723978
  - last_30_windows: window_count=30, filled_total=29, realized=297.6025643805565, avg=9.920085479351883

### 证据索引
- `rules/task-reports/2026-04/260404_004/260404_004_truth_audit_ui_scope_and_price_semantics.json`
- `rules/task-reports/2026-04/260404_004/260404_004_truth_audit_ui_scope_and_price_semantics.log`
