# TraeTask_260329_004 实施记录（启动后等待下一个窗口再挂单）

## 定位结论

- 唯一 first_break_layer：**runner 启动首 tick 层**
- 修前行为：启动后首个已存在窗口直接进入挂单路径，导致“当前窗口立即挂单”。

## 修复范围

- `strategies/crypto_binary/bot_runner.mjs`
- `scripts/truth_audit_start_wait_next_window_260329_004.mjs`

## 核心修复

- 在 runner 启动链路新增启动窗口门控状态：
  - `pending`：启动后首 tick 未判定；
  - `wait_next_window`：若启动时已有活动窗口，记录该窗口并进入等待；
  - `open`：检测到窗口切到新窗口后释放门控。
- 门控期间对动作意图统一 gate 为 NOOP，理由 `wait_next_window_after_start`。
- 仅当窗口切换到不同于启动窗口的新窗口后，允许执行挂单。
- `start/stop` 时重置门控状态，避免跨次运行污染。

## 结果

- 启动后在当前已存在窗口不挂单。
- 到下一个新窗口才开始挂单。
- UP/DOWN 双边挂单在新窗口仍成立。
