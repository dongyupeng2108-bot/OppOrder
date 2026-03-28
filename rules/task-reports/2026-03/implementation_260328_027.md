# TraeTask_260328_027 实施记录（方向撤单公式防抖）

## 依赖确认

- 026 的重复触发判定位于策略判定层：
  - `bot_strategy.mjs` 的 `wantCancelUp / wantCancelDown` 计算与 `up_cancel_formula/down_cancel_formula` 分支。
- 状态写入时机：
  - runner 在每 tick 末尾将 `decision.patches` 合并到 state（`bot_runner.mjs` 的 statePatch 合并逻辑）。
- 窗口重置路径：
  - `createWindowResetPatch` 在窗口切换时重置方向状态。

## 修复实现

- 新增方向公式防抖状态字段（状态层持久化）：
  - `up_formula_cancelled`
  - `down_formula_cancelled`
- 判定层变更：
  - 公式撤单需额外满足 `canTriggerXxxFormula`（未被该方向公式触发过）。
  - 公式撤单首次触发时置位对应 `*_formula_cancelled=true`。
- 窗口重置：
  - 在 `createWindowResetPatch` 中将 `up_formula_cancelled/down_formula_cancelled` 重置为 `false`。

## Fail -> Pass 事实

- Fail（026 事实）：
  - `i=4 reason=up_cancel_formula`
  - `i=5 reason=up_cancel_formula`
  - `A_CANCEL_HITS=2`

- Pass（本次 real runtime，按 `last_tick_at` 去重后的 tick 事实）：
  - `UP_UNIQ_TRACE` 中仅一次 `reason=up_cancel_formula`
  - `UP_CANCEL_HITS_UNIQ=1`
  - `DOWN_UNIQ_TRACE` 中仅一次 `reason=down_cancel_formula`
  - `DOWN_CANCEL_HITS_UNIQ=1`

## 既有成立项回归

- 撤单优先于挂单：撤单触发 tick `total` 不增长。
- 非 PLACE_LADDER tick 不新增订单：`UP_NON_PLACE_ADD_UNIQ=`（空），`DOWN_NON_PLACE_ADD_UNIQ=`（空）。
- 同价同方向不重复 open：`DUP_MAX_SAMPLE=0`。
- 双边隔离仍成立：
  - UP 触发后 `open_yes=0, open_no=2`
  - DOWN 触发后 `open_yes=2, open_no=0`
