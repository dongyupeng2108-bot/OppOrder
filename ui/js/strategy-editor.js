/**
 * strategy-editor.js
/**
 * SE-2: Bot Console UI 逻辑
 */

// 默认代码模板
const SE_DEFAULT_CODE = `/**
 * 策略决策函数
 * @param {object} ctx - 市场上下文
 * @param {object} ctx.price - { up, down, btc }
 * @param {object} ctx.regime - { score (0=趋势,1=震荡) }
 * @param {object} ctx.window - { remaining_sec }
 * @param {object} ctx.orderbook - { mid }
 * @returns {string} 'BUY_UP' | 'BUY_DOWN' | 'HOLD' | 'CLOSE'
 */
function decide(ctx) {
  // 示例：简单的趋势跟随
  const trend = ctx.price.up > 0.6 ? 'UP' : (ctx.price.down > 0.6 ? 'DOWN' : 'FLAT');
  
  if (ctx.window.remaining_sec != null && ctx.window.remaining_sec < 60) return 'CLOSE'; // 收盘前平仓
  
  if (trend === 'UP') return 'BUY_UP';
  if (trend === 'DOWN') return 'BUY_DOWN';
  
  return 'HOLD';
}`;

// AI 指南文案 (暂存为 Bot 说明)
const SE_GUIDE_TEXT = `========================================
  BTCQDD Bot 参数配置指南
========================================

第一部分：Bot 运行说明

1. 运行模式
   目前 Bot 运行在 Paper-Staging 环境下，主要用于验证策略逻辑与系统稳定性。
   Live 模式已后置，将在 Paper 充分验收通过后开放。

2. 策略执行
   Bot 主链采用预置策略（如 btc_5m_ladder_bot 等）。
   配置参数后，Bot 会自动按照规则读取市场数据并执行。

3. 日志与结算
   - 结构化日志是 Bot 的一级产物，用于后续复盘分析。
   - 窗口切换时自动触发结算，详情请关注实时日志区。
`;

const SE_MODULE_INFO = [
  {
    name: '策略与运行输入',
    duty: '统一采集并装配行情、窗口、ATR、订单簿等输入上下文。',
    input: '行情源数据、窗口发现结果、ATR 与订单簿采样、运行配置。',
    output: 'BotContext 输入对象与 readiness 前置字段。'
  },
  {
    name: '执行引擎',
    duty: '负责生命周期、gate、decision、ledger、幂等核心语义与执行推进。',
    input: '输入模块上下文、运行配置、历史执行状态。',
    output: '决策结果、订单执行真值、/bot/status 与 /bot/orders 关键状态。'
  },
  {
    name: '实时监控',
    duty: '负责对外暴露与展示运行事实，不反向定义执行语义。',
    input: '执行引擎与结果模块输出、日志与状态快照。',
    output: '/bot/context、/bot/status、/bot/orders 与控制台展示。'
  },
  {
    name: '运行结果',
    duty: '负责 postmortem、last_run_snapshot、performance_summary 结果表达。',
    input: '执行结束态、订单成交结果、窗口结算数据、聚合统计输入。',
    output: '/bot/postmortem/latest、/bot/performance/summary 与结果快照字段。'
  },
  {
    name: '版本测试/保障',
    duty: '作为横切保障层，验证业务链路并输出可审计证据。',
    input: '业务接口返回、运行日志、样本数据、任务证据上下文。',
    output: 'verify 结论、verify_all_manual 汇总与任务证据文件。'
  }
];

// 状态管理
let _se_running = false;
let _se_period = '5m';
let _se_pollTimer = null;
let _seLastLogTs = '';
let _seErrorCount = 0;
let _seLastPollError = null;
let _seActionPending = false;
let _sePerformancePreset = 'today';
let _seTestRunPending = false;
let _seTestStatus = { state: 'idle' };
let _seTestLastResultFile = null;
let _seTestLastRunId = null;
let _seTestFailModalShownRunId = null;
let _seTestLogTail = [];
let _seTestUserTriggered = false;
let _seTestRecoveredRunning = false;
let _seTestSelectedModuleKey = 'allchain';
let _seLogViewMode = 'key';
let _seLogEntriesRaw = [];
let _seLogEntriesKey = [];
let _seLogNoiseSuppressed = 0;
const SE_TEST_MODULES = [
  { key: 'module1', label: '模块1 策略与输入', hint: '高价值策略输入与运行语义回归集合' },
  { key: 'module2', label: '模块2 执行引擎', hint: '窗口生命周期、幂等、订单范围与执行引擎语义' },
  { key: 'module3', label: '模块3 实时监控', hint: 'context/status 与输入监控链路一致性' },
  { key: 'module4', label: '模块4 运行结果', hint: '结果链、PNL 与 runtime→业务结果一致性' },
  { key: 'module5', label: '模块5 版本测试/保障', hint: '版本保障关键脚本集（不跑全链）' },
  { key: 'allchain', label: '全链测试', hint: 'verify_all_manual 总入口（现有全链）' }
];
const BASE_URL = ''; // 相对路径

async function restartServer() {
  const btn = document.getElementById('se-btn-restart');
  if (btn) {
    btn.textContent = '重启中...';
    btn.style.opacity = '0.7';
    btn.disabled = true;
  }
  try {
    await fetch(`${BASE_URL}/server/restart`, { method: 'POST' });
    if (btn) {
      btn.textContent = '已重启';
      setTimeout(() => {
        btn.textContent = '重启服务';
        btn.style.opacity = '1';
        btn.disabled = false;
      }, 2000);
    }
  } catch(e) {
    console.error('[SE] restart failed', e);
    alert('重启失败: ' + e.message);
    if (btn) {
      btn.textContent = '重启服务';
      btn.style.opacity = '1';
      btn.disabled = false;
    }
  }
}

const BOT_CONFIG_FIELDS = [
  'open_delay_sec',
  'ladder_prices',
  'ladder_size',
  'atr_multiple',
  'cancel_all_remaining_sec',
  'up_ladder',
  'down_ladder',
  'up_cancel',
  'down_cancel'
];
const SE_DEFAULT_OPEN_DELAY_SEC = 10;
const SE_DEFAULT_ATR_MULTIPLE = 1.2;
const SE_DEFAULT_CANCEL_ALL_REMAINING_SEC = 100;
const SE_DEFAULT_LADDER_SIZE = 5;
const SE_DEFAULT_LADDER_PRICES = [0.27, 0.24, 0.21, 0.18];
const SE_DEFAULT_LADDER_ROWS = SE_DEFAULT_LADDER_PRICES.map((price) => ({ price, size: SE_DEFAULT_LADDER_SIZE, tp_price: 1 }));
let _seConfigCurrent = null;
let _seConfigDefaults = null;
let _seParamActiveTab = 'up';
let _seParamDraft = null;

