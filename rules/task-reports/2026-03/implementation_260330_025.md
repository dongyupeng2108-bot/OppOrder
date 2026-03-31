# TraeTask_260330_025 实施记录（同窗 YES 重复挂单/重复成交真值定位）

## 范围与方式

- 本单仅定位，不做业务修复。
- 未改 runner/strategy/server 业务逻辑、UI 文案布局、PNL 公式、账户链与三大文档结构。

## 审计脚本

- 新增：`scripts/truth_audit_yes_repeat_same_window_260330_025.mjs`
- 护栏：
  - `MAX_WALL_TIME=25min`
  - `MAX_SILENCE=120s`
  - `LOG_TAIL=150`
- 采样：
  - real runtime：单档位配置（UP 0.3/5/1，DOWN 0.3/5/1，UP撤单120s，DOWN撤单60s）
  - debug control：`fill_yes_path_v1`
  - order_id 级对账表：记录 `created_this_tick`、`fill_event_seen`、`source_block=api` 等字段

## 定位要点

- real 样本捕获到：
  - `post_fill_new_yes_order_ids=["paper_06a66cc4","paper_18c07d7a"]`
  - `duplicate_yes_filled_order_ids=["paper_e553a175","paper_474d88b8"]`
- 即在同窗首个 YES 成交后，后续仍出现新的 YES order_id，且最终出现两条 YES 已成交（不同 order_id）。
- 这不是“同一 order_id 被重复投影”，而是执行侧确有重复创建/重复成交链路事实。

## 结论

- verdict：`C：存在断裂`
- 唯一 first_break_layer：`terminal_state_guard`
- 三选一：`真实重复执行`
- real/debug 分叉层：`terminal_state_guard`
