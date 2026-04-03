## TraeTask_260403_008 实施记录（Truth Audit，heavy）

### 范围与约束
- 仅定位，不修改业务逻辑。
- 审计主链限定为：PM官方结算获取/轮询/状态映射/落盘/completed触发。

### 新增脚本
- `scripts/truth_audit_settlement_chain_260403_008.mjs`
  - real runtime 样本：`btc-updown-5m-1775138400`、`btc-updown-5m-1775138700`
  - PM官方探测：每样本最多 3 次，间隔 20s，单次超时 10s
  - 本地链路对账：
    - `/bot/status` 是否暴露 settlement_runtime 字段
    - bot 日志是否存在 settlement 轮询/映射事件
    - `BOT_RUN_SNAPSHOT` 与 postmortem 落盘关系
    - today/postmortem 下游状态

### 执行
- `node --check scripts/truth_audit_settlement_chain_260403_008.mjs`：通过
- `node scripts/truth_audit_settlement_chain_260403_008.mjs ...`：通过
- 产出：
  - `260403_008_truth_audit_settlement_chain.json`
  - `260403_008_truth_audit_settlement_chain.log`