// 初始化
async function initStrategyEditor() {
  const container = document.getElementById('se-container');
  if (!container) return; // 避免重复初始化或找不到容器

  // 如果已有内容，不再重绘（保留状态）
  if (container.innerHTML.trim()) return;

  container.innerHTML = `
    <div class="se-layout" style="height:100%;display:flex;flex-direction:column;background:#0b0d10;color:#d6dde5;position:relative;">
      <div style="height:62px;border-bottom:1px solid #232a33;background:#0d131a;padding:0 12px;display:grid;grid-template-columns:1fr auto auto auto auto auto;gap:10px;align-items:center;">
        <div style="font-size:18px;letter-spacing:.3px;">BTCQDD 执行机器人</div>
        <button id="se-btn-param-toggle" onclick="se_toggleParamsPanel()" style="height:34px;width:34px;border:1px solid #2f3946;background:#18202a;color:#d6dde5;border-radius:4px;cursor:pointer;">⚙</button>
        <button id="se-btn-module-info" onclick="se_openModuleInfo()" style="height:34px;border:1px solid #35506b;background:#1a2a3a;color:#c8e6ff;border-radius:4px;padding:0 10px;cursor:pointer;">模块说明</button>
        <button id="se-btn-test" onclick="se_openTestPanel()" style="height:34px;border:1px solid #35506b;background:#1a2a3a;color:#c8e6ff;border-radius:4px;padding:0 10px;cursor:pointer;">版本测试入口</button>
        <button id="se-btn-restart" onclick="restartServer()" style="height:34px;border:1px solid #35506b;background:#1a2a3a;color:#c8e6ff;border-radius:4px;padding:0 10px;cursor:pointer;">重启服务</button>
        <button id="se-btn-run-toggle" class="se-btn-deploy" onclick="se_toggleBotRun()">启动</button>
      </div>

      <div style="flex:1;min-height:0;padding:10px;display:grid;grid-template-columns:320px 12px minmax(0,1fr);gap:0;">
        <section class="se-order-panel" style="border:1px solid #232a33;background:#11161c;padding:10px;min-height:0;width:100%;max-width:none;overflow:hidden;display:flex;flex-direction:column;">
          <div id="se-order-title" class="se-order-title">当前窗口订单状态</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;font-size:12px;padding:4px 2px 8px 2px;">
            <div style="color:#7f8a97;">BTC价格</div><div id="se-order-btc" style="text-align:left;color:#d6dde5;">—</div>
            <div style="color:#7f8a97;">UPDOWN概率</div><div id="se-order-updown-prob" style="text-align:left;color:#d6dde5;">—</div>
            <div style="color:#7f8a97;">波动值</div><div id="se-order-volatility" style="text-align:left;color:#d6dde5;">—</div>
          </div>
          <div style="flex:1;min-height:0;overflow:auto;">
            <table class="se-order-table" style="table-layout:fixed;width:100%;">
              <colgroup>
                <col style="width:20%">
                <col style="width:12%">
                <col style="width:18%">
                <col style="width:12%">
                <col style="width:20%">
                <col style="width:18%">
              </colgroup>
              <thead><tr><th>订单类型</th><th>UP/DOWN</th><th>价格</th><th>数量</th><th>平仓价</th><th>状态</th></tr></thead>
              <tbody id="se-order-body">
                <tr><td colspan="6" style="color:#555;text-align:center">暂无</td></tr>
              </tbody>
            </table>
          </div>
          <div id="se-latency" style="font-size:10px;color:#888;text-align:right;padding:4px 8px 0 8px;"></div>
        </section>
        <div style="background:#0b0d10;border-left:1px solid #1a2028;border-right:1px solid #1a2028;"></div>
        <div style="min-height:0;display:grid;grid-template-rows:minmax(260px,1fr) 208px;gap:10px;">
          <div style="display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,0.5fr);gap:10px;min-height:0;">
            <section style="border:1px solid #232a33;background:#11161c;padding:10px;display:flex;flex-direction:column;min-height:0;gap:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <h3 style="margin:0;font-size:13px;color:#d6dde5;">实时日志</h3>
                <div style="display:flex;align-items:center;gap:8px;">
                  <button id="se-log-view-key" onclick="se_setLogViewMode('key')" style="height:22px;border:1px solid #35506b;background:#1a2a3a;color:#c8e6ff;border-radius:3px;padding:0 8px;cursor:pointer;font-size:11px;">关键信息流</button>
                  <button id="se-log-view-raw" onclick="se_setLogViewMode('raw')" style="height:22px;border:1px solid #2f3946;background:#121821;color:#8ea1b5;border-radius:3px;padding:0 8px;cursor:pointer;font-size:11px;">原始日志</button>
                  <span style="font-size:11px;color:#7f8a97;">当前窗口</span>
                  <span id="se-log-current-window" style="font-size:11px;color:#d6dde5;font-family:monospace;">—</span>
                  <span id="se-countdown" style="font-size:11px;color:#aaa;font-family:monospace;">--:--</span>
                </div>
              </div>
              <div id="se-log-view-hint" style="font-size:11px;color:#8ea1b5;min-height:16px;">默认展示关键信息流</div>
              <div id="se-log-area" class="se-log-area" style="flex:1;min-height:0;"></div>
              <div id="se-ui-error" style="font-size:11px;color:#ff8a80;min-height:16px;"></div>
            </section>
            <section style="border:1px solid #232a33;background:#11161c;padding:10px;display:flex;flex-direction:column;gap:8px;min-height:0;">
              <div id="se-pm-account-card" style="border:1px solid #253140;background:#0f141a;border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:4px;">
                <div id="se-pm-account-name" style="font-size:12px;color:#b7c4d3;">PM账号名：--</div>
                <div id="se-pm-account-balance" style="font-size:12px;color:#d6dde5;">余额：--美元（今日--）</div>
              </div>
              <h3 style="margin:0;font-size:13px;color:#d6dde5;">上一窗口结果</h3>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;font-size:12px;">
                <div style="color:#7f8a97;">已成交总数</div><div id="se-prev-filled-total" style="text-align:right;color:#d6dde5;">—</div>
                <div style="color:#7f8a97;">已撤单总数</div><div id="se-prev-cancelled-total" style="text-align:right;color:#d6dde5;">—</div>
                <div style="color:#7f8a97;">PNL</div><div id="se-prev-pnl" style="text-align:right;color:#d6dde5;">—</div>
              </div>
            </section>
          </div>
          <section style="border:1px solid #232a33;background:#11161c;padding:10px;display:flex;flex-direction:column;gap:8px;min-height:0;">
            <h3 style="margin:0;font-size:13px;color:#d6dde5;">近期表现摘要</h3>
            <div style="display:flex;gap:6px;">
              <button id="se-perf-btn-today" onclick="se_setPerformancePreset('today')" style="background:#1f1f1f;color:#ddd;border:1px solid #555;border-radius:4px;padding:2px 8px;cursor:pointer;">今日</button>
              <button id="se-perf-btn-last7d" onclick="se_setPerformancePreset('last_7d')" style="background:#111;color:#aaa;border:1px solid #333;border-radius:4px;padding:2px 8px;cursor:pointer;">近7天</button>
              <button id="se-perf-btn-last30" onclick="se_setPerformancePreset('last_30_windows')" style="background:#111;color:#aaa;border:1px solid #333;border-radius:4px;padding:2px 8px;cursor:pointer;">近30窗口</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;font-size:12px;">
              <div style="color:#7f8a97;">统计区间</div><div id="se-perf-range" style="text-align:right;color:#d6dde5;">今日</div>
            </div>
            <div style="border:1px solid #232a33;background:#11161c;padding:10px;display:flex;flex-direction:column;gap:8px;min-height:0;">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;font-size:12px;">
                <div style="color:#7f8a97;">窗口数</div><div id="se-perf-window-count" style="text-align:right;color:#d6dde5;">—</div>
                <div style="color:#7f8a97;">胜率</div><div id="se-perf-win-rate" style="text-align:right;color:#d6dde5;">—</div>
                <div style="color:#7f8a97;">总成交单数</div><div id="se-perf-filled-total" style="text-align:right;color:#d6dde5;">—</div>
                <div style="color:#7f8a97;">总计PNL</div><div id="se-perf-realized-total" style="text-align:right;color:#d6dde5;">—</div>
                <div style="color:#7f8a97;">平均每窗口盈亏</div><div id="se-perf-avg-realized" style="text-align:right;color:#d6dde5;">—</div>
              </div>
              <div id="se-perf-note" style="font-size:11px;color:#9aa0a6;min-height:16px;">—</div>
            </div>
          </section>
        </div>
      </div>
      <aside id="se-param-collapse" style="display:none;position:absolute;top:62px;left:10px;width:320px;max-height:calc(100% - 74px);border:1px solid #1c222b;background:#0d1218;padding:10px;overflow:auto;z-index:20;">
        <h3 style="margin:0 0 8px 0;font-size:13px;color:#d6dde5;">策略参数</h3>
        <div id="se-snapshot-note" style="font-size:11px;color:#7f8a97;line-height:1.5;margin-bottom:8px;">saved/active runtime snapshot 读取中...</div>
        <div id="se-params-form" style="color:#ddd; display: flex; flex-direction: column; gap: 12px;">
          <div>
            <label style="display:block; margin-bottom:5px; font-weight:bold;">开盘等待秒数</label>
            <input type="number" id="param_open_delay_sec" style="background:#1e1e1e; border:1px solid #555; color:#fff; padding:6px; border-radius:4px; width:100%; box-sizing:border-box;">
          </div>
          <div style="display:flex;gap:6px;">
            <button id="se-param-tab-up" onclick="se_switchParamTab('up')" style="flex:1;background:#1d3a28;color:#c8ffd8;border:1px solid #2f6a47;border-radius:4px;padding:6px;cursor:pointer;">UP挂单</button>
            <button id="se-param-tab-down" onclick="se_switchParamTab('down')" style="flex:1;background:#1a2330;color:#c8e6ff;border:1px solid #35506b;border-radius:4px;padding:6px;cursor:pointer;">DOWN挂单</button>
          </div>
          <div style="border:1px solid #232a33;background:#11161c;padding:8px;border-radius:4px;display:flex;flex-direction:column;gap:8px;">
            <div id="se-ladder-title" style="font-weight:bold;color:#d6dde5;">UP挂单档位</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px;font-size:11px;color:#8fa1b3;">
              <div>挂单价</div><div>数量</div><div>止盈价</div><div></div>
            </div>
            <div id="se-ladder-rows" style="display:flex;flex-direction:column;gap:6px;"></div>
            <button onclick="se_addLadderRow()" style="align-self:flex-start;background:#1f1f1f;color:#ddd;border:1px solid #555;border-radius:4px;padding:4px 8px;cursor:pointer;">新增档位</button>
          </div>
          <div style="border:1px solid #232a33;background:#11161c;padding:8px;border-radius:4px;display:flex;flex-direction:column;gap:8px;">
            <div id="se-cancel-title" style="font-weight:bold;color:#d6dde5;">UP撤单条件</div>
            <div>
              <label style="display:block; margin-bottom:5px;">结束前若干秒全撤</label>
              <input type="number" id="param_direction_before_end_sec" style="background:#1e1e1e; border:1px solid #555; color:#fff; padding:6px; border-radius:4px; width:100%; box-sizing:border-box;">
            </div>
            <div>
              <label style="display:block; margin-bottom:5px;">公式触发撤单</label>
              <input type="text" id="param_direction_formula" style="background:#1e1e1e; border:1px solid #555; color:#fff; padding:6px; border-radius:4px; width:100%; box-sizing:border-box;">
            </div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="se-btn" onclick="se_restoreDefaultParams()" style="background:#444;color:#eee;border:1px solid #555;padding:4px 8px;border-radius:4px;cursor:pointer;">恢复默认</button>
            <button class="se-btn-save" onclick="se_saveParams()" style="background:#007acc;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;">保存参数</button>
            <button class="se-btn-guide" onclick="se_showGuide()">说明</button>
          </div>
          <div id="se-param-feedback" style="min-height: 18px; font-size: 12px; color: #ff8a80;"></div>
          <div style="padding: 8px; background: rgba(0, 122, 204, 0.12); border-left: 3px solid #007acc; border-radius: 4px; color: #9fd3ff;font-size:12px;">
            保存后将在下一轮启动时生效
          </div>
        </div>
      </aside>
      <textarea id="se-editor" style="display:none;">function decide(ctx) { return 'HOLD'; }</textarea>

      <div style="display:none;">
        <span id="se-bot-running">—</span>
        <span id="se-bot-phase">—</span>
        <span id="se-bot-debug">—</span>
        <span id="se-summary-yes-position">—</span>
        <span id="se-summary-no-position">—</span>
        <span id="se-summary-filled-total">—</span>
        <span id="se-summary-realized-total">—</span>
        <span id="se-summary-unrealized-total">—</span>
        <span id="se-summary-updated-at">—</span>
      </div>
      <div id="se-bot-state-tip" style="display:none;"></div>
      <div id="se-preview-state" style="display:none;"></div>
      <div id="se-preview-intents" style="display:none;"></div>
      <div id="se-preview-reason" style="display:none;"></div>
      <div id="se-preview-context" style="display:none;"></div>
      <div id="se-preview-diag" style="display:none;"></div>
      <div id="se-active-runtime-note" style="display:none;"></div>
      <div id="se-last-run-note" style="display:none;"></div>
      <div id="se-pm-note" style="display:none;"></div>
    </div>

    <!-- AI 指南 Modal -->
    <div id="se-guide-overlay" class="se-overlay" onclick="se_closeGuide()" style="display:none">
      <div class="se-modal" onclick="event.stopPropagation()">
        <div class="se-modal-title">🤖 AI 策略编写指南</div>
        <pre id="se-guide-text" class="se-guide-pre"></pre>
        <div class="se-modal-actions">
          <button id="se-btn-copy" class="se-btn-copy" onclick="se_copyGuide()">复制全文</button>
          <button class="se-btn-close" onclick="se_closeGuide()">关闭</button>
        </div>
      </div>
    </div>
    <div id="se-test-result-overlay" class="se-overlay" onclick="se_closeTestResultModal()" style="display:none">
      <div class="se-modal" onclick="event.stopPropagation()">
        <div id="se-test-result-title" class="se-modal-title">版本测试结果</div>
        <pre id="se-test-result-content" class="se-guide-pre"></pre>
        <div class="se-modal-actions">
          <button class="se-btn-close" onclick="se_closeTestResultModal()">关闭</button>
        </div>
      </div>
    </div>
    <div id="se-test-panel-overlay" class="se-overlay" onclick="se_closeTestPanel()" style="display:none">
      <div class="se-modal" onclick="event.stopPropagation()">
        <div class="se-modal-title">模块化测试入口</div>
        <div id="se-test-panel-content" class="se-guide-pre" style="white-space:normal;line-height:1.5;display:flex;flex-direction:column;gap:10px;"></div>
        <div class="se-modal-actions">
          <button class="se-btn-close" onclick="se_closeTestPanel()">关闭</button>
        </div>
      </div>
    </div>
    <div id="se-module-info-overlay" class="se-overlay" onclick="se_closeModuleInfo()" style="display:none">
      <div class="se-modal" onclick="event.stopPropagation()">
        <div id="se-module-info-title" class="se-modal-title">模块说明</div>
        <div id="se-module-info-content" class="se-guide-pre" style="white-space:normal;line-height:1.5;display:flex;flex-direction:column;gap:8px;"></div>
        <div class="se-modal-actions">
          <button class="se-btn-close" onclick="se_closeModuleInfo()">关闭</button>
        </div>
      </div>
    </div>
  `;

  // 加载并渲染 Bot 参数
  await se_loadParams();

  // 恢复上次代码：优先服务端 → 回退 localStorage → 最后用默认模板
  let saved = null;
  try {
    const resp = await fetch(`${BASE_URL}/strategy-runner/code`);
    const data = await resp.json();
    if (data.ok && data.code) saved = data.code;
  } catch (_) {}
  if (!saved) saved = localStorage.getItem('se_code');
  document.getElementById('se-editor').value = saved || SE_DEFAULT_CODE;
  document.getElementById('se-guide-text').textContent = SE_GUIDE_TEXT;
  se_renderModuleInfo();
  se_renderTestPanel();
  se_setPerformancePreset('today', false);
  se_updateRunningUI(false);
  se_updateTestButton();
  se_startPoll();

}

// ── Bot 参数管理逻辑 ────────────────────────────────────────────────────────
async function se_loadParams() {
  try {
    se_setParamFeedback('读取参数中...', '#9fd3ff');
    const resp = await fetch(`${BASE_URL}/bot/config`);
    const data = await resp.json();
    if (!resp.ok || !data?.current || !data?.defaults) {
      throw new Error(data?.error || `HTTP ${resp.status}`);
    }
    _seConfigCurrent = se_pickBotConfig(data.current);
    _seConfigDefaults = se_pickBotConfig(data.defaults);
    _seParamActiveTab = 'up';
    se_renderParams(_seConfigCurrent);
    se_setParamFeedback('参数已加载', '#8bc34a');
  } catch (e) {
    _seConfigDefaults = {
      open_delay_sec: SE_DEFAULT_OPEN_DELAY_SEC,
      ladder_prices: [...SE_DEFAULT_LADDER_PRICES],
      ladder_size: SE_DEFAULT_LADDER_SIZE,
      atr_multiple: SE_DEFAULT_ATR_MULTIPLE,
      cancel_all_remaining_sec: SE_DEFAULT_CANCEL_ALL_REMAINING_SEC,
      up_ladder: SE_DEFAULT_LADDER_ROWS.map((item) => ({ ...item })),
      down_ladder: SE_DEFAULT_LADDER_ROWS.map((item) => ({ ...item })),
      up_cancel: { before_end_sec: SE_DEFAULT_CANCEL_ALL_REMAINING_SEC, formula: '' },
      down_cancel: { before_end_sec: SE_DEFAULT_CANCEL_ALL_REMAINING_SEC, formula: '' }
    };
    _seConfigCurrent = {
      ..._seConfigDefaults,
      ladder_prices: [..._seConfigDefaults.ladder_prices],
      up_ladder: _seConfigDefaults.up_ladder.map((item) => ({ ...item })),
      down_ladder: _seConfigDefaults.down_ladder.map((item) => ({ ...item })),
      up_cancel: { ..._seConfigDefaults.up_cancel },
      down_cancel: { ..._seConfigDefaults.down_cancel }
    };
    _seParamActiveTab = 'up';
    se_renderParams(_seConfigCurrent);
    se_setParamFeedback(`读取参数失败: ${e.message}`, '#ff8a80');
  }
}

