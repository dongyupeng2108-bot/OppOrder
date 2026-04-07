# API JSON 错误语义字典

## 适用范围
- `strategies/crypto_binary/server.mjs` 的所有 JSON 请求体端点。

## 固定错误语义
- `invalid json payload`
  - 含义：请求体不是合法 JSON（语法错误）。
  - HTTP 状态：`400`

- `invalid json payload type`
  - 含义：请求体是合法 JSON，但不是对象（例如 `[]`、`1`、`"x"`）。
  - HTTP 状态：`400`

## 约束
- 以上错误语义为稳定契约，不得在无新任务的情况下漂移。
- 新增 JSON 端点必须复用相同语义与状态码。
