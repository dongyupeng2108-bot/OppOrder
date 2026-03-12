// ─── Type map ────────────────────────────
const TH_TM = { pair:{icon:"⚖️",short:"配对"}, revert:{icon:"🎯",short:"回归"}, breakout:{icon:"📐",short:"突破"} };

// ─── State ──────────────────────────────
let th_score = null;
let th_side = 'buy';
let th_countdown = 300;
let th_timers = [];
let priceHistory = [];
const TH_LOG_MAX = 100;
const th_logBuffer = []; // { time, type, text }
let th_symbol    = 'BTC';  // 当前选中币种
let th_timeframe = '5m';   // 当前选中周期
let _th_pollCtrl = null;   // AbortController for polling loops
let _th_wsHandler = null;  // unified WS handler (for dedup via offWsEvent)

// ─── PM chart ────────────────────────────
function drawPmChart() {
  const svg = document.getElementById('pm-chart');
  if (!svg || priceHistory.length < 2) return;
  const rect = svg.getBoundingClientRect();
  const W = rect.width  || svg.parentElement?.getBoundingClientRect().width  || 600;
  const H = rect.height || svg.parentElement?.getBoundingClientRect().height || 160;
  if (W === 0 || H === 0) return;

  // 边距
  const PAD_RIGHT  = 44; // Y轴标签区
  const PAD_BOTTOM = 22; // X轴标签区
  const CW = W - PAD_RIGHT;
  const CH = H - PAD_BOTTOM;

  const vals  = priceHistory.map(p => p.v);
  const times = priceHistory.map(p => p.t);

  // Y轴范围：固定 0~100%
  const yMin = 0;
  const yMax = 1;

  // 折线坐标
  const pts = priceHistory.map((p, i) => {
    const x = (i / (priceHistory.length - 1)) * CW;
    const y = CH - ((p.v - yMin) / (yMax - yMin)) * CH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  // 最后一个点
  const last = priceHistory[priceHistory.length - 1];
  const dotX = CW;
  const dotY = CH - ((last.v - yMin) / (yMax - yMin)) * CH;

  // 网格线（5条横线）
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(r => {
    const y = (r * CH).toFixed(1);
    return `<line x1="0" y1="${y}" x2="${CW}" y2="${y}" stroke="#1a1a2e" stroke-width="1"/>`;
  }).join('');

  // Y轴标签（右侧，5条）；顶部标签固定在 y=16 避免被倒计时遮挡
  const yLabels = [0, 0.25, 0.5, 0.75, 1].map(r => {
    const val = yMax - r * (yMax - yMin); // r=0 → 100%（顶）
    const y   = r === 0 ? 16 : (r * CH);
    return `<text x="${(CW + 4).toFixed(0)}" y="${(+y + 4).toFixed(0)}"
      font-size="11" fill="#4a4a6a" text-anchor="start">${(val * 100).toFixed(0)}%</text>`;
  }).join('');

  // X轴标签（首/中/尾 3个时间点）
  const fmt = ts => new Date(ts).toTimeString().slice(0, 8);
  const xLabels = [0, 0.5, 1].map(r => {
    const idx    = Math.min(Math.floor(r * (priceHistory.length - 1)), priceHistory.length - 1);
    const x      = (r * CW).toFixed(0);
    const anchor = r === 0 ? 'start' : r === 1 ? 'end' : 'middle';
    return `<text x="${x}" y="${(H - 4).toFixed(0)}"
      font-size="11" fill="#4a4a6a" text-anchor="${anchor}">${fmt(times[idx])}</text>`;
  }).join('');

  svg.innerHTML = `
    ${gridLines}
    <polyline points="${pts}" fill="none" stroke="#00d4aa" stroke-width="1.5"/>
    <circle cx="${dotX.toFixed(1)}" cy="${dotY.toFixed(1)}" r="3" fill="#00d4aa"/>
    ${yLabels}
    ${xLabels}
  `;

  const placeholder = document.getElementById('pm-placeholder');
  if (placeholder) placeholder.style.display = 'none';
}

// ─── Side switching ──────────────────────
function th_setSide(side) {
  th_side = side;
  const buyEl  = document.getElementById("th-side-buy");
  const sellEl = document.getElementById("th-side-sell");
  const btnEl  = document.getElementById("th-buy-btn");
  if (side === "buy") {
    buyEl.style.color  = "#26a69a"; buyEl.style.borderBottom  = "4px solid #26a69a";
    sellEl.style.color = "#444";    sellEl.style.borderBottom = "4px solid transparent";
    btnEl.style.background = "#26a69a"; btnEl.textContent = "Buy";
  } else {
    sellEl.style.color = "#ef5350"; sellEl.style.borderBottom = "4px solid #ef5350";
    buyEl.style.color  = "#444";    buyEl.style.borderBottom  = "4px solid transparent";
    btnEl.style.background = "#ef5350"; btnEl.textContent = "Sell";
  }
}

// ─── Coin dropdown ───────────────────────
function th_toggleCoinMenu() {
  const m = document.getElementById("th-coin-menu");
  m.style.display = m.style.display === "none" ? "block" : "none";
}
function th_selectCoin(coin) {
  th_symbol = coin;
  document.getElementById("th-coin-label").textContent = coin;
  document.getElementById("th-pm-coin").textContent = coin;
  document.getElementById("th-coin-menu").style.display = "none";
  document.querySelectorAll("#th-coin-menu div").forEach(el => {
    const match = el.textContent.trim() === coin;
    el.style.background = match ? "#12122a" : "transparent";
    el.style.color = match ? "#ddd" : "#666";
  });
  th_onMarketSwitch();
}

// ─── Symbol / Timeframe switching ─────────
function th_bindSymbolButtons() {
  // 币种切换通过 th_selectCoin(coin) inline handler 实现，th-sym-* id 不存在，此处静默跳过
  ['BTC', 'ETH', 'SOL', 'XRP'].forEach(sym => {
    const btn = document.getElementById(`th-sym-${sym.toLowerCase()}`);
    if (!btn) return;
    btn.onclick = () => { th_symbol = sym; th_updateSymbolUI(); th_onMarketSwitch(); };
  });
}

function th_bindTimeframeButtons() {
  // th-tf-* 元素在 HTML 中不存在，全部静默跳过
  ['5m', '15m', '1h', '4h'].forEach(tf => {
    const btn = document.getElementById(`th-tf-${tf}`);
    if (!btn) return;
    btn.onclick = () => { th_timeframe = tf; th_updateTimeframeUI(); th_onMarketSwitch(); };
  });
}

function th_updateSymbolUI() {
  ['btc', 'eth', 'sol', 'xrp'].forEach(s => {
    const btn = document.getElementById(`th-sym-${s}`);
    if (btn) btn.classList.toggle('active', s.toUpperCase() === th_symbol);
  });
}

function th_setTimeframe(tf) {
  th_timeframe = tf;
  th_updateTimeframeUI();
  th_onMarketSwitch();
}

function th_updateTimeframeUI() {
  ['5m', '15m', '1h', '4h'].forEach(tf => {
    const btn = document.getElementById(`th-tf-${tf}`);
    if (btn) btn.classList.toggle('active', tf === th_timeframe);
  });
}

async function th_onMarketSwitch() {
  th_appendLog('system', `切换到 ${th_symbol} ${th_timeframe}`);

  // /market/current-window 不存在，静默跳过
  try {
    const r = await fetch(`${BASE_URL}/market/current-window?symbol=${th_symbol}&timeframe=${th_timeframe}`);
    if (r.ok) {
      const d = await r.json();
      const winEl = document.getElementById('th-current-window');
      if (winEl && d.window_start) winEl.textContent = new Date(d.window_start * 1000).toLocaleTimeString();
      th_resetCountdown(d.window_start, d.window_size_sec || th_windowSizeSec());
    }
  } catch (_) {}

  // /market/orderbook 不存在，静默跳过（现有 /book/snapshot 由轮询定时刷新）
  try {
    const r = await fetch(`${BASE_URL}/market/orderbook?symbol=${th_symbol}&timeframe=${th_timeframe}`);
    if (r.ok) {
      const d = await r.json();
      if (typeof th_renderBook === 'function') th_renderBook(d);
    }
  } catch (_) {}
}

// ─── Regime gauge ────────────────────────
function th_updateGauge(score) {
  const scoreEl = document.getElementById("th-regime-score");
  const arc = document.getElementById("th-gauge-arc");
  const needle = document.getElementById("th-gauge-needle");
  const dot = document.getElementById("th-gauge-dot");
  if (score == null) {
    if (scoreEl) { scoreEl.style.color = "#444"; scoreEl.textContent = "—"; }
    if (arc) arc.setAttribute("stroke-dasharray", "0 157");
    if (needle) { needle.setAttribute("x2", "10"); needle.setAttribute("y2", "65"); needle.setAttribute("stroke", "#333"); }
    if (dot) dot.setAttribute("fill", "#333");
    return;
  }
  const color = score > 0.6 ? "#10b981" : score > 0.4 ? "#f59e0b" : "#ef4444";
  const angleRad = (-90 + score * 180) * Math.PI / 180;
  const x2 = 60 + 36 * Math.cos(angleRad);
  const y2 = 62 + 36 * Math.sin(angleRad);
  if (arc) arc.setAttribute("stroke-dasharray", (score * 157) + " 157");
  if (needle) { needle.setAttribute("x2", x2.toFixed(2)); needle.setAttribute("y2", y2.toFixed(2)); needle.setAttribute("stroke", color); }
  if (dot) dot.setAttribute("fill", color);
  if (scoreEl) { scoreEl.style.color = color; scoreEl.textContent = score.toFixed(2); }
}

// ─── Countdown ───────────────────────────
function th_updateCountdown() {
  const m = Math.floor(th_countdown / 60);
  const s = th_countdown % 60;
  const el = document.getElementById("th-countdown");
  if (!el) return;
  el.textContent = m + ":" + s.toString().padStart(2, "0");
  el.style.color = th_countdown < 60 ? "#ef5350" : "#888";
}

// ─── Status label helper ──────────────────
function th_getStatusLabel(inst) {
  const r = inst.runtime_state;
  const d = inst.desired_state;
  if (r === true)  return { label: '运行中', color: 'var(--color-up)' };
  if (r === false && d === true) return { label: '配置中', color: 'var(--color-orange, #ffa726)' };
  if (r === false) return { label: '已停止', color: 'var(--color-muted, #888)' };
  return { label: '未知', color: 'var(--color-muted, #888)' };
}

// ─── Render strategy table ───────────────
function th_renderStratTable(strats = []) {
  const tbody = document.getElementById("th-strat-tbody");
  if (!tbody) return;
  if (strats.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="padding:12px;text-align:center;color:#2a2a40;font-size:18px">暂无运行中策略</td></tr>`;
    return;
  }
  tbody.innerHTML = strats.map(st => {
    const typeShort = TH_TM[st.type]?.short || "";
    const pnlColor = st.pnl > 0 ? "#26a69a" : st.pnl < 0 ? "#ef5350" : "#444";
    const pnlText = st.pnl != null ? (st.pnl > 0 ? "+" : "") + st.pnl : "—";
    const statusInfo = th_getStatusLabel(st);
    const badgeColor = statusInfo.color;
    const badgeText = st.runtime_state === true ? "▶" : "■";
    return `<tr style="border-bottom:2px solid #0a0a18">
      <td style="padding:6px 12px"><span class="badge" style="background:${badgeColor}15;color:${badgeColor}">${badgeText}</span></td>
      <td style="padding:6px 12px;color:#bbb;font-weight:600">${st.strategy_id || st.name || "—"}</td>
      <td style="padding:6px 12px"><div style="width:20px;height:20px;border-radius:4px;background:${st.color || "#444"}"></div></td>
      <td style="padding:6px 12px;color:#666">${typeShort}</td>
      <td style="padding:6px 12px;font-family:var(--m);color:${statusInfo.color}">${statusInfo.label}</td>
      <td style="padding:6px 12px;font-family:var(--m);color:#555">${st.trades != null ? st.trades : "—"}</td>
      <td style="padding:6px 12px;font-family:var(--m);color:#555">${st.winRate != null ? st.winRate + "%" : "—"}</td>
      <td style="padding:6px 12px;font-family:var(--m);font-weight:600;color:${pnlColor}">${pnlText}</td>
      <td style="padding:6px 12px"><span style="cursor:pointer;color:#444;font-size:22px">⚙</span></td>
    </tr>`;
  }).join("");
}

// ─── Log buffer helpers ───────────────────
function th_appendLog(type, text, level = 'info') {
  const entry = { time: new Date().toLocaleTimeString(), type, text, level };
  th_logBuffer.unshift(entry);
  if (th_logBuffer.length > TH_LOG_MAX) th_logBuffer.length = TH_LOG_MAX;
  th_renderLog();
}

// ─── Render log ──────────────────────────
function th_renderLog() {
  const el = document.getElementById("th-log-area");
  if (!el) return;
  const colorMap = { info: '#b0bec5', warn: '#ffb74d', error: '#ef5350', success: '#26a69a' };
  el.innerHTML = th_logBuffer.map(e =>
    `<div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid #111;font-size:12px;line-height:1.5;">
      <span style="color:#555;flex-shrink:0;">${e.time}</span>
      <span style="color:${colorMap[e.level]||colorMap.info};flex-shrink:0;width:52px;">[${e.type}]</span>
      <span style="color:${colorMap[e.level]||colorMap.info};">${e.text}</span>
    </div>`
  ).join('');
}

// ─── Add strategy ────────────────────────
function th_addStrategy() {
  switchTab('lab');
  setTimeout(() => {
    if (typeof sl_newStrategy === 'function') sl_newStrategy();
  }, 100);
}

// ─── Render order book ───────────────────
function th_renderBook(bookData) {
  const asksEl = document.getElementById("th-asks-area");
  const bidsEl = document.getElementById("th-bids-area");
  if (asksEl) asksEl.innerHTML = bookData.asks.map(a => {
    const w = Math.min(80, parseInt(a.s) / 25);
    return `<div style="display:flex;justify-content:space-between;padding:2px 0;position:relative">
      <div style="position:absolute;right:0;top:0;bottom:0;width:${w}%;background:#ef535006"></div>
      <span style="color:#ef5350;font-size:18px;font-family:var(--m);position:relative">${a.p}${a.mine ? '<span style="color:#6366f1;font-size:12px;margin-left:2px">●</span>' : ''}</span>
      <span style="color:#444;font-size:18px;font-family:var(--m);position:relative">${a.s}</span>
    </div>`;
  }).join("");
  if (bidsEl) bidsEl.innerHTML = bookData.bids.map(b => {
    const w = Math.min(80, parseInt(b.s) / 25);
    return `<div style="display:flex;justify-content:space-between;padding:2px 0;position:relative">
      <div style="position:absolute;right:0;top:0;bottom:0;width:${w}%;background:#26a69a06"></div>
      <span style="color:#26a69a;font-size:18px;font-family:var(--m);position:relative">${b.p}${b.mine ? '<span style="color:#6366f1;font-size:12px;margin-left:2px">●</span>' : ''}</span>
      <span style="color:#444;font-size:18px;font-family:var(--m);position:relative">${b.s}</span>
    </div>`;
  }).join("");
}

// ─── Render orders ───────────────────────
function th_renderOrders(list) {
  const el = document.getElementById("th-orders-area");
  if (!el) return;
  el.innerHTML = '<div style="color:#2a2a40;font-size:14px;font-weight:600;margin-bottom:4px">我的挂单</div>' +
    list.slice(0, 4).map(o => {
      const sideStr  = o.side ?? o.sd ?? '—';
      const priceStr = o.price ?? o.ask_price ?? o.limit_price ?? '—';
      const sizeStr  = o.size ?? o.shares ?? o.amount ?? '—';
      const sideColor = String(sideStr).toUpperCase() === 'BID' ? '#26a69a' : '#ef5350';
      const ageStr = o.created_at ? Math.round((Date.now() - new Date(o.created_at).getTime()) / 1000) + 's' : (o.age ?? '—');
      return `<div style="display:flex;justify-content:space-between;margin-bottom:2px">
        <span style="color:${sideColor};font-size:16px;font-family:var(--m)">${sideStr} ${priceStr} × ${sizeStr}</span>
        <span style="color:#333;font-size:16px;font-family:var(--m)">${ageStr}</span>
      </div>`;
    }).join("");
}

// ─── Render strategy legend ───────────────
function th_renderStratLegend(strats = []) {
  const el = document.getElementById("th-strat-legend");
  if (!el) return;
  el.innerHTML = strats.filter(s => s.status === "running").map(st =>
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
      <svg width="16" height="14" viewBox="0 0 8 7"><polygon points="4,0 0,7 8,7" fill="${st.color || "#444"}"/></svg>
      <span style="color:#333;font-size:14px">${st.name}</span>
    </div>`
  ).join("");
}

// ─── Polling ─────────────────────────────
async function th_pollBook(signal) {
  try {
    const res = await fetch(BASE_URL + "/book/snapshot", { signal });
    if (!res.ok) return;
    const data = await res.json();
    const asks = (data.asks || []).slice(0, 5).map(r => ({p: parseFloat(r[0]).toFixed(3), s: String(r[1])}));
    const bids = (data.bids || []).slice(0, 5).map(r => ({p: parseFloat(r[0]).toFixed(3), s: String(r[1])}));
    if (asks.length || bids.length) {
      th_renderBook({asks, bids});
    } else {
      // ── FAKE_DEPTH START ──────────────────────────────────────────
      // 当前 /book/snapshot 返回 bids:[], asks:[]，使用 best_bid/best_ask 构造估算深度
      // TODO: 待后端 /book/snapshot 接入真实盘口数据后移除此段
      // ──────────────────────────────────────────────────────────────
      const askP = data.best_ask ?? data.ask_up ?? 0;
      const bidP = data.best_bid ?? data.bid_up ?? 0;
      const tick = data.tick_size ?? 0.01;
      if (askP > 0 || bidP > 0) {
        const pseudoAsks = [0, 1, 2].map(i => ({p: (askP + i * tick).toFixed(3), s: String(Math.round(500 - i * 120))}));
        const pseudoBids = [0, 1, 2].map(i => ({p: (bidP - i * tick).toFixed(3), s: String(Math.round(500 - i * 120))}));
        th_renderBook({asks: pseudoAsks, bids: pseudoBids});
      }
      // ── FAKE_DEPTH END ────────────────────────────────────────────
    }
    const mid    = data.mid    ?? data.mid_up;
    const ask    = data.best_ask ?? data.ask_up ?? data.ask;
    const bid    = data.best_bid ?? data.bid_up ?? data.bid;
    const spread = data.spread ?? data.spread_up;
    const midEl = document.getElementById("th-mid-price");
    if (mid != null && midEl) {
      midEl.innerHTML =
        `<span style="color:#ddd;font-size:26px;font-weight:700;font-family:var(--m)">${parseFloat(mid).toFixed(3)}</span>` +
        `<span style="color:#222;font-size:14px;margin-left:8px">spread ${spread != null ? parseFloat(spread).toFixed(3) : "—"}</span>`;
    }
    if (ask != null) { const el = document.getElementById("up-price");   if (el) el.textContent = "Up "   + (ask * 100).toFixed(0) + "¢"; }
    if (bid != null) { const el = document.getElementById("down-price"); if (el) el.textContent = "Down " + (bid * 100).toFixed(0) + "¢"; }
    if (mid != null && mid >= 0.05 && mid <= 0.95) {
      priceHistory.push({ v: mid, t: Date.now() });
      if (priceHistory.length > 100) priceHistory.shift();
      drawPmChart();
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.warn('[th_pollBook]', err.message);
  }
}

async function th_pollInstances(signal) {
  try {
    const [instRes, statusRes] = await Promise.all([
      fetch(BASE_URL + '/ui/instances', { signal }),
      fetch(BASE_URL + '/strategies/status', { signal }),
    ]);
    const instData   = instRes.ok   ? await instRes.json()   : { data: [] };
    const statusData = statusRes.ok ? await statusRes.json() : { instances: [] };

    const runtimeMap = {};
    (statusData.instances || []).forEach(s => { runtimeMap[s.name] = s; });

    const items = Array.isArray(instData.data) ? instData.data : [];
    const merged = items.map(inst => ({
      ...inst,
      runtime_state:  runtimeMap[inst.strategy_id]?.runtime_state  ?? null,
      desired_state:  runtimeMap[inst.strategy_id]?.desired_state  ?? null,
      last_error:     runtimeMap[inst.strategy_id]?.last_error     ?? null,
      last_heartbeat: runtimeMap[inst.strategy_id]?.last_heartbeat ?? null,
    }));

    th_renderStratTable(merged);
    th_renderStratLegend(merged);
    if (merged.length > 0 && merged[0].regime_score != null) {
      th_score = merged[0].regime_score;
      th_updateGauge(th_score);
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.warn('[th_pollInstances]', err.message);
  }
}

async function th_pollOrders(signal) {
  try {
    const res = await fetch(BASE_URL + "/trading/orders", { signal });
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) th_renderOrders(data);
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.warn('[th_pollOrders]', err.message);
  }
}

// ─── Render full TradingHall HTML ────────
function th_render() {
  const el = document.getElementById("page-hall");
  if (!el) return;
  el.innerHTML = `
    <!-- Left panel -->
    <div style="width:360px;background:#080814;border-right:2px solid #10102a;display:flex;flex-direction:column;flex-shrink:0;overflow:auto">
      <div style="padding:20px;border-bottom:2px solid #10102a">
        <div style="color:#333;font-size:16px;font-weight:600;letter-spacing:1px;margin-bottom:12px">手动交易</div>
        <div style="display:flex;margin-bottom:12px">
          <div id="th-side-buy" onclick="th_setSide('buy')" style="flex:1;text-align:center;padding:8px 0;cursor:pointer;font-size:20px;font-weight:700;color:#26a69a;border-bottom:4px solid #26a69a">Buy</div>
          <div id="th-side-sell" onclick="th_setSide('sell')" style="flex:1;text-align:center;padding:8px 0;cursor:pointer;font-size:20px;font-weight:700;color:#444;border-bottom:4px solid transparent">Sell</div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <div id="up-price" style="flex:1;text-align:center;padding:6px 0;border-radius:6px;font-size:18px;font-weight:600;background:#26a69a15;color:#26a69a">Up —</div>
          <div id="down-price" style="flex:1;text-align:center;padding:6px 0;border-radius:6px;font-size:18px;font-weight:600;background:#ef535015;color:#ef5350">Down —</div>
        </div>
        <div style="display:flex;align-items:center;background:#0a0a1a;border:2px solid #12122a;border-radius:6px;padding:0 12px;height:56px;margin-bottom:8px">
          <span style="color:#555;font-size:18px">$</span>
          <input id="th-amount-input" value="1" style="flex:1;background:transparent;border:none;outline:none;color:#ddd;font-family:var(--m);font-size:26px;font-weight:700;text-align:right;padding:0 8px">
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <div id="th-amt-1" style="flex:1;text-align:center;padding:2px 0;border-radius:4px;background:#12122a;color:#444;font-size:14px;cursor:pointer">$1</div>
          <div id="th-amt-5" style="flex:1;text-align:center;padding:2px 0;border-radius:4px;background:#12122a;color:#444;font-size:14px;cursor:pointer">$5</div>
          <div id="th-amt-add10" style="flex:1;text-align:center;padding:2px 0;border-radius:4px;background:#12122a;color:#444;font-size:14px;cursor:pointer">+10</div>
          <div id="th-amt-max" style="flex:1;text-align:center;padding:2px 0;border-radius:4px;background:#12122a;color:#444;font-size:14px;cursor:pointer">Max</div>
        </div>
        <div id="th-buy-btn" style="text-align:center;padding:12px 0;border-radius:6px;font-size:20px;font-weight:700;background:#26a69a;color:#fff;cursor:pointer">Buy</div>
      </div>
      <div style="padding:20px;border-bottom:2px solid #10102a">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="color:#333;font-size:16px;font-weight:600">手动盈亏</span>
          <span id="th-reset-pnl" style="color:#222;font-size:14px;cursor:pointer;background:#12122a;padding:2px 8px;border-radius:4px">重置</span>
        </div>
        <div style="text-align:center"><span id="th-manual-pnl" style="color:#26a69a;font-size:36px;font-weight:800;font-family:var(--m)">0.0000</span></div>
        <div style="display:flex;justify-content:space-around;font-size:16px;color:#333;margin-top:4px"><span>交易 <span id="th-manual-trades">0</span></span><span>胜率 <span id="th-manual-winrate">—</span></span></div>
      </div>
      <div style="padding:20px;border-bottom:2px solid #10102a">
        <div style="color:#333;font-size:16px;font-weight:600;letter-spacing:1px;margin-bottom:8px">市场状态</div>
        <div style="text-align:center">
          <svg width="160" height="96" viewBox="0 0 120 70">
            <path d="M 10 65 A 50 50 0 0 1 110 65" fill="none" stroke="#141428" stroke-width="8" stroke-linecap="round"/>
            <path id="th-gauge-arc" d="M 10 65 A 50 50 0 0 1 110 65" fill="none" stroke="url(#th-gg)" stroke-width="8" stroke-linecap="round" stroke-dasharray="0 157"/>
            <defs><linearGradient id="th-gg" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#ef4444"/><stop offset="50%" stop-color="#f59e0b"/><stop offset="100%" stop-color="#10b981"/></linearGradient></defs>
            <line id="th-gauge-needle" x1="60" y1="62" x2="10" y2="65" stroke="#333" stroke-width="2" stroke-linecap="round"/>
            <circle id="th-gauge-dot" cx="60" cy="62" r="3" fill="#333"/>
          </svg>
          <div id="th-regime-score" style="color:#444;font-size:28px;font-weight:700;font-family:var(--m);margin-top:-4px">—</div>
        </div>
      </div>
      <div style="padding:12px 20px;margin-top:auto;border-top:2px solid #10102a">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:2px">
          <div style="width:8px;height:8px;border-radius:4px;background:#333"></div>
          <span style="color:#333;font-size:14px">Binance WS</span>
          <span style="color:#555;font-size:14px;font-family:var(--m);margin-left:auto">—</span>
        </div>
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:2px">
          <div id="th-conn-indicator" style="width:8px;height:8px;border-radius:4px;background:#333"></div>
          <span style="color:#333;font-size:14px">PM WS</span>
          <span style="color:#555;font-size:14px;font-family:var(--m);margin-left:auto">—</span>
        </div>
      </div>
    </div>

    <!-- Center -->
    <div style="flex:1;display:flex;flex-direction:column;overflow-y:auto;min-width:0">
      <div style="height:52px;background:#0a0a18;border-bottom:2px solid #12122a;display:flex;align-items:center;padding:0 20px;gap:12px;flex-shrink:0">
        <span style="color:#444;font-size:20px">交易大厅</span>
        <div style="flex:1"></div>
        <div style="position:relative">
          <div onclick="th_toggleCoinMenu()" style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:2px 14px;border-radius:6px;background:#12122a">
            <span id="th-coin-label" style="font-weight:700;font-size:22px;color:#ddd">BTC</span>
            <span style="color:#333;font-size:14px">▼</span>
          </div>
          <div id="th-coin-menu" style="display:none;position:absolute;top:44px;right:0;background:#0a0a18;border:2px solid #12122a;border-radius:10px;padding:6px;z-index:100;min-width:160px">
            <div onclick="th_selectCoin('BTC')" style="padding:6px 14px;border-radius:6px;cursor:pointer;font-size:20px;background:#12122a;color:#ddd">BTC</div>
            <div onclick="th_selectCoin('ETH')" style="padding:6px 14px;border-radius:6px;cursor:pointer;font-size:20px;background:transparent;color:#666">ETH</div>
            <div onclick="th_selectCoin('SOL')" style="padding:6px 14px;border-radius:6px;cursor:pointer;font-size:20px;background:transparent;color:#666">SOL</div>
            <div onclick="th_selectCoin('XRP')" style="padding:6px 14px;border-radius:6px;cursor:pointer;font-size:20px;background:transparent;color:#666">XRP</div>
          </div>
        </div>
        <!-- 周期切换 -->
        <div class="th-timeframe-bar" style="display:inline-flex;gap:4px;margin-left:12px;">
          <button id="th-tf-5m"  class="th-tf-btn active" onclick="th_setTimeframe('5m')">5m</button>
          <button id="th-tf-15m" class="th-tf-btn"         onclick="th_setTimeframe('15m')">15m</button>
          <button id="th-tf-1h"  class="th-tf-btn"         onclick="th_setTimeframe('1h')">1h</button>
          <button id="th-tf-4h"  class="th-tf-btn"         onclick="th_setTimeframe('4h')">4h</button>
        </div>
      </div>
      <div style="flex:1;min-height:160px;border-bottom:2px solid #12122a;display:flex;align-items:center;justify-content:center;position:relative;color:#1a1a2e;font-size:22px">
        <span id="th-pm-coin" style="position:absolute;top:12px;left:20px;color:#555;font-size:20px;font-weight:600;z-index:1">BTC</span>
        <span id="th-pm-tf" style="position:absolute;top:12px;right:140px;color:#333;font-size:18px;font-family:var(--m);z-index:1">15M</span>
        <div style="position:absolute;top:8px;right:16px;background:#0a0a1a;border-radius:6px;padding:4px 16px;border:2px solid #12122a;z-index:1">
          <span id="th-countdown" style="font-family:var(--m);font-size:24px;font-weight:700;color:#888">5:00</span>
        </div>
        <svg id="pm-chart" width="100%" height="100%" style="display:block;position:absolute;inset:0"></svg>
        <div id="pm-placeholder" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#1a1a2e;font-size:20px;pointer-events:none">PM 概率折线图（含成交标记 + 配对连线）</div>
      </div>
      <div style="flex-shrink:0;background:#080814;border-top:2px solid #12122a">
        <table class="data-table">
          <thead><tr>
            <th></th><th>策略</th><th>颜色</th><th>类型</th><th>运行</th><th>交易</th><th>胜率</th><th>获利</th><th></th>
          </tr></thead>
          <tbody id="th-strat-tbody"></tbody>
        </table>
        <div style="padding:4px 12px;border-bottom:2px solid #12122a"><span onclick="th_addStrategy()" style="font-size:18px;color:#333;cursor:pointer">+ 添加策略</span></div>
        <div id="th-log-area" style="max-height:120px;overflow:auto;padding:4px 0"></div>
      </div>
    </div>

    <!-- Right panel -->
    <div style="width:328px;background:#080814;border-left:2px solid #10102a;display:flex;flex-direction:column;flex-shrink:0;overflow:auto">
      <div style="padding:10px 16px;color:#2a2a40;font-size:16px;font-weight:600;letter-spacing:1px;border-bottom:2px solid #10102a">订单簿</div>
      <div style="font-size:10px;color:var(--color-muted,#888);padding:2px 8px 4px;border-bottom:1px solid #1a1a2e;letter-spacing:0.3px;">⚠ 估算深度（仅展示参考，非真实盘口）</div>
      <div id="th-asks-area" style="padding:6px 12px"></div>
      <div id="th-mid-price" style="text-align:center;padding:8px 0;border-top:2px solid #10102a;border-bottom:2px solid #10102a">
        <span style="color:#555;font-size:26px;font-weight:700;font-family:var(--m)">—</span>
      </div>
      <div id="th-bids-area" style="padding:6px 12px"></div>
      <div id="th-orders-area" style="padding:8px 12px;border-top:2px solid #10102a">
        <div style="color:#2a2a40;font-size:14px;font-weight:600;margin-bottom:4px">我的挂单</div>
      </div>
      <div id="th-strat-legend" style="padding:8px 12px;margin-top:auto;border-top:2px solid #10102a"></div>
    </div>
  `;
}

// ─── Countdown helpers ────────────────────
function th_windowSizeSec() {
  const map = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 };
  return map[th_timeframe] || 300;
}

function th_resetCountdown(windowStart, sizeSec) {
  const sz = sizeSec || th_windowSizeSec();
  const wStart = windowStart || Math.floor(Date.now() / 1000 / sz) * sz;
  th_countdown = (wStart + sz) - Math.floor(Date.now() / 1000);
}

// ─── Polling loop (AbortController) ─────
function th_startPolling() {
  if (_th_pollCtrl) _th_pollCtrl.abort();
  _th_pollCtrl = new AbortController();
  const { signal } = _th_pollCtrl;

  const loopBook = async () => {
    if (signal.aborted) return;
    await th_pollBook(signal);
    if (!signal.aborted) setTimeout(loopBook, 2000);
  };
  const loopInstances = async () => {
    if (signal.aborted) return;
    await th_pollInstances(signal);
    if (!signal.aborted) setTimeout(loopInstances, 5000);
  };
  const loopOrders = async () => {
    if (signal.aborted) return;
    await th_pollOrders(signal);
    if (!signal.aborted) setTimeout(loopOrders, 5000);
  };
  loopBook();
  loopInstances();
  loopOrders();
}

// ─── Timer loop ──────────────────────────
function th_startTimers() {
  th_timers.forEach(clearInterval);
  th_timers = [];
  th_timers.push(setInterval(() => {
    const sizeSec = th_windowSizeSec();
    const now = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(now / sizeSec) * sizeSec;
    th_countdown = (windowStart + sizeSec) - now;
    th_updateCountdown();
  }, 1000));
  th_startPolling();
}

// ─── Cleanup (called when leaving tab) ───
window.cleanupTradingHall = function() {
  th_timers.forEach(clearInterval);
  th_timers = [];
  if (_th_pollCtrl) { _th_pollCtrl.abort(); _th_pollCtrl = null; }
  if (_th_wsHandler) { offWsEvent(_th_wsHandler); _th_wsHandler = null; }
};

// ─── Manual trade helpers ─────────────────
function th_bindManualTradeButtons() {
  const buyBtn   = document.getElementById('th-buy-btn');
  const amtInput = document.getElementById('th-amount-input');

  if (buyBtn) buyBtn.onclick = () => th_submitManualOrder(th_side.toUpperCase());

  const amt1 = document.getElementById('th-amt-1');
  const amt5 = document.getElementById('th-amt-5');
  const add10 = document.getElementById('th-amt-add10');
  const max   = document.getElementById('th-amt-max');
  if (amt1  && amtInput) amt1.onclick  = () => { amtInput.value = 1; };
  if (amt5  && amtInput) amt5.onclick  = () => { amtInput.value = 5; };
  if (add10 && amtInput) add10.onclick = () => { amtInput.value = (parseFloat(amtInput.value) || 0) + 10; };
  if (max   && amtInput) max.onclick   = () => { amtInput.value = 10; };
}

async function th_submitManualOrder(side) {
  const amtInput = document.getElementById('th-amount-input');
  const amount = parseFloat(amtInput?.value);
  if (!amount || amount <= 0) {
    th_showTradeToast('请输入有效金额', 'error');
    return;
  }

  const buyBtn = document.getElementById('th-buy-btn');
  if (buyBtn) buyBtn.disabled = true;

  try {
    const r = await fetch(BASE_URL + '/trading/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ side, amount }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Order failed');
    th_showTradeToast(`${side} $${amount} 已提交（Paper）`, 'success');
    setTimeout(th_refreshManualStats, 600);
  } catch (err) {
    th_showTradeToast('下单失败：' + err.message, 'error');
  } finally {
    if (buyBtn) buyBtn.disabled = false;
  }
}

async function th_refreshManualStats() {
  try {
    const r = await fetch(BASE_URL + '/trading/manual/stats');
    if (!r.ok) return;
    const d = await r.json();
    const pnlEl   = document.getElementById('th-manual-pnl');
    const tradeEl = document.getElementById('th-manual-trades');
    const winEl   = document.getElementById('th-manual-winrate');
    if (pnlEl)   pnlEl.textContent   = (d.total_pnl >= 0 ? '+' : '') + (d.total_pnl || 0).toFixed(4);
    if (tradeEl) tradeEl.textContent = d.total_trades || 0;
    if (winEl)   winEl.textContent   = d.win_rate !== undefined ? (d.win_rate * 100).toFixed(1) + '%' : '—';
  } catch (_) {}
}

function th_bindResetPnl() {
  const resetBtn = document.getElementById('th-reset-pnl');
  if (!resetBtn) return;
  resetBtn.onclick = async () => {
    if (!confirm('确认清零手动交易统计？此操作不可撤销。')) return;
    try {
      await fetch(BASE_URL + '/trading/manual/reset', { method: 'POST' });
      await th_refreshManualStats();
      th_showTradeToast('统计已重置', 'success');
    } catch (err) {
      th_showTradeToast('重置失败：' + err.message, 'error');
    }
  };
}

function th_showTradeToast(msg, type = 'success') {
  const existing = document.getElementById('th-trade-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'th-trade-toast';
  toast.textContent = msg;
  toast.style.cssText = `
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    z-index: 9999; padding: 10px 20px; border-radius: 6px; font-size: 13px;
    background: ${type === 'error' ? '#ef5350' : '#26a69a'};
    color: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ─── WS event handlers ───────────────────
function th_onRegimeChanged(event) {
  const p = event.payload || event;
  const score = p.regime_score;
  if (score == null) return;
  th_score = score;
  th_updateGauge(th_score);
  const scoreEl = document.getElementById('th-regime-score');
  if (scoreEl) {
    scoreEl.textContent = score.toFixed(2);
    scoreEl.style.color = score >= 0.6 ? '#26a69a' : score >= 0.4 ? '#ffb74d' : '#ef5350';
  }
  const label = score >= 0.5 ? '震荡' : '趋势';
  const regimeLevel = score >= 0.6 ? 'success' : score >= 0.4 ? 'warn' : 'info';
  th_appendLog('regime', `score=${score.toFixed(3)} (${label})`, regimeLevel);
}

function th_onWindowSwitch(event) {
  const p = event.payload || event;
  th_refreshManualStats();
  th_appendLog('window', `窗口切换 → ${p.window_id || JSON.stringify(p)}`, 'info');
}

function th_onOrderEvent(event) {
  const p = event.payload || event;
  setTimeout(th_refreshManualStats, 200);
  const typeLabel = { 'order.placed': '挂单', 'order.filled': '成交', 'order.cancelled': '撤单' }[event.type] || event.type;
  const orderLevel = event.type === 'order.filled' ? 'success' : event.type === 'order.cancelled' ? 'warn' : 'info';
  th_appendLog('order', `${typeLabel} ${p.side || ''} $${p.amount || p.size || ''}`, orderLevel);
}

function th_initWsEvents() {
  if (_th_wsHandler) offWsEvent(_th_wsHandler);

  _th_wsHandler = function(event) {
    if (!event || !event.type) return;
    switch (event.type) {
      case 'regime.changed':
        th_onRegimeChanged(event);
        break;
      case 'window.switch':
        th_onWindowSwitch(event);
        break;
      case 'order.placed':
      case 'order.filled':
      case 'order.cancelled':
        th_onOrderEvent(event);
        break;
    }
  };

  onWsEvent(_th_wsHandler);
}

// ─── Connection indicator ─────────────────
function th_startConnIndicator() {
  const indicator = document.getElementById('th-conn-indicator');
  if (!indicator) return;
  setInterval(() => {
    const alive = typeof isWsAlive === 'function' && isWsAlive();
    indicator.style.background = alive ? '#26a69a' : '#666';
    indicator.title = alive ? 'WS 已连接' : 'WS 未连接或超时';
  }, 2000);
}

// ─── Init ────────────────────────────────
window.initTradingHall = function() {
  th_render();
  th_renderStratTable();
  th_updateGauge(th_score);
  th_updateCountdown();
  th_startTimers();
  th_bindManualTradeButtons();
  th_bindResetPnl();
  th_refreshManualStats();
  th_initWsEvents();
  th_startConnIndicator();
  th_bindSymbolButtons();
  th_bindTimeframeButtons();
  th_updateTimeframeUI();
  th_logBuffer.length = 0;
  th_renderLog();
  th_appendLog('system', '日志已就绪，等待事件...', 'info');
};