function se_cloneLadderRows(rows = []) {
  return rows.map((item) => ({
    price: Number(item.price),
    size: Number(item.size),
    tp_price: Number(item.tp_price)
  }));
}

function se_normalizeLadderRows(rows = [], fallbackRows = SE_DEFAULT_LADDER_ROWS) {
  const source = Array.isArray(rows) && rows.length > 0 ? rows : fallbackRows;
  const normalized = source.map((item) => {
    const price = Number(item?.price);
    const size = Number(item?.size);
    const tpPriceRaw = item?.tp_price;
    const tpPrice = tpPriceRaw === undefined || tpPriceRaw === null || tpPriceRaw === '' ? 1 : Number(tpPriceRaw);
    if (!Number.isFinite(price) || !Number.isFinite(size) || !Number.isFinite(tpPrice)) return null;
    return { price, size, tp_price: tpPrice };
  }).filter(Boolean);
  return normalized.length > 0 ? normalized : se_cloneLadderRows(fallbackRows);
}

function se_normalizeCancelConfig(value = {}, fallbackBeforeEndSec = SE_DEFAULT_CANCEL_ALL_REMAINING_SEC) {
  const beforeEndSec = Number.isInteger(Number(value?.before_end_sec))
    ? Number(value.before_end_sec)
    : fallbackBeforeEndSec;
  const formula = typeof value?.formula === 'string' ? value.formula : '';
  return {
    before_end_sec: beforeEndSec,
    formula
  };
}

function se_setTabButtonState() {
  const upBtn = document.getElementById('se-param-tab-up');
  const downBtn = document.getElementById('se-param-tab-down');
  if (upBtn) {
    const active = _seParamActiveTab === 'up';
    upBtn.style.background = active ? '#1d3a28' : '#1a2330';
    upBtn.style.color = active ? '#c8ffd8' : '#aab8c8';
    upBtn.style.borderColor = active ? '#2f6a47' : '#35506b';
  }
  if (downBtn) {
    const active = _seParamActiveTab === 'down';
    downBtn.style.background = active ? '#3a2a1d' : '#1a2330';
    downBtn.style.color = active ? '#ffd7b5' : '#aab8c8';
    downBtn.style.borderColor = active ? '#6c4e2a' : '#35506b';
  }
}

function se_syncActiveTabFromForm() {
  if (!_seParamDraft) return;
  const rows = [];
  let index = 0;
  while (true) {
    const priceEl = document.getElementById(`param_${_seParamActiveTab}_price_${index}`);
    const sizeEl = document.getElementById(`param_${_seParamActiveTab}_size_${index}`);
    const tpEl = document.getElementById(`param_${_seParamActiveTab}_tp_${index}`);
    if (!priceEl || !sizeEl || !tpEl) break;
    rows.push({
      price: Number(priceEl.value),
      size: Number(sizeEl.value),
      tp_price: Number(tpEl.value)
    });
    index += 1;
  }
  if (rows.length > 0) _seParamDraft[`${_seParamActiveTab}_ladder`] = rows;
  const beforeEndEl = document.getElementById('param_direction_before_end_sec');
  const formulaEl = document.getElementById('param_direction_formula');
  if (beforeEndEl && formulaEl) {
    _seParamDraft[`${_seParamActiveTab}_cancel`] = {
      before_end_sec: Number(beforeEndEl.value),
      formula: String(formulaEl.value || '')
    };
  }
}

function se_renderActiveTabPanel() {
  if (!_seParamDraft) return;
  se_setTabButtonState();
  const directionLabel = _seParamActiveTab === 'up' ? 'UP' : 'DOWN';
  const rowsContainer = document.getElementById('se-ladder-rows');
  const title = document.getElementById('se-ladder-title');
  const cancelTitle = document.getElementById('se-cancel-title');
  if (title) title.textContent = `${directionLabel}挂单档位`;
  if (cancelTitle) cancelTitle.textContent = `${directionLabel}撤单条件`;
  if (rowsContainer) {
    const ladderRows = _seParamDraft[`${_seParamActiveTab}_ladder`] || [];
    rowsContainer.innerHTML = ladderRows.map((_, index) => `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px;">
        <input type="number" step="0.001" id="param_${_seParamActiveTab}_price_${index}" style="background:#1e1e1e; border:1px solid #555; color:#fff; padding:6px; border-radius:4px; width:100%; box-sizing:border-box;">
        <input type="number" step="0.001" id="param_${_seParamActiveTab}_size_${index}" style="background:#1e1e1e; border:1px solid #555; color:#fff; padding:6px; border-radius:4px; width:100%; box-sizing:border-box;">
        <input type="number" step="0.001" id="param_${_seParamActiveTab}_tp_${index}" style="background:#1e1e1e; border:1px solid #555; color:#fff; padding:6px; border-radius:4px; width:100%; box-sizing:border-box;">
        <button onclick="se_removeLadderRow(${index})" style="background:#3a1f1f;color:#ffb3b3;border:1px solid #6a2f2f;border-radius:4px;padding:0 8px;cursor:pointer;">删</button>
      </div>
    `).join('');
    ladderRows.forEach((row, index) => {
      const priceEl = document.getElementById(`param_${_seParamActiveTab}_price_${index}`);
      const sizeEl = document.getElementById(`param_${_seParamActiveTab}_size_${index}`);
      const tpEl = document.getElementById(`param_${_seParamActiveTab}_tp_${index}`);
      if (priceEl) priceEl.value = row.price;
      if (sizeEl) sizeEl.value = row.size;
      if (tpEl) tpEl.value = row.tp_price;
    });
  }
  const cancelConfig = _seParamDraft[`${_seParamActiveTab}_cancel`] || { before_end_sec: 0, formula: '' };
  const beforeEndEl = document.getElementById('param_direction_before_end_sec');
  const formulaEl = document.getElementById('param_direction_formula');
  if (beforeEndEl) beforeEndEl.value = cancelConfig.before_end_sec;
  if (formulaEl) formulaEl.value = cancelConfig.formula;
}

function se_switchParamTab(tab) {
  if (tab !== 'up' && tab !== 'down') return;
  if (!_seParamDraft) return;
  se_syncActiveTabFromForm();
  _seParamActiveTab = tab;
  se_renderActiveTabPanel();
}

function se_addLadderRow() {
  if (!_seParamDraft) return;
  se_syncActiveTabFromForm();
  const key = `${_seParamActiveTab}_ladder`;
  const rows = _seParamDraft[key] || [];
  const last = rows[rows.length - 1] || { price: 0.2, size: 1, tp_price: 1 };
  rows.push({ price: Number(last.price), size: Number(last.size), tp_price: 1 });
  _seParamDraft[key] = rows;
  se_renderActiveTabPanel();
}

function se_removeLadderRow(index) {
  if (!_seParamDraft) return;
  se_syncActiveTabFromForm();
  const key = `${_seParamActiveTab}_ladder`;
  const rows = _seParamDraft[key] || [];
  if (rows.length <= 1) {
    se_setParamFeedback('每个方向至少保留 1 档', '#ffb74d');
    return;
  }
  rows.splice(index, 1);
  _seParamDraft[key] = rows;
  se_renderActiveTabPanel();
}

function se_renderParams(params) {
  _seParamDraft = {
    open_delay_sec: Number(params.open_delay_sec),
    ladder_prices: Array.isArray(params.ladder_prices) ? params.ladder_prices.map((item) => Number(item)) : [...SE_DEFAULT_LADDER_PRICES],
    ladder_size: Number(params.ladder_size),
    atr_multiple: Number(params.atr_multiple),
    cancel_all_remaining_sec: Number(params.cancel_all_remaining_sec),
    up_ladder: se_normalizeLadderRows(params.up_ladder),
    down_ladder: se_normalizeLadderRows(params.down_ladder),
    up_cancel: se_normalizeCancelConfig(params.up_cancel, Number(params.cancel_all_remaining_sec)),
    down_cancel: se_normalizeCancelConfig(params.down_cancel, Number(params.cancel_all_remaining_sec))
  };
  document.getElementById('param_open_delay_sec').value = params.open_delay_sec;
  se_renderActiveTabPanel();
}

function se_toggleParamsPanel(forceOpen = null) {
  const panel = document.getElementById('se-param-collapse');
  if (!panel) return;
  const open = forceOpen === null ? panel.style.display === 'none' : forceOpen;
  panel.style.display = open ? 'block' : 'none';
  panel.dataset.open = open ? '1' : '0';
}

function se_restoreDefaultParams() {
  if (!_seConfigDefaults) return;
  se_renderParams(_seConfigDefaults);
  se_setParamFeedback('已恢复默认值（未保存）', '#ffb74d');
}

