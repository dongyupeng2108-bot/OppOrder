# TraeTask_260329_002 实施记录（当前窗口展示名）

## 变更范围

- 仅修改 `ui/js/strategy-editor.js` 展示口径。
- 新增只读审计脚本 `scripts/truth_audit_window_display_label_260329_002.mjs`。
- 未修改执行主链、signer/余额链、PNL/today。

## 实现方式

- 新增前端函数 `se_formatWindowDisplayName(windowId)`：
  - 匹配标准窗口 ID 末尾模式 `-(\d+)m-(\d{10})`。
  - 解析分钟粒度与窗口起始 Unix 秒，按 `America/New_York` 生成 PM 风格标签。
  - 输出格式示例：`March 29, 10:55-11AM ET`。
  - 非标准窗口（debug/自定义）直接回退原始 `window_id`。

- 将“当前窗口”显示从原始值改为展示名：
  - `se-log-current-window` 赋值改为 `se_formatWindowDisplayName(...)`。

## 结果

- 真实 PM 窗口显示为时间标签。
- debug / 非标准窗口保持原始名。
- 仅改显示，不改业务执行语义。
