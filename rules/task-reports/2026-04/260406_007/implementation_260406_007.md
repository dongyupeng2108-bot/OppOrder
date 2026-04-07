# implementation_260406_007

## 任务信息
- task_id: `260406_007`
- 类型: 业务实现任务
- 目标: 强化 API 载荷形状校验，拒绝非对象 JSON

## 实施内容
- 修改：
  - `strategies/crypto_binary/server.mjs`
  - 新增 `ensureJsonObjectPayload`
- 生效端点：
  - `POST /config/reload`
  - `POST /bot/config`
  - `POST /bot/start`
- 新增真实运行审计脚本：
  - `scripts/truth_audit_bot_api_payload_shape_260406_007.mjs`
