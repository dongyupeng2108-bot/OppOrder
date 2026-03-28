# TraeTask_260328_024 实施记录（strategy-editor 参数 UI 重构）

## UI DOM 事实

- 全局区存在“开盘等待秒数”输入。
- 页签存在“UP挂单 / DOWN挂单”。
- 档位行包含“挂单价 / 数量 / 止盈价”三列。
- 每个方向包含撤单条件：
  - 结束前若干秒全撤
  - 公式触发撤单

## 保存后 /bot/config 事实

- `SAVE_OK=True`
- `CFG_AFTER_SAVE_UP=[{"price":0.31,"size":2,"tp_price":0.35},{"price":0.29,"size":1.5,"tp_price":0.33}]`
- `CFG_AFTER_SAVE_DOWN=[{"price":0.69,"size":2,"tp_price":0.64},{"price":0.71,"size":1.5,"tp_price":0.66}]`
- `CFG_AFTER_SAVE_UP_CANCEL={"before_end_sec":45,"formula":"secs_left <= 45 || spread > 0.03"}`
- `CFG_AFTER_SAVE_DOWN_CANCEL={"before_end_sec":30,"formula":"has_open_down_orders && volatility_ratio > 0.002"}`

## 回填事实

- 页面加载链：`se_loadParams -> se_pickBotConfig -> se_renderParams -> se_renderActiveTabPanel`。
- 回填字段：
  - `open_delay_sec` 回填到 `param_open_delay_sec`
  - `up/down_ladder` 回填到当前页签逐行 `price/size/tp_price`
  - `up/down_cancel` 回填到 `param_direction_before_end_sec / param_direction_formula`
