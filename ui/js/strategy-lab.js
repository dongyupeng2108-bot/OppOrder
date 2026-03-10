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

// ─── Helpers ─────────────────────────────
function sl_genS(base, drift, vol, n = 36) {
  let v = base;
  return Array.from({length: n}, () => { v += drift + (Math.random() - 0.5) * vol; return +v.toFixed(2); });
}

function sl_bdg(text, color) {
  return `<span class="badge" style="background:${color}15;color:${color}">${text}</span>`;
}

function sl_stat(l, v, c = "#ccc") {
  return `<div class="stat-card"><div class="stat-label">${l}</div><div class="stat-value" style="color:${c}">${v}</div></div>`;
}

function sl_mlc(title, series, h = 110) {
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
    return `<div style="display:flex;align-items:center;gap:4px">
      <div style="width:8px;height:2px;background:${s.color};border-radius:1px"></div>
      <span style="color:#444;font-size:7px">${s.name}</span>
      <span style="color:${s.color};font-size:7px;font-family:var(--m);font-weight:600">${fmt}</span>
    </div>`;
  }).join("");
  return `<div style="margin-bottom:8px">
    ${title ? `<div style="color:#555;font-size:9px;font-weight:700;margin-bottom:2px">${title}</div>` : ""}
    <svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      <rect x="${pad.l}" y="${pad.t}" width="${cw}" height="${ch}" fill="#08081a" rx="2"/>
      ${zeroLine}
      ${polylines}
      ${dots}
    </svg>
    <div style="display:flex;gap:12px;justify-content:center;margin-top:1px">${legend}</div>
  </div>`;
}

