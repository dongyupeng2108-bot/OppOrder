// ─── Type map ────────────────────────────
const TH_TM = { pair:{icon:"⚖️",short:"配对"}, revert:{icon:"🎯",short:"回归"}, breakout:{icon:"📐",short:"突破"} };

// ─── State ──────────────────────────────
let th_score = null;
let th_side = 'buy';
let th_countdown = 300;
let th_timers = [];
let priceHistory = [];

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
  document.getElementById("th-coin-label").textContent = coin;
  document.getElementById("th-pm-coin").textContent = coin;
  document.getElementById("th-coin-menu").style.display = "none";
  document.querySelectorAll("#th-coin-menu div").forEach(el => {
    const match = el.textContent.trim() === coin;
    el.style.background = match ? "#12122a" : "transparent";
    el.style.color = match ? "#ddd" : "#666";
  });
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
    const badgeColor = st.status === "running" ? "#26a69a" : "#ef5350";
    const badgeText = st.status === "running" ? "▶" : "■";
    return `<tr style="border-bottom:2px solid #0a0a18">
      <td style="padding:6px 12px"><span class="badge" style="background:${badgeColor}15;color:${badgeColor}">${badgeText}</span></td>
      <td style="padding:6px 12px;color:#bbb;font-weight:600">${st.name || "—"}</td>
      <td style="padding:6px 12px"><div style="width:20px;height:20px;border-radius:4px;background:${st.color || "#444"}"></div></td>
      <td style="padding:6px 12px;color:#666">${typeShort}</td>
      <td style="padding:6px 12px;font-family:var(--m);color:#555">${st.status === "running" ? (st.started_at || "—") : "—"}</td>
      <td style="padding:6px 12px;font-family:var(--m);color:#555">${st.trades != null ? st.trades : "—"}</td>
      <td style="padding:6px 12px;font-family:var(--m);color:#555">${st.winRate != null ? st.winRate + "%" : "—"}</td>
      <td style="padding:6px 12px;font-family:var(--m);font-weight:600;color:${pnlColor}">${pnlText}</td>
      <td style="padding:6px 12px"><span style="cursor:pointer;color:#444;font-size:22px">⚙</span></td>
    </tr>`;
  }).join("");
}

// ─── Render log ──────────────────────────
function th_renderLog(items) {
  const el = document.getElementById("th-log-area");
  if (!el) return;
  el.innerHTML = items.map((lg, i) => {
    const aColor = lg.a === "下单" ? "#26a69a" : lg.a === "撤单" ? "#f59e0b" : lg.a === "成交" ? "#0ea5e9" : "#555";
    return `<div style="display:flex;align-items:center;gap:16px;padding:2px 12px;font-size:16px;opacity:${(1 - i * 0.12).toFixed(2)}">
      <span style="color:#1a1a2e;font-family:var(--m);width:96px;flex-shrink:0">${lg.ts}</span>
      <span style="color:${lg.c};font-weight:600;width:60px;flex-shrink:0">${lg.st}</span>
      <span class="badge" style="background:${aColor}15;color:${aColor}">${lg.a}</span>
      <span style="color:#444;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${lg.d}</span>
    </div>`;
  }).join("");
}

