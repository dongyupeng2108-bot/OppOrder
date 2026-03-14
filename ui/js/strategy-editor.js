/**
 * strategy-editor.js
 * SE-2: 策略编辑器 UI 逻辑
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
  
  if (ctx.window.remaining_sec < 60) return 'CLOSE'; // 收盘前平仓
  
  if (trend === 'UP') return 'BUY_UP';
  if (trend === 'DOWN') return 'BUY_DOWN';
  
  return 'HOLD';
}`;

// AI 指南文案
const SE_GUIDE_TEXT = `🤖 AI 策略编写指南

1. 函数签名
   function decide(ctx) { ... return ACTION; }

2. 上下文对象 (ctx)
   - ctx.price.up       : UP token 当前价格 (0.0 ~ 1.0)
   - ctx.price.down     : DOWN token 当前价格 (0.0 ~ 1.0)
   - ctx.price.btc      : BTC/USDT 现货价格
   - ctx.regime.score   : 市场状态评分 (0.0=强趋势, 1.0=完全震荡)
   - ctx.window.remaining_sec : 当前 15m/5m 窗口剩余秒数
   - ctx.orderbook.mid  : 当前盘口中间价 (用于精细定价)

3. 返回值 (Action)
   - 'BUY_UP'   : 买入/持有 UP token
   - 'BUY_DOWN' : 买入/持有 DOWN token
   - 'HOLD'     : 保持当前持仓 (不交易)
   - 'CLOSE'    : 平掉所有持仓 (通常在窗口结束前)

4. 示例策略
   // 震荡策略 (Regime Score > 0.7)
   if (ctx.regime.score > 0.7) {
     if (ctx.price.up < 0.2) return 'BUY_UP';   // 超跌反弹
     if (ctx.price.down < 0.2) return 'BUY_DOWN';
   }
   // 趋势策略 (Regime Score < 0.3)
   else if (ctx.regime.score < 0.3) {
     if (ctx.price.up > 0.6) return 'BUY_UP';   // 追涨
     if (ctx.price.down > 0.6) return 'BUY_DOWN';
   }
   return 'HOLD';

5. 调试
   使用 console.log() 输出日志，会在右侧日志面板显示。
`;

// 状态管理
let _se_running = false;
let _se_period = '15m';
let _se_pollTimer = null;
const BASE_URL = ''; // 相对路径

// 初始化
function initStrategyEditor() {
  const container = document.getElementById('se-container');
  if (!container) return; // 避免重复初始化或找不到容器

  // 如果已有内容，不再重绘（保留状态）
  if (container.innerHTML.trim()) return;

  container.innerHTML = `
    <div class="se-layout">
      <!-- 左栏 -->
      <div class="se-left">
        <div class="se-toolbar">
          <div class="se-period-toggle">
            <button id="se-btn-5m" class="se-period-btn" onclick="se_setPeriod('5m')">5m</button>
            <button id="se-btn-15m" class="se-period-btn se-period-active" onclick="se_setPeriod('15m')">15m</button>
          </div>
          <div class="se-status">
            <span id="se-status-dot" class="se-dot se-dot-off"></span>
            <span id="se-status-label">已停止</span>
          </div>
        </div>
        <textarea id="se-editor" class="se-code-area" spellcheck="false" placeholder="在此编写 decide(ctx) 函数..."></textarea>
        <div class="se-actions">
          <button id="se-btn-deploy" class="se-btn-deploy" onclick="se_deploy()">▶ 部署运行</button>
          <button class="se-btn-save" onclick="se_save()">保存</button>
          <button class="se-btn-guide" onclick="se_showGuide()">🤖 AI 指南</button>
        </div>
      </div>

      <!-- 右栏 -->
      <div class="se-right">
        <div class="se-panel">
          <div class="se-panel-title">实时日志</div>
          <div id="se-log-area" class="se-log-area"></div>
        </div>
        <div class="se-panel se-stats-panel">
          <div class="se-stat-item">
            <div class="se-stat-label">交易次数</div>
            <div id="se-stat-trades" class="se-stat-value">0</div>
          </div>
          <div class="se-stat-item">
            <div class="se-stat-label">胜率</div>
            <div id="se-stat-winrate" class="se-stat-value">—</div>
          </div>
          <div class="se-stat-item">
            <div class="se-stat-label">运行时长</div>
            <div id="se-stat-uptime" class="se-stat-value">0s</div>
          </div>
        </div>
        <div class="se-panel">
          <div class="se-panel-title">累计 PnL</div>
          <svg id="se-pnl-chart" class="se-pnl-svg" viewBox="0 0 300 80" preserveAspectRatio="none">
            <text x="150" y="45" text-anchor="middle" class="se-chart-placeholder">运行后显示</text>
          </svg>
        </div>
        <div class="se-panel">
          <div class="se-panel-title">Context 参考</div>
          <div class="se-context-ref">
            <div class="se-ctx-row"><span class="se-ctx-key">ctx.price.up/down</span><span class="se-ctx-desc">UP/DOWN token 价格 (0~1)</span></div>
            <div class="se-ctx-row"><span class="se-ctx-key">ctx.price.btc</span><span class="se-ctx-desc">BTC/USDT 现价</span></div>
            <div class="se-ctx-row"><span class="se-ctx-key">ctx.regime.score</span><span class="se-ctx-desc">市场评分 (0=趋势,1=震荡)</span></div>
            <div class="se-ctx-row"><span class="se-ctx-key">ctx.window.remaining_sec</span><span class="se-ctx-desc">窗口剩余秒数</span></div>
            <div class="se-ctx-row"><span class="se-ctx-key">ctx.orderbook.mid</span><span class="se-ctx-desc">盘口中间价</span></div>
          </div>
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

  // 恢复上次代码（localStorage）
  const saved = localStorage.getItem('se_code');
  document.getElementById('se-editor').value = saved || SE_DEFAULT_CODE;
  document.getElementById('se-guide-text').textContent = SE_GUIDE_TEXT;
}

// 部署 / 停止
async function se_deploy() {
  const code = document.getElementById('se-editor').value.trim();
  if (!code) { alert('请先编写策略代码'); return; }

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
      se_updateRunningUI(true);
      se_startPoll();
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
  se_stopPoll();
}

function se_updateRunningUI(running) {
  const btn = document.getElementById('se-btn-deploy');
  const dot = document.getElementById('se-status-dot');
  const label = document.getElementById('se-status-label');
  if (running) {
    btn.textContent = '■ 停止';
    btn.classList.add('se-btn-stop');
    dot.className = 'se-dot se-dot-on';
    label.textContent = '运行中';
  } else {
    btn.textContent = '▶ 部署运行';
    btn.classList.remove('se-btn-stop');
    dot.className = 'se-dot se-dot-off';
    label.textContent = '已停止';
  }
}

// 保存 / 周期切换
function se_save() {
  const code = document.getElementById('se-editor').value;
  localStorage.setItem('se_code', code);
  // 视觉反馈：按钮短暂变色
  const btn = event.target;
  const orig = btn.textContent;
  btn.textContent = '已保存 ✓';
  setTimeout(() => { btn.textContent = orig; }, 1500);
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
    const [statusRes, logsRes] = await Promise.all([
      fetch(`${BASE_URL}/strategy-runner/status`),
      fetch(`${BASE_URL}/strategy-runner/logs`)
    ]);
    const status = await statusRes.json();
    const logsData = await logsRes.json();

    se_renderStats(status);
    se_renderPnlChart(status.pnl_series || []);
    se_renderLogs(logsData.logs || []);

    // 如果服务端显示已停止，同步前端状态
    if (!status.running && _se_running) {
      _se_running = false;
      se_updateRunningUI(false);
      se_stopPoll();
    }
  } catch (err) {
    console.warn('[se] poll error:', err.message);
  }
}

// 渲染统计、日志、PnL 图
function se_renderStats(status) {
  const stats = status.stats || {};
  document.getElementById('se-stat-trades').textContent = stats.trades ?? 0;
  const winRate = stats.trades > 0
    ? Math.round((stats.wins / stats.trades) * 100) + '%'
    : '—';
  document.getElementById('se-stat-winrate').textContent = winRate;
  document.getElementById('se-stat-uptime').textContent =
    se_formatUptime(status.uptime_sec || 0);
}

function se_formatUptime(sec) {
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm';
  return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
}

function se_renderLogs(logs) {
  const area = document.getElementById('se-log-area');
  if (!logs.length) return;
  // 只追加新日志（避免重绘整个列表）
  const existing = area.children.length;
  const newLogs = logs.slice(existing);
  newLogs.forEach(log => {
    const div = document.createElement('div');
    div.className = `se-log-entry se-log-${log.type?.toLowerCase() || 'info'}`;
    const time = new Date(log.ts).toLocaleTimeString('zh-CN', { hour12: false });
    div.textContent = `${time} [${log.type}] ${log.msg}`;
    area.appendChild(div);
  });
  // 自动滚到底部
  area.scrollTop = area.scrollHeight;
}

function se_renderPnlChart(pnlSeries) {
  const svg = document.getElementById('se-pnl-chart');
  if (!pnlSeries.length) return;

  const W = 300, H = 80, PAD = 10;
  const pnls = pnlSeries.map(p => p.pnl);
  const minP = Math.min(...pnls), maxP = Math.max(...pnls);
  const range = maxP - minP || 1;

  const points = pnlSeries.map((p, i) => {
    const x = PAD + (i / Math.max(pnlSeries.length - 1, 1)) * (W - PAD * 2);
    const y = H - PAD - ((p.pnl - minP) / range) * (H - PAD * 2);
    return `${x},${y}`;
  }).join(' ');

  const lastPnl = pnls[pnls.length - 1];
  const color = lastPnl >= 0 ? 'var(--color-up)' : 'var(--color-down)';

  svg.innerHTML = `
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2"/>
    <text x="${W - PAD}" y="${PAD + 10}" text-anchor="end" fill="${color}" font-size="11">
      ${lastPnl >= 0 ? '+' : ''}${lastPnl.toFixed(3)}
    </text>`;
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
