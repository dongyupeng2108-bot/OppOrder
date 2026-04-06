# implementation_260406_006

## 任务信息
- task_id: `260406_006`
- 类型: 业务实现任务
- 目标: 修复 BTCQDD API 在无效 JSON 输入下的错误语义

## 实施内容
- 修改：
  - `strategies/crypto_binary/server.mjs`
  - 新增统一 JSON 解析函数 `parseJsonBody`
- 生效端点：
  - `POST /config/reload`
  - `POST /bot/config`
  - `POST /bot/start`
- 新增真实运行审计脚本：
  - `scripts/truth_audit_bot_api_invalid_json_260406_006.mjs`
