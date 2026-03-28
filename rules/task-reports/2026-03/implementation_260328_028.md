# TraeTask_260328_028 实施记录（策略与运行模块防回归固化）

## 新增/改动验证脚本

- 新增：`scripts/verify_strategy_runtime_regression_guard.mjs`
- 入口纳入：`scripts/verify_all_manual.mjs`

## 覆盖项（8项）

- 新契约保存/读取一致（`up_ladder/down_ladder/up_cancel/down_cancel/tp_price`）
- YES/NO 单边梯队独立挂出
- ENTRY -> TAKE_PROFIT 逐档绑定（`tp_price + ladder_key + parent_order_id`）
- 方向性撤单只撤本方向
- 撤单优先于挂单（撤单 tick 不增单）
- 非 `PLACE_LADDER` tick 不新增订单
- 同窗口同方向公式撤单只触发一次（去重 tick 统计）
- 同价同方向不重复 open

## 关键运行结果

- 新脚本单跑：
  - `pass=true`
  - `conclusion=A: regression guard pass (8/8 checks)`
  - `first_break_layer=null`
  - `up_cancel_hits_unique_tick=1`
  - `down_cancel_hits_unique_tick=1`
- 全量入口：
  - `verify_all_manual total_scripts=11`
  - `pass_count=11`
  - `overall_pass=true`

## 最小事实摘录

- 契约保存返回：
  - `save_response_status=200`
  - `config_current` 含 `up_ladder/down_ladder` 每档 `price,size,tp_price` 与 `up_cancel/down_cancel`
- 预览分叉校验：
  - `reason=ladder_not_posted`
  - intents 同时包含 `PLACE_LADDER side=YES` 与 `side=NO`，且 ladder 明细一致
- 运行挂单：
  - `open_yes=2, open_no=2`
- TP 绑定：
  - ENTRY：`side=YES, tp_price=0.97, ladder_key=YES:0`
  - TP：`kind=TAKE_PROFIT, side=YES, price=0.97, tp_price=0.97, ladder_key=YES:0, parent_order_id=<ENTRY.order_id>`
