## TraeTask_260403_009 实施记录（韩国 VPN 官方探测复测）

### 范围与约束
- 仅复测 PM 官方结算可观测层 + 本地 completed 触发复核。
- 不修改 server/执行/结算/统计/UI 生产逻辑。

### 新增脚本
- `scripts/truth_audit_korea_vpn_official_probe_260403_009.mjs`
  - 样本：`btc-updown-5m-1775138400`、`btc-updown-5m-1775138700`（real runtime）
  - 官方探测上限：每样本 3 次、间隔 15s、单次超时 8s
  - 输出官方层原文字段：HTTP状态/错误、official_resolved、official_outcome、resolved_at
  - 复核本地 completed：`completed_at`、`has_postmortem_row`、`trigger_source`

### 执行
- `node --check scripts/truth_audit_korea_vpn_official_probe_260403_009.mjs`：通过
- `node scripts/truth_audit_korea_vpn_official_probe_260403_009.mjs ...`：通过
- 产出：
  - `260403_009_truth_audit_korea_vpn_official_probe.json`
  - `260403_009_truth_audit_korea_vpn_official_probe.log`
