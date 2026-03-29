# TraeTask_260328_032 实施记录（重启恢复语义层修复）

## 根因确认（对应 031）

- 主因（A 重启恢复语义层）：
  - 恢复快照在进程初始化早期被 `onRuntimeUpdate(running=false)` 覆写为默认配置，导致重启后 `saved_config` 回落。
- 次因（B 持久化样本判读层）：
  - `/bot/orders` 默认按窗口显示，重启后若窗口上下文未建立，会出现 `orders` 为空但 `summary` 非空；TP 需要用 `all_orders` 对账。
- 次因（C 启停判定层）：
  - 031 脚本使用 `tick_interval_ms=800`，低于服务最小阈值 `1000`，导致 `start_ok` 误判。

## 修复实现

- `saved_config` 持久化层（server）：
  - 新增端口级恢复文件：`data/crypto_binary/bot_runtime_recovery_<PORT>.json`。
  - 配置变更、状态变更、账本变更后落盘恢复快照。
  - 避免初始化阶段覆盖：仅在 `botRecoveryHydrated=true` 后允许 runtime 回调触发落盘。

- `active_runtime_snapshot` 恢复层（server）：
  - `/bot/status` 始终返回 `active_runtime_snapshot`（含 `running` 标记），停止态也有可解释快照，不再半恢复空态误导。
  - 路由级懒恢复：所有 `/bot/*` 读写入口先执行恢复装载。

- 订单账本恢复层（ledger + server）：
  - `bot_order_ledger` 新增 `restore()`，支持从快照恢复订单全量字段（含 `parent_order_id/ladder_key/tp_price`）。
  - ledger 每次变更触发回调，server 即时持久化，保证 ENTRY/TP 绑定在崩溃重启后可回放。

- stop/start 真运行判定（runner + 验证脚本）：
  - runner `start()` 增加立即 tick 一次，缩短“running=true 但尚未首tick”的窗口。
  - 审计脚本将 start 成功标准改为“`last_tick_at` 相对 start 前推进”，并使用合法间隔 `1000ms`。

## Fail -> Pass 主证据

- 配置恢复：
  - Fail（031）：重启后 `saved_config.open_delay_sec=10`（默认），与重启前 `5` 不一致。
  - Pass（032）：重启前后 `saved_config/config_current/active_runtime_snapshot` 均为 `5`。

- 部分成交 + TP 后重启：
  - Fail（031）：`tp_count(post)=0`，并伴随 `summary.total=0/filled_total=0`。
  - Pass（032）：`tp_count(pre)=1`、`tp_count(post)=1`，且 `filled_total` 不倒退。

- 连续 stop/start：
  - Fail（031）：`fail_start_no_tick=20`。
  - Pass（032）：`fail_start_no_tick=0`，`fail_zombie_after_stop=0`。

## 结果

- 032 审计结论：`A：恢复能力与持久化一致性可靠`
- 4/4 检查通过：`031-A/B/C/D = true`