async function se_saveParams() {
  try {
    const params = se_readParamsFromForm();
    const validationError = se_validateParams(params);
    if (validationError) {
      se_setParamFeedback(validationError, '#ff8a80');
      return;
    }
    se_setParamFeedback('保存参数中...', '#9fd3ff');
    const resp = await fetch(`${BASE_URL}/bot/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    const data = await resp.json();
    if (!resp.ok || data?.ok === false) {
      throw new Error(data?.error || `HTTP ${resp.status}`);
    }
    _seConfigCurrent = se_pickBotConfig(data.current || params);
    _seConfigDefaults = data.defaults ? se_pickBotConfig(data.defaults) : _seConfigDefaults;
    se_renderParams(_seConfigCurrent);
    se_setParamFeedback('参数保存成功', '#8bc34a');
  } catch (e) {
    se_setParamFeedback(`保存参数失败: ${e.message}`, '#ff8a80');
  }
}

function se_pickBotConfig(input = {}) {
  const picked = {};
  for (const key of BOT_CONFIG_FIELDS) picked[key] = input[key];
  const ladderPrices = Array.isArray(picked.ladder_prices) ? picked.ladder_prices.map((item) => Number(item)) : [...SE_DEFAULT_LADDER_PRICES];
  const ladderSize = Number(picked.ladder_size ?? SE_DEFAULT_LADDER_SIZE);
  const fallbackRows = ladderPrices.map((price) => ({ price, size: ladderSize, tp_price: 1 }));
  const cancelFallback = Number(picked.cancel_all_remaining_sec ?? SE_DEFAULT_CANCEL_ALL_REMAINING_SEC);
  return {
    open_delay_sec: Number(picked.open_delay_sec ?? SE_DEFAULT_OPEN_DELAY_SEC),
    ladder_prices: ladderPrices,
    ladder_size: ladderSize,
    atr_multiple: Number(picked.atr_multiple ?? SE_DEFAULT_ATR_MULTIPLE),
    cancel_all_remaining_sec: cancelFallback,
    up_ladder: se_normalizeLadderRows(picked.up_ladder, fallbackRows),
    down_ladder: se_normalizeLadderRows(picked.down_ladder, fallbackRows),
    up_cancel: se_normalizeCancelConfig(picked.up_cancel, cancelFallback),
    down_cancel: se_normalizeCancelConfig(picked.down_cancel, cancelFallback)
  };
}

function se_readParamsFromForm() {
  se_syncActiveTabFromForm();
  const openDelaySec = Number(document.getElementById('param_open_delay_sec').value);
  const current = _seParamDraft || _seConfigCurrent || se_pickBotConfig({});
  return {
    open_delay_sec: openDelaySec,
    ladder_prices: Array.isArray(current.ladder_prices) ? current.ladder_prices.map((item) => Number(item)) : [...SE_DEFAULT_LADDER_PRICES],
    ladder_size: Number(current.ladder_size),
    atr_multiple: Number(current.atr_multiple),
    cancel_all_remaining_sec: Number(current.cancel_all_remaining_sec),
    up_ladder: se_cloneLadderRows(current.up_ladder || []),
    down_ladder: se_cloneLadderRows(current.down_ladder || []),
    up_cancel: {
      before_end_sec: Number(current.up_cancel?.before_end_sec),
      formula: String(current.up_cancel?.formula || '')
    },
    down_cancel: {
      before_end_sec: Number(current.down_cancel?.before_end_sec),
      formula: String(current.down_cancel?.formula || '')
    }
  };
}

function se_validateParams(params) {
  if (!Number.isInteger(params.open_delay_sec) || params.open_delay_sec < 0) return 'open_delay_sec 必须为非负整数';
  if (!Array.isArray(params.up_ladder) || params.up_ladder.length < 1) return 'up_ladder 至少保留 1 档';
  if (!Array.isArray(params.down_ladder) || params.down_ladder.length < 1) return 'down_ladder 至少保留 1 档';
  const invalidUp = params.up_ladder.some((item) => !Number.isFinite(item.price) || item.price <= 0 || item.price >= 1 || !Number.isFinite(item.size) || item.size <= 0 || !Number.isFinite(item.tp_price) || item.tp_price <= 0 || item.tp_price > 1);
  if (invalidUp) return 'up_ladder 每档需满足 0 < price < 1、0 < tp_price <= 1 且 size > 0';
  const invalidDown = params.down_ladder.some((item) => !Number.isFinite(item.price) || item.price <= 0 || item.price >= 1 || !Number.isFinite(item.size) || item.size <= 0 || !Number.isFinite(item.tp_price) || item.tp_price <= 0 || item.tp_price > 1);
  if (invalidDown) return 'down_ladder 每档需满足 0 < price < 1、0 < tp_price <= 1 且 size > 0';
  if (!Number.isInteger(params.up_cancel.before_end_sec) || params.up_cancel.before_end_sec < 0) return 'up_cancel.before_end_sec 必须为非负整数';
  if (!Number.isInteger(params.down_cancel.before_end_sec) || params.down_cancel.before_end_sec < 0) return 'down_cancel.before_end_sec 必须为非负整数';
  if (params.up_cancel.formula.length > 240) return 'up_cancel.formula 长度不能超过 240';
  if (params.down_cancel.formula.length > 240) return 'down_cancel.formula 长度不能超过 240';
  if (!Number.isInteger(params.cancel_all_remaining_sec) || params.cancel_all_remaining_sec < 0) return 'cancel_all_remaining_sec 必须为非负整数';
  if (!Number.isInteger(params.ladder_size) || params.ladder_size <= 0) return 'ladder_size 必须为正整数';
  if (!Number.isFinite(params.atr_multiple) || params.atr_multiple <= 0) return 'atr_multiple 必须为正数';
  if (!Array.isArray(params.ladder_prices) || params.ladder_prices.length < 1) return 'ladder_prices 至少保留 1 个数值';
  if (params.ladder_prices.some((item) => !Number.isFinite(item) || item <= 0 || item >= 1)) return 'ladder_prices 每项必须满足 0 < p < 1';
  return null;
}

function se_setParamFeedback(message, color = '#ff8a80') {
  const el = document.getElementById('se-param-feedback');
  if (!el) return;
  el.style.color = color;
  el.textContent = message || '';
}

// ── 以下为原有逻辑 ──────────────────────────────────────────────────────────

// 部署 / 停止
async function se_startBot() {
  if (_se_running || _seActionPending) return;
  _seActionPending = true;
  se_updateRunningUI(_se_running);
  se_renderPollError('Start 请求中...');
  try {
    const res = await fetch(`${BASE_URL}/bot/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tick_interval_ms: 1000 })
    });
    const data = await res.json();
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    _se_running = data?.running === true;
    se_updateRunningUI(_se_running);
    se_renderPollError(_se_running ? null : 'Start 已返回，但运行态未就绪');
    se_appendLog('SYSTEM', 'Bot Start 请求成功');
    await se_poll();
  } catch (err) {
    se_renderPollError(`Start 失败: ${err.message}`);
    se_appendLog('ERROR', `Start 失败: ${err.message}`);
  } finally {
    _seActionPending = false;
    se_updateRunningUI(_se_running);
  }
}

async function se_stopBot() {
  if (!_se_running || _seActionPending) return;
  _seActionPending = true;
  se_updateRunningUI(_se_running);
  se_renderPollError('Stop 请求中...');
  try {
    const res = await fetch(`${BASE_URL}/bot/stop`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    _se_running = data?.running === true;
    se_updateRunningUI(_se_running);
    se_renderPollError(_se_running ? 'Stop 已返回，但仍在运行' : null);
    se_appendLog('SYSTEM', 'Bot Stop 请求成功');
    await se_poll();
  } catch (err) {
    se_renderPollError(`Stop 失败: ${err.message}`);
    se_appendLog('ERROR', `Stop 失败: ${err.message}`);
  } finally {
    _seActionPending = false;
    se_updateRunningUI(_se_running);
  }
}

async function se_toggleBotRun() {
  if (_seActionPending) return;
  if (_se_running) {
    await se_stopBot();
    return;
  }
  await se_startBot();
}

function se_updateRunningUI(running) {
  const runBtn = document.getElementById('se-btn-run-toggle');
  const dot = document.getElementById('se-status-dot');
  const label = document.getElementById('se-status-label');
  if (runBtn) {
    runBtn.disabled = _seActionPending;
    runBtn.textContent = _seActionPending ? (running ? '停止中...' : '启动中...') : (running ? '停止' : '启动');
    runBtn.style.background = running ? '#7a3a3a' : '#10b981';
    runBtn.style.border = running ? '1px solid #9a4b4b' : 'none';
    runBtn.style.color = '#fff';
  }
  if (dot) dot.className = running ? 'se-dot se-dot-on' : 'se-dot se-dot-off';
  if (label) label.textContent = running ? '运行中' : '已停止';
}

function se_updateTestButton() {
  const btn = document.getElementById('se-btn-test');
  if (!btn) return;
  const running = _seTestStatus?.state === 'running';
  btn.disabled = false;
  const label = _seTestStatus?.module_label || '版本测试';
  btn.textContent = running ? `${label} 测试中...` : (_seTestRunPending ? '启动中...' : '版本测试入口');
}

function se_renderTestPanel() {
  const container = document.getElementById('se-test-panel-content');
  if (!container) return;
  const running = _seTestStatus?.state === 'running';
  const statusLabel = running
    ? `运行中：${_seTestStatus?.module_label || '未知模块'}`
    : `当前状态：${se_formatStateValue(_seTestStatus?.state || 'idle')}`;
  const rows = SE_TEST_MODULES.map((item) => {
    const active = item.key === _seTestSelectedModuleKey;
    const style = active
      ? 'border:1px solid #3f6fa1;background:#1b2b3a;color:#d7ecff;'
      : 'border:1px solid #3a4553;background:#121923;color:#c8d3de;';
    return `
      <button
        id="se-test-module-${item.key}"
        onclick="se_runVersionTestByModule('${item.key}')"
        style="text-align:left;padding:8px 10px;border-radius:6px;cursor:pointer;${style}"
      >${item.label}</button>
      <div style="font-size:11px;color:#8ea0b3;margin:-4px 0 6px 2px;">${item.hint}</div>
    `;
  }).join('');
  container.innerHTML = `
    <div style="font-size:12px;color:#9fb2c4;">${statusLabel}</div>
    <div style="display:flex;flex-direction:column;gap:2px;">${rows}</div>
  `;
}

function se_openTestPanel() {
  const overlay = document.getElementById('se-test-panel-overlay');
  if (!overlay) return;
  se_renderTestPanel();
  overlay.style.display = 'flex';
}

function se_closeTestPanel() {
  const overlay = document.getElementById('se-test-panel-overlay');
  if (overlay) overlay.style.display = 'none';
}

function se_makeTestTaskId() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yy}${mm}${dd}_${hh}${mi}${ss}`;
}

async function se_runVersionTestByModule(moduleKey = 'allchain') {
  if (_seTestRunPending || _seTestStatus?.state === 'running') return;
  _seTestSelectedModuleKey = moduleKey;
  _seTestRunPending = true;
  _seTestUserTriggered = true;
  _seTestRecoveredRunning = false;
  _seTestLastRunId = null;
  _seTestLastResultFile = null;
  se_updateTestButton();
  se_renderTestPanel();
  try {
    const taskId = se_makeTestTaskId();
    const res = await fetch(`${BASE_URL}/bot/test/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId, module_key: moduleKey })
    });
    const data = await res.json();
    if (!res.ok && data?.already_running !== true) {
      _seTestUserTriggered = false;
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    if (data?.already_running === true) {
      _seTestUserTriggered = false;
      se_appendLog('SYSTEM', '版本测试重复启动被阻止');
      alert('版本测试已在运行中，请等待完成后再试。');
      return;
    }
    const moduleLabel = data?.status?.module_label || SE_TEST_MODULES.find((item) => item.key === moduleKey)?.label || moduleKey;
    se_appendLog('SYSTEM', `模块测试已启动 module=${moduleLabel} task_id=${taskId}`);
    await se_pollTestRunner();
  } catch (err) {
    _seTestUserTriggered = false;
    se_appendLog('ERROR', `模块测试启动失败: ${err.message}`);
    alert(`模块测试启动失败: ${err.message}`);
  } finally {
    _seTestRunPending = false;
    se_updateTestButton();
    se_renderTestPanel();
  }
}

function se_showTestResultModal(resultPayload) {
  const result = resultPayload?.result && typeof resultPayload.result === 'object'
    ? resultPayload.result
    : (resultPayload && typeof resultPayload === 'object' ? resultPayload : null);
  if (!result) return;
  const runId = _seTestStatus?.run_id || _seTestStatus?.result_file || `${result.task_id || 'unknown'}:${result.generated_at || ''}`;
  if (_seTestFailModalShownRunId === runId) return;
  const failed = Array.isArray(result.results) ? result.results.filter((item) => item?.pass !== true) : [];
  const overlay = document.getElementById('se-test-result-overlay');
  const title = document.getElementById('se-test-result-title');
  const content = document.getElementById('se-test-result-content');
  if (!overlay || !title || !content) return;
  const summary = [
    `module=${se_formatStateValue(_seTestStatus?.module_label || result?.module_key || _seTestSelectedModuleKey)}`,
    `total=${se_formatStateValue(result.total_scripts)}`,
    `pass=${se_formatStateValue(result.pass_count)}`,
    `fail=${se_formatStateValue(result.fail_count)}`,
    `overall=${se_formatStateValue(result.overall_pass)}`
  ].join(' | ');
  const logTail = _seTestLogTail.slice(-20).join('\n');
  if (result.overall_pass === true) {
    title.textContent = '模块测试通过';
    content.textContent = [
      summary,
      '',
      '通过摘要：',
      '所有脚本均通过校验。'
    ].join('\n');
  } else {
    const detail = failed.map((item, idx) => {
      const name = item?.script_name || `script_${idx + 1}`;
      const message = item?.message || '无 message';
      return `${idx + 1}. ${name}\n   ${message}`;
    }).join('\n');
    title.textContent = '模块测试失败';
    content.textContent = [
      summary,
      '',
      '失败项：',
      detail || '无',
      '',
      '日志摘要（最近20行）：',
      logTail || '暂无'
    ].join('\n');
  }
  overlay.style.display = 'flex';
  _seTestFailModalShownRunId = runId;
}

function se_closeTestResultModal() {
  const overlay = document.getElementById('se-test-result-overlay');
  if (overlay) overlay.style.display = 'none';
}

function se_renderModuleInfo() {
  const container = document.getElementById('se-module-info-content');
  if (!container) return;
  container.innerHTML = SE_MODULE_INFO.map((item) => `
    <section style="border:1px solid #2a3440;border-radius:6px;padding:8px;background:#10161d;">
      <div style="font-size:13px;color:#d6dde5;font-weight:600;margin-bottom:4px;">${item.name}</div>
      <div style="font-size:12px;color:#a9b5c2;">职责：${item.duty}</div>
      <div style="font-size:12px;color:#a9b5c2;">主要输入：${item.input}</div>
      <div style="font-size:12px;color:#a9b5c2;">主要输出/对外面：${item.output}</div>
    </section>
  `).join('');
}

