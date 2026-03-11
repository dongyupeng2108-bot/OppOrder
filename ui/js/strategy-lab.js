// ─── New strategy ────────────────────────
function sl_newStrategy() {
  alert('新建策略：请在 strategies/crypto_binary/instances/ 目录创建新的 .json 配置文件，重启服务后自动加载。');
}

// ─── Data ───────────────────────────────
const SL_STRATS = [
  { id:"s1", name:"配对做市#002", color:"#10b981", type:"pair",     status:"running", pnl:326,  trades:361, winRate:35, avgPos:8.2 },
  { id:"s2", name:"配对做市#003", color:"#0ea5e9", type:"pair",     status:"running", pnl:52,   trades:120, winRate:31, avgPos:9.5 },
  { id:"s3", name:"极值回归A",    color:"#f59e0b", type:"revert",   status:"running", pnl:22,   trades:18,  winRate:12, avgPos:4.8 },
  { id:"s4", name:"方向突破B",    color:"#ef4444", type:"breakout", status:"stopped", pnl:-38,  trades:45,  winRate:28, avgPos:6.1 },
];
const SL_TM = { pair:{icon:"⚖️",short:"配对"}, revert:{icon:"🎯",short:"回归"}, breakout:{icon:"📐",short:"突破"} };

// ─── State ──────────────────────────────
let sl_sel = "s1";
let sl_sub = "edit";
let sl_checked = ["s1","s2","s3"];
let sl_offset = 0.03;
let sl_tranches = 3;
let sl_pairT = 0.97;
let sl_instances = null; // null=未加载; []=无策略; [...]= 已加载

// ─── Instance fetch ───────────────────────
async function sl_pollInstances() {
  try {
    const res = await fetch(BASE_URL + '/ui/instances');
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok && Array.isArray(data.data)) {
      sl_instances = data.data.map((d, i) => ({
        id: d.strategy_id,
        name: d.strategy_id,
        color: window.STRAT_COLORS?.[i % 6] || '#10b981',
        type: 'pair',
        status: d.is_active ? 'running' : 'stopped',
        pnl: null,
        trades: d.open_orders ?? null,
        winRate: null,
        avgPos: null,
      }));
      if (sl_instances.length > 0) {
        sl_sel = sl_instances[0].id;
        sl_checked = sl_instances.slice(0, 3).map(s => s.id);
      }
      sl_renderSidebar();
      sl_renderSubtabBar();
      sl_renderContent();
    }
  } catch (_) {}
}

function sl_findStrat(id) {
  if (sl_instances) {
    const s = sl_instances.find(s => s.id === id);
    if (s) return s;
  }
  return SL_STRATS.find(s => s.id === id);
}

// ─── Helpers ─────────────────────────────
function sl_bdg(text, color) {
  return `<span class="badge" style="background:${color}15;color:${color}">${text}</span>`;
}

function sl_stat(l, v, c = "#ccc") {
  return `<div class="stat-card"><div class="stat-label">${l}</div><div class="stat-value" style="color:${c}">${v}</div></div>`;
}

function sl_mlc(title, series, h = 220) {
  const w = 440, pad = {t:12, r:40, b:18, l:4};
  const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
  const all = series.flatMap(s => s.data);
  const mn = Math.min(...all), mx = Math.max(...all), rg = mx - mn || 1;
  const n = series[0]?.data.length || 1;
  const tY = v => pad.t + ch - ((v - mn) / rg) * ch;
  const tX = i => pad.l + (i / Math.max(1, n - 1)) * cw;
  const polylines = series.map(s =>
    `<polyline points="${s.data.map((v,i) => `${tX(i).toFixed(1)},${tY(v).toFixed(1)}`).join(" ")}"
      fill="none" stroke="${s.color}" stroke-width="1.5" opacity="0.85"/>`
  ).join("");
  const dots = series.map(s =>
    `<circle cx="${tX(n-1).toFixed(1)}" cy="${tY(s.data[n-1]).toFixed(1)}" r="2.5" fill="${s.color}"/>`
  ).join("");
  const zeroLine = mn < 0 && mx > 0
    ? `<line x1="${pad.l}" y1="${tY(0).toFixed(1)}" x2="${pad.l+cw}" y2="${tY(0).toFixed(1)}" stroke="#222" stroke-dasharray="3,3" stroke-width="0.5"/>`
    : "";
  const legend = series.map(s => {
    const lastVal = s.data[s.data.length - 1];
    const fmt = s.fmt ? s.fmt(lastVal) : "";
    return `<div style="display:flex;align-items:center;gap:8px">
      <div style="width:16px;height:4px;background:${s.color};border-radius:2px"></div>
      <span style="color:#444;font-size:14px">${s.name}</span>
      <span style="color:${s.color};font-size:14px;font-family:var(--m);font-weight:600">${fmt}</span>
    </div>`;
  }).join("");
  return `<div style="margin-bottom:16px">
    ${title ? `<div style="color:#555;font-size:18px;font-weight:700;margin-bottom:4px">${title}</div>` : ""}
    <svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      <rect x="${pad.l}" y="${pad.t}" width="${cw}" height="${ch}" fill="#08081a" rx="2"/>
      ${zeroLine}
      ${polylines}
      ${dots}
    </svg>
    <div style="display:flex;gap:24px;justify-content:center;margin-top:2px">${legend}</div>
  </div>`;
}