function sl_slider(id, label, value, min, max, step, unit = "", disabled = false) {
  const pct = ((value - min) / (max - min)) * 100;
  const dispVal = step < 1 ? value.toFixed(2) : value.toFixed(0);
  const dis = disabled ? " disabled" : "";
  return `<div class="slider-wrap${dis}">
    <div style="display:flex;justify-content:space-between;margin-bottom:2px">
      <span style="color:#666;font-size:10px">${label}</span>
      <span id="${id}-val" style="color:#aaa;font-size:10px;font-family:var(--m);font-weight:600">${dispVal}${unit}</span>
    </div>
    <div class="slider-track">
      <div class="slider-bg"></div>
      <div id="${id}-fill" class="slider-fill${dis}" style="width:${pct}%"></div>
      ${!disabled ? `<input class="slider-input" type="range" min="${min}" max="${max}" step="${step}" value="${value}"
        oninput="sl_onSlider('${id}',this.value,${min},${max},'${unit}',${step < 1})">` : ""}
      <div id="${id}-thumb" class="slider-thumb${dis}" style="left:calc(${pct}% - 6px)"></div>
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
  if (thumbEl) thumbEl.style.left = `calc(${pct}% - 6px)`;
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
    `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #0a0a18">
      <span style="color:#888;font-size:10px">${r.l}</span>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="color:${r.c};font-size:14px;font-weight:800">${r.dir}</span>
        <span style="color:#444;font-size:9px">${r.d}</span>
      </div>
    </div>`
  ).join("");
}

// ─── Sidebar ─────────────────────────────
function sl_renderSidebar() {
  const el = document.getElementById("sl-sidebar");
  if (!el) return;
  if (sl_sub === "compare") {
    el.innerHTML = `
      <div style="padding:8px 10px;color:#2a2a40;font-size:8px;font-weight:600;letter-spacing:1px">勾选对比</div>
      ${SL_STRATS.map(s => {
        const on = sl_checked.includes(s.id);
        return `<div onclick="sl_toggleCheck('${s.id}')" style="padding:6px 10px;cursor:pointer;display:flex;align-items:center;gap:6px;background:${on ? "#0e0e22" : "transparent"}">
          <div style="width:13px;height:13px;border-radius:3px;border:1.5px solid ${on ? s.color : "#1a1a2e"};background:${on ? s.color + "20" : "transparent"};
            display:flex;align-items:center;justify-content:center;flex-shrink:0">
            ${on ? `<span style="color:${s.color};font-size:9px;font-weight:800">✓</span>` : ""}
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:4px">
              <div style="width:5px;height:5px;border-radius:1px;background:${s.color}"></div>
              <span style="color:${on ? "#ccc" : "#555"};font-size:10px;font-weight:600">${s.name}</span>
            </div>
            <span style="color:#2a2a40;font-size:8px">${s.pnl > 0 ? "+" : ""}${s.pnl}</span>
          </div>
        </div>`;
      }).join("")}
      <div style="padding:6px 10px;color:#2a2a40;font-size:8px">已选 ${sl_checked.length}</div>`;
  } else {
    el.innerHTML = `
      <div style="padding:8px 10px;color:#2a2a40;font-size:8px;font-weight:600;letter-spacing:1px">选择策略</div>
      ${SL_STRATS.map(s => {
        const active = sl_sel === s.id;
        const pnlColor = s.pnl > 0 ? "#26a69a" : s.pnl < 0 ? "#ef5350" : "#2a2a40";
        return `<div onclick="sl_setSel('${s.id}')" style="padding:6px 10px;cursor:pointer;
          border-left:${active ? `3px solid ${s.color}` : "3px solid transparent"};background:${active ? "#0e0e22" : "transparent"}">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:6px;height:6px;border-radius:1px;background:${s.color}"></div>
            <span style="color:${active ? "#ccc" : "#666"};font-weight:600;font-size:10px">${s.name}</span>
          </div>
          <div style="display:flex;justify-content:space-between">
            <span style="color:#2a2a40;font-size:8px">${SL_TM[s.type]?.icon} ${SL_TM[s.type]?.short}</span>
            <span style="font-family:var(--m);font-size:8px;color:${pnlColor}">${s.pnl ? (s.pnl > 0 ? "+" : "") + s.pnl : "—"}</span>
          </div>
        </div>`;
      }).join("")}
      <div style="padding:6px 10px">
        <div style="text-align:center;padding:4px 0;border-radius:3px;background:#12122a;color:#444;font-size:9px;cursor:pointer">+ 新建</div>
      </div>`;
  }
}

// ─── Sub-tab bar ─────────────────────────
function sl_renderSubtabBar() {
  const el = document.getElementById("sl-subtab-bar");
  if (!el) return;
  const st = SL_STRATS.find(s => s.id === sl_sel);
  el.innerHTML = `
    <div onclick="sl_setSub('edit')" class="subtab ${sl_sub === 'edit' ? 'active' : ''}">⚙️ 调整参数</div>
    <div onclick="sl_setSub('postmortem')" class="subtab ${sl_sub === 'postmortem' ? 'active' : ''}">📋 交易复盘</div>
    <div onclick="sl_setSub('compare')" class="subtab ${sl_sub === 'compare' ? 'active' : ''}">⚡ 策略对比</div>
    ${sl_sub !== "compare" ? `<div style="flex:1"></div>
      <div style="display:flex;align-items:center;gap:8px;padding:0 6px">
        <div style="width:7px;height:7px;border-radius:2px;background:${st?.color}"></div>
        <span style="font-weight:700;color:#ccc;font-size:12px">${st?.name}</span>
      </div>` : ""}`;
}

// ─── Edit content ─────────────────────────
function sl_renderEdit() {
  const st = SL_STRATS.find(s => s.id === sl_sel);
  return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
    <!-- 左卡：策略参数 -->
    <div class="card">
      <div style="font-size:11px;font-weight:700;margin-bottom:10px;color:${st?.color}">${SL_TM[st?.type]?.icon} ${st?.name} 参数</div>
      ${sl_slider("sl-offset", "挂单偏移", sl_offset, 0.005, 0.10, 0.005)}
      ${sl_slider("sl-tranches", "档数", sl_tranches, 1, 5, 1)}
      ${sl_slider("sl-pairT", "配对成本目标", sl_pairT, 0.90, 0.99, 0.01)}
      ${sl_slider("sl-prob", "概率区间下界", 0.35, 0.10, 0.45, 0.05)}
      ${sl_slider("sl-refresh", "报价刷新", 0.01, 0.005, 0.05, 0.005)}
      ${sl_slider("sl-timeout", "配对超时", 300, 60, 600, 30, "s")}
      <div style="margin-top:8px;text-align:center;padding:7px 0;border-radius:5px;font-size:11px;font-weight:700;background:linear-gradient(135deg,#6366f1,#0ea5e9);color:#fff;cursor:pointer">运行历史模拟</div>
    </div>
    <!-- 中卡：参数影响 -->
    <div class="card">
      <div class="section-title">📐 参数影响</div>
      <div id="sl-influence-rows"></div>
      <div style="border-top:1px solid #12122a;padding-top:10px;margin-top:8px">
        <div style="color:#555;font-size:10px;font-weight:600;margin-bottom:4px">敏感度</div>
        ${[{v:"0.01",pnl:18},{v:"0.02",pnl:47},{v:"0.03",pnl:52},{v:"0.05",pnl:31}].map(r => {
          const best = 52;
          return `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #08081a;background:${r.pnl === best ? "#26a69a06" : "transparent"}">
            <span style="font-family:var(--m);color:#aaa;font-size:10px">${r.v}</span>
            <span style="font-family:var(--m);color:#26a69a;font-size:10px;font-weight:700">+${r.pnl}${r.pnl === best ? '<span style="color:#f59e0b;margin-left:2px;font-size:7px">★</span>' : ""}</span>
          </div>`;
        }).join("")}
      </div>
    </div>
    <!-- 右卡：模拟结果 -->
    <div class="card">
      <div class="section-title">🧪 模拟结果</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">
        ${sl_stat("成交率", "62%")}${sl_stat("平均Edge", "1.3%", "#26a69a")}
        ${sl_stat("模拟PnL", "+$214", "#26a69a")}${sl_stat("最大回撤", "-6.2%", "#ef5350")}
      </div>
      <div style="color:#444;font-size:10px;font-weight:600;margin-bottom:4px">PnL 曲线</div>
      <svg width="100%" height="60" viewBox="0 0 200 60"><rect width="200" height="60" fill="#08081a" rx="2"/>
        <polyline fill="none" stroke="#26a69a" stroke-width="1.2" points="0,48 20,45 40,40 60,35 80,32 100,28 120,30 140,22 160,18 180,15 200,10"/></svg>
      <div style="display:flex;gap:8px;margin-top:10px">
        <div style="flex:1;text-align:center;padding:5px 0;border-radius:4px;font-size:10px;font-weight:600;background:#26a69a15;color:#26a69a;cursor:pointer">→ 部署运行</div>
        <div style="text-align:center;padding:5px 8px;border-radius:4px;font-size:9px;background:#12122a;color:#555;cursor:pointer">导出</div>
      </div>
    </div>
  </div>`;
}