function se_openModuleInfo() {
  const overlay = document.getElementById('se-module-info-overlay');
  if (overlay) overlay.style.display = 'flex';
}

function se_closeModuleInfo() {
  const overlay = document.getElementById('se-module-info-overlay');
  if (overlay) overlay.style.display = 'none';
}

// 保存 / 周期切换
async function se_save() {
  const code = document.getElementById('se-editor').value;
  localStorage.setItem('se_code', code);  // 保留 localStorage 作为备份
  try {
    await fetch(`${BASE_URL}/strategy-runner/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
  } catch (_) {}
  // 视觉反馈：按钮短暂变色
  const btn = (typeof event !== 'undefined' && event?.target) ? event.target : null;
  const orig = btn ? btn.textContent : '';
  if (btn) btn.textContent = '已保存 ✓';
  setTimeout(() => { if (btn) btn.textContent = orig; }, 1500);
}

function se_setPeriod(period) {
  _se_period = period;
  document.getElementById('se-btn-5m').classList.toggle('se-period-active', period === '5m');
  document.getElementById('se-btn-15m').classList.toggle('se-period-active', period === '15m');
}

// 轮询（每 2 秒）
function se_startPoll() {
  if (_se_pollTimer) return;
  _se_pollTimer = setInterval(se_poll, 2000);
  se_poll(); // 立即拉一次
}

function se_stopPoll() {
  if (_se_pollTimer) { clearInterval(_se_pollTimer); _se_pollTimer = null; }
}

async function se_pollTestRunner() {
  try {
    const statusRes = await fetch(`${BASE_URL}/bot/test/status`);
    const statusData = await statusRes.json();
    const status = statusData && typeof statusData === 'object' ? statusData : { state: 'idle' };
    _seTestStatus = status;
    if (typeof status?.module_key === 'string' && status.module_key) {
      _seTestSelectedModuleKey = status.module_key;
    }
    if (status.state === 'running') _seTestRecoveredRunning = true;
    se_updateTestButton();
    se_renderTestPanel();
    const logsRes = await fetch(`${BASE_URL}/bot/test/logs?limit=120`);
    const logsData = await logsRes.json();
    _seTestLogTail = Array.isArray(logsData?.lines) ? logsData.lines.slice(-80) : [];
    const terminal = status.state === 'passed' || status.state === 'failed';
    if (!terminal) return;
    const allowModal = _seTestUserTriggered || _seTestRecoveredRunning;
    if (!allowModal) return;
    const resultQuery = new URLSearchParams();
    if (status?.run_id) resultQuery.set('run_id', status.run_id);
    if (status?.module_key) resultQuery.set('module_key', status.module_key);
    const resultUrl = `${BASE_URL}/bot/test/result${resultQuery.toString() ? `?${resultQuery.toString()}` : ''}`;
    if ((status.run_id && status.run_id !== _seTestLastRunId) || (status.result_file && status.result_file !== _seTestLastResultFile)) {
      _seTestLastResultFile = status.result_file;
      _seTestLastRunId = status.run_id || null;
      const resultRes = await fetch(resultUrl);
      const resultData = await resultRes.json();
      if (resultRes.ok && resultData?.ok !== false) {
        se_showTestResultModal(resultData);
      }
      _seTestUserTriggered = false;
      _seTestRecoveredRunning = false;
      return;
    }
    if (!status.result_file) return;
    const resultRes = await fetch(resultUrl);
    const resultData = await resultRes.json();
    if (resultRes.ok && resultData?.ok !== false) {
      se_showTestResultModal(resultData);
    }
    _seTestUserTriggered = false;
    _seTestRecoveredRunning = false;
  } catch (err) {
    se_appendLog('ERROR', `测试接口异常: ${err.message}`);
  }
}

async function se_poll() {
  try {
    const [statusRes, logsRes, ordersRes, summaryRes] = await Promise.all([
      fetch(`${BASE_URL}/bot/status`),
      fetch(`${BASE_URL}/bot/logs?limit=200`),
      fetch(`${BASE_URL}/bot/orders`),
      fetch(`${BASE_URL}/bot/paper/summary`)
    ]);
    const status = await statusRes.json();
    const logsData = await logsRes.json();
    const ordersData = await ordersRes.json();
    const summaryData = await summaryRes.json();
    let contextData = {};
    let previewData = null;
    let postmortemData = null;
    let performanceData = null;
    let accountData = null;
    let previewError = null;
    try {
      const contextRes = await fetch(`${BASE_URL}/bot/context`);
      contextData = await contextRes.json();
      if (!contextRes.ok) throw new Error(contextData?.error || `context HTTP ${contextRes.status}`);
    } catch (err) {
      contextData = {};
      previewError = err.message;
    }
    try {
      const previewRes = await fetch(`${BASE_URL}/bot/decision-preview`);
      previewData = await previewRes.json();
      if (!previewRes.ok) throw new Error(previewData?.error || `decision-preview HTTP ${previewRes.status}`);
    } catch (err) {
      previewData = null;
      previewError = previewError || err.message;
    }
    try {
      const postmortemRes = await fetch(`${BASE_URL}/bot/postmortem/latest`);
      postmortemData = await postmortemRes.json();
      if (!postmortemRes.ok || postmortemData?.ok === false) throw new Error(postmortemData?.error || `postmortem HTTP ${postmortemRes.status}`);
    } catch (err) {
      postmortemData = null;
      previewError = previewError || err.message;
    }
    try {
      const perfRes = await fetch(`${BASE_URL}/bot/performance/summary?preset=${encodeURIComponent(_sePerformancePreset)}&detail=1`);
      performanceData = await perfRes.json();
      if (!perfRes.ok || performanceData?.ok === false) throw new Error(performanceData?.error || `performance HTTP ${perfRes.status}`);
    } catch (err) {
      performanceData = null;
      previewError = previewError || err.message;
    }
    try {
      const accountRes = await fetch(`${BASE_URL}/bot/account`);
      accountData = await accountRes.json();
      if (!accountRes.ok || accountData?.ok === false) throw new Error(accountData?.error || `account HTTP ${accountRes.status}`);
    } catch (err) {
      accountData = null;
    }
    se_renderContext(contextData, status, ordersData);
    se_renderOverview(status, summaryData, ordersData, postmortemData);
    se_renderPerformance(performanceData, status);
    se_renderPmAccountInfo(accountData?.account || null);
    se_renderDecision(status, contextData, previewData, ordersData, previewError);
    se_renderLogs(Array.isArray(logsData) ? logsData : (logsData.logs || []));
    se_renderOrders(ordersData, status);
    await se_pollTestRunner();

    const remaining = status?.remaining_sec ?? null;
    const el = document.getElementById('se-countdown');
    if (el) {
      if (remaining != null) {
        const m = Math.floor(remaining / 60);
        const s = remaining % 60;
        el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      } else {
        el.textContent = '--:--';
      }
    }

    // 延迟显示
    const latEl = document.getElementById('se-latency');
    if (latEl) {
      latEl.textContent = '';
    }

    // 如果服务端显示已停止，同步前端状态
    _se_running = status?.running === true;
    se_updateRunningUI(_se_running);
    _seLastPollError = null;
    se_renderPollError(null);
  } catch (err) {
    console.warn('[se] poll error:', err.message);
    _seLastPollError = err.message;
    se_renderPollError(err.message);
  }
}

async function se_applyPaperAction(action) {
  try {
    const res = await fetch(`${BASE_URL}/bot/paper/apply-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      alert('动作执行失败: ' + (data.error || res.status));
      return;
    }
    se_renderOrders({ orders: data.orders, summary: data.summary }, null);
  } catch (err) {
    alert('动作执行失败: ' + err.message);
  }
}

function se_setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = se_formatStateValue(value);
}

function se_formatWindowDisplayName(windowId) {
  const raw = windowId == null ? '' : String(windowId).trim();
  if (!raw) return 'N/A (null)';
  const match = raw.match(/-(\d+)m-(\d{10})$/);
  if (!match) return raw;
  const minutes = Number(match[1]);
  const startSec = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(startSec) || minutes <= 0) return raw;
  const start = new Date(startSec * 1000);
  const end = new Date((startSec + minutes * 60) * 1000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return raw;
  const tz = 'America/New_York';
  const dateText = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'long',
    day: 'numeric'
  }).format(start);
  const timeParts = (date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).formatToParts(date);
    const obj = {};
    for (const p of parts) obj[p.type] = p.value;
    return {
      hour: obj.hour || '',
      minute: obj.minute || '00',
      dayPeriod: String(obj.dayPeriod || '').toUpperCase()
    };
  };
  const startParts = timeParts(start);
  const endParts = timeParts(end);
  const endClock = endParts.minute === '00' ? endParts.hour : `${endParts.hour}:${endParts.minute}`;
  const startClock = `${startParts.hour}:${startParts.minute}`;
  const range = startParts.dayPeriod === endParts.dayPeriod
    ? `${startClock}-${endClock}${endParts.dayPeriod}`
    : `${startClock}${startParts.dayPeriod}-${endClock}${endParts.dayPeriod}`;
  return `${dateText}, ${range} ET`;
}

function se_renderPmAccountInfo(account) {
  const pickNumber = (...values) => {
    for (const value of values) {
      const num = Number(value);
      if (Number.isFinite(num)) return num;
    }
    return null;
  };
  const pickString = (...values) => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
    return null;
  };
  const accountName = pickString(
    account?.pm_account_name
  );
  const balanceUsd = pickNumber(
    account?.pm_balance_usd
  );
  const todayChange = pickNumber(account?.pm_balance_change_today_usd);
  const balanceText = balanceUsd == null ? '--' : balanceUsd.toFixed(2);
  const todayText = todayChange == null ? '--' : `${todayChange >= 0 ? '+' : ''}${todayChange.toFixed(2)}`;
  const accountEl = document.getElementById('se-pm-account-name');
  const balanceEl = document.getElementById('se-pm-account-balance');
  if (accountEl) accountEl.textContent = `PM账号名：${accountName || '--'}`;
  if (balanceEl) balanceEl.textContent = `余额：${balanceText}美元（今日${todayText}）`;
}

function se_renderDecision(status, context, preview, ordersData, previewError) {
  const previewIntentsSummary = preview?.intents_summary
    || (Array.isArray(preview?.intents)
      ? preview.intents.map((intent) => {
        if (!intent || typeof intent !== 'object') return 'UNKNOWN';
        if (intent.kind === 'NOOP') return 'NOOP';
        if (intent.kind === 'PLACE_LADDER') return `PLACE_LADDER(${se_formatStateValue(intent.side)}|${se_formatStateValue(intent.prices)}|size=${se_formatStateValue(intent.size)})`;
        if (intent.kind === 'CANCEL_OPEN') return `CANCEL_OPEN(${se_formatStateValue(intent.side)})`;
        return se_formatStateValue(intent.kind);
      }).join(' + ')
      : null);
  const isRunning = status?.running === true;
  const isNoop = previewIntentsSummary === 'NOOP' || (Array.isArray(preview?.intents) && preview.intents.length === 1 && preview.intents[0]?.kind === 'NOOP');
  const previewState = !isRunning
    ? 'EMPTY'
    : (previewError ? 'EMPTY' : (isNoop ? 'NOOP' : (previewIntentsSummary ? 'ACTION' : 'EMPTY')));
  const diagnostics = preview?.diagnostics && typeof preview.diagnostics === 'object' ? preview.diagnostics : {};
  const ordersSummary = ordersData?.summary || {};
  const basisSummary = [
    `phase=${se_formatStateValue(status?.phase)}`,
    `window=${se_formatStateValue(status?.current_window_id)}`,
    `ladder_posted=${se_formatStateValue(diagnostics.ladder_posted)}`,
    `orders_open=${se_formatStateValue(ordersSummary.open_total)}`
  ].join(' | ');
  se_setText('se-preview-state', previewState);
  se_setText('se-preview-intents', previewState === 'EMPTY'
    ? '当前无有效 preview'
    : (isNoop ? '当前无动作（NOOP）' : previewIntentsSummary));
  se_setText('se-preview-reason', previewState === 'EMPTY'
    ? (previewError || 'N/A (null)')
    : preview?.reason);
  se_setText('se-preview-context', [
    `btc=${se_formatStateValue(context?.btc_price)}`,
    `anchor=${se_formatStateValue(context?.anchor_btc ?? status?.anchor_btc)}`,
    `remaining=${se_formatStateValue(context?.remaining_sec ?? status?.remaining_sec)}`
  ].join(' | '));
  se_setText('se-preview-diag', basisSummary);
  if (!isRunning) return;
}