function sl_slider(id, label, value, min, max, step, unit = "", disabled = false) {
  const pct = ((value - min) / (max - min)) * 100;
  const dispVal = step < 1 ? value.toFixed(2) : value.toFixed(0);
  const dis = disabled ? " disabled" : "";
  return `<div class="slider-wrap${dis}">
    <div style="display:flex;justify-content:space-between;margin-bottom:2px">
      <span style="color:#666;font-size:20px">${label}</span>
      <span id="${id}-val" style="color:#aaa;font-size:20px;font-family:var(--m);font-weight:600">${dispVal}${unit}</span>
    </div>
    <div class="slider-track">
      <div class="slider-bg"></div>
      <div id="${id}-fill" class="slider-fill${dis}" style="width:${pct}%"></div>
      ${!disabled ? `<input class="slider-input" type="range" min="${min}" max="${max}" step="${step}" value="${value}"
        oninput="sl_onSlider('${id}',this.value,${min},${max},'${unit}',${step < 1})">` : ""}
      <div id="${id}-thumb" class="slider-thumb${dis}" style="left:calc(${pct}% - 12px)"></div>
    </div>
  </div>`;
}

function sl_onSlider(id, val, min, max, unit, isFloat) {
  const v = parseFloat(val);
  const pct = ((v - min) / (max - min)) * 100;
  const dispVal = isFloat ? v.toFixed(2) : v.toFixed(0);
  const valEl = document.getElementById(id + "-val");
  const fillEl = document.getElementById(id + "-fill");
  const thumbEl = document.getElementById(id + "-thumb");
  if (valEl) valEl.textContent = dispVal + unit;
  if (fillEl) fillEl.style.width = pct + "%";
  if (thumbEl) thumbEl.style.left = `calc(${pct}% - 12px)`;
  // update state for edit sliders
  if (id === "sl-offset") { sl_offset = v; sl_updateInfluence(); }
  if (id === "sl-tranches") { sl_tranches = v; sl_updateInfluence(); }
  if (id === "sl-pairT") sl_pairT = v;
}

function sl_updateInfluence() {
  const rows = [
    {l:"成交率", dir: sl_offset > 0.02 ? "↓" : "↑", c: sl_offset > 0.02 ? "#ef5350" : "#26a69a", d: sl_offset > 0.02 ? "降低" : "升高"},
    {l:"Edge",   dir: sl_offset > 0.02 ? "↑" : "↓", c: sl_offset > 0.02 ? "#26a69a" : "#ef5350", d: sl_offset > 0.02 ? "增大" : "减小"},
    {l:"配对率", dir: sl_tranches > 2 ? "↑" : "↓",  c: sl_tranches > 2 ? "#26a69a" : "#ef5350",  d: sl_tranches > 2 ? "提升" : "降低"},
    {l:"风险",   dir: sl_offset > 0.03 ? "↑" : "→", c: sl_offset > 0.03 ? "#f59e0b" : "#666",    d: sl_offset > 0.03 ? "增大" : "不变"},
  ];
  const el = document.getElementById("sl-influence-rows");
  if (!el) return;
  el.innerHTML = rows.map(r =>
    `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:2px solid #0a0a18">
      <span style="color:#888;font-size:20px">${r.l}</span>
      <div style="display:flex;align-items:center;gap:16px">
        <span style="color:${r.c};font-size:28px;font-weight:800">${r.dir}</span>
        <span style="color:#444;font-size:18px">${r.d}</span>
      </div>
    </div>`
  ).join("");
}

