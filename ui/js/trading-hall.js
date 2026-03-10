// ─── Data ───────────────────────────────
const TH_STRATS = [
  { id:"s1", name:"配对做市#002", color:"#10b981", type:"pair",     status:"running", pnl:326,  trades:361, winRate:35, avgPos:8.2 },
  { id:"s2", name:"配对做市#003", color:"#0ea5e9", type:"pair",     status:"running", pnl:52,   trades:120, winRate:31, avgPos:9.5 },
  { id:"s3", name:"极值回归A",    color:"#f59e0b", type:"revert",   status:"running", pnl:22,   trades:18,  winRate:12, avgPos:4.8 },
  { id:"s4", name:"方向突破B",    color:"#ef4444", type:"breakout", status:"stopped", pnl:-38,  trades:45,  winRate:28, avgPos:6.1 },
];
const TH_TM = { pair:{icon:"⚖️",short:"配对"}, revert:{icon:"🎯",short:"回归"}, breakout:{icon:"📐",short:"突破"} };

const TH_ORDERS = [
  {sd:"BID",p:"0.472",sz:"$5",tr:"T1",st:"#002",age:"8s"},
  {sd:"BID",p:"0.465",sz:"$5",tr:"T2",st:"#002",age:"8s"},
  {sd:"ASK",p:"0.538",sz:"$5",tr:"T1",st:"#002",age:"5s"},
  {sd:"ASK",p:"0.545",sz:"$5",tr:"T2",st:"#002",age:"5s"},
  {sd:"BID",p:"0.082",sz:"$3",tr:"—", st:"回归A",age:"32s"},
];
const TH_LOGS = [
  {ts:"18:32:15",st:"#002",  c:"#10b981",a:"下单",d:"BUY UP @ 0.472 × $5"},
  {ts:"18:32:14",st:"#002",  c:"#10b981",a:"撤单",d:"BID 0.468 老化(21s)"},
  {ts:"18:31:58",st:"#002",  c:"#10b981",a:"成交",d:"BUY DOWN @ 0.531 配对 cost=0.963"},
  {ts:"18:31:45",st:"回归A", c:"#f59e0b",a:"监控",d:"DOWN ask=0.18 > 0.12"},
  {ts:"18:31:30",st:"#002",  c:"#10b981",a:"撤单",d:"全撤: sigma跳变"},
];
const TH_BOOK = {
  asks:[{p:"0.545",s:"450"},{p:"0.540",s:"1560"},{p:"0.538",s:"890"},{p:"0.535",s:"120",mine:true},{p:"0.531",s:"380"}],
  bids:[{p:"0.523",s:"412"},{p:"0.520",s:"85",mine:true},{p:"0.518",s:"1240"},{p:"0.515",s:"634"},{p:"0.510",s:"2100",mine:true}],
};

// ─── State ──────────────────────────────
let th_score = 0.68;
let th_countdown = 247;
let th_timers = [];