function se_renderContext(context, status, orders) {
  const running = status?.running === true;
  const toFinite = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };
  const formatFixed1 = (value, emptyText = '—') => {
    const num = toFinite(value);
    return num === null ? emptyText : num.toFixed(1);
  };
  const formatFixed3 = (value, emptyText = '—') => {
    const num = toFinite(value);
    return num === null ? emptyText : num.toFixed(3);
  };
  const scopedContext = orders?.context_snapshot && typeof orders.context_snapshot === 'object'
    ? orders.context_snapshot
    : context;
  const upProb = toFinite(scopedContext?.bid_yes ?? scopedContext?.ask_yes);
  const downProb = toFinite(scopedContext?.bid_no ?? scopedContext?.ask_no);
  const upDownText = (upProb !== null && downProb !== null)
    ? `UP ${formatFixed3(upProb)} / DOWN ${formatFixed3(downProb)}`
    : '—';
  se_setText('se-order-btc', formatFixed1(scopedContext?.btc_price));
  se_setText('se-order-updown-prob', upDownText);
  se_setText('se-order-volatility', formatFixed3(scopedContext?.atr_5m));
  if (!running) {
    se_setText('se-runtime-note', '当前未运行；启动后将显示关键执行状态。');
    return;
  }
  const toRuntimeValue = (value, emptyText) => (value === null || value === undefined || value === '') ? emptyText : value;
  se_setText('se-runtime-note', '运行中，关键执行状态实时刷新。');
}

function se_pickSummaryValue(summary, keys, fallback = null) {
  for (const key of keys) {
    if (summary && summary[key] !== undefined) return summary[key];
  }
  return fallback;
}

function se_renderOverview(status, summary, ordersData, postmortemPayload) {
  const mergedSummary = summary && typeof summary === 'object' ? summary : {};
  const yesEntry = se_pickSummaryValue(mergedSummary, ['yes_entry_filled_count', 'yes_filled_count'], 0);
  const yesExit = se_pickSummaryValue(mergedSummary, ['yes_exit_filled_count'], 0);
  const noEntry = se_pickSummaryValue(mergedSummary, ['no_entry_filled_count', 'no_filled_count'], 0);
  const noExit = se_pickSummaryValue(mergedSummary, ['no_exit_filled_count'], 0);
  const filledTotal = se_pickSummaryValue(mergedSummary, ['filled_total'], yesEntry + yesExit + noEntry + noExit);
  const realizedTotal = se_pickSummaryValue(mergedSummary, ['realized_gross_pnl_total'], null);
  const unrealizedTotal = se_pickSummaryValue(mergedSummary, ['unrealized_gross_pnl_total', 'total_unrealized_pnl'], null);
  const yesPos = se_pickSummaryValue(mergedSummary, ['yes_position_size'], null);
  const noPos = se_pickSummaryValue(mergedSummary, ['no_position_size'], null);
  const updatedAt = se_pickSummaryValue(mergedSummary, ['updated_at'], null);
  const yesUnreal = se_pickSummaryValue(mergedSummary, ['yes_unrealized_gross_pnl', 'yes_unrealized_pnl'], null);
  const noUnreal = se_pickSummaryValue(mergedSummary, ['no_unrealized_gross_pnl', 'no_unrealized_pnl'], null);

  se_setText('se-bot-running', status?.running);
  se_setText('se-bot-phase', status?.phase);
  se_setText('se-bot-debug', status?.debug_scenario);
  se_setText('se-summary-yes-position', yesPos);
  se_setText('se-summary-no-position', noPos);
  se_setText('se-summary-filled-total', filledTotal);
  se_setText('se-summary-realized-total', realizedTotal);
  se_setText('se-summary-unrealized-total', unrealizedTotal);
  se_setText('se-summary-updated-at', updatedAt);
  const savedConfig = status?.saved_config && typeof status.saved_config === 'object' ? status.saved_config : null;
  const activeRuntime = status?.active_runtime_snapshot && typeof status.active_runtime_snapshot === 'object'
    ? status.active_runtime_snapshot
    : null;
  const activeConfig = activeRuntime?.config && typeof activeRuntime.config === 'object' ? activeRuntime.config : null;
  const lastRun = status?.last_run_snapshot && typeof status.last_run_snapshot === 'object' ? status.last_run_snapshot : null;
  const lastActiveConfig = lastRun?.active_config && typeof lastRun.active_config === 'object' ? lastRun.active_config : null;
  const postmortem = postmortemPayload?.postmortem && typeof postmortemPayload.postmortem === 'object'
    ? postmortemPayload.postmortem
    : null;
  const stopReasonRaw = lastRun?.stop_reason || postmortem?.stop_reason || null;
  const stopReasonText = stopReasonRaw === 'AUTO_COMPLETED'
    ? '自动完成'
    : (stopReasonRaw === 'MANUAL_STOP' ? '手动停止' : (stopReasonRaw || '暂无'));
  se_setText('se-log-current-window', se_formatWindowDisplayName(postmortem?.window_id || lastRun?.current_window_id));
  const paramSummary = savedConfig
    ? `开盘等待 ${se_formatStateValue(savedConfig.open_delay_sec)} 秒 · 波动 ${se_formatStateValue(savedConfig.atr_multiple)} · 全撤 ${se_formatStateValue(savedConfig.cancel_all_remaining_sec)} 秒`
    : '参数尚未加载';
  se_setText('se-param-summary', paramSummary);
  se_setText('se-snapshot-note', activeRuntime
    ? `saved 与 active 可能不同：active.window=${se_formatStateValue(activeRuntime.current_window_id)}`
    : '当前未运行：仅展示 saved 参数，active runtime snapshot 为空');
  const lastActiveConfigText = lastActiveConfig
    ? `等待 ${se_formatStateValue(lastActiveConfig.open_delay_sec)} · 波动 ${se_formatStateValue(lastActiveConfig.atr_multiple)} · 全撤 ${se_formatStateValue(lastActiveConfig.cancel_all_remaining_sec)}`
    : 'N/A (null)';
  const completedAt = postmortem?.completed_at || lastRun?.completed_at;
  se_setText('se-prev-window', postmortem?.window_id || lastRun?.current_window_id);
  se_setText('se-prev-stop-reason', stopReasonText);
  se_setText('se-prev-completed-at', completedAt);
  se_setText('se-prev-filled-total', postmortem?.filled_total ?? lastRun?.filled_total);
  se_setText('se-prev-cancelled-total', postmortem?.cancelled_total ?? lastRun?.cancelled_total ?? 0);
  se_setText('se-prev-pnl', postmortem?.realized_gross_pnl_total ?? lastRun?.realized_gross_pnl_total);
  se_setText('se-prev-realized-total', postmortem?.realized_gross_pnl_total ?? lastRun?.realized_gross_pnl_total);
  se_setText('se-prev-action-summary', postmortem?.action_summary ?? 'N/A (null)');
  se_setText('se-prev-param-summary', lastActiveConfigText);
  se_setText('se-runtime-yes-position', yesPos);
  se_setText('se-runtime-no-position', noPos);
  se_setText('se-runtime-filled-total', filledTotal);
  se_setText('se-runtime-realized-total', realizedTotal);
  const lastActiveConfigDebugText = lastActiveConfig
    ? `open_delay=${se_formatStateValue(lastActiveConfig.open_delay_sec)} | prices=${se_formatStateValue(lastActiveConfig.ladder_prices)} | size=${se_formatStateValue(lastActiveConfig.ladder_size)} | atr=${se_formatStateValue(lastActiveConfig.atr_multiple)} | cancel=${se_formatStateValue(lastActiveConfig.cancel_all_remaining_sec)}`
    : 'N/A (null)';
  se_setText('se-last-active-config', lastActiveConfigDebugText);
  se_setText('se-last-stop-reason', stopReasonText);
  se_setText('se-last-completed-at', completedAt);
  se_setText('se-last-window-id', postmortem?.window_id || lastRun?.current_window_id);
  se_setText('se-last-phase', lastRun?.phase);
  se_setText('se-last-filled-total', postmortem?.filled_total ?? lastRun?.filled_total);
  se_setText('se-last-realized-total', postmortem?.realized_gross_pnl_total ?? lastRun?.realized_gross_pnl_total);
  se_setText('se-last-unrealized-total', postmortem?.unrealized_gross_pnl_total ?? lastRun?.unrealized_gross_pnl_total);
  se_setText('se-pm-window-id', postmortem?.window_id);
  se_setText('se-pm-stop-reason', stopReasonText);
  se_setText('se-pm-filled-total', postmortem?.filled_total);
  se_setText('se-pm-realized-total', postmortem?.realized_gross_pnl_total);
  se_setText('se-pm-unrealized-total', postmortem?.unrealized_gross_pnl_total);
  se_setText('se-pm-action-summary', postmortem?.action_summary);
  const toFinite = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };
  const summaryRealizedNum = toFinite(realizedTotal);
  const summaryUnrealizedNum = toFinite(unrealizedTotal);
  const postmortemRealizedNum = toFinite(postmortem?.realized_gross_pnl_total);
  const postmortemUnrealizedNum = toFinite(postmortem?.unrealized_gross_pnl_total);
  const pnlMatched = summaryRealizedNum !== null
    && summaryUnrealizedNum !== null
    && postmortemRealizedNum !== null
    && postmortemUnrealizedNum !== null
    && summaryRealizedNum === postmortemRealizedNum
    && summaryUnrealizedNum === postmortemUnrealizedNum;
  se_setText('se-pm-pnl-match', postmortem ? (pnlMatched ? 'MATCH' : 'MISMATCH') : 'N/A (null)');
  se_setText('se-pm-note', postmortem
    ? `UI pnl(realized=${se_formatStateValue(realizedTotal)}, unrealized=${se_formatStateValue(unrealizedTotal)}) vs postmortem pnl(realized=${se_formatStateValue(postmortem?.realized_gross_pnl_total)}, unrealized=${se_formatStateValue(postmortem?.unrealized_gross_pnl_total)})`
    : '当前无 postmortem 记录');
  se_setText('se-bot-state-tip', `YES upnl=${se_formatStateValue(yesUnreal)} | NO upnl=${se_formatStateValue(noUnreal)} | poll=${_seLastPollError ? 'error' : 'ok'}`);
}

function se_setPerformancePreset(preset, triggerPoll = true) {
  _sePerformancePreset = preset === 'last_7d' || preset === 'last_30_windows' ? preset : 'today';
  const activeStyle = 'background:#1f1f1f;color:#ddd;border:1px solid #555;';
  const idleStyle = 'background:#111;color:#aaa;border:1px solid #333;';
  const buttons = [
    ['se-perf-btn-today', 'today'],
    ['se-perf-btn-last7d', 'last_7d'],
    ['se-perf-btn-last30', 'last_30_windows']
  ];
  buttons.forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.cssText = `${el.style.cssText};${value === _sePerformancePreset ? activeStyle : idleStyle}`;
  });
  if (triggerPoll) {
    se_poll();
  }
}

function se_perfPresetLabel(preset) {
  if (preset === 'last_7d') return '近7天';
  if (preset === 'last_30_windows') return '近30窗口';
  return '今日';
}