// ─── Add strategy ────────────────────────
function th_addStrategy() {
  alert('添加策略：请将策略配置 JSON 放入 strategies/crypto_binary/instances/ 目录，重启服务后自动加载。');
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
    list.slice(0, 4).map(o =>
      `<div style="display:flex;justify-content:space-between;margin-bottom:2px">
        <span style="color:${o.sd === "BID" ? "#26a69a" : "#ef5350"};font-size:16px;font-family:var(--m)">${o.sd} ${o.p}</span>
        <span style="color:#333;font-size:16px;font-family:var(--m)">${o.age}</span>
      </div>`
    ).join("");
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
async function th_pollBook() {
  try {
    const res = await fetch(BASE_URL + "/book/snapshot");
    if (!res.ok) return;
    const data = await res.json();
    const asks = (data.asks || []).slice(0, 5).map(r => ({p: parseFloat(r[0]).toFixed(3), s: String(r[1])}));
    const bids = (data.bids || []).slice(0, 5).map(r => ({p: parseFloat(r[0]).toFixed(3), s: String(r[1])}));
    if (asks.length || bids.length) {
      th_renderBook({asks, bids});
    } else {
      // 伪深度降级：用 best_ask/best_bid/tick_size 构造 3 档显示
      const askP = data.best_ask ?? data.ask_up ?? 0;
      const bidP = data.best_bid ?? data.bid_up ?? 0;
      const tick = data.tick_size ?? 0.01;
      if (askP > 0 || bidP > 0) {
        const pseudoAsks = [0, 1, 2].map(i => ({p: (askP + i * tick).toFixed(3), s: String(Math.round(500 - i * 120))}));
        const pseudoBids = [0, 1, 2].map(i => ({p: (bidP - i * tick).toFixed(3), s: String(Math.round(500 - i * 120))}));
        th_renderBook({asks: pseudoAsks, bids: pseudoBids});
      }
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
  } catch (_) {}
}

async function th_pollInstances() {
  try {
    const res = await fetch(BASE_URL + "/ui/instances");
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok && Array.isArray(data.data)) {
      th_renderStratTable(data.data);
      th_renderStratLegend(data.data);
      if (data.data.length > 0 && data.data[0].regime_score != null) {
        th_score = data.data[0].regime_score;
        th_updateGauge(th_score);
      }
    }
  } catch (_) {}
}

async function th_pollOrders() {
  try {
    const res = await fetch(BASE_URL + "/trading/orders");
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) th_renderOrders(data);
  } catch (_) {}
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
          <div style="width:8px;height:8px;border-radius:4px;background:#333"></div>
          <span style="color:#333;font-size:14px">PM WS</span>
          <span style="color:#555;font-size:14px;font-family:var(--m);margin-left:auto">—</span>
        </div>
      </div>
    </div>

    <!-- Center -->
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0">
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

// ─── Timer loop ──────────────────────────
function th_startTimers() {
  th_timers.forEach(clearInterval);
  th_timers = [];
  th_timers.push(setInterval(() => {
    th_countdown = th_countdown <= 0 ? 300 : th_countdown - 1;
    th_updateCountdown();
  }, 1000));
  th_timers.push(setInterval(th_pollBook, 2000));
  th_timers.push(setInterval(th_pollInstances, 5000));
  th_timers.push(setInterval(th_pollOrders, 5000));
}

// ─── Cleanup (called when leaving tab) ───
window.cleanupTradingHall = function() {
  th_timers.forEach(clearInterval);
  th_timers = [];
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
    const r = await fetch(BASE_URL + '/trading/manual-stats');
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
  resetBtn.onclick = () => {
    if (!confirm('确认清零手动交易统计？此操作不可撤销。')) return;
    const pnlEl   = document.getElementById('th-manual-pnl');
    const tradeEl = document.getElementById('th-manual-trades');
    const winEl   = document.getElementById('th-manual-winrate');
    if (pnlEl)   pnlEl.textContent   = '0.0000';
    if (tradeEl) tradeEl.textContent = '0';
    if (winEl)   winEl.textContent   = '—';
    th_showTradeToast('统计已重置', 'success');
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
function th_registerWsHandlers() {
  // regime.changed：更新 regime gauge 显示
  onWsEvent('regime.changed', (data) => {
    if (data.regime_score !== undefined) {
      th_score = data.regime_score;
      th_updateGauge(th_score);
    }
  });

  // window.switch：窗口切换时刷新手动交易统计
  onWsEvent('window.switch', (_data) => {
    th_refreshManualStats();
  });

  // order.filled / order.cancelled：轻量刷新统计
  onWsEvent('order.filled', () => { setTimeout(th_refreshManualStats, 200); });
  onWsEvent('order.cancelled', () => { setTimeout(th_refreshManualStats, 200); });
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
  th_registerWsHandlers();
  th_startConnIndicator();
};
