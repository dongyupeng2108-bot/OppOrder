# TraeTask_260328_032 修复验收（重启恢复语义层）

## 结论

- 验收结论：**PASS**
- 本轮审计：`A：恢复能力与持久化一致性可靠`
- first_break_layer：**已修复（原 031 为 A 重启恢复语义层）**

## Fail -> Pass 摘录

- 配置恢复：
  - Fail（031）：重启后 `saved_config.open_delay_sec=10`（默认回落）
  - Pass（032）：重启前后 `saved_config/config_current/active_runtime_snapshot` 均为 `5`

- 部分成交 + TP 已生成后重启：
  - Fail（031）：`tp_count(post)=0`，并出现账本清空迹象
  - Pass（032）：`tp_count(pre)=1`、`tp_count(post)=1`，`filled_total` 不倒退

- 连续 stop/start：
  - Fail（031）：`fail_start_no_tick=20`
  - Pass（032）：`fail_start_no_tick=0`，`fail_zombie_after_stop=0`

## 关键说明

- saved_config 持久化层：server 恢复快照文件（按端口隔离）负责落盘与加载。
- active_runtime_snapshot 恢复层：status 始终回传快照并标记 `running`，避免半恢复空态误导。
- 订单账本一致性层：ledger 支持 restore 并在变更时触发持久化，保留 `parent_order_id + ladder_key + tp_price` 绑定。
- stop/start 真运行判定：runner start 触发立即 tick，验收脚本以 `last_tick_at` 前进作为成功标准。