function se_renderPerformance(perfPayload, status) {
  const summary = perfPayload?.summary && typeof perfPayload.summary === 'object' ? perfPayload.summary : null;
  const rows = Array.isArray(summary?.participating_postmortem_rows) ? summary.participating_postmortem_rows : [];
  const toFinite = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };
  const formatFixed1 = (value) => {
    const num = toFinite(value);
    return num === null ? '—' : num.toFixed(1);
  };
  const winNumerator = rows.filter((row) => toFinite(row?.realized_gross_pnl_total) !== null && toFinite(row?.realized_gross_pnl_total) > 0).length;
  const winDenominator = rows.length;
  const winRateText = winDenominator > 0 ? `${((winNumerator / winDenominator) * 100).toFixed(1)}%` : '—';
  se_setText('se-perf-range', se_perfPresetLabel(summary?.preset || _sePerformancePreset));
  document.getElementById('se-perf-window-count').textContent = se_formatStateValue(summary?.window_count);
  document.getElementById('se-perf-win-rate').textContent = winRateText;
  document.getElementById('se-perf-filled-total').textContent = se_formatStateValue(summary?.filled_total);
  document.getElementById('se-perf-realized-total').textContent = formatFixed1(summary?.realized_gross_pnl_total);
  document.getElementById('se-perf-avg-realized').textContent = se_formatStateValue(summary?.avg_realized_gross_pnl_per_window);
  const noteEl = document.getElementById('se-perf-note');
  if (!noteEl) return;
  const empty = (summary?.window_count ?? 0) === 0;
  noteEl.textContent = empty
    ? `${se_perfPresetLabel(_sePerformancePreset)} 当前无已完成窗口数据（running 窗口不计入）`
    : `${se_perfPresetLabel(summary?.preset)} | 仅统计已完成窗口 | running_excluded=${se_formatStateValue(summary?.running_window_excluded)} | running_now=${se_formatStateValue(status?.running)}`;
}

function se_renderPollError(message) {
  const el = document.getElementById('se-ui-error');
  if (!el) return;
  if (!message) {
    el.textContent = '';
    return;
  }
  el.textContent = `接口拉取失败: ${message}`;
}

function se_formatStateValue(value) {
  if (value === null || value === undefined || value === '') return 'N/A (null)';
  if (Array.isArray(value)) return value.length ? value.join(',') : '[]';
  return `${value}`;
}

function se_renderOrders(orders, status) {
  const tbody = document.getElementById('se-order-body');
  if (!tbody) return;
  const titleEl = document.getElementById('se-order-title');
  const scope = orders?.window_scope && typeof orders.window_scope === 'object' ? orders.window_scope : {};
  const isCurrentWindowScope = scope?.scope === 'current_window';
  if (titleEl) titleEl.textContent = '当前窗口订单状态';
  const list = Array.isArray(orders?.window_orders)
    ? [...orders.window_orders]
    : (Array.isArray(orders?.orders) ? [...orders.orders] : []);
  const scopedList = isCurrentWindowScope
    ? list.filter((item) => {
      const rowWindowId = item?.resolved_window_id ?? item?.inferred_window_id ?? null;
      return rowWindowId == null || rowWindowId === scope?.display_window_id;
    })
    : [];
  const finalList = scopedList;
  finalList.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const topList = finalList.slice(0, 200);
  const lifecycleLabel = (value, isCloseOrder) => {
    if (value === 'OPEN') return '挂单中';
    if (value === 'FILLED') return isCloseOrder ? '已经平仓' : '已成交';
    if (value === 'CANCELLED') return '已撤单';
    return se_formatStateValue(value);
  };
  const lifecycleCode = (value) => {
    if (value === 'OPEN' || value === 'FILLED' || value === 'CANCELLED') return value;
    return '';
  };
  const rows = topList.map((o) => {
    const statusColor = o.status === 'OPEN' ? '#00e676' : (o.status === 'FILLED' ? '#ffb74d' : '#888');
    const orderPriceText = typeof o.price === 'number' ? o.price.toFixed(3) : '--';
    const fillPriceText = typeof o.fill_price === 'number' ? o.fill_price.toFixed(3) : '--';
    const priceCell = `${orderPriceText}<div style="font-size:11px;color:#aaa;">fill:${fillPriceText}</div>`;
    const isCloseOrder = o.kind === 'TAKE_PROFIT' || o.kind === 'EXIT';
    const typeMain = isCloseOrder
      ? (o.side === 'YES' ? 'YES平仓' : (o.side === 'NO' ? 'NO平仓' : '平仓'))
      : (o.side === 'YES' ? 'YES' : (o.side === 'NO' ? 'NO' : se_formatStateValue(o.side)));
    const typeSub = o.parent_order_id ? `子单(${String(o.parent_order_id).slice(0, 8)})` : '父单';
    const typeCell = `${typeMain}<div style="font-size:11px;color:#8ea1b5;white-space:normal;word-break:break-word;">${typeSub}</div>`;
    const upDownMain = o.side === 'YES' ? 'UP' : (o.side === 'NO' ? 'DOWN' : se_formatStateValue(o.side));
    const statusMain = lifecycleLabel(o.status, isCloseOrder);
    const statusSub = lifecycleCode(o.status);
    const statusCell = statusSub
      ? `${statusMain}<div style="font-size:11px;color:#8ea1b5;">${statusSub}</div>`
      : statusMain;
    const tpPriceText = typeof o.tp_price === 'number' ? o.tp_price.toFixed(3) : '--';
    const tpIsSettle = typeof o.tp_price === 'number' && Number(o.tp_price) === 1;
    const closePriceText = tpIsSettle
      ? '等待结算'
      : (typeof o.tp_price === 'number'
        ? o.tp_price.toFixed(3)
        : (typeof o.fill_price === 'number' ? o.fill_price.toFixed(3) : '--'));
    const closeSubText = tpIsSettle
      ? '结算价:1.000'
      : (tpPriceText === '--' || tpPriceText === closePriceText ? '' : `tp:${tpPriceText}`);
    const closeCell = closeSubText
      ? `${closePriceText}<div style="font-size:11px;color:#aaa;">${closeSubText}</div>`
      : closePriceText;
    return `<tr><td style="white-space:normal;word-break:break-word;">${typeCell}</td><td>${upDownMain}</td><td>${priceCell}</td><td>${se_formatStateValue(o.size)}</td><td>${closeCell}</td><td style="color:${statusColor}">${statusCell}</td></tr>`;
  });
  tbody.innerHTML = rows.length
    ? rows.join('')
    : `<tr><td colspan="6" style="color:#555;text-align:center">${isCurrentWindowScope ? '当前窗口暂无活跃订单' : '当前无活动窗口订单'}</td></tr>`;
}

function se_logEventLabel(event) {
  return ({
    BOT_STARTED: '机器人已启动',
    BOT_STOPPED: '机器人已停止',
    BOT_WINDOW_INITIALIZED: '窗口初始化完成',
    BOT_DECISION: '策略决策已生成',
    BOT_ORDER_APPLY: '已提交挂单',
    BOT_ORDER_CANCEL: '已提交撤单',
    BOT_FILL: '订单成交',
    BOT_RUN_SNAPSHOT: '已记录运行快照',
    BOT_POSTMORTEM_WRITTEN: '复盘记录已写入',
    BOT_TICK_OK: '周期检查正常',
    RUNNER_TICK: '执行周期更新',
    BOT_CONTEXT_READY: '上下文就绪',
    BOT_CONTEXT_PENDING: '上下文待就绪'
  }[event] || null);
}

function se_logLevelLabel(level) {
  return ({
    info: '信息',
    warn: '警告',
    warning: '警告',
    error: '错误',
    debug: '调试'
  }[level] || '信息');
}

function se_hasLatinWord(text) {
  return /[A-Za-z]{2,}/.test(text || '');
}

function se_translateLogDetail(message, data) {
  let text = typeof message === 'string' ? message.trim() : '';
  if (!text && data && typeof data === 'object') {
    const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
    const intents = typeof data.intents_summary === 'string' ? data.intents_summary.trim() : '';
    if (reason) text = `原因:${reason}`;
    else if (intents) text = `动作:${intents}`;
  }
  if (!text) return '—';
  const origin = text;
  let translated = text
    .replace(/\bPLACE_LADDER\b/g, '挂阶梯单')
    .replace(/\bCANCEL_OPEN\b/g, '撤销挂单')
    .replace(/\bFLATTEN_POSITION\b/g, '平仓')
    .replace(/\bNOOP\b/g, '无动作')
    .replace(/\bBOTH\b/g, '双边')
    .replace(/\bYES\b/g, 'YES')
    .replace(/\bNO\b/g, 'NO')
    .replace(/window initialized/gi, '窗口初始化完成')
    .replace(/bot runner started/gi, '机器人启动')
    .replace(/bot runner stopped/gi, '机器人停止')
    .replace(/filled\s+(\d+)\s+orders?/gi, '成交 $1 笔订单')
    .replace(/tick ok/gi, '周期正常')
    .replace(/ladder_not_posted/gi, '阶梯单未挂出')
    .replace(/pre_open_or_open_not_open_delay/gi, '开盘等待阶段')
    .replace(/price_or_bounds_null/gi, '价格或边界未就绪')
    .replace(/btc_price>=upper_bound/gi, 'BTC 价格触达上边界')
    .replace(/btc_price<=lower_bound/gi, 'BTC 价格触达下边界')
    .replace(/\s+/g, ' ')
    .trim();
  if (translated === origin && se_hasLatinWord(origin)) {
    translated = '详见原始信息';
  }
  return translated;
}

function se_logReasonToken(message, data) {
  const fromData = typeof data?.reason === 'string' ? data.reason.trim() : '';
  if (fromData) return fromData;
  const fromMsg = typeof message === 'string' ? message.trim() : '';
  const matched = fromMsg.match(/tick\s+([a-zA-Z0-9_:-]+)/i);
  return matched && matched[1] ? matched[1] : '';
}

function se_isNoiseLog(event, message, data) {
  const reason = se_logReasonToken(message, data);
  const intents = typeof data?.intents_summary === 'string' ? data.intents_summary.trim() : '';
  if (reason === 'price_or_bounds_null') return true;
  if (reason === 'scheduled_tick_ok') return true;
  if (reason === 'tick_ok') return true;
  if (reason === 'noop') return true;
  if (event === 'BOT_TICK_OK') return true;
  if (event === 'RUNNER_TICK' && (reason === 'price_or_bounds_null' || reason === 'scheduled_tick_ok')) return true;
  if (String(message || '').toLowerCase().includes('scheduled tick ok')) return true;
  if (String(message || '').toLowerCase().includes('tick price_or_bounds_null')) return true;
  if (String(message || '').toUpperCase().includes('NOOP')) return true;
  if (String(intents).toUpperCase() === 'NOOP') return true;
  return false;
}

function se_logIntentsToken(message, data) {
  const fromData = typeof data?.intents_summary === 'string' ? data.intents_summary.trim() : '';
  if (fromData) return fromData;
  return typeof message === 'string' ? message.trim() : '';
}

