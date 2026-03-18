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
const SE_GUIDE_TEXT = `========================================
  BTCQDD \u7b56\u7565\u7f16\u8f91\u5668\u6307\u5357
========================================

\u7b2c\u4e00\u90e8\u5206\uff1a\u4f7f\u7528\u8bf4\u660e\uff08\u7ed9\u4eba\u770b\uff09

1. \u8fd9\u662f\u4ec0\u4e48
   \u7b56\u7565\u7f16\u8f91\u5668\u8ba9\u4f60\u7528 JavaScript \u7f16\u5199\u4ea4\u6613\u7b56\u7565\uff0c
   \u5728 Polymarket \u52a0\u5bc6\u8d27\u5e01 Up/Down \u5e02\u573a\u4e0a\u8fdb\u884c Paper Trading\u3002
   \u7b56\u7565\u4ee3\u7801\u6bcf\u6b21\u4ef7\u683c\u53d8\u52a8\u65f6\u88ab\u8c03\u7528\uff0c\u8fd4\u56de\u4ea4\u6613\u51b3\u7b56\u3002

2. Paper \u6a21\u5f0f vs \u771f\u5b9e\u73af\u5883
   \u5f53\u524d\u8fd0\u884c\u5728 Paper \u6a21\u5f0f\uff0c\u4e0e\u771f\u5b9e\u4ea4\u6613\u6709\u4ee5\u4e0b\u5dee\u5f02\uff1a
   - \u6210\u4ea4\u6761\u4ef6\uff1a\u6302\u5355\u4ef7 >= \u5356\u4e00\u4ef7(ask)\u65f6\u624d\u6210\u4ea4\uff08\u771f\u5b9e maker \u884c\u4e3a\uff09
     \u2192 \u6302\u5728 mid \u4ef7\u4f4d\u53ef\u80fd\u4e0d\u4f1a\u7acb\u5373\u6210\u4ea4\uff0c\u9700\u8981\u7b49\u5f85
     \u2192 \u60f3\u7acb\u5373\u6210\u4ea4\u8bf7\u7528\u5bf9\u8c61\u683c\u5f0f\u6307\u5b9a ask \u4ef7\u683c
   - \u6210\u4ea4\u6982\u7387\uff1aoptimistic \u6a21\u5f0f\uff08\u89e6\u4ef7\u5373\u6210\u4ea4\uff09\uff0c\u771f\u5b9e\u73af\u5883\u7ea6 30-70%
   - \u624b\u7eed\u8d39\uff1amaker \u9650\u4ef7\u5355 = 0 \u8d39\u7528 + \u6bcf\u65e5\u8fd4\u5229\uff1btaker \u5e02\u4ef7\u5355 = 0.5-1.56%
   - \u5e76\u53d1\u7ade\u4e89\uff1aPaper \u6ca1\u6709\u5176\u4ed6\u505a\u5e02\u5546\u7ade\u4e89\uff0c\u771f\u5b9e\u73af\u5883\u6709
   - PnL \u8ba1\u7b97\uff1a\u7ed3\u7b97\u5236\uff08\u7a97\u53e3\u7ed3\u675f\u540e\u624d\u8ba1\u7b97\u76c8\u4e8f\uff09

3. \u8ba2\u5355\u72b6\u6001\u6d41\u8f6c
   \u4e0b\u5355 \u2192 \u6302\u5355\u4e2d(OPEN) \u2192 \u6210\u4ea4(FILLED)
   CLOSE \u65f6\uff1aOPEN \u2192 \u5df2\u64a4\u5355(CANCELLED)\uff0cFILLED \u2192 \u5df2\u5e73\u4ed3(CLOSED)
   \u7a97\u53e3\u5207\u6362 \u2192 FILLED/CLOSED \u8ba2\u5355\u53c2\u4e0e\u7ed3\u7b97\uff0cCANCELLED \u4e0d\u53c2\u4e0e

4. \u6301\u4ed3\u9650\u5236
   \u603b\u6301\u4ed3\u4e0a\u9650 $1\u3002\u8d85\u8fc7\u65f6\u65b0\u7684 BUY \u6307\u4ee4\u4f1a\u88ab\u62d2\u7edd\uff08\u65e5\u5fd7\u663e\u793a position limit\uff09\u3002

========================================

\u7b2c\u4e8c\u90e8\u5206\uff1a\u63a5\u53e3\u6587\u6863\uff08\u7ed9 AI \u770b\uff09

1. \u51fd\u6570\u7b7e\u540d
   function decide(ctx) { ... return ACTION; }

2. \u8fd4\u56de\u503c

   \u5b57\u7b26\u4e32\u683c\u5f0f\uff08\u7b80\u5355\uff09\uff1a
   - 'BUY_UP'    \u4e70 UP token\uff08\u4ef7\u683c = ctx.price.up\uff0c\u6570\u91cf = 1\uff09
   - 'BUY_DOWN'  \u4e70 DOWN token\uff08\u4ef7\u683c = ctx.price.down\uff0c\u6570\u91cf = 1\uff09
   - 'HOLD'      \u4e0d\u64cd\u4f5c
   - 'CLOSE'     \u5e73\u4ed3\uff1aOPEN \u8ba2\u5355\u64a4\u5355\uff0cFILLED \u8ba2\u5355\u6807\u8bb0\u5df2\u5e73\u4ed3

   \u5bf9\u8c61\u683c\u5f0f\uff08\u7cbe\u7ec6\u63a7\u5236\uff09\uff1a
   return {
     action: 'BUY',
     side: 'UP',        // 'UP' \u6216 'DOWN'
     price: 0.35,       // \u81ea\u5b9a\u4e49\u6302\u5355\u4ef7\uff08\u9ed8\u8ba4 = ctx.price.up/down\uff09
     size: 3            // \u4e0b\u5355\u6570\u91cf\uff08\u9ed8\u8ba4 = 1\uff09
   };
   \u2192 price \u8bbe\u4e3a ctx.orderbook.ask_down \u53ef\u4ee5\u7acb\u5373\u6210\u4ea4
   \u2192 price \u8bbe\u4e3a ctx.price.down (mid) \u53ef\u80fd\u9700\u8981\u7b49\u5f85

3. ctx \u5b57\u6bb5\u5b8c\u6574\u5217\u8868

   ctx.price
     .up          number 0~1    UP token \u4e2d\u95f4\u4ef7
     .down        number 0~1    DOWN token \u4e2d\u95f4\u4ef7
     .btc         number        BTC/USDT \u5b9e\u65f6\u4ef7\u683c
     .spread      number        |up - down| \u4ef7\u5dee

   ctx.window
     .remaining_sec  number|\u200bnull  \u7a97\u53e3\u5269\u4f59\u79d2\u6570
     .period         string       "5m" \u6216 "15m"
     .slug           string|\u200bnull  \u7a97\u53e3\u552f\u4e00\u6807\u8bc6

   ctx.orderbook
     .mid_up      number|null   UP \u4e2d\u95f4\u4ef7
     .mid_down    number|null   DOWN \u4e2d\u95f4\u4ef7
     .bid_up      number|null   UP \u6700\u4f18\u4e70\u4ef7
     .ask_up      number|null   UP \u6700\u4f18\u5356\u4ef7
     .bid_down    number|null   DOWN \u6700\u4f18\u4e70\u4ef7
     .ask_down    number|null   DOWN \u6700\u4f18\u5356\u4ef7

   ctx.position
     .up          number        \u5f53\u524d UP \u6301\u4ed3\u4efd\u6570
     .down        number        \u5f53\u524d DOWN \u6301\u4ed3\u4efd\u6570
     .total       number        \u603b\u6301\u4ed3

   ctx.volatility   number        ATR14 \u6ce2\u52a8\u7387 (%)\uff0c\u7a97\u53e3\u5185\u56fa\u5b9a\u503c

   ctx.orders       Array         \u5f53\u524d\u6d3b\u8dc3\u6302\u5355\u5217\u8868
     [i].order_id   string
     [i].side       'UP'|'DOWN'
     [i].price      number
     [i].size       number
     [i].status     'OPEN'
     [i].age_ms     number        \u6302\u5355\u5df2\u5b58\u6d3b\u6beb\u79d2

   ctx.stats
     .pnl         number        \u7d2f\u8ba1\u76c8\u4e8f ($)
     .wins        number        \u80dc\u573a\u6570
     .losses      number        \u8d1f\u573a\u6570
     .trades      number        \u603b\u4ea4\u6613\u6b21\u6570 (wins+losses)

   ctx.regime
     .score       null           \u672a\u63a5\u5165\uff08\u59cb\u7ec6\u4e3a null\uff09
     .sigma       null           \u672a\u63a5\u5165
     .alternation null           \u672a\u63a5\u5165

4. \u72b6\u6001\u6301\u4e45\u5316\uff08\u8de8 tick \u4fdd\u5b58\u6570\u636e\uff09
   \u5fc5\u987b\u7528 globalThis\uff0c\u7edd\u5bf9\u4e0d\u80fd\u7528 window\uff01
   if (!globalThis._s) globalThis._s = { count: 0 };
   globalThis._s.count += 1;

   \u547d\u540d\u5efa\u8bae\uff1a\u4f7f\u7528 _v1_xxx / _s_xxx \u524d\u7f00
   \uff08deploy \u65f6\u6846\u67b6\u4f1a\u81ea\u52a8\u6e05\u7406 _v*/_s*/_test*/_simple* \u524d\u7f00\u53d8\u91cf\uff09

5. \u5b89\u5168\u6ce8\u610f\u4e8b\u9879
   - \u7edd\u5bf9\u4e0d\u80fd\u7528 window\uff08Node.js \u73af\u5883\uff0c\u4f1a\u5d29\u6e83\uff09
   - \u4e0d\u8981\u5199\u540c\u6b65\u6b7b\u5faa\u73af while(true)\uff08\u4f1a\u5361\u6b7b\u670d\u52a1\uff09
   - \u4e0d\u8981\u4fee\u6539 globalThis._btcqdd* \u524d\u7f00\u53d8\u91cf\uff08\u6846\u67b6\u5185\u90e8\u7528\uff09
   - \u4e0d\u80fd\u7528 require() \u6216 import()\uff08\u5b89\u5168\u9650\u5236\uff09
   - remaining_sec \u53ef\u80fd\u4e3a null\uff0c\u4f7f\u7528\u524d\u5fc5\u987b\u68c0\u67e5\uff1a
     if (ctx.window.remaining_sec != null && ctx.window.remaining_sec < 60)
     \u2192 \u76f4\u63a5\u5199 remaining_sec < 60 \u4f1a\u8bef\u89e6\u53d1\uff08null < 60 === true\uff09

6. \u8c03\u8bd5
   console.log() \u8f93\u51fa\u5230\u53f3\u4fa7\u65e5\u5fd7\u9762\u677f\u3002

7. \u793a\u4f8b\u7b56\u7565

   // \u4f4e\u4ef7\u63a5\u535a\u7b56\u7565
   function decide(ctx) {
     if (!globalThis._s) globalThis._s = { bought: false };

     // \u7a97\u53e3\u5373\u5c06\u7ed3\u675f\u65f6\u5e73\u4ed3
     if (ctx.window.remaining_sec != null && ctx.window.remaining_sec < 30) {
       globalThis._s.bought = false;
       return 'CLOSE';
     }

     // \u5df2\u6301\u4ed3\u5219\u4e0d\u91cd\u590d\u5f00\u4ed3
     if (ctx.position.total > 0 || globalThis._s.bought) return 'HOLD';

     // DOWN \u4ef7\u683c\u4f4e\u4e8e 0.15 \u65f6\u4e70\u5165\uff08\u7528 ask \u4ef7\u7acb\u5373\u6210\u4ea4\uff09
     if (ctx.price.down != null && ctx.price.down < 0.15) {
       globalThis._s.bought = true;
       return {
         action: 'BUY', side: 'DOWN',
         price: ctx.orderbook.ask_down,
         size: 1
       };
     }
     return 'HOLD';
   }
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
          <div style="flex:1;background:#1e1e1e;border:1px solid #333;padding: 0 16px;display:flex;flex-direction:column;border-bottom:none;">
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

    // 延迟显示
    const latEl = document.getElementById('se-latency');
    if (latEl && status.latency) {
      const d = status.latency.decide_ms;
      const o = status.latency.order_ms;
      latEl.textContent = '\u5ef6\u8fdf: \u51b3\u7b56 ' + d + 'ms | \u4e0b\u5355 ' + o + 'ms';
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
    } else if (o.status === 'cancelled') {
      typeText = '已撤单';
      typeStyle = 'color:#666';
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
  if (!W || W < 50) return;  // 容器未渲染或太小，跳过
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
