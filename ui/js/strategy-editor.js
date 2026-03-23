/**
 * strategy-editor.js/**
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

// Bot 参数默认值与缓存 Key
const BOT_PARAMS_CACHE_KEY = 'btcqdd_bot_params';
const BOT_DEFAULT_PARAMS = {
  executor_mode: 'paper-staging',
  open_delay_sec: 10,
  max_position_usd: 100,
  cancel_all_before_expiry_sec: 100,
  atr_multiplier: 1.2,
  ladder_size: 5,
  ladder_prices: '0.27,0.24,0.21,0.18'
};

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
          <!-- 静态参数区骨架 -->
          <div id="se-params-form" style="padding: 20px; color: #ddd; display: flex; flex-direction: column; gap: 15px; flex:1;">
            
            <div style="display:flex; gap:20px; flex-wrap:wrap;">
              <!-- executor_mode (只读) -->
              <div style="flex:1; min-width:200px;">
                <label style="display:block; margin-bottom:5px; font-weight:bold;">运行环境 (executor_mode):</label>
                <select id="param_executor_mode" disabled style="background:#222; border:1px solid #444; color:#aaa; padding:6px; border-radius:4px; width:100%;">
                  <option value="paper-staging" selected>paper-staging (可用)</option>
                  <option value="live">live (未开放)</option>
                </select>
                <div style="font-size:0.8em; color:#888; margin-top:4px;">* 当前仅支持 paper-staging，Live 模式已后置。</div>
              </div>

              <!-- open_delay_sec -->
              <div style="flex:1; min-width:200px;">
                <label style="display:block; margin-bottom:5px; font-weight:bold;">开仓延迟秒数 (open_delay_sec):</label>
                <input type="number" id="param_open_delay_sec" style="background:#1e1e1e; border:1px solid #555; color:#fff; padding:6px; border-radius:4px; width:100%; box-sizing:border-box;">
              </div>
            </div>

            <div style="display:flex; gap:20px; flex-wrap:wrap;">
              <!-- max_position_usd -->
              <div style="flex:1; min-width:200px;">
                <label style="display:block; margin-bottom:5px; font-weight:bold;">最大持仓上限 (max_position_usd):</label>
                <input type="number" id="param_max_position_usd" style="background:#1e1e1e; border:1px solid #555; color:#fff; padding:6px; border-radius:4px; width:100%; box-sizing:border-box;">
              </div>

              <!-- cancel_all_before_expiry_sec -->
              <div style="flex:1; min-width:200px;">
                <label style="display:block; margin-bottom:5px; font-weight:bold;">平仓保护倒计时 (cancel_all_before_expiry_sec):</label>
                <input type="number" id="param_cancel_all_before_expiry_sec" style="background:#1e1e1e; border:1px solid #555; color:#fff; padding:6px; border-radius:4px; width:100%; box-sizing:border-box;">
              </div>
            </div>

            <div style="display:flex; gap:20px; flex-wrap:wrap;">
              <!-- atr_multiplier -->
              <div style="flex:1; min-width:200px;">
                <label style="display:block; margin-bottom:5px; font-weight:bold;">ATR 乘数 (atr_multiplier):</label>
                <input type="number" step="0.1" id="param_atr_multiplier" style="background:#1e1e1e; border:1px solid #555; color:#fff; padding:6px; border-radius:4px; width:100%; box-sizing:border-box;">
              </div>

              <!-- ladder_size -->
              <div style="flex:1; min-width:200px;">
                <label style="display:block; margin-bottom:5px; font-weight:bold;">阶梯下单份数 (ladder_size):</label>
                <input type="number" id="param_ladder_size" style="background:#1e1e1e; border:1px solid #555; color:#fff; padding:6px; border-radius:4px; width:100%; box-sizing:border-box;">
              </div>
            </div>

            <div>
              <!-- ladder_prices -->
              <label style="display:block; margin-bottom:5px; font-weight:bold;">阶梯挂单价格列表 (ladder_prices) [逗号分隔]:</label>
              <input type="text" id="param_ladder_prices" style="background:#1e1e1e; border:1px solid #555; color:#fff; padding:6px; border-radius:4px; width:100%; box-sizing:border-box;">
            </div>

            <div style="margin-top: 20px; padding: 10px; background: rgba(255, 152, 0, 0.1); border-left: 4px solid #ff9800; border-radius: 4px; font-style: italic; color: #ffb74d;">
              <strong>提示：</strong>当前页面仅为前端参数骨架，尚未连接真实的 Bot 主链。点击"保存参数"仅会保存在浏览器本地缓存(localStorage)中，不会影响后端运行逻辑。
            </div>
          </div>
          <!-- 隐藏原代码编辑框以防报错 -->
          <textarea id="se-editor" style="display:none;">function decide(ctx) { return 'HOLD'; }</textarea>
          <div class="se-actions">
            <button id="se-btn-deploy" class="se-btn-deploy" onclick="se_deploy()">▶ 启动 Bot</button>
            <div class="se-status" style="margin-left:auto; display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span id="se-status-dot" class="se-dot se-dot-off"></span>
                <span id="se-status-label">已停止</span>
              </div>
              <div id="se-bot-state-tip" style="font-size:11px;color:#999;">当前为只读 Bot 状态骨架，尚未接主循环</div>
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
          <div class="se-panel" style="flex-shrink:0; padding:10px 12px; border:1px solid #333; background:#161616;">
            <div style="font-size:12px; color:#bbb; margin-bottom:6px;">当前策略意图</div>
            <div id="se-decision-value" style="font-size:16px; color:#00e676; font-weight:700;">—</div>
            <div id="se-decision-reason" style="font-size:12px; color:#999; margin-top:4px;">reason: —</div>
            <div id="se-decision-diag" style="font-size:11px; color:#888; margin-top:4px; line-height:1.45;">diagnostics: —</div>
          </div>
          <div style="flex:1;background:#1e1e1e;border:1px solid #333;padding: 0 16px;display:flex;flex-direction:column;border-bottom:none;">
            <div id="se-pnl-title" style="padding:4px 8px;border-bottom:1px solid #333;font-size:12px;color:#aaa;">累计 PnL</div>
            <div style="flex:1;position:relative;">
              <svg id="se-pnl-chart" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;"></svg>
            </div>
          </div>
        </div>

        <!-- 右侧订单面板 -->
        <div class="se-order-panel">
          <div class="se-order-title">Bot 账本订单</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 0;">
            <button class="se-btn" onclick="se_applyPaperAction('PLACE_BOTH_LADDERS')" style="background:#1f6f4a;color:#fff;border:1px solid #2c8f61;padding:6px;border-radius:4px;cursor:pointer;">PLACE_BOTH</button>
            <button class="se-btn" onclick="se_applyPaperAction('CANCEL_NO_OPEN')" style="background:#7a3a3a;color:#fff;border:1px solid #9a4b4b;padding:6px;border-radius:4px;cursor:pointer;">CANCEL_NO</button>
            <button class="se-btn" onclick="se_applyPaperAction('CANCEL_YES_OPEN')" style="background:#7a3a3a;color:#fff;border:1px solid #9a4b4b;padding:6px;border-radius:4px;cursor:pointer;">CANCEL_YES</button>
            <button class="se-btn" onclick="se_applyPaperAction('CANCEL_ALL_OPEN')" style="background:#5a2d7a;color:#fff;border:1px solid #7a3f9f;padding:6px;border-radius:4px;cursor:pointer;">CANCEL_ALL</button>
          </div>
          <table class="se-order-table" style="table-layout:fixed;width:100%;">
            <colgroup><col style="width:22%"><col style="width:22%"><col style="width:28%"><col style="width:28%"></colgroup>
            <thead><tr><th>来源</th><th>方向</th><th>价格</th><th>状态</th></tr></thead>
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
  se_loadParams();

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
  se_startPoll();

}

// ── Bot 参数管理逻辑 ────────────────────────────────────────────────────────
function se_loadParams() {
  let params = { ...BOT_DEFAULT_PARAMS };
  try {
    const cached = localStorage.getItem(BOT_PARAMS_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      params = { ...params, ...parsed }; // 合并缓存值
    }
  } catch (e) {
    console.warn('[SE] Failed to load params from localStorage', e);
  }
  se_renderParams(params);
}

function se_renderParams(params) {
  document.getElementById('param_executor_mode').value = params.executor_mode || 'paper-staging';
  document.getElementById('param_open_delay_sec').value = params.open_delay_sec;
  document.getElementById('param_max_position_usd').value = params.max_position_usd;
  document.getElementById('param_cancel_all_before_expiry_sec').value = params.cancel_all_before_expiry_sec;
  document.getElementById('param_atr_multiplier').value = params.atr_multiplier;
  document.getElementById('param_ladder_size').value = params.ladder_size;
  document.getElementById('param_ladder_prices').value = params.ladder_prices;
}

function se_restoreDefaultParams() {
  if (confirm('确定要恢复为默认参数吗？')) {
    se_renderParams(BOT_DEFAULT_PARAMS);
    se_saveParams(true);
  }
}

function se_saveParams(silent = false) {
  const params = {
    executor_mode: document.getElementById('param_executor_mode').value,
    open_delay_sec: Number(document.getElementById('param_open_delay_sec').value),
    max_position_usd: Number(document.getElementById('param_max_position_usd').value),
    cancel_all_before_expiry_sec: Number(document.getElementById('param_cancel_all_before_expiry_sec').value),
    atr_multiplier: Number(document.getElementById('param_atr_multiplier').value),
    ladder_size: Number(document.getElementById('param_ladder_size').value),
    ladder_prices: document.getElementById('param_ladder_prices').value
  };

  try {
    localStorage.setItem(BOT_PARAMS_CACHE_KEY, JSON.stringify(params));
    if (!silent) {
      alert('参数已保存到本地缓存 (localStorage)！\n注意：当前为壳收敛阶段，暂未接后端 API。');
    }
  } catch (e) {
    console.error('[SE] Failed to save params', e);
    alert('保存参数失败！');
  }
}

// ── 以下为原有逻辑 ──────────────────────────────────────────────────────────

// 部署 / 停止
async function se_deploy() {
  const code = document.getElementById('se-editor').value.trim();
  if (!code) { alert('请先编写策略代码'); return; }

  try {
    new Function(code);
  } catch (e) {
    alert('语法错误：' + e.message);
    return;
  }

  if (_se_running) {
    // 当前运行中 → 停止
    await se_stop();
    return;
  }

  try {
    const res = await fetch(`${BASE_URL}/strategy-runner/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, period: _se_period })
    });
    const data = await res.json();
    if (data.ok) {
      _se_running = true;
      _seLastLogTs = '';
      _seErrorCount = 0;
      const logArea = document.getElementById('se-log-area');
      if (logArea) logArea.innerHTML = '';
      se_appendLog('SYSTEM', '策略已启动');
      se_updateRunningUI(true);
     // 清空旧数据
      _seLastLogTs = '';
      if (typeof se_startPoll === 'function') se_startPoll();
    } else {
      se_appendLog('ERROR', data.error || '部署失败');
    }
  } catch (err) {
    se_appendLog('ERROR', err.message);
  }
}

async function se_stop() {
  try {
    await fetch(`${BASE_URL}/strategy-runner/stop`, { method: 'POST' });
  } catch (_) {}
  _se_running = false;
  se_updateRunningUI(false);
}

function se_updateRunningUI(running) {
  const btn = document.getElementById('se-btn-deploy');
  const dot = document.getElementById('se-status-dot');
  const label = document.getElementById('se-status-label');
  if (running) {
    btn.textContent = '⏹ 停止 Bot';
    btn.classList.add('se-btn-stop');
    btn.classList.remove('se-btn-deploy');
    dot.className = 'se-dot se-dot-on';
    label.textContent = '运行中';
  } else {
    btn.textContent = '▶ 启动 Bot';
    btn.classList.remove('se-btn-stop');
    btn.classList.add('se-btn-deploy');
    dot.className = 'se-dot se-dot-off';
    label.textContent = '已停止';
  }
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
    const [contextRes, statusRes, logsRes, decisionRes, ordersRes, summaryRes] = await Promise.all([
      fetch(`${BASE_URL}/bot/context`),
      fetch(`${BASE_URL}/bot/status`),
      fetch(`${BASE_URL}/bot/logs?limit=200`),
      fetch(`${BASE_URL}/bot/decision-preview`),
      fetch(`${BASE_URL}/bot/orders`),
      fetch(`${BASE_URL}/bot/paper/summary`)
    ]);
    const context = await contextRes.json();
    const status = await statusRes.json();
    const logsData = await logsRes.json();
    const decisionData = await decisionRes.json();
    const ordersData = await ordersRes.json();
    const summaryData = await summaryRes.json();

    se_renderContext(context, status);
    se_renderDecision(decisionData);
    se_renderPnlChart(summaryData);
    se_renderLogs(Array.isArray(logsData) ? logsData : (logsData.logs || []));
    se_renderOrders(ordersData);

    const remaining = context.remaining_sec ?? null;
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
    if (status.phase === 'IDLE' && _se_running) {
      _se_running = false;
      se_updateRunningUI(false);
    }
  } catch (err) {
    console.warn('[se] poll error:', err.message);
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
  const rows = list.map((o) => {
    const cls = o.side === 'YES' ? 'up-color' : 'down-color';
    const statusColor = o.status === 'OPEN' ? '#00e676' : (o.status === 'FILLED' ? '#ffb74d' : '#888');
    const orderPriceText = typeof o.price === 'number' ? o.price.toFixed(3) : '--';
    const fillPriceText = typeof o.fill_price === 'number' ? o.fill_price.toFixed(3) : '--';
    const priceCell = `${orderPriceText}<div style="font-size:11px;color:#aaa;">fill:${fillPriceText}</div>`;
    return `<tr><td>${se_formatStateValue(o.source)}</td><td class="${cls}">${se_formatStateValue(o.side)}</td><td>${priceCell}</td><td style="color:${statusColor}">${se_formatStateValue(o.status)}</td></tr>`;
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
    se_stop();
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
});