// ─── Sidebar ─────────────────────────────
function sl_renderSidebar() {
  const el = document.getElementById("sl-sidebar");
  if (!el) return;
  const list = sl_instances ?? SL_STRATS;
  if (sl_sub === "compare") {
    if (list.length === 0) {
      el.innerHTML = `<div style="padding:16px 20px;color:#2a2a40;font-size:16px;font-weight:600;letter-spacing:1px">勾选对比</div>
        <div style="padding:40px 20px;color:#2a2a40;font-size:18px;text-align:center">暂无策略</div>`;
      return;
    }
    el.innerHTML = `
      <div style="padding:16px 20px;color:#2a2a40;font-size:16px;font-weight:600;letter-spacing:1px">勾选对比</div>
      ${list.map(s => {
        const on = sl_checked.includes(s.id);
        return `<div onclick="sl_toggleCheck('${s.id}')" style="padding:12px 20px;cursor:pointer;display:flex;align-items:center;gap:12px;background:${on ? "#0e0e22" : "transparent"}">
          <div style="width:26px;height:26px;border-radius:6px;border:3px solid ${on ? s.color : "#1a1a2e"};background:${on ? s.color + "20" : "transparent"};
            display:flex;align-items:center;justify-content:center;flex-shrink:0">
            ${on ? `<span style="color:${s.color};font-size:18px;font-weight:800">✓</span>` : ""}
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:10px;height:10px;border-radius:2px;background:${s.color}"></div>
              <span style="color:${on ? "#ccc" : "#555"};font-size:20px;font-weight:600">${s.name}</span>
            </div>
            <span style="color:#2a2a40;font-size:16px">${s.pnl != null ? (s.pnl > 0 ? "+" : "") + s.pnl : "—"}</span>
          </div>
        </div>`;
      }).join("")}
      <div style="padding:12px 20px;color:#2a2a40;font-size:16px">已选 ${sl_checked.length}</div>`;
  } else {
    if (list.length === 0) {
      el.innerHTML = `<div style="padding:16px 20px;color:#2a2a40;font-size:16px;font-weight:600;letter-spacing:1px">选择策略</div>
        <div style="padding:40px 20px;color:#2a2a40;font-size:18px;text-align:center">暂无策略</div>`;
      return;
    }
    el.innerHTML = `
      <div style="padding:16px 20px;color:#2a2a40;font-size:16px;font-weight:600;letter-spacing:1px">选择策略</div>
      ${list.map(s => {
        const active = sl_sel === s.id;
        const pnlColor = s.pnl > 0 ? "#26a69a" : s.pnl < 0 ? "#ef5350" : "#2a2a40";
        return `<div onclick="sl_setSel('${s.id}')" style="padding:12px 20px;cursor:pointer;
          border-left:${active ? `6px solid ${s.color}` : "6px solid transparent"};background:${active ? "#0e0e22" : "transparent"}">
          <div style="display:flex;align-items:center;gap:16px">
            <div style="width:12px;height:12px;border-radius:2px;background:${s.color}"></div>
            <span style="color:${active ? "#ccc" : "#666"};font-weight:600;font-size:20px">${s.name}</span>
          </div>
          <div style="display:flex;justify-content:space-between">
            <span style="color:#2a2a40;font-size:16px">${SL_TM[s.type]?.icon || ""} ${SL_TM[s.type]?.short || ""}</span>
            <span style="font-family:var(--m);font-size:16px;color:${pnlColor}">${s.pnl != null ? (s.pnl > 0 ? "+" : "") + s.pnl : "—"}</span>
          </div>
        </div>`;
      }).join("")}
      <div style="padding:12px 20px">
        <div onclick="sl_newStrategy()" style="text-align:center;padding:8px 0;border-radius:6px;background:#12122a;color:#444;font-size:18px;cursor:pointer">+ 新建</div>
      </div>`;
  }
}

// ─── Sub-tab bar ─────────────────────────
function sl_renderSubtabBar() {
  const el = document.getElementById("sl-subtab-bar");
  if (!el) return;
  const st = sl_findStrat(sl_sel);
  el.innerHTML = `
    <div onclick="sl_setSub('edit')" class="subtab ${sl_sub === 'edit' ? 'active' : ''}">⚙️ 调整参数</div>
    <div onclick="sl_setSub('postmortem')" class="subtab ${sl_sub === 'postmortem' ? 'active' : ''}">📋 交易复盘</div>
    <div onclick="sl_setSub('compare')" class="subtab ${sl_sub === 'compare' ? 'active' : ''}">⚡ 策略对比</div>
    ${sl_sub !== "compare" ? `<div style="flex:1"></div>
      <div style="display:flex;align-items:center;gap:16px;padding:0 12px">
        <div style="width:14px;height:14px;border-radius:4px;background:${st?.color}"></div>
        <span style="font-weight:700;color:#ccc;font-size:24px">${st?.name}</span>
      </div>` : ""}`;
}