// ─── Postmortem content ───────────────────
function sl_renderPostmortem() {
  const st = SL_STRATS.find(s => s.id === sl_sel);
  const sources = [
    {l:"夜间流动性偏移",v:9.4,d:"深夜盘口薄"},
    {l:"高波动配对",v:6.1,d:"波动大价差扩大"},
    {l:"均值回归",v:3.2,d:"偏离后回归"},
    {l:"其他",v:-0.5,d:"tick损耗"},
  ];
  const losses = [
    {l:"成交后继续反向",pct:43,ex:"3/8 买DOWN@0.48→0.12→-$4.80"},
    {l:"快速单边未配对",pct:31,ex:"3/5 UP成交DOWN未→-$5"},
    {l:"挂单未成交",pct:18,ex:"3/7 offset大→错过+$3.2"},
    {l:"spread吞edge",pct:8,ex:"cost=0.998→-$0.2"},
  ];
  const sens = [
    {p:"偏移",vals:[{v:"0.01",pnl:18,f:72},{v:"0.02",pnl:47,f:68},{v:"0.03",pnl:52,f:55},{v:"0.05",pnl:31,f:38}]},
    {p:"档数",vals:[{v:"1",pnl:22,f:45},{v:"2",pnl:39,f:55},{v:"3",pnl:47,f:68},{v:"5",pnl:40,f:78}]},
  ];
  const dist = [
    {r:"< -$5",n:12,c:"#ef5350"},{r:"-$5~0",n:73,c:"#ef535060"},
    {r:"$0~$5",n:231,c:"#26a69a60"},{r:"> $5",n:45,c:"#26a69a"},
  ];
  const maxD = Math.max(...dist.map(b => b.n));
  const stColor = st?.color || "#10b981";

  return `<div>
    <div style="background:#0b0b1a;border-radius:6px;padding:10px 14px;border:1px solid #12122a;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:8px;height:8px;border-radius:2px;background:${stColor}"></div>
        <span style="font-size:14px;font-weight:800;color:#ddd">${st?.name}</span>
        ${sl_bdg("BTC 15M", stColor)}
        <span style="color:#333;font-size:9px">· ${st?.trades} 次</span>
      </div>
      <div style="padding:3px 8px;border-radius:3px;font-size:9px;background:#6366f115;color:#6366f1;cursor:pointer">修改参数</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:12px">
      ${sl_stat("总收益", `+$${st?.pnl}`, "#26a69a")}
      ${sl_stat("胜率", st?.winRate + "%", st?.winRate > 30 ? "#26a69a" : "#f59e0b")}
      ${sl_stat("Sharpe", "1.82")}
      ${sl_stat("最大回撤", "-6.4%", "#ef5350")}
      ${sl_stat("成交率", "68%")}
      ${sl_stat("仓位", "$" + st?.avgPos)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div class="card">
        <div class="section-title" style="color:#26a69a">💰 赚钱来源</div>
        ${sources.map(s => `<div style="margin-bottom:6px">
          <div style="display:flex;justify-content:space-between">
            <span style="color:#aaa;font-size:10px;font-weight:600">${s.l}</span>
            <span style="font-family:var(--m);font-size:11px;font-weight:700;color:${s.v >= 0 ? "#26a69a" : "#ef5350"}">${s.v >= 0 ? "+" : ""}${s.v}%</span>
          </div>
          <div style="height:4px;background:#08081a;border-radius:2px;overflow:hidden;margin-top:2px">
            <div style="height:4px;width:${Math.max(2, Math.abs(s.v) * 5)}%;background:${s.v >= 0 ? "#26a69a50" : "#ef535050"};border-radius:2px"></div></div>
          <div style="color:#222;font-size:8px;margin-top:1px">${s.d}</div>
        </div>`).join("")}
        <div style="border-top:1px solid #12122a;padding-top:8px;margin-top:4px">
          <div style="color:#444;font-size:9px;font-weight:600;margin-bottom:4px">按市场状态</div>
          ${[{l:"震荡",v:"+14.5%",c:"#26a69a"},{l:"中性",v:"+5.8%",c:"#26a69a"},{l:"趋势",v:"-2.1%",c:"#ef5350"}].map(r =>
            `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #08081a">
              <span style="color:#555;font-size:9px">${r.l}</span>
              <span style="color:${r.c};font-family:var(--m);font-size:9px;font-weight:600">${r.v}</span>
            </div>`).join("")}
        </div>
      </div>
      <div class="card">
        <div class="section-title" style="color:#ef5350">⚠️ 失败模式</div>
        ${losses.map((lm, i) => `<div style="background:#08081a;border-radius:4px;padding:8px;margin-bottom:6px;border:1px solid #10102a">
          <div style="display:flex;justify-content:space-between;margin-bottom:2px">
            <span style="color:#bbb;font-size:10px;font-weight:700">${i+1}. ${lm.l}</span>
            <span style="font-family:var(--m);font-size:12px;font-weight:800;color:#ef5350">${lm.pct}%</span>
          </div>
          <div style="font-size:8px;color:#444;border-left:2px solid #ef535030;padding-left:6px">${lm.ex}</div>
        </div>`).join("")}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="card">
        <div class="section-title" style="color:#6366f1">🔬 参数敏感度</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          ${sens.map(ps => {
            const best = Math.max(...ps.vals.map(v => v.pnl));
            return `<div>
              <div style="color:#888;font-size:10px;font-weight:700;margin-bottom:4px">${ps.p}</div>
              <table style="width:100%;border-collapse:collapse;font-size:9px">
                <thead><tr style="border-bottom:1px solid #12122a">
                  <th style="padding:2px 4px;text-align:left;color:#333;font-size:7px">值</th>
                  <th style="padding:2px 4px;text-align:center;color:#333;font-size:7px">收益</th>
                  <th style="padding:2px 4px;text-align:center;color:#333;font-size:7px">成交</th>
                </tr></thead>
                <tbody>${ps.vals.map(r =>
                  `<tr style="border-bottom:1px solid #08081a;background:${r.pnl === best ? "#26a69a06" : "transparent"}">
                    <td style="padding:2px 4px;font-family:var(--m);color:#aaa">${r.v}</td>
                    <td style="padding:2px 4px;text-align:center;font-family:var(--m);font-weight:700;color:#26a69a">+${r.pnl}${r.pnl === best ? '<span style="color:#f59e0b;margin-left:1px;font-size:6px">★</span>' : ""}</td>
                    <td style="padding:2px 4px;text-align:center;font-family:var(--m);color:#666">${r.f}%</td>
                  </tr>`).join("")}
                </tbody>
              </table>
            </div>`;
          }).join("")}
        </div>
      </div>
      <div class="card">
        <div class="section-title">📊 单笔收益分布</div>
        ${dist.map(b => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="width:44px;text-align:right;color:#555;font-size:9px;font-family:var(--m);flex-shrink:0">${b.r}</span>
          <div style="flex:1;height:14px;background:#08081a;border-radius:3px;overflow:hidden">
            <div style="height:14px;width:${(b.n / maxD) * 100}%;background:${b.c};border-radius:3px;display:flex;align-items:center;padding-left:4px">
              ${b.n > 20 ? `<span style="color:#060612;font-size:7px;font-weight:700">${b.n}</span>` : ""}
            </div>
          </div>
          <span style="width:20px;color:#444;font-size:8px;font-family:var(--m)">${b.n}</span>
        </div>`).join("")}
        <div style="color:#222;font-size:8px;margin-top:4px;text-align:center">靠<span style="color:#26a69a">大量小盈利</span>积累，偶被<span style="color:#ef5350">单边行情</span>打回撤</div>
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
    {k:"pnl",    l:"累计PnL", f: v => (v >= 0 ? "+" : "") + v,          c: v => v >= 0 ? "#26a69a" : "#ef5350"},
    {k:"trades", l:"交易",    f: v => v,                                  c: () => "#aaa"},
    {k:"winRate",l:"胜率",    f: v => v + "%",                            c: v => v > 30 ? "#26a69a" : "#f59e0b"},
    {k:"avgPos", l:"仓位",    f: v => "$" + parseFloat(v).toFixed(1),    c: () => "#aaa"},
  ];
  const tableRows = ms.map(m => {
    const best = Math.max(...sts.map(x => x[m.k]));
    return `<tr style="border-bottom:1px solid #0a0a18">
      <td style="padding:5px 8px;color:#555;font-weight:600">${m.l}</td>
      ${sts.map(s => `<td style="padding:5px 8px;text-align:center;font-family:var(--m);font-weight:700;font-size:12px;
        color:${m.c(s[m.k])};background:${s[m.k] === best ? m.c(s[m.k]) + "08" : "transparent"}">
        ${m.f(s[m.k])}${s[m.k] === best ? '<span style="margin-left:3px;font-size:7px;color:#f59e0b">★</span>' : ""}
      </td>`).join("")}
    </tr>`;
  }).join("");

  // Generate MLC chart data
  const pnlSeries = sts.map(s => ({name: s.name, color: s.color, fmt: v => (v >= 0 ? "+" : "") + v.toFixed(0),
    data: sl_genS(0, s.pnl > 0 ? 0.8 : -0.3, s.pnl > 100 ? 8 : 5)}));
  const posSeries = sts.map(s => ({name: s.name, color: s.color, fmt: v => "$" + v.toFixed(1),
    data: sl_genS(s.avgPos, 0, 3).map(v => Math.max(0, v))}));
  const wrSeries = sts.map(s => ({name: s.name, color: s.color, fmt: v => v.toFixed(0) + "%",
    data: sl_genS(s.winRate, 0, 8).map(v => Math.max(5, Math.min(80, v)))}));

  return `<div style="display:flex;flex-direction:column;gap:12px">
    <div class="card">
      <div class="section-title">⚡ 核心指标</div>
      <table style="width:100%;border-collapse:collapse;font-size:10px">
        <thead><tr style="border-bottom:1px solid #12122a">
          <th style="padding:5px 8px;text-align:left;color:#333;font-size:9px;width:60px">指标</th>
          ${sts.map(s => `<th style="padding:5px 8px;text-align:center;border-bottom:2px solid ${s.color}">
            <div style="display:flex;align-items:center;justify-content:center;gap:4px">
              <div style="width:6px;height:6px;border-radius:1px;background:${s.color}"></div>
              <span style="color:#ccc;font-size:10px;font-weight:700">${s.name}</span>
            </div>
          </th>`).join("")}
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div class="card">
      <div class="section-title">📈 趋势对比</div>
      ${sl_mlc("累计 PnL", pnlSeries)}
      ${sl_mlc("仓位变化", posSeries)}
      ${sl_mlc("滚动胜率", wrSeries)}
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
    <div id="sl-sidebar" style="width:160px;background:#080814;border-right:1px solid #10102a;display:flex;flex-direction:column;flex-shrink:0;overflow:auto"></div>
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
      <div id="sl-subtab-bar" class="subtab-bar"></div>
      <div id="sl-content" style="flex:1;overflow:auto;padding:14px"></div>
    </div>`;
  sl_renderSidebar();
  sl_renderSubtabBar();
  sl_renderContent();
};