function se_buildStateSentence(log) {
  const level = (log.level || log.type || 'info').toLowerCase();
  const event = log.event || log.type || 'LOG';
  const message = log.message || log.msg || '';
  const data = log.data && typeof log.data === 'object' ? log.data : null;
  const detail = se_translateLogDetail(message, data);
  const reason = se_logReasonToken(message, data);
  const intents = se_logIntentsToken(message, data).toUpperCase();
  if (level === 'error') return `错误：${detail === '—' ? '请查看原始日志' : detail}`;
  if (level === 'warn' || level === 'warning') return `警告：${detail === '—' ? '请查看原始日志' : detail}`;
  if (event === 'BOT_STARTED') return '机器人已启动';
  if (event === 'BOT_STOPPED') return '机器人已停止';
  if (event === 'BOT_WINDOW_INITIALIZED') return '进入新窗口，开始等待 open_delay';
  if (event === 'BOT_DECISION_GATED' && reason === 'wait_next_window_after_start') return '等待新窗口，当前窗口仅观察';
  if (event === 'BOT_DECISION_GATED' && reason === 'pre_open_or_open_not_open_delay') return '等待 open_delay 到期';
  if ((event === 'RUNNER_TICK' || event === 'BOT_DECISION_GATED') && reason === 'price_or_bounds_null') return '等待价格与边界数据';
  if ((event === 'RUNNER_TICK' || event === 'BOT_DECISION') && reason === 'scheduled_tick_ok') return '本周期无动作';
  if ((event === 'RUNNER_TICK' || event === 'BOT_DECISION') && reason === 'noop') return '本周期无动作';
  if (event === 'BOT_ORDER_APPLY') {
    const summary = typeof data?.intents_summary === 'string' ? data.intents_summary : '';
    if (summary.includes('PLACE_LADDER(BOTH)')) return '已挂 UP 2 单 / DOWN 2 单';
    if (summary.includes('PLACE_LADDER(YES)')) return '已挂 UP 挂单';
    if (summary.includes('PLACE_LADDER(NO)')) return '已挂 DOWN 挂单';
    return '已提交挂单';
  }
  if (event === 'BOT_INTENTS') {
    if (intents.includes('PLACE_LADDER(BOTH)')) return '挂单完成：UP 与 DOWN 已提交';
    if (intents.includes('PLACE_LADDER(YES)')) return '挂单完成：UP 已提交';
    if (intents.includes('PLACE_LADDER(NO)')) return '挂单完成：DOWN 已提交';
    if (intents.includes('CANCEL_OPEN(YES)') && reason === 'up_cancel_before_end') return 'UP 到时撤单（120秒）';
    if (intents.includes('CANCEL_OPEN(NO)') && reason === 'down_cancel_before_end') return 'DOWN 到时撤单（60秒）';
    if (intents.includes('CANCEL_OPEN(YES)')) return 'UP 方向撤单已提交';
    if (intents.includes('CANCEL_OPEN(NO)')) return 'DOWN 方向撤单已提交';
    if (intents === 'NOOP') return '本周期无动作';
  }
  if (event === 'BOT_FILL') {
    const fills = Array.isArray(data?.fills) ? data.fills : [];
    const noCount = fills.filter((item) => item?.side === 'NO').length;
    const yesCount = fills.filter((item) => item?.side === 'YES').length;
    if (noCount > 0 && yesCount === 0) return `NO 方向 ${noCount} 单成交`;
    if (yesCount > 0 && noCount === 0) return `UP 方向 ${yesCount} 单成交`;
    if (yesCount > 0 || noCount > 0) return `双边共 ${yesCount + noCount} 单成交`;
    return detail === '—' ? '发生成交' : detail;
  }
  if (event === 'BOT_ORDER_CANCEL') {
    if (reason === 'up_cancel_before_end') return 'UP 到时撤单（120秒）';
    if (reason === 'down_cancel_before_end') return 'DOWN 到时撤单（60秒）';
    if (reason === 'up_formula_cancel') return 'UP 公式触发撤单';
    if (reason === 'down_formula_cancel') return 'DOWN 公式触发撤单';
    return detail === '—' ? '已执行撤单' : detail;
  }
  if (event === 'BOT_POSTMORTEM_WRITTEN') return '当前窗口结束，结果已归档';
  if (event === 'BOT_TICK_OK') return '心跳周期正常';
  return detail === '—' ? '状态已更新' : detail;
}

function se_isKeyLog(log) {
  const level = (log.level || log.type || 'info').toLowerCase();
  const event = log.event || log.type || 'LOG';
  const message = log.message || log.msg || '';
  const data = log.data && typeof log.data === 'object' ? log.data : null;
  const reason = se_logReasonToken(message, data);
  const intents = se_logIntentsToken(message, data).toUpperCase();
  if (level === 'error' || level === 'warn' || level === 'warning') return true;
  if (event === 'BOT_STARTED' || event === 'BOT_STOPPED' || event === 'BOT_WINDOW_INITIALIZED') return true;
  if (event === 'BOT_FILL' || event === 'BOT_ORDER_APPLY' || event === 'BOT_ORDER_CANCEL' || event === 'BOT_POSTMORTEM_WRITTEN') return true;
  if (event === 'BOT_INTENTS' && (intents.includes('PLACE_LADDER(') || intents.includes('CANCEL_OPEN('))) return true;
  if (event === 'BOT_DECISION_GATED' && (reason === 'wait_next_window_after_start' || reason === 'pre_open_or_open_not_open_delay' || reason === 'price_or_bounds_null')) return true;
  if (event === 'RUNNER_TICK' && (reason === 'up_cancel_before_end' || reason === 'down_cancel_before_end' || reason === 'up_formula_cancel' || reason === 'down_formula_cancel')) return true;
  if (se_isNoiseLog(event, message, data)) return false;
  return false;
}

function se_refreshLogViewModeUI() {
  const keyBtn = document.getElementById('se-log-view-key');
  const rawBtn = document.getElementById('se-log-view-raw');
  const hint = document.getElementById('se-log-view-hint');
  if (keyBtn) {
    keyBtn.style.borderColor = _seLogViewMode === 'key' ? '#35506b' : '#2f3946';
    keyBtn.style.background = _seLogViewMode === 'key' ? '#1a2a3a' : '#121821';
    keyBtn.style.color = _seLogViewMode === 'key' ? '#c8e6ff' : '#8ea1b5';
  }
  if (rawBtn) {
    rawBtn.style.borderColor = _seLogViewMode === 'raw' ? '#35506b' : '#2f3946';
    rawBtn.style.background = _seLogViewMode === 'raw' ? '#1a2a3a' : '#121821';
    rawBtn.style.color = _seLogViewMode === 'raw' ? '#c8e6ff' : '#8ea1b5';
  }
  if (hint) {
    hint.textContent = _seLogViewMode === 'key'
      ? `默认展示关键信息流（已折叠噪声 ${_seLogNoiseSuppressed} 条）`
      : '当前展示原始日志（包含心跳/空转事件）';
  }
}

function se_renderLogAreaByMode() {
  const area = document.getElementById('se-log-area');
  if (!area) return;
  const source = _seLogViewMode === 'raw' ? _seLogEntriesRaw : _seLogEntriesKey;
  const list = source.slice(-300);
  se_refreshLogViewModeUI();
  if (!list.length) {
    area.innerHTML = _seLogViewMode === 'raw'
      ? '<div class="se-log-entry se-log-info">暂无原始日志</div>'
      : '<div class="se-log-entry se-log-info">暂无关键信息流</div>';
    return;
  }
  const rows = list.map((item) => {
    const line = _seLogViewMode === 'raw' ? item.rawLine : item.keyLine;
    return `<div class="se-log-entry se-log-${item.level}">${line}</div>`;
  });
  area.innerHTML = rows.join('');
  area.scrollTop = area.scrollHeight;
}

function se_setLogViewMode(mode) {
  if (mode !== 'key' && mode !== 'raw') return;
  _seLogViewMode = mode;
  se_renderLogAreaByMode();
}

function se_renderLogs(logs) {
  const area = document.getElementById('se-log-area');
  if (!area) return;
  if (!logs.length && _seLogEntriesRaw.length === 0) {
    se_renderLogAreaByMode();
    return;
  }
  const newLogs = _seLastLogTs
    ? logs.filter((l) => l.ts > _seLastLogTs)
    : logs;
  if (newLogs.length === 0) {
    se_renderLogAreaByMode();
    return;
  }
  _seLastLogTs = logs[logs.length - 1].ts;
  newLogs.forEach((log) => {
    const level = (log.level || log.type || 'info').toLowerCase();
    const event = log.event || log.type || 'LOG';
    const message = log.message || log.msg || '';
    const data = log.data && typeof log.data === 'object' ? log.data : null;
    const time = new Date(log.ts).toLocaleTimeString('zh-CN', { hour12: false });
    const stateSentence = se_buildStateSentence(log);
    const detail = se_translateLogDetail(message, data);
    const rawLine = `${time} [${se_logLevelLabel(level)}] ${stateSentence}（原始:${event}${message ? ` | 原文:${message}` : ''}）`.trim();
    const keyLine = `${time} [${se_logLevelLabel(level)}] ${stateSentence}`.trim();
    const noise = se_isNoiseLog(event, message, data);
    _seLogEntriesRaw.push({ ts: log.ts, level, event, message, data, rawLine, keyLine });
    if (se_isKeyLog(log)) {
      _seLogEntriesKey.push({ ts: log.ts, level, event, message, data, rawLine, keyLine });
    } else if (noise || detail === '无动作' || detail === '周期正常') {
      _seLogNoiseSuppressed += 1;
    }
    if (level === 'error') _seErrorCount++;
    else _seErrorCount = 0;
  });
  while (_seLogEntriesRaw.length > 300) _seLogEntriesRaw.shift();
  while (_seLogEntriesKey.length > 300) _seLogEntriesKey.shift();
  se_renderLogAreaByMode();
  if (_seErrorCount >= 3 && _se_running) {
    se_stopBot();
    alert('连续报错 3 次，策略已自动停止');
  }
}

function se_appendLog(type, msg) {
  const level = String(type || 'info').toLowerCase();
  const ts = new Date().toISOString();
  const line = `${new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })} [${se_logLevelLabel(level)}] ${String(msg || '')}`.trim();
  const entry = {
    ts,
    level,
    event: 'UI_LOG',
    message: String(msg || ''),
    data: { source: 'ui' },
    rawLine: line,
    keyLine: line
  };
  _seLogEntriesRaw.push(entry);
  _seLogEntriesKey.push(entry);
  while (_seLogEntriesRaw.length > 300) _seLogEntriesRaw.shift();
  while (_seLogEntriesKey.length > 300) _seLogEntriesKey.shift();
  se_renderLogAreaByMode();
}

function se_renderPnlChart(pnlSeries) {
  const svg = document.getElementById('se-pnl-chart');
  if (!svg) return;
  const summary = pnlSeries && typeof pnlSeries === 'object' ? pnlSeries : null;
  if (!summary) {
    svg.innerHTML = '<text x="150" y="100" text-anchor="middle" fill="#666" font-size="12">summary unavailable</text>';
    return;
  }
  const fmt = (v) => (typeof v === 'number' ? v.toFixed(4) : 'null');
  svg.setAttribute('viewBox', '0 0 300 200');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.innerHTML = `
    <rect x="0" y="0" width="300" height="200" fill="#1a1a2e" />
    <text x="12" y="24" fill="#bbb" font-size="12">YES count:${se_formatStateValue(summary.yes_filled_count)} avg:${fmt(summary.yes_avg_fill_price)} upnl:${fmt(summary.yes_unrealized_pnl)}</text>
    <text x="12" y="52" fill="#bbb" font-size="12">NO  count:${se_formatStateValue(summary.no_filled_count)} avg:${fmt(summary.no_avg_fill_price)} upnl:${fmt(summary.no_unrealized_pnl)}</text>
    <text x="12" y="88" fill="#00e676" font-size="13" font-weight="bold">Total UPNL: ${fmt(summary.total_unrealized_pnl)}</text>
    <text x="12" y="118" fill="#888" font-size="11">YES mark:${fmt(summary.yes_mark_price)} NO mark:${fmt(summary.no_mark_price)}</text>
    <text x="12" y="146" fill="#888" font-size="11">YES size:${se_formatStateValue(summary.yes_position_size)} NO size:${se_formatStateValue(summary.no_position_size)}</text>
    <text x="12" y="174" fill="#666" font-size="10">updated:${se_formatStateValue(summary.updated_at)}</text>
  `;
}

// 辅助日志函数
function se_appendLog(type, msg) {
  const area = document.getElementById('se-log-area');
  if (!area) return;
  const div = document.createElement('div');
  div.className = `se-log-entry se-log-${type.toLowerCase()}`;
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  div.textContent = `${time} [${type}] ${msg}`;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

// AI 指南 Modal
function se_showGuide() {
  document.getElementById('se-guide-overlay').style.display = 'flex';
}

function se_closeGuide() {
  document.getElementById('se-guide-overlay').style.display = 'none';
}

async function se_copyGuide() {
  try {
    await navigator.clipboard.writeText(SE_GUIDE_TEXT);
    const btn = document.getElementById('se-btn-copy');
    btn.textContent = '已复制 ✓';
    setTimeout(() => { btn.textContent = '复制全文'; }, 2000);
  } catch (err) {
    console.error('[se] copy failed:', err.message);
  }
}

// 监听 Tab 切换（在 page-editor 显示时初始化）
const _se_observer = new MutationObserver((mutations) => {
  mutations.forEach(m => {
    if (m.target.id === 'page-editor' &&
        m.attributeName === 'style' &&
        m.target.style.display !== 'none') {
      initStrategyEditor();
    }
  });
});

document.addEventListener('DOMContentLoaded', () => {
  const editorPage = document.getElementById('page-editor');
  if (editorPage) {
    _se_observer.observe(editorPage, { attributes: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      se_stopPoll();
      return;
    }
    se_startPoll();
  });
  window.addEventListener('beforeunload', () => {
    se_stopPoll();
  });
});
