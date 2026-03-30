# TraeTask_260330_017 实施记录（NO 方向重复挂阶梯单定位）

## 范围与基线

- 本单仅做真值定位，不做业务修复。
- 未修改下单/撤单、anchor/bounds/tp、UI/日志、PNL/today/账户链业务语义。

## 审计脚本

- 新增：`scripts/truth_audit_no_repeat_no_ladder_260330_017.mjs`
- 护栏：
  - `MAX_WALL_TIME=25min`
  - `MAX_SILENCE=120s`
  - `LOG_TAIL=150`
- 输出：
  - real runtime 连续样本
  - debug control 对照
  - 对账表（含 order_id 级字段）
  - 归一化 `04:08:00~04:08:20` 事实窗

## 本轮定位结果

- verdict：`B：样本不足`
- first_break_layer：`SAMPLE_BLOCKED_OR_INSUFFICIENT`
- 停止原因：`NO_REPEATED_PLACE_NO_AFTER_NO_TWO_FILLS`
- 说明：
  - real 样本捕获到 `NO` 两单成交窗口；
  - 但未在“NO 已两单成交之后”复现同窗持续 `PLACE_LADDER(NO)` 序列；
  - 因此无法对候选层给出唯一可复核首断裂层，按停止条件回报样本不足。

## 事实保留

- 已保留 `04:08:00~04:08:20` 归一化窗口事实（decision_intents/newly_created_order_ids_this_tick/no_terminal_state/window_id）。
- 已保留 NO 侧 `filled/open order_id` 列表与当前窗/上一窗 window_id。
