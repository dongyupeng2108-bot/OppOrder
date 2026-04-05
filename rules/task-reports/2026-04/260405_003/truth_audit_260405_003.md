# truth_audit_260405_003

## 结论块
- verdict: A（通过）
- first_break_layer: NONE_CHAIN_PASS
- 结论: M0 基线测量已完成，四类指标均有可复核样本

## 基线指标摘要
- quote->decision:
  - p50=390ms
  - p95=963ms
- decision->action:
  - p50=60123ms
  - p95=102736ms
- tick 周期:
  - p50=5000ms
  - p95=5000ms
  - max=5000ms
- 三价链缺失率:
  - missing=0 / total=59 / rate=0

## 核查项
- [PASS] quote->decision 样本存在
- [PASS] decision->action 样本存在
- [PASS] tick 周期样本存在
- [PASS] 三价链样本存在

## 证据索引
- 主证据 JSON：
  - `rules/task-reports/2026-04/260405_003_truth_audit_m0_baseline_metrics_260405_003.json`
- 脚本运行日志：
  - `rules/task-reports/2026-04/260405_003_truth_audit_m0_baseline_metrics_260405_003.log`