// ─── Side switching ──────────────────────
function th_setSide(side) {
  const buyEl  = document.getElementById("th-side-buy");
  const sellEl = document.getElementById("th-side-sell");
  const btnEl  = document.getElementById("th-buy-btn");
  if (side === "buy") {
    buyEl.style.color  = "#26a69a"; buyEl.style.borderBottom  = "2px solid #26a69a";
    sellEl.style.color = "#444";    sellEl.style.borderBottom = "2px solid transparent";
    btnEl.style.background = "#26a69a"; btnEl.textContent = "Buy";
  } else {
    sellEl.style.color = "#ef5350"; sellEl.style.borderBottom = "2px solid #ef5350";
    buyEl.style.color  = "#444";    buyEl.style.borderBottom  = "2px solid transparent";
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
  document.getElementById("th-kline-coin").textContent = coin;
  document.getElementById("th-pm-coin").textContent = coin;
  document.getElementById("th-coin-menu").style.display = "none";
  document.querySelectorAll("#th-coin-menu div").forEach(el => {
    const match = el.textContent.trim() === coin;
    el.style.background = match ? "#12122a" : "transparent";
    el.style.color = match ? "#ddd" : "#666";
  });
}

// ─── TF switching ────────────────────────
function th_setTf(tf) {
  ["5M","15M","1H","4H","1D"].forEach(t => {
    const el = document.getElementById("th-tf-" + t);
    if (!el) return;
    if (t === tf) { el.style.background = "#6366f1"; el.style.color = "#fff"; }
    else          { el.style.background = "transparent"; el.style.color = "#444"; }
  });
  document.getElementById("th-kline-tf").textContent = tf;
  document.getElementById("th-pm-tf").textContent = tf;
}

// ─── Regime gauge ────────────────────────
function th_updateGauge(score) {
  const color = score > 0.6 ? "#10b981" : score > 0.4 ? "#f59e0b" : "#ef4444";
  const angleRad = (-90 + score * 180) * Math.PI / 180;
  const x2 = 60 + 36 * Math.cos(angleRad);
  const y2 = 62 + 36 * Math.sin(angleRad);
  const arc = document.getElementById("th-gauge-arc");
  const needle = document.getElementById("th-gauge-needle");
  const dot = document.getElementById("th-gauge-dot");
  const scoreEl = document.getElementById("th-regime-score");
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
function th_renderStratTable() {
  const tbody = document.getElementById("th-strat-tbody");
  if (!tbody) return;
  tbody.innerHTML = TH_STRATS.map(st => {
    const typeShort = TH_TM[st.type]?.short || "";
    const pnlColor = st.pnl > 0 ? "#26a69a" : st.pnl < 0 ? "#ef5350" : "#444";
    const pnlText = st.pnl ? (st.pnl > 0 ? "+" : "") + st.pnl : "—";
    const badgeColor = st.status === "running" ? "#26a69a" : "#ef5350";
    const badgeText = st.status === "running" ? "▶" : "■";
    return `<tr style="border-bottom:1px solid #0a0a18">
      <td style="padding:3px 6px"><span class="badge" style="background:${badgeColor}15;color:${badgeColor}">${badgeText}</span></td>
      <td style="padding:3px 6px;color:#bbb;font-weight:600">${st.name}</td>
      <td style="padding:3px 6px"><div style="width:10px;height:10px;border-radius:2px;background:${st.color}"></div></td>
      <td style="padding:3px 6px;color:#666">${typeShort}</td>
      <td style="padding:3px 6px;font-family:var(--m);color:#555">${st.status === "running" ? "16:25:30" : "—"}</td>
      <td style="padding:3px 6px;font-family:var(--m);color:#555">${st.trades || "—"}</td>
      <td style="padding:3px 6px;font-family:var(--m);color:#555">${st.winRate ? st.winRate + "%" : "—"}</td>
      <td style="padding:3px 6px;font-family:var(--m);font-weight:600;color:${pnlColor}">${pnlText}</td>
      <td style="padding:3px 6px"><span style="cursor:pointer;color:#444;font-size:11px">⚙</span></td>
    </tr>`;
  }).join("");
}

// ─── Render log ──────────────────────────
function th_renderLog(items) {
  const el = document.getElementById("th-log-area");
  if (!el) return;
  el.innerHTML = items.map((lg, i) => {
    const aColor = lg.a === "下单" ? "#26a69a" : lg.a === "撤单" ? "#f59e0b" : lg.a === "成交" ? "#0ea5e9" : "#555";
    return `<div style="display:flex;align-items:center;gap:8px;padding:1px 6px;font-size:8px;opacity:${(1 - i * 0.12).toFixed(2)}">
      <span style="color:#1a1a2e;font-family:var(--m);width:48px;flex-shrink:0">${lg.ts}</span>
      <span style="color:${lg.c};font-weight:600;width:30px;flex-shrink:0">${lg.st}</span>
      <span class="badge" style="background:${aColor}15;color:${aColor}">${lg.a}</span>
      <span style="color:#444;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${lg.d}</span>
    </div>`;
  }).join("");
}

// ─── Render order book ───────────────────
function th_renderBook(bookData) {
  const asksEl = document.getElementById("th-asks-area");
  const bidsEl = document.getElementById("th-bids-area");
  if (asksEl) asksEl.innerHTML = bookData.asks.map(a => {
    const w = Math.min(80, parseInt(a.s) / 25);
    return `<div style="display:flex;justify-content:space-between;padding:1px 0;position:relative">
      <div style="position:absolute;right:0;top:0;bottom:0;width:${w}%;background:#ef535006"></div>
      <span style="color:#ef5350;font-size:9px;font-family:var(--m);position:relative">${a.p}${a.mine ? '<span style="color:#6366f1;font-size:6px;margin-left:1px">●</span>' : ''}</span>
      <span style="color:#444;font-size:9px;font-family:var(--m);position:relative">${a.s}</span>
    </div>`;
  }).join("");
  if (bidsEl) bidsEl.innerHTML = bookData.bids.map(b => {
    const w = Math.min(80, parseInt(b.s) / 25);
    return `<div style="display:flex;justify-content:space-between;padding:1px 0;position:relative">
      <div style="position:absolute;right:0;top:0;bottom:0;width:${w}%;background:#26a69a06"></div>
      <span style="color:#26a69a;font-size:9px;font-family:var(--m);position:relative">${b.p}${b.mine ? '<span style="color:#6366f1;font-size:6px;margin-left:1px">●</span>' : ''}</span>
      <span style="color:#444;font-size:9px;font-family:var(--m);position:relative">${b.s}</span>
    </div>`;
  }).join("");
}

// ─── Render orders ───────────────────────
function th_renderOrders(list) {
  const el = document.getElementById("th-orders-area");
  if (!el) return;
  el.innerHTML = '<div style="color:#2a2a40;font-size:7px;font-weight:600;margin-bottom:2px">我的挂单</div>' +
    list.slice(0, 4).map(o =>
      `<div style="display:flex;justify-content:space-between;margin-bottom:1px">
        <span style="color:${o.sd === "BID" ? "#26a69a" : "#ef5350"};font-size:8px;font-family:var(--m)">${o.sd} ${o.p}</span>
        <span style="color:#333;font-size:8px;font-family:var(--m)">${o.age}</span>
      </div>`
    ).join("");
}

// ─── Render strategy legend ───────────────
function th_renderStratLegend() {
  const el = document.getElementById("th-strat-legend");
  if (!el) return;
  el.innerHTML = TH_STRATS.filter(s => s.status === "running").map(st =>
    `<div style="display:flex;align-items:center;gap:4px;margin-bottom:1px">
      <svg width="8" height="7" viewBox="0 0 8 7"><polygon points="4,0 0,7 8,7" fill="${st.color}"/></svg>
      <span style="color:#333;font-size:7px">${st.name}</span>
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
    if (asks.length || bids.length) th_renderBook({asks, bids});
    const midEl = document.getElementById("th-mid-price");
    if (data.mid != null && midEl) {
      midEl.innerHTML =
        `<span style="color:#ddd;font-size:13px;font-weight:700;font-family:var(--m)">${parseFloat(data.mid).toFixed(3)}</span>` +
        `<span style="color:#222;font-size:7px;margin-left:4px">spread ${data.spread != null ? parseFloat(data.spread).toFixed(3) : "—"}</span>`;
    }
  } catch (_) {}
}

async function th_pollInstances() {
  try {
    const res = await fetch(BASE_URL + "/ui/instances");
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok && Array.isArray(data.data) && data.data.length > 0) {
      const inst = data.data[0];
      if (inst.regime_score != null) { th_score = inst.regime_score; th_updateGauge(th_score); }
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
    <div style="width:180px;background:#080814;border-right:1px solid #10102a;display:flex;flex-direction:column;flex-shrink:0;overflow:auto">
      <div style="padding:10px;border-bottom:1px solid #10102a">
        <div style="color:#333;font-size:8px;font-weight:600;letter-spacing:1px;margin-bottom:6px">手动交易</div>
        <div style="display:flex;margin-bottom:6px">
          <div id="th-side-buy" onclick="th_setSide('buy')" style="flex:1;text-align:center;padding:4px 0;cursor:pointer;font-size:10px;font-weight:700;color:#26a69a;border-bottom:2px solid #26a69a">Buy</div>
          <div id="th-side-sell" onclick="th_setSide('sell')" style="flex:1;text-align:center;padding:4px 0;cursor:pointer;font-size:10px;font-weight:700;color:#444;border-bottom:2px solid transparent">Sell</div>
        </div>
        <div style="display:flex;gap:4px;margin-bottom:6px">
          <div style="flex:1;text-align:center;padding:3px 0;border-radius:3px;font-size:9px;font-weight:600;background:#26a69a15;color:#26a69a">Up 49¢</div>
          <div style="flex:1;text-align:center;padding:3px 0;border-radius:3px;font-size:9px;font-weight:600;background:#ef535015;color:#ef5350">Down 51¢</div>
        </div>
        <div style="display:flex;align-items:center;background:#0a0a1a;border:1px solid #12122a;border-radius:3px;padding:0 6px;height:28px;margin-bottom:4px">
          <span style="color:#555;font-size:9px">$</span>
          <input id="th-amt-input" value="1" style="flex:1;background:transparent;border:none;outline:none;color:#ddd;font-family:var(--m);font-size:13px;font-weight:700;text-align:right;padding:0 4px">
        </div>
        <div style="display:flex;gap:4px;margin-bottom:6px">
          <div style="flex:1;text-align:center;padding:1px 0;border-radius:2px;background:#12122a;color:#444;font-size:7px;cursor:pointer">$1</div>
          <div style="flex:1;text-align:center;padding:1px 0;border-radius:2px;background:#12122a;color:#444;font-size:7px;cursor:pointer">$5</div>
          <div style="flex:1;text-align:center;padding:1px 0;border-radius:2px;background:#12122a;color:#444;font-size:7px;cursor:pointer">+10</div>
          <div style="flex:1;text-align:center;padding:1px 0;border-radius:2px;background:#12122a;color:#444;font-size:7px;cursor:pointer">Max</div>
        </div>
        <div id="th-buy-btn" style="text-align:center;padding:6px 0;border-radius:3px;font-size:10px;font-weight:700;background:#26a69a;color:#fff;cursor:pointer">Buy</div>
      </div>
      <div style="padding:10px;border-bottom:1px solid #10102a">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="color:#333;font-size:8px;font-weight:600">手动盈亏</span>
          <span style="color:#222;font-size:7px;cursor:pointer;background:#12122a;padding:1px 4px;border-radius:2px">重置</span>
        </div>
        <div style="text-align:center"><span style="color:#26a69a;font-size:18px;font-weight:800;font-family:var(--m)">+12.50</span></div>
        <div style="display:flex;justify-content:space-around;font-size:8px;color:#333;margin-top:2px"><span>交易 8</span><span>胜率 63%</span></div>
      </div>
      <div style="padding:10px;border-bottom:1px solid #10102a">
        <div style="color:#333;font-size:8px;font-weight:600;letter-spacing:1px;margin-bottom:4px">市场状态</div>
        <div style="text-align:center">
          <svg width="80" height="48" viewBox="0 0 120 70">
            <path d="M 10 65 A 50 50 0 0 1 110 65" fill="none" stroke="#141428" stroke-width="8" stroke-linecap="round"/>
            <path id="th-gauge-arc" d="M 10 65 A 50 50 0 0 1 110 65" fill="none" stroke="url(#th-gg)" stroke-width="8" stroke-linecap="round" stroke-dasharray="106.76 157"/>
            <defs><linearGradient id="th-gg" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#ef4444"/><stop offset="50%" stop-color="#f59e0b"/><stop offset="100%" stop-color="#10b981"/></linearGradient></defs>
            <line id="th-gauge-needle" x1="60" y1="62" x2="82.55" y2="43.45" stroke="#10b981" stroke-width="2" stroke-linecap="round"/>
            <circle id="th-gauge-dot" cx="60" cy="62" r="3" fill="#10b981"/>
          </svg>
          <div id="th-regime-score" style="color:#10b981;font-size:14px;font-weight:700;font-family:var(--m);margin-top:-2px">0.68</div>
        </div>
      </div>
      <div style="padding:6px 10px;margin-top:auto;border-top:1px solid #10102a">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:1px">
          <div style="width:4px;height:4px;border-radius:2px;background:#26a69a"></div>
          <span style="color:#333;font-size:7px">Binance WS</span>
          <span style="color:#26a69a;font-size:7px;font-family:var(--m);margin-left:auto">38ms</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:1px">
          <div style="width:4px;height:4px;border-radius:2px;background:#26a69a"></div>
          <span style="color:#333;font-size:7px">PM WS</span>
          <span style="color:#26a69a;font-size:7px;font-family:var(--m);margin-left:auto">105ms</span>
        </div>
      </div>
    </div>

    <!-- Center -->
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0">
      <div style="height:26px;background:#0a0a18;border-bottom:1px solid #12122a;display:flex;align-items:center;padding:0 10px;gap:6px;flex-shrink:0">
        <span style="color:#444;font-size:10px">交易大厅</span>
        <div style="flex:1"></div>
        <div style="position:relative">
          <div onclick="th_toggleCoinMenu()" style="display:flex;align-items:center;gap:3px;cursor:pointer;padding:1px 7px;border-radius:3px;background:#12122a">
            <span id="th-coin-label" style="font-weight:700;font-size:11px;color:#ddd">BTC</span>
            <span style="color:#333;font-size:7px">▼</span>
          </div>
          <div id="th-coin-menu" style="display:none;position:absolute;top:22px;right:0;background:#0a0a18;border:1px solid #12122a;border-radius:5px;padding:3px;z-index:100;min-width:80px">
            <div onclick="th_selectCoin('BTC')" style="padding:3px 7px;border-radius:3px;cursor:pointer;font-size:10px;background:#12122a;color:#ddd">BTC</div>
            <div onclick="th_selectCoin('ETH')" style="padding:3px 7px;border-radius:3px;cursor:pointer;font-size:10px;background:transparent;color:#666">ETH</div>
            <div onclick="th_selectCoin('SOL')" style="padding:3px 7px;border-radius:3px;cursor:pointer;font-size:10px;background:transparent;color:#666">SOL</div>
            <div onclick="th_selectCoin('XRP')" style="padding:3px 7px;border-radius:3px;cursor:pointer;font-size:10px;background:transparent;color:#666">XRP</div>
          </div>
        </div>
      </div>
      <div style="flex:1;min-height:80px;border-bottom:1px solid #12122a;display:flex;align-items:center;justify-content:center;position:relative;color:#1a1a2e;font-size:11px">
        <span id="th-kline-coin" style="position:absolute;top:6px;left:10px;color:#555;font-size:10px;font-weight:600">BTC</span>
        <span id="th-kline-tf" style="position:absolute;top:6px;right:10px;color:#333;font-size:9px;font-family:var(--m)">15M</span>
        BTC K 线图（含成交量柱）
      </div>
      <div style="height:24px;background:#0a0a18;border-bottom:1px solid #12122a;display:flex;align-items:center;padding:0 10px;gap:2px;flex-shrink:0">
        <div id="th-tf-5M"  onclick="th_setTf('5M')"  style="padding:2px 8px;border-radius:2px;font-size:9px;font-weight:600;font-family:var(--m);background:transparent;color:#444;cursor:pointer">5M</div>
        <div id="th-tf-15M" onclick="th_setTf('15M')" style="padding:2px 8px;border-radius:2px;font-size:9px;font-weight:600;font-family:var(--m);background:#6366f1;color:#fff;cursor:pointer">15M</div>
        <div id="th-tf-1H"  onclick="th_setTf('1H')"  style="padding:2px 8px;border-radius:2px;font-size:9px;font-weight:600;font-family:var(--m);background:transparent;color:#444;cursor:pointer">1H</div>
        <div id="th-tf-4H"  onclick="th_setTf('4H')"  style="padding:2px 8px;border-radius:2px;font-size:9px;font-weight:600;font-family:var(--m);background:transparent;color:#444;cursor:pointer">4H</div>
        <div id="th-tf-1D"  onclick="th_setTf('1D')"  style="padding:2px 8px;border-radius:2px;font-size:9px;font-weight:600;font-family:var(--m);background:transparent;color:#444;cursor:pointer">1D</div>
        <div style="flex:1"></div>
        <span style="color:#2a2a40;font-size:8px">Bitcoin Up or Down – Mar 9, 6:50–6:55 AM ET</span>
      </div>
      <div style="flex:1;min-height:80px;border-bottom:1px solid #12122a;display:flex;align-items:center;justify-content:center;position:relative;color:#1a1a2e;font-size:11px">
        <span id="th-pm-coin" style="position:absolute;top:6px;left:10px;color:#555;font-size:10px;font-weight:600">BTC</span>
        <span id="th-pm-tf" style="position:absolute;top:6px;right:70px;color:#333;font-size:9px;font-family:var(--m)">15M</span>
        <div style="position:absolute;top:4px;right:8px;background:#0a0a1a;border-radius:3px;padding:2px 8px;border:1px solid #12122a">
          <span id="th-countdown" style="font-family:var(--m);font-size:12px;font-weight:700;color:#888">4:07</span>
        </div>
        PM 概率折线图（含成交标记 + 配对连线）
      </div>
      <div style="flex-shrink:0;background:#080814;border-top:1px solid #12122a">
        <table class="data-table">
          <thead><tr>
            <th></th><th>策略</th><th>颜色</th><th>类型</th><th>运行</th><th>交易</th><th>胜率</th><th>获利</th><th></th>
          </tr></thead>
          <tbody id="th-strat-tbody"></tbody>
        </table>
        <div style="padding:2px 6px;border-bottom:1px solid #12122a"><span style="font-size:9px;color:#333;cursor:pointer">+ 添加策略</span></div>
        <div id="th-log-area" style="max-height:60px;overflow:auto;padding:2px 0"></div>
      </div>
    </div>

    <!-- Right panel -->
    <div style="width:164px;background:#080814;border-left:1px solid #10102a;display:flex;flex-direction:column;flex-shrink:0;overflow:auto">
      <div style="padding:5px 8px;color:#2a2a40;font-size:8px;font-weight:600;letter-spacing:1px;border-bottom:1px solid #10102a">订单簿</div>
      <div id="th-asks-area" style="padding:3px 6px"></div>
      <div id="th-mid-price" style="text-align:center;padding:4px 0;border-top:1px solid #10102a;border-bottom:1px solid #10102a">
        <span style="color:#ddd;font-size:13px;font-weight:700;font-family:var(--m)">0.527</span>
        <span style="color:#222;font-size:7px;margin-left:4px">spread 0.008</span>
      </div>
      <div id="th-bids-area" style="padding:3px 6px"></div>
      <div id="th-orders-area" style="padding:4px 6px;border-top:1px solid #10102a">
        <div style="color:#2a2a40;font-size:7px;font-weight:600;margin-bottom:2px">我的挂单</div>
      </div>
      <div id="th-strat-legend" style="padding:4px 6px;margin-top:auto;border-top:1px solid #10102a"></div>
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
    th_score = Math.max(0, Math.min(1, th_score + (Math.random() - 0.5) * 0.04));
    th_updateGauge(th_score);
  }, 1000));
  th_timers.push(setInterval(th_pollBook, 2000));
  th_timers.push(setInterval(th_pollInstances, 5000));
  th_timers.push(setInterval(th_pollOrders, 5000));
}

// ─── Init ────────────────────────────────
window.initTradingHall = function() {
  th_render();
  th_renderStratTable();
  th_renderLog(TH_LOGS);
  th_renderBook(TH_BOOK);
  th_renderOrders(TH_ORDERS);
  th_renderStratLegend();
  th_updateGauge(th_score);
  th_updateCountdown();
  th_startTimers();
};