// ─── Edit content ─────────────────────────
function sl_renderEdit() {
  const st = sl_findStrat(sl_sel);
  return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px">
    <!-- 左卡：策略参数 -->
    <div class="card">
      <div style="font-size:22px;font-weight:700;margin-bottom:20px;color:${st?.color}">${SL_TM[st?.type]?.icon} ${st?.name} 参数</div>
      ${sl_slider("sl-offset", "挂单偏移", sl_offset, 0.005, 0.10, 0.005)}
      ${sl_slider("sl-tranches", "档数", sl_tranches, 1, 5, 1)}
      ${sl_slider("sl-pairT", "配对成本目标", sl_pairT, 0.90, 0.99, 0.01)}
      ${sl_slider("sl-prob", "概率区间下界", 0.35, 0.10, 0.45, 0.05)}
      ${sl_slider("sl-refresh", "报价刷新", 0.01, 0.005, 0.05, 0.005)}
      ${sl_slider("sl-timeout", "配对超时", 300, 60, 600, 30, "s")}
      <div onclick="console.log('[StratLab] 运行历史模拟')" style="margin-top:16px;text-align:center;padding:14px 0;border-radius:10px;font-size:22px;font-weight:700;background:linear-gradient(135deg,#6366f1,#0ea5e9);color:#fff;cursor:pointer">运行历史模拟</div>
    </div>
    <!-- 中卡：参数影响 -->
    <div class="card">
      <div class="section-title">📐 参数影响</div>
      <div id="sl-influence-rows"></div>
      <div style="border-top:2px solid #12122a;padding-top:20px;margin-top:16px">
        <div style="color:#555;font-size:20px;font-weight:600;margin-bottom:8px">敏感度</div>
        ${[{v:"0.01",pnl:18},{v:"0.02",pnl:47},{v:"0.03",pnl:52},{v:"0.05",pnl:31}].map(r => {
          const best = 52;
          return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:2px solid #08081a;background:${r.pnl === best ? "#26a69a06" : "transparent"}">
            <span style="font-family:var(--m);color:#aaa;font-size:20px">${r.v}</span>
            <span style="font-family:var(--m);color:#26a69a;font-size:20px;font-weight:700">+${r.pnl}${r.pnl === best ? '<span style="color:#f59e0b;margin-left:4px;font-size:14px">★</span>' : ""}</span>
          </div>`;
        }).join("")}
      </div>
    </div>
    <!-- 右卡：模拟结果 -->
    <div class="card">
      <div class="section-title">🧪 模拟结果</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
        ${sl_stat("成交率", "62%")}${sl_stat("平均Edge", "1.3%", "#26a69a")}
        ${sl_stat("模拟PnL", "+$214", "#26a69a")}${sl_stat("最大回撤", "-6.2%", "#ef5350")}
      </div>
      <div style="color:#444;font-size:20px;font-weight:600;margin-bottom:8px">PnL 曲线</div>
      <svg width="100%" height="60" viewBox="0 0 200 60"><rect width="200" height="60" fill="#08081a" rx="2"/>
        <polyline fill="none" stroke="#26a69a" stroke-width="1.2" points="0,48 20,45 40,40 60,35 80,32 100,28 120,30 140,22 160,18 180,15 200,10"/></svg>
      <div style="display:flex;gap:16px;margin-top:20px">
        <div onclick="console.log('[StratLab] 部署运行')" style="flex:1;text-align:center;padding:10px 0;border-radius:8px;font-size:20px;font-weight:600;background:#26a69a15;color:#26a69a;cursor:pointer">→ 部署运行</div>
        <div style="text-align:center;padding:10px 16px;border-radius:8px;font-size:18px;background:#12122a;color:#555;cursor:pointer">导出</div>
      </div>
    </div>
  </div>`;
}

// ─── Postmortem content ───────────────────
function sl_renderPostmortem() {
  const st = sl_findStrat(sl_sel);
  const stColor = st?.color || "#10b981";
  const placeholder = `<div style="color:#2a2a40;font-size:20px;text-align:center;padding:40px 0">暂无复盘数据</div>`;

  return `<div>
    <div style="background:#0b0b1a;border-radius:12px;padding:20px 28px;border:2px solid #12122a;margin-bottom:24px;display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:16px">
        <div style="width:16px;height:16px;border-radius:4px;background:${stColor}"></div>
        <span style="font-size:28px;font-weight:800;color:#ddd">${st?.name}</span>
        ${sl_bdg("BTC 15M", stColor)}
      </div>
      <div style="padding:6px 16px;border-radius:6px;font-size:18px;background:#6366f115;color:#6366f1;cursor:pointer">修改参数</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:24px">
      ${sl_stat("总收益", "—")}
      ${sl_stat("胜率", "—")}
      ${sl_stat("Sharpe", "—")}
      ${sl_stat("最大回撤", "—")}
      ${sl_stat("成交率", "—")}
      ${sl_stat("仓位", "—")}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px">
      <div class="card">
        <div class="section-title" style="color:#26a69a">💰 赚钱来源</div>
        ${placeholder}
      </div>
      <div class="card">
        <div class="section-title" style="color:#ef5350">⚠️ 失败模式</div>
        ${placeholder}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
      <div class="card">
        <div class="section-title" style="color:#6366f1">🔬 参数敏感度</div>
        ${placeholder}
      </div>
      <div class="card">
        <div class="section-title">📊 单笔收益分布</div>
        ${placeholder}
      </div>
    </div>
  </div>`;
}

// ─── Compare content ─────────────────────
function sl_renderCompare() {
  const sts = SL_STRATS.filter(s => sl_checked.includes(s.id));
  if (sts.length < 2) {
    return `<div style="color:#333;text-align:center;padding:40px">请勾选至少 2 个策略</div>`;
  }
  const ms = [
    {l:"累计PnL"}, {l:"交易"}, {l:"胜率"}, {l:"仓位"},
  ];
  const tableRows = ms.map(m =>
    `<tr style="border-bottom:2px solid #0a0a18">
      <td style="padding:10px 16px;color:#555;font-weight:600">${m.l}</td>
      ${sts.map(() => `<td style="padding:10px 16px;text-align:center;font-family:var(--m);font-weight:700;font-size:24px;color:#2a2a40">—</td>`).join("")}
    </tr>`
  ).join("");
  const placeholder = `<div style="color:#2a2a40;font-size:20px;text-align:center;padding:40px 0">暂无对比数据</div>`;

  return `<div style="display:flex;flex-direction:column;gap:24px">
    <div class="card">
      <div class="section-title">⚡ 核心指标</div>
      <table style="width:100%;border-collapse:collapse;font-size:20px">
        <thead><tr style="border-bottom:2px solid #12122a">
          <th style="padding:10px 16px;text-align:left;color:#333;font-size:18px;width:120px">指标</th>
          ${sts.map(s => `<th style="padding:10px 16px;text-align:center;border-bottom:4px solid ${s.color}">
            <div style="display:flex;align-items:center;justify-content:center;gap:8px">
              <div style="width:12px;height:12px;border-radius:2px;background:${s.color}"></div>
              <span style="color:#ccc;font-size:20px;font-weight:700">${s.name}</span>
            </div>
          </th>`).join("")}
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div class="card">
      <div class="section-title">📈 趋势对比</div>
      ${placeholder}
    </div>
  </div>`;
}

// ─── Main render ─────────────────────────
function sl_renderContent() {
  const el = document.getElementById("sl-content");
  if (!el) return;
  if (sl_sub === "edit") el.innerHTML = sl_renderEdit();
  else if (sl_sub === "postmortem") el.innerHTML = sl_renderPostmortem();
  else el.innerHTML = sl_renderCompare();
  if (sl_sub === "edit") sl_updateInfluence();
}

// ─── Event handlers ──────────────────────
function sl_setSel(id) { sl_sel = id; sl_renderSidebar(); sl_renderSubtabBar(); sl_renderContent(); }
function sl_setSub(sub) { sl_sub = sub; sl_renderSidebar(); sl_renderSubtabBar(); sl_renderContent(); }
function sl_toggleCheck(id) {
  sl_checked = sl_checked.includes(id) ? sl_checked.filter(x => x !== id) : [...sl_checked, id];
  sl_renderSidebar();
  if (sl_sub === "compare") sl_renderContent();
}

// ─── Full page render ─────────────────────
window.initStrategyLab = function() {
  const el = document.getElementById("page-lab");
  if (!el) return;
  el.style.flexDirection = "row";
  el.innerHTML = `
    <div id="sl-sidebar" style="width:320px;background:#080814;border-right:2px solid #10102a;display:flex;flex-direction:column;flex-shrink:0;overflow:auto"></div>
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
      <div id="sl-subtab-bar" class="subtab-bar"></div>
      <div id="sl-content" style="flex:1;overflow:auto;padding:28px"></div>
    </div>`;
  sl_renderSidebar();
  sl_renderSubtabBar();
  sl_renderContent();
  sl_pollInstances();
};
