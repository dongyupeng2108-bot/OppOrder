# TraeTask_260330_045 实施记录（PNL与平均每窗口盈亏显示精度统一）

## 范围执行

- 本轮仅修改 UI 展示格式，不改业务计算逻辑。
- 修改文件：
  - `ui/js/strategy-editor.js`
  - `scripts/truth_audit_pnl_display_precision_260330_045.mjs`
- 未修改：
  - `strategies/crypto_binary/bot_strategy.mjs`
  - `strategies/crypto_binary/bot_runner.mjs`
  - `strategies/crypto_binary/server.mjs` 业务语义与 API 原始值
  - PNL 计算/聚合逻辑

## 修复内容

- 新增统一展示 helper：`se_formatPnlDisplay(value, emptyText)`，统一输出 `toFixed(2)`。
- 将 PNL 显示链路统一接入 2 位小数：
  - 上一窗口结果 PNL
  - 近期表现摘要总计PNL
  - 近期表现摘要平均每窗口盈亏
  - 相关 PNL 展示位（overview/runtime/last/postmortem realized total）同步收口，避免局部不一致

## 验证脚本

- 新增：`scripts/truth_audit_pnl_display_precision_260330_045.mjs`
- 验证点：
  - 修前/修后 DOM 文本对比（按旧格式链与新格式链镜像）
  - PNL 与平均每窗口盈亏均为 2 位小数
  - API 原始值保持不变（只改显示）

## 运行结果

- `node --check ui/js/strategy-editor.js`：通过
- `node --check scripts/truth_audit_pnl_display_precision_260330_045.mjs`：通过
- 主审计：
  - `node scripts/truth_audit_pnl_display_precision_260330_045.mjs --task_id=260330_045 --sample=pnl_display_precision_v1 --output=rules/task-reports/2026-03/260330_045_truth_audit_pnl_display_precision.json`
  - `pass=true`
  - `first_break_layer=NONE_CHAIN_PASS`
