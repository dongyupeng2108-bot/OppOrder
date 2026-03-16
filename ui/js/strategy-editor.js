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
  
  if (ctx.window.remaining_sec != null && ctx.window.remaining_sec < 60) return 'CLOSE'; // 收盘前平仓
  
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

6. 重要：运行环境
策略代码在 Node.js 服务端 eval() 执行，不是浏览器环境。
- 不能用 window（Node.js 中不存在，会导致服务崩溃）
- 必须用 globalThis 替代 window
- 跨 tick 保存状态示例：
  if (!globalThis._s) globalThis._s = { up: 0, down: 0 };
  globalThis._s.up += 1;

---

## CONTEXT 字段速查

| 字段 | 类型 | 说明 |
|------|------|------|
| ctx.price.up | number 0~1 | UP token 当前价格 |
| ctx.price.down | number 0~1 | DOWN token 当前价格 |
| ctx.price.btc | number | BTC/USDT 现价 |
| ctx.price.spread | number | |up - down| 价差 |
| ctx.regime.score | number 0~1 | 市场评分（0=趋势，1=震荡）|
| ctx.regime.sigma | number | BTC 波动率 |
| ctx.regime.alternation | number | 涨跌交替度 |
| ctx.window.remaining_sec | number | 窗口剩余秒数 |
| ctx.window.period | string | "5m" 或 "15m" |
| ctx.orderbook.mid | number | 盘口中间价 |
| ctx.orderbook.best_bid | number | 最优买价 |
| ctx.orderbook.best_ask | number | 最优卖价 |
`;

// 状态管理
let _se_running = false;
let _se_period = '5m';
let _se_pollTimer = null;
let _seLastLogTs = '';
let _seErrorCount = 0;
const BASE_URL = ''; // 相对路径

async function restartServer() {
  try { await fetch(`${BASE_URL}/server/restart`, { method: 'POST' }); }
  catch(e) { console.error('[SE] restart failed', e); }
}

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
        <div class="se-toolbar">
          <div class="se-period-toggle">
            <button id="se-btn-5m" class="se-period-btn se-period-active" onclick="se_setPeriod('5m')">5m</button>
            <button id="se-btn-15m" class="se-period-btn" onclick="se_setPeriod('15m')">15m</button>
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
        <!-- 左侧面板组 (日志 + 统计 + PnL) -->
        <div class="se-left-panels">
          <div class="se-panel" style="flex-shrink: 0; height: 160px;">
            <div class="se-log-header">
              <span>实时日志</span>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
                <button class="se-restart-inline-btn" onclick="restartServer()">⟳ 重启</button>
                <span id="se-countdown" style="font-size:11px;color:#aaa;font-family:monospace;display:block;margin-top:6px;text-align:right;">--:--</span>
              </div>
            </div>
            <div id="se-log-area" class="se-log-area"></div>
          </div>
          <div class="se-panel se-stats-panel" style="flex-shrink: 0;">
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
          <div style="flex:1;background:#1e1e1e;border:1px solid #333;display:flex;flex-direction:column;">
            <div id="se-pnl-title" style="padding:4px 8px;border-bottom:1px solid #333;font-size:12px;color:#aaa;">累计 PnL</div>
            <div style="flex:1;position:relative;">
              <svg id="se-pnl-chart" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;"></svg>
            </div>
          </div>
        </div>

        <!-- 右侧订单面板 -->
        <div class="se-order-panel">
          <div class="se-order-title">订单</div>
          <table class="se-order-table" style="table-layout:fixed;width:100%;">
            <colgroup><col style="width:22%"><col style="width:22%"><col style="width:28%"><col style="width:28%"></colgroup>
            <thead><tr><th>类型</th><th>方向</th><th>价格</th><th>PNL</th></tr></thead>
            <tbody id="se-order-body">
              <tr><td colspan="4" style="color:#555;text-align:center">暂无</td></tr>
            </tbody>
          </table>
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

  // 独立轮询：倒计时 + 日志，不依赖策略是否运行
  setInterval(async () => {
    try {
      const res = await fetch(`${BASE_URL}/strategy-runner/status`);
      const status = await res.json();
      // 更新倒计时
      const remaining = status.window?.remaining_sec ?? null;
      const el = document.getElementById('se-countdown');
      if (el) {
        if (remaining != null) {
          const m = Math.floor(remaining / 60);
          const s = remaining % 60;
          el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        } else {
          el.textContent = '--:--';
        }
      }
    } catch (_) {}
  }, 3000);
}

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
    se_renderOrders(status.orders);

    // 倒计时更新
    const remaining = status.window?.remaining_sec ?? null;
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
  const totalSettled = (stats.wins || 0) + (stats.losses || 0);
  const winRate = totalSettled > 0
    ? Math.round((stats.wins / totalSettled) * 100) + '%'
    : '—';
  document.getElementById('se-stat-winrate').textContent = winRate;
  document.getElementById('se-stat-uptime').textContent =
    se_formatUptime(status.uptime_sec || 0);

  // PnL 标题颜色：盈利绿色，亏损红色
  const pnlTitleEl = document.getElementById('se-pnl-title');
  if (pnlTitleEl) {
    pnlTitleEl.style.color = '#aaa';
    pnlTitleEl.textContent = '累计 PnL';
  }
}

function se_formatUptime(sec) {
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm';
  return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
}

function se_renderOrders(orders) {
  const tbody = document.getElementById('se-order-body');
  if (!tbody) return;
  const rows = [];
  for (const o of (orders?.open || [])) {
    const cls = o.side === 'UP' ? 'up-color' : 'down-color';
    rows.push(`<tr><td>挂单</td><td class="${cls}">${o.side}</td><td>${o.price?.toFixed(3) ?? '--'}</td><td style="color:#555">----</td></tr>`);
  }
  for (const o of (orders?.filled || [])) {
    const cls = o.side === 'UP' ? 'up-color' : 'down-color';
    let typeText = '持仓';
    let typeStyle = '';
    if (o.status === 'closed') {
      typeText = '已平仓';
      typeStyle = 'color:#888';
    } else if (o.status === 'filled') {
      typeText = '持仓';
    }
    
    rows.push(`<tr>
      <td style="${typeStyle}">${typeText}</td>
      <td class="${cls}">${o.side}</td>
      <td>${o.price?.toFixed(3) ?? '--'}</td>
      <td style="color:#888">待结算</td>
    </tr>`);
  }
  for (const e of (orders?.pending_settlement || [])) {
    rows.push(`<tr><td class="pending-color">待结算</td><td>--</td><td>--</td><td class="pending-color">${e.count}单</td></tr>`);
  }
  tbody.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="4" style="color:#555;text-align:center">暂无</td></tr>';
}

function se_renderLogs(logs) {
  const area = document.getElementById('se-log-area');
  if (!logs.length) return;

  // 只渲染比上次最后一条更新的日志
  const newLogs = _seLastLogTs
    ? logs.filter(l => l.ts > _seLastLogTs)
    : logs;

  if (newLogs.length === 0) return;

  _seLastLogTs = logs[logs.length - 1].ts;

  newLogs.forEach(log => {
    const div = document.createElement('div');
    div.className = `se-log-entry se-log-${log.type?.toLowerCase() || 'info'}`;
    const time = new Date(log.ts).toLocaleTimeString('zh-CN', { hour12: false });
    div.textContent = `${time} [${log.type}] ${log.msg}`;
    area.appendChild(div);

    if (log.type === 'ERROR') {
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
  if (!pnlSeries || pnlSeries.length < 1) {
    svg.innerHTML = '<text x="150" y="100" text-anchor="middle" fill="#666" font-size="12">运行后显示</text>';
    return;
  }

  const container = svg.parentElement;
  const W = container ? container.offsetWidth : 300;
  const H = container ? Math.min(container.offsetHeight, 250) : 200;
  const PAD = { top: 15, right: 10, bottom: 28, left: 45 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const pnls = pnlSeries.map(p => p.pnl);
  const minP = Math.min(...pnls, 0);
  const maxP = Math.max(...pnls, 0);
  const range = maxP - minP || 0.01;

  const toX = (i) => PAD.left + (i / Math.max(pnlSeries.length - 1, 1)) * chartW;
  const toY = (v) => PAD.top + chartH - ((v - minP) / range) * chartH;

  let html = '';

  // 背景
  html += `<rect x="${PAD.left}" y="${PAD.top}" width="${chartW}" height="${chartH}" fill="#1a1a2e" rx="2"/>`;

  // Y 轴网格线 + 标签（5 档）
  for (let i = 0; i <= 4; i++) {
    const val = minP + (range * i / 4);
    const y = toY(val);
    html += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="#333" stroke-width="0.5"/>`;
    html += `<text x="${PAD.left - 4}" y="${y + 3}" text-anchor="end" fill="#888" font-size="9">${val >= 0 ? '+' : ''}${val.toFixed(3)}</text>`;
  }

  // 零线（加粗）
  if (minP < 0 && maxP > 0) {
    const zeroY = toY(0);
    html += `<line x1="${PAD.left}" y1="${zeroY}" x2="${W - PAD.right}" y2="${zeroY}" stroke="#555" stroke-width="1" stroke-dasharray="4,2"/>`;
  }

  // X 轴时间标签（最多 5 个）
  const step = Math.max(1, Math.floor(pnlSeries.length / 5));
  for (let i = 0; i < pnlSeries.length; i += step) {
    const p = pnlSeries[i];
    if (!p.ts) continue;
    const d = new Date(p.ts);
    const label = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const x = toX(i);
    html += `<text x="${x}" y="${H - 5}" text-anchor="middle" fill="#888" font-size="9">${label}</text>`;
  }

  // 折线
  const lastPnl = pnls[pnls.length - 1];
  const color = lastPnl >= 0 ? '#00c853' : '#ff1744';
  const points = pnlSeries.map((p, i) => `${toX(i)},${toY(p.pnl)}`).join(' ');
  html += `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2"/>`;

  // 区域填充（折线到零线之间半透明填充）
  const zeroY = toY(0);
  const areaPoints = pnlSeries.map((p, i) => `${toX(i)},${toY(p.pnl)}`).join(' ');
  const lastX = toX(pnlSeries.length - 1);
  const firstX = toX(0);
  html += `<polygon points="${areaPoints} ${lastX},${zeroY} ${firstX},${zeroY}" fill="${color}" opacity="0.15"/>`;

  // 最新 PnL 数值（右上角，盈绿亏红）
  html += `<text x="${W - PAD.right}" y="${PAD.top + 12}" text-anchor="end" fill="${color}" font-size="10" font-weight="bold">${lastPnl >= 0 ? '+' : ''}${lastPnl.toFixed(4)}</text>`;

  // Y 轴线 + X 轴线
  html += `<line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${H - PAD.bottom}" stroke="#555" stroke-width="1"/>`;
  html += `<line x1="${PAD.left}" y1="${H - PAD.bottom}" x2="${W - PAD.right}" y2="${H - PAD.bottom}" stroke="#555" stroke-width="1"/>`;

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.innerHTML = html;
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
