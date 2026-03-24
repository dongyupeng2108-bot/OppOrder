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

// 状态管理
let _se_running = false;
let _se_period = '5m';
let _se_pollTimer = null;
let _seLastLogTs = '';
let _seErrorCount = 0;
let _seLastPollError = null;
let _seActionPending = false;
const BASE_URL = ''; // 相对路径

async function restartServer() {
  const btn = document.querySelector('.se-restart-inline-btn');
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
        btn.textContent = '⟳ 重启';
        btn.style.opacity = '1';
        btn.disabled = false;
      }, 2000);
    }
  } catch(e) {
    console.error('[SE] restart failed', e);
    alert('重启失败: ' + e.message);
    if (btn) {
      btn.textContent = '⟳ 重启';
      btn.style.opacity = '1';
      btn.disabled = false;
    }
  }
}

const BOT_CONFIG_FIELDS = ['open_delay_sec', 'ladder_prices', 'ladder_size', 'atr_multiple', 'cancel_all_remaining_sec'];
let _seConfigCurrent = null;
let _seConfigDefaults = null;

// 初始化
async function initStrategyEditor() {
  const container = document.getElementById('se-container');
  if (!container) return; // 避免重复初始化或找不到容器

  // 如果已有内容，不再重绘（保留状态）
  if (container.innerHTML.trim()) return;

  container.innerHTML = `
    <div class="se-layout">
      <!-- 左栏 -->
      <div class="se-left">
        <div class="se-toolbar" style="justify-content: space-between;">
          <span style="font-weight:bold; color:#00e676; padding-left:10px;">参数配置 (Bot Console)</span>
          <div>
            <button class="se-btn-guide" onclick="se_showGuide()">查看说明</button>
            <button class="se-btn" onclick="se_restoreDefaultParams()" style="background:#444;color:#eee;border:1px solid #555;padding:4px 8px;border-radius:4px;margin-left:5px;cursor:pointer;">恢复默认</button>
            <button class="se-btn-save" onclick="se_saveParams()" style="background:#007acc;color:#fff;border:none;padding:4px 8px;border-radius:4px;margin-left:5px;cursor:pointer;">保存参数</button>
          </div>
        </div>
        <div class="se-editor-container" style="flex:1;display:flex;flex-direction:column;position:relative;overflow-y:auto;">
          <div id="se-params-form" style="padding: 20px; color: #ddd; display: flex; flex-direction: column; gap: 15px; flex:1;">
            
            <div style="display:flex; gap:20px; flex-wrap:wrap;">
              <div style="flex:1; min-width:200px;">
                <label style="display:block; margin-bottom:5px; font-weight:bold;">开仓延迟秒数 (open_delay_sec):</label>
                <input type="number" id="param_open_delay_sec" style="background:#1e1e1e; border:1px solid #555; color:#fff; padding:6px; border-radius:4px; width:100%; box-sizing:border-box;">
              </div>
              <div style="flex:1; min-width:200px;">
                <label style="display:block; margin-bottom:5px; font-weight:bold;">平仓保护倒计时 (cancel_all_remaining_sec):</label>
                <input type="number" id="param_cancel_all_remaining_sec" style="background:#1e1e1e; border:1px solid #555; color:#fff; padding:6px; border-radius:4px; width:100%; box-sizing:border-box;">
              </div>
            </div>

            <div style="display:flex; gap:20px; flex-wrap:wrap;">
              <div style="flex:1; min-width:200px;">
                <label style="display:block; margin-bottom:5px; font-weight:bold;">ATR 乘数 (atr_multiple):</label>
                <input type="number" step="0.01" id="param_atr_multiple" style="background:#1e1e1e; border:1px solid #555; color:#fff; padding:6px; border-radius:4px; width:100%; box-sizing:border-box;">
              </div>
              <div style="flex:1; min-width:200px;">
                <label style="display:block; margin-bottom:5px; font-weight:bold;">阶梯下单份数 (ladder_size):</label>
                <input type="number" id="param_ladder_size" style="background:#1e1e1e; border:1px solid #555; color:#fff; padding:6px; border-radius:4px; width:100%; box-sizing:border-box;">
              </div>
            </div>

            <div>
              <label style="display:block; margin-bottom:5px; font-weight:bold;">阶梯挂单价格列表 (ladder_prices) [逗号分隔]:</label>
              <input type="text" id="param_ladder_prices" style="background:#1e1e1e; border:1px solid #555; color:#fff; padding:6px; border-radius:4px; width:100%; box-sizing:border-box;">
            </div>

            <div id="se-param-feedback" style="margin-top: 6px; min-height: 18px; font-size: 12px; color: #ff8a80;"></div>
            <div style="margin-top: 6px; padding: 10px; background: rgba(0, 122, 204, 0.12); border-left: 4px solid #007acc; border-radius: 4px; color: #9fd3ff;">
              固定参数闭环：读取 current/defaults，恢复默认仅改表单，点击“保存参数”才写回后端。
            </div>
          </div>
          <!-- 隐藏原代码编辑框以防报错 -->
          <textarea id="se-editor" style="display:none;">function decide(ctx) { return 'HOLD'; }</textarea>
          <div class="se-actions" style="display:flex;gap:8px;align-items:center;">
            <button id="se-btn-start" class="se-btn-deploy" onclick="se_startBot()">▶ Start</button>
            <button id="se-btn-stop" class="se-btn se-btn-stop" onclick="se_stopBot()" style="background:#7a3a3a;color:#fff;border:1px solid #9a4b4b;padding:6px 10px;border-radius:4px;cursor:pointer;">■ Stop</button>
            <div class="se-status" style="margin-left:auto; display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span id="se-status-dot" class="se-dot se-dot-off"></span>
                <span id="se-status-label">已停止</span>
              </div>
              <div id="se-bot-state-tip" style="font-size:11px;color:#999;">Bot Console 只读总览（status/summary/orders/logs）</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右栏 -->
      <div class="se-right">
        <!-- 左侧面板组 (日志 + 统计 + PnL) -->
        <div class="se-left-panels">
          <div class="se-panel" style="flex-shrink: 0; height: 160px;">
            <div class="se-log-header">
              <span>Bot 结构化日志</span>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
                <button class="se-restart-inline-btn" onclick="restartServer()">⟳ 重启</button>
                <span id="se-countdown" style="font-size:11px;color:#aaa;font-family:monospace;display:block;margin-top:6px;text-align:right;">--:--</span>
              </div>
            </div>
            <div id="se-log-area" class="se-log-area"></div>
          </div>
          <div class="se-panel se-stats-panel" style="flex-shrink: 0;">
            <div class="se-stat-item"><div class="se-stat-label">slug</div><div id="se-ctx-slug" class="se-stat-value">—</div></div>
            <div class="se-stat-item"><div class="se-stat-label">window_id</div><div id="se-ctx-window-id" class="se-stat-value">—</div></div>
            <div class="se-stat-item"><div class="se-stat-label">last_window_id</div><div id="se-ctx-last-window-id" class="se-stat-value">—</div></div>
            <div class="se-stat-item"><div class="se-stat-label">remaining_sec</div><div id="se-ctx-remaining" class="se-stat-value">—</div></div>
            <div class="se-stat-item"><div class="se-stat-label">btc_price</div><div id="se-ctx-btc-price" class="se-stat-value">—</div></div>
            <div class="se-stat-item"><div class="se-stat-label">anchor_btc</div><div id="se-ctx-anchor-btc" class="se-stat-value">—</div></div>
            <div class="se-stat-item"><div class="se-stat-label">atr_5m</div><div id="se-ctx-atr" class="se-stat-value">—</div></div>
            <div class="se-stat-item"><div class="se-stat-label">upper_bound</div><div id="se-ctx-upper-bound" class="se-stat-value">—</div></div>
            <div class="se-stat-item"><div class="se-stat-label">lower_bound</div><div id="se-ctx-lower-bound" class="se-stat-value">—</div></div>
            <div class="se-stat-item"><div class="se-stat-label">bid_yes</div><div id="se-ctx-bid-yes" class="se-stat-value">—</div></div>
            <div class="se-stat-item"><div class="se-stat-label">ask_yes</div><div id="se-ctx-ask-yes" class="se-stat-value">—</div></div>
            <div class="se-stat-item"><div class="se-stat-label">bid_no</div><div id="se-ctx-bid-no" class="se-stat-value">—</div></div>
            <div class="se-stat-item"><div class="se-stat-label">ask_no</div><div id="se-ctx-ask-no" class="se-stat-value">—</div></div>
            <div class="se-stat-item"><div class="se-stat-label">tick_size</div><div id="se-ctx-tick-size" class="se-stat-value">—</div></div>
            <div class="se-stat-item"><div class="se-stat-label">stale</div><div id="se-ctx-stale" class="se-stat-value">—</div></div>
          </div>
          <div class="se-panel" style="flex:1; padding:10px 12px; border:1px solid #333; background:#161616; display:flex; flex-direction:column; gap:8px;">
            <div style="font-size:12px; color:#bbb;">Bot 只读总览</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;font-size:12px;">
              <div style="color:#888;">running</div><div id="se-bot-running" style="color:#ddd;">—</div>
              <div style="color:#888;">phase</div><div id="se-bot-phase" style="color:#ddd;">—</div>
              <div style="color:#888;">debug_scenario</div><div id="se-bot-debug" style="color:#ddd;">—</div>
              <div style="color:#888;">window_id</div><div id="se-bot-window" style="color:#ddd;">—</div>
              <div style="color:#888;">yes_position_size</div><div id="se-summary-yes-position" style="color:#ddd;">—</div>
              <div style="color:#888;">no_position_size</div><div id="se-summary-no-position" style="color:#ddd;">—</div>
              <div style="color:#888;">filled_total</div><div id="se-summary-filled-total" style="color:#ddd;">—</div>
              <div style="color:#888;">realized_gross_pnl_total</div><div id="se-summary-realized-total" style="color:#ddd;">—</div>
              <div style="color:#888;">unrealized_gross_pnl_total</div><div id="se-summary-unrealized-total" style="color:#ddd;">—</div>
              <div style="color:#888;">updated_at</div><div id="se-summary-updated-at" style="color:#ddd;">—</div>
            </div>
            <div style="margin-top:4px;padding-top:6px;border-top:1px solid #2a2a2a;display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;font-size:12px;">
              <div style="color:#8aa4bf;">saved.open_delay_sec</div><div id="se-saved-open-delay" style="color:#ddd;">—</div>
              <div style="color:#8aa4bf;">saved.ladder_prices</div><div id="se-saved-ladder-prices" style="color:#ddd;">—</div>
              <div style="color:#8aa4bf;">saved.ladder_size</div><div id="se-saved-ladder-size" style="color:#ddd;">—</div>
              <div style="color:#8aa4bf;">saved.atr_multiple</div><div id="se-saved-atr-multiple" style="color:#ddd;">—</div>
              <div style="color:#8aa4bf;">saved.cancel_all_remaining_sec</div><div id="se-saved-cancel-all" style="color:#ddd;">—</div>
              <div style="color:#8aa4bf;">active.phase</div><div id="se-active-phase" style="color:#ddd;">—</div>
              <div style="color:#8aa4bf;">active.window_id</div><div id="se-active-window-id" style="color:#ddd;">—</div>
              <div style="color:#8aa4bf;">active.open_delay_sec</div><div id="se-active-open-delay" style="color:#ddd;">—</div>
              <div style="color:#8aa4bf;">active.ladder_prices</div><div id="se-active-ladder-prices" style="color:#ddd;">—</div>
              <div style="color:#8aa4bf;">active.ladder_size</div><div id="se-active-ladder-size" style="color:#ddd;">—</div>
              <div style="color:#8aa4bf;">active.atr_multiple</div><div id="se-active-atr-multiple" style="color:#ddd;">—</div>
              <div style="color:#8aa4bf;">active.cancel_all_remaining_sec</div><div id="se-active-cancel-all" style="color:#ddd;">—</div>
              <div style="color:#8aa4bf;">active.anchor_btc</div><div id="se-active-anchor-btc" style="color:#ddd;">—</div>
              <div style="color:#8aa4bf;">active.upper_bound</div><div id="se-active-upper-bound" style="color:#ddd;">—</div>
              <div style="color:#8aa4bf;">active.lower_bound</div><div id="se-active-lower-bound" style="color:#ddd;">—</div>
            </div>
            <div id="se-active-runtime-note" style="font-size:11px;color:#9aa0a6;min-height:16px;">—</div>
            <div id="se-ui-error" style="font-size:11px;color:#ff8a80;min-height:16px;"></div>
          </div>
        </div>

        <!-- 右侧订单面板 -->
        <div class="se-order-panel">
          <div class="se-order-title">订单最小摘要</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;padding:8px 2px 10px 2px;font-size:12px;">
            <div style="color:#888;">total</div><div id="se-orders-total" style="color:#ddd;">—</div>
            <div style="color:#888;">open_total</div><div id="se-orders-open-total" style="color:#ddd;">—</div>
            <div style="color:#888;">filled_total</div><div id="se-orders-filled-total" style="color:#ddd;">—</div>
            <div style="color:#888;">cancelled_total</div><div id="se-orders-cancelled-total" style="color:#ddd;">—</div>
          </div>
          <table class="se-order-table" style="table-layout:fixed;width:100%;">
            <colgroup><col style="width:22%"><col style="width:22%"><col style="width:28%"><col style="width:28%"></colgroup>
            <thead><tr><th>方向</th><th>类型</th><th>价格</th><th>状态</th></tr></thead>
            <tbody id="se-order-body">
              <tr><td colspan="4" style="color:#555;text-align:center">暂无</td></tr>
            </tbody>
          </table>
          <div id="se-latency" style="font-size:10px;color:#888;text-align:right;padding:4px 8px;margin-top:auto;"></div>
        </div>
      </div>
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
  se_updateRunningUI(false);
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
    se_renderParams(_seConfigCurrent);
    se_setParamFeedback('参数已加载', '#8bc34a');
  } catch (e) {
    _seConfigDefaults = {
      open_delay_sec: 10,
      ladder_prices: [0.27, 0.24, 0.21, 0.18],
      ladder_size: 5,
      atr_multiple: 1.2,
      cancel_all_remaining_sec: 100
    };
    _seConfigCurrent = { ..._seConfigDefaults, ladder_prices: [..._seConfigDefaults.ladder_prices] };
    se_renderParams(_seConfigCurrent);
    se_setParamFeedback(`读取参数失败: ${e.message}`, '#ff8a80');
  }
}

function se_renderParams(params) {
  document.getElementById('param_open_delay_sec').value = params.open_delay_sec;
  document.getElementById('param_cancel_all_remaining_sec').value = params.cancel_all_remaining_sec;
  document.getElementById('param_atr_multiple').value = params.atr_multiple;
  document.getElementById('param_ladder_size').value = params.ladder_size;
  document.getElementById('param_ladder_prices').value = Array.isArray(params.ladder_prices) ? params.ladder_prices.join(',') : '';
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
  return {
    open_delay_sec: Number(picked.open_delay_sec ?? 0),
    ladder_prices: Array.isArray(picked.ladder_prices) ? picked.ladder_prices.map((item) => Number(item)) : [],
    ladder_size: Number(picked.ladder_size ?? 1),
    atr_multiple: Number(picked.atr_multiple ?? 1.2),
    cancel_all_remaining_sec: Number(picked.cancel_all_remaining_sec ?? 100)
  };
}

function se_readParamsFromForm() {
  return {
    open_delay_sec: Number(document.getElementById('param_open_delay_sec').value),
    ladder_prices: String(document.getElementById('param_ladder_prices').value || '')
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item)),
    ladder_size: Number(document.getElementById('param_ladder_size').value),
    atr_multiple: Number(document.getElementById('param_atr_multiple').value),
    cancel_all_remaining_sec: Number(document.getElementById('param_cancel_all_remaining_sec').value)
  };
}

function se_validateParams(params) {
  if (!Number.isInteger(params.open_delay_sec) || params.open_delay_sec < 0) return 'open_delay_sec 必须为非负整数';
  if (!Number.isInteger(params.cancel_all_remaining_sec) || params.cancel_all_remaining_sec < 0) return 'cancel_all_remaining_sec 必须为非负整数';
  if (!Number.isInteger(params.ladder_size) || params.ladder_size <= 0) return 'ladder_size 必须为正整数';
  if (!Number.isFinite(params.atr_multiple) || params.atr_multiple <= 0) return 'atr_multiple 必须为正数';
  if (!Array.isArray(params.ladder_prices) || params.ladder_prices.length !== 4) return 'ladder_prices 必须为 4 个数值';
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

function se_updateRunningUI(running) {
  const startBtn = document.getElementById('se-btn-start');
  const stopBtn = document.getElementById('se-btn-stop');
  const dot = document.getElementById('se-status-dot');
  const label = document.getElementById('se-status-label');
  if (startBtn) startBtn.disabled = running || _seActionPending;
  if (stopBtn) stopBtn.disabled = !running || _seActionPending;
  if (dot) dot.className = running ? 'se-dot se-dot-on' : 'se-dot se-dot-off';
  if (label) label.textContent = running ? '运行中' : '已停止';
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

    se_renderContext({}, status);
    se_renderOverview(status, summaryData, ordersData);
    se_renderLogs(Array.isArray(logsData) ? logsData : (logsData.logs || []));
    se_renderOrders(ordersData);

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
    se_renderOrders({ orders: data.orders, summary: data.summary });
  } catch (err) {
    alert('动作执行失败: ' + err.message);
  }
}

function se_renderDecision(payload) {
  const decisionEl = document.getElementById('se-decision-value');
  const reasonEl = document.getElementById('se-decision-reason');
  const diagEl = document.getElementById('se-decision-diag');
  if (!decisionEl || !reasonEl || !diagEl) return;
  const intentsSummary = payload?.intents_summary
    || (Array.isArray(payload?.intents)
      ? payload.intents.map((intent) => {
        if (!intent || typeof intent !== 'object') return 'UNKNOWN';
        if (intent.kind === 'NOOP') return 'NOOP';
        if (intent.kind === 'PLACE_LADDER') return `PLACE_LADDER(${se_formatStateValue(intent.side)})`;
        if (intent.kind === 'CANCEL_OPEN') return `CANCEL_OPEN(${se_formatStateValue(intent.side)})`;
        return se_formatStateValue(intent.kind);
      }).join(' + ')
      : 'NOOP');
  const diagnostics = payload?.diagnostics && typeof payload.diagnostics === 'object' ? payload.diagnostics : {};
  const diagnosticsText = [
    `remaining_sec=${se_formatStateValue(diagnostics.remaining_sec)}`,
    `open_elapsed_sec=${se_formatStateValue(diagnostics.open_elapsed_sec)}`,
    `ladder_posted=${se_formatStateValue(diagnostics.ladder_posted)}`,
    `bounds_ready=${se_formatStateValue(diagnostics.bounds_ready)}`
  ].join(' | ');
  decisionEl.textContent = se_formatStateValue(intentsSummary);
  reasonEl.textContent = 'reason: ' + se_formatStateValue(payload?.reason);
  diagEl.textContent = 'diagnostics: ' + diagnosticsText;
}

// 渲染统计、日志、PnL 图
function se_renderContext(context, status) {
  document.getElementById('se-ctx-slug').textContent = se_formatStateValue(context.slug);
  document.getElementById('se-ctx-window-id').textContent = se_formatStateValue(context.window_id ?? status?.current_window_id);
  document.getElementById('se-ctx-last-window-id').textContent = se_formatStateValue(context.last_window_id ?? status?.last_window_id);
  document.getElementById('se-ctx-remaining').textContent = se_formatStateValue(context.remaining_sec);
  document.getElementById('se-ctx-btc-price').textContent = se_formatStateValue(context.btc_price);
  document.getElementById('se-ctx-anchor-btc').textContent = se_formatStateValue(context.anchor_btc ?? status?.anchor_btc);
  document.getElementById('se-ctx-atr').textContent = se_formatStateValue(context.atr_5m);
  document.getElementById('se-ctx-upper-bound').textContent = se_formatStateValue(context.upper_bound ?? status?.upper_bound);
  document.getElementById('se-ctx-lower-bound').textContent = se_formatStateValue(context.lower_bound ?? status?.lower_bound);
  document.getElementById('se-ctx-bid-yes').textContent = se_formatStateValue(context.bid_yes);
  document.getElementById('se-ctx-ask-yes').textContent = se_formatStateValue(context.ask_yes);
  document.getElementById('se-ctx-bid-no').textContent = se_formatStateValue(context.bid_no);
  document.getElementById('se-ctx-ask-no').textContent = se_formatStateValue(context.ask_no);
  document.getElementById('se-ctx-tick-size').textContent = se_formatStateValue(context.tick_size);
  document.getElementById('se-ctx-stale').textContent = se_formatStateValue(context.stale);
  const pnlTitleEl = document.getElementById('se-pnl-title');
  if (pnlTitleEl) {
    pnlTitleEl.style.color = '#aaa';
    pnlTitleEl.textContent = 'Paper Summary';
  }
}

function se_pickSummaryValue(summary, keys, fallback = null) {
  for (const key of keys) {
    if (summary && summary[key] !== undefined) return summary[key];
  }
  return fallback;
}

function se_renderOverview(status, summary, ordersData) {
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

  document.getElementById('se-bot-running').textContent = se_formatStateValue(status?.running);
  document.getElementById('se-bot-phase').textContent = se_formatStateValue(status?.phase);
  document.getElementById('se-bot-debug').textContent = se_formatStateValue(status?.debug_scenario);
  document.getElementById('se-bot-window').textContent = se_formatStateValue(status?.current_window_id);
  document.getElementById('se-summary-yes-position').textContent = se_formatStateValue(yesPos);
  document.getElementById('se-summary-no-position').textContent = se_formatStateValue(noPos);
  document.getElementById('se-summary-filled-total').textContent = se_formatStateValue(filledTotal);
  document.getElementById('se-summary-realized-total').textContent = se_formatStateValue(realizedTotal);
  document.getElementById('se-summary-unrealized-total').textContent = se_formatStateValue(unrealizedTotal);
  document.getElementById('se-summary-updated-at').textContent = se_formatStateValue(updatedAt);
  const savedConfig = status?.saved_config && typeof status.saved_config === 'object' ? status.saved_config : null;
  const activeRuntime = status?.active_runtime_snapshot && typeof status.active_runtime_snapshot === 'object'
    ? status.active_runtime_snapshot
    : null;
  const activeConfig = activeRuntime?.config && typeof activeRuntime.config === 'object' ? activeRuntime.config : null;
  document.getElementById('se-saved-open-delay').textContent = se_formatStateValue(savedConfig?.open_delay_sec);
  document.getElementById('se-saved-ladder-prices').textContent = se_formatStateValue(savedConfig?.ladder_prices);
  document.getElementById('se-saved-ladder-size').textContent = se_formatStateValue(savedConfig?.ladder_size);
  document.getElementById('se-saved-atr-multiple').textContent = se_formatStateValue(savedConfig?.atr_multiple);
  document.getElementById('se-saved-cancel-all').textContent = se_formatStateValue(savedConfig?.cancel_all_remaining_sec);
  document.getElementById('se-active-phase').textContent = se_formatStateValue(activeRuntime?.phase);
  document.getElementById('se-active-window-id').textContent = se_formatStateValue(activeRuntime?.current_window_id);
  document.getElementById('se-active-open-delay').textContent = se_formatStateValue(activeConfig?.open_delay_sec);
  document.getElementById('se-active-ladder-prices').textContent = se_formatStateValue(activeConfig?.ladder_prices);
  document.getElementById('se-active-ladder-size').textContent = se_formatStateValue(activeConfig?.ladder_size);
  document.getElementById('se-active-atr-multiple').textContent = se_formatStateValue(activeConfig?.atr_multiple);
  document.getElementById('se-active-cancel-all').textContent = se_formatStateValue(activeConfig?.cancel_all_remaining_sec);
  document.getElementById('se-active-anchor-btc').textContent = se_formatStateValue(activeRuntime?.anchor_btc);
  document.getElementById('se-active-upper-bound').textContent = se_formatStateValue(activeRuntime?.upper_bound);
  document.getElementById('se-active-lower-bound').textContent = se_formatStateValue(activeRuntime?.lower_bound);
  const runtimeNote = document.getElementById('se-active-runtime-note');
  if (runtimeNote) {
    runtimeNote.textContent = activeRuntime
      ? 'active runtime snapshot 来自当前运行实例；save 后未重启时可能与 saved config 不同'
      : '当前未运行：仅展示 saved config，active runtime snapshot 为空';
  }

  const openOrdersSummary = ordersData?.summary || {};
  document.getElementById('se-orders-total').textContent = se_formatStateValue(openOrdersSummary.total);
  document.getElementById('se-orders-open-total').textContent = se_formatStateValue(openOrdersSummary.open_total);
  document.getElementById('se-orders-filled-total').textContent = se_formatStateValue(openOrdersSummary.filled_total);
  document.getElementById('se-orders-cancelled-total').textContent = se_formatStateValue(openOrdersSummary.cancelled_total);

  const tip = document.getElementById('se-bot-state-tip');
  if (tip) {
    tip.textContent = `YES upnl=${se_formatStateValue(yesUnreal)} | NO upnl=${se_formatStateValue(noUnreal)} | poll=${_seLastPollError ? 'error' : 'ok'}`;
  }
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

function se_renderOrders(orders) {
  const tbody = document.getElementById('se-order-body');
  if (!tbody) return;
  const list = Array.isArray(orders?.orders) ? [...orders.orders] : [];
  list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const topList = list.slice(0, 8);
  const rows = topList.map((o) => {
    const cls = o.side === 'YES' ? 'up-color' : 'down-color';
    const statusColor = o.status === 'OPEN' ? '#00e676' : (o.status === 'FILLED' ? '#ffb74d' : '#888');
    const orderPriceText = typeof o.price === 'number' ? o.price.toFixed(3) : '--';
    const fillPriceText = typeof o.fill_price === 'number' ? o.fill_price.toFixed(3) : '--';
    const priceCell = `${orderPriceText}<div style="font-size:11px;color:#aaa;">fill:${fillPriceText}</div>`;
    return `<tr><td class="${cls}">${se_formatStateValue(o.side)}</td><td>${se_formatStateValue(o.kind)}</td><td>${priceCell}</td><td style="color:${statusColor}">${se_formatStateValue(o.status)}</td></tr>`;
  });
  tbody.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="4" style="color:#555;text-align:center">暂无</td></tr>';
}

function se_renderLogs(logs) {
  const area = document.getElementById('se-log-area');
  if (!logs.length) {
    area.innerHTML = '<div class="se-log-entry se-log-info">暂无 Bot 结构化日志</div>';
    return;
  }

  const newLogs = _seLastLogTs
    ? logs.filter(l => l.ts > _seLastLogTs)
    : logs;

  if (newLogs.length === 0) return;
  if (area.children.length === 1 && area.textContent.includes('暂无 Bot 结构化日志')) {
    area.innerHTML = '';
  }

  _seLastLogTs = logs[logs.length - 1].ts;

  newLogs.forEach(log => {
    const div = document.createElement('div');
    const level = (log.level || log.type || 'info').toLowerCase();
    const event = log.event || log.type || 'LOG';
    const message = log.message || log.msg || '';
    div.className = `se-log-entry se-log-${level}`;
    const time = new Date(log.ts).toLocaleTimeString('zh-CN', { hour12: false });
    div.textContent = `${time} [${level.toUpperCase()}] ${event} ${message}`.trim();
    area.appendChild(div);

    if (level === 'error') {
      _seErrorCount++;
    } else {
      _seErrorCount = 0;
    }
  });

  if (_seErrorCount >= 3 && _se_running) {
    se_stopBot();
    alert('连续报错 3 次，策略已自动停止');
  }

  // 限制 DOM 节点数量（最多 300 条）
  while (area.children.length > 300) {
    area.removeChild(area.firstChild);
  }

  // 自动滚到底部
  area.scrollTop = area.scrollHeight;
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
