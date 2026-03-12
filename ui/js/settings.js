// ─── State ──────────────────────────────
let st_sec = "risk";
let st_risk = {pos: 10, maxOrd: 6, stop: 5, dd: 25};
let st_cancel = {sigma: 0.30, tau: 60, age: 20};
let st_fill = {model: "conservative", disc: 0.50, delay: 500};
let st_events = {fomc: true, cpi: true, nfp: false};

// ─── Slider helper ───────────────────────
function st_slider(id, label, value, min, max, step, unit = "", disabled = false) {
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
        oninput="st_onSlider('${id}',this.value,${min},${max},'${unit}',${step < 1})">` : ""}
      <div id="${id}-thumb" class="slider-thumb${dis}" style="left:calc(${pct}% - 12px)"></div>
    </div>
  </div>`;
}

function st_onSlider(id, val, min, max, unit, isFloat) {
  const v = parseFloat(val);
  const pct = ((v - min) / (max - min)) * 100;
  const dispVal = isFloat ? v.toFixed(2) : v.toFixed(0);
  const valEl = document.getElementById(id + "-val");
  const fillEl = document.getElementById(id + "-fill");
  const thumbEl = document.getElementById(id + "-thumb");
  if (valEl) valEl.textContent = dispVal + unit;
  if (fillEl) fillEl.style.width = pct + "%";
  if (thumbEl) thumbEl.style.left = `calc(${pct}% - 12px)`;
  // update state
  if (id === "st-pos")    st_risk.pos    = v;
  if (id === "st-maxOrd") st_risk.maxOrd = v;
  if (id === "st-stop")   st_risk.stop   = v;
  if (id === "st-dd")     st_risk.dd     = v;
  if (id === "st-sigma")  st_cancel.sigma = v;
  if (id === "st-tau")    st_cancel.tau   = v;
  if (id === "st-age")    st_cancel.age   = v;
  if (id === "st-disc")   st_fill.disc    = v;
  if (id === "st-delay")  st_fill.delay   = v;
}

// ─── Toggle helper ───────────────────────
function st_toggle(id, label, on) {
  return `<div class="toggle-wrap">
    <span style="color:#666;font-size:20px">${label}</span>
    <div onclick="st_onToggle('${id}')" class="toggle-track" id="${id}-track" style="background:${on ? "#6366f1" : "#141428"}">
      <div id="${id}-knob" class="toggle-knob" style="left:${on ? "32px" : "4px"}"></div>
    </div>
  </div>`;
}

function st_onToggle(id) {
  if (id === "st-fomc") st_events.fomc = !st_events.fomc;
  if (id === "st-cpi")  st_events.cpi  = !st_events.cpi;
  if (id === "st-nfp")  st_events.nfp  = !st_events.nfp;
  const on = id === "st-fomc" ? st_events.fomc : id === "st-cpi" ? st_events.cpi : st_events.nfp;
  const track = document.getElementById(id + "-track");
  const knob  = document.getElementById(id + "-knob");
  if (track) track.style.background = on ? "#6366f1" : "#141428";
  if (knob)  knob.style.left = on ? "32px" : "4px";
}

// ─── Section content ─────────────────────
function st_renderContent() {
  const el = document.getElementById("st-content");
  if (!el) return;
  const hasSel = typeof sl_sel !== 'undefined' && sl_sel;
  const instanceLabel = hasSel
    ? `<div style="font-size:12px;color:var(--color-up,#26a69a);padding:8px 16px 4px;border-bottom:1px solid #1a1a2e;margin-bottom:8px;">✏ 当前编辑实例：<strong>${sl_sel}</strong></div>`
    : `<div style="font-size:12px;color:var(--color-muted,#888);padding:8px 16px 4px;border-bottom:1px solid #1a1a2e;margin-bottom:8px;">⚠ 请先在策略实验室中选择一个实例</div>`;
  let html = "";
  if (st_sec === "risk") {
    html = `<div class="card">
      <div class="section-title">🛡️ 风险控制</div>
      ${st_slider("st-pos",    "仓位上限", st_risk.pos,    1,  50, 1,  "USD")}
      ${st_slider("st-maxOrd", "挂单上限", st_risk.maxOrd, 2,  12, 1)}
      ${st_slider("st-stop",   "连亏停机", st_risk.stop,   2,  20, 1,  "次")}
      ${st_slider("st-dd",     "回撤停机", st_risk.dd,     5,  50, 5,  "%")}
    </div>`;
  } else if (st_sec === "cancel") {
    html = `<div class="card">
      <div class="section-title">🔔 撤单引擎</div>
      ${st_slider("st-sigma", "sigma跳变", st_cancel.sigma, 0.1, 0.8,  0.05)}
      ${st_slider("st-tau",   "时间衰减",  st_cancel.tau,   30,  300,  10,  "s")}
      ${st_slider("st-age",   "挂单老化",  st_cancel.age,   5,   60,   5,   "s")}
      <div style="display:flex;justify-content:space-between;margin-top:8px">
        <span style="color:#666;font-size:20px">tick变更</span>
        <span class="badge" style="background:#ef535015;color:var(--color-down)">强制</span>
      </div>
    </div>`;
  } else if (st_sec === "events") {
    html = `<div class="card">
      <div class="section-title">📅 事件回避</div>
      ${st_toggle("st-fomc", "FOMC 利率决议", st_events.fomc)}
      ${st_toggle("st-cpi",  "CPI 数据发布",  st_events.cpi)}
      ${st_toggle("st-nfp",  "NFP 非农数据",  st_events.nfp)}
    </div>`;
  } else if (st_sec === "fill") {
    const isOpt = st_fill.model === "optimistic";
    html = `<div class="card">
      <div class="section-title">🧪 模拟模式</div>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <div onclick="st_setFillModel('conservative')" style="flex:1;text-align:center;padding:6px 0;border-radius:6px;font-size:18px;font-weight:600;
          cursor:pointer;background:${!isOpt ? "#6366f1" : "#12122a"};color:${!isOpt ? "#fff" : "#333"}">保守</div>
        <div onclick="st_setFillModel('optimistic')" style="flex:1;text-align:center;padding:6px 0;border-radius:6px;font-size:18px;font-weight:600;
          cursor:pointer;background:${isOpt ? "#6366f1" : "#12122a"};color:${isOpt ? "#fff" : "#333"}">乐观</div>
      </div>
      ${st_slider("st-disc",  "fill_discount", st_fill.disc,  0.1,  1.0,  0.1,  "",   isOpt)}
      ${st_slider("st-delay", "fill_delay",    st_fill.delay, 100, 2000, 100,  "ms", isOpt)}
    </div>`;
  }
  html += `<div onclick="st_applySettings()" style="margin-top:24px;text-align:center;padding:14px 0;border-radius:10px;font-size:22px;font-weight:700;
    background:linear-gradient(135deg,#6366f1,#0ea5e9);color:#fff;cursor:pointer">应用设置</div>`;
  el.innerHTML = instanceLabel + html;
  if (!hasSel) {
    el.querySelectorAll('input[type=range]').forEach(e => { e.disabled = true; e.style.opacity = '0.4'; });
    el.querySelectorAll('button').forEach(e => {
      if (!e.dataset.keepEnabled) { e.disabled = true; e.style.opacity = '0.4'; }
    });
  }
}

function st_setFillModel(model) {
  st_fill.model = model;
  st_renderContent();
}

async function st_applySettings() {
  const instanceName = (typeof sl_sel !== 'undefined' && sl_sel) ? sl_sel : null;
  if (!instanceName) {
    st_showToast('请先在策略实验室选择一个实例', 'error');
    return;
  }

  const patch = {
    risk: {
      max_position_usd: st_risk.pos,
      max_open_orders: st_risk.maxOrd,
      consecutive_loss_stop: st_risk.stop,
      max_drawdown_pct: st_risk.dd / 100,
    },
    cancel: {
      sigma_threshold: st_cancel.sigma,
      tau_min_sec: st_cancel.tau,
      order_age_max_sec: st_cancel.age,
    },
    paper: {
      fill_model: st_fill.model,
      fill_discount: st_fill.disc,
      fill_delay_ms: st_fill.delay,
    },
  };

  try {
    const r = await fetch(BASE_URL + `/strategies/${instanceName}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Write failed');
  } catch (err) {
    st_showToast('保存失败：' + err.message, 'error');
    return;
  }

  const isLive = (typeof st_executorMode !== 'undefined' && st_executorMode === 'live')
              || document.body.dataset.executorMode === 'live';
  const confirmMsg = isLive
    ? '⚠️ 当前为 Live 模式！\n\nconfig/reload 将短暂中断所有 runner（约 1~2 秒），期间可能影响在途挂单。\n\n确认继续？'
    : 'config/reload 将短暂中断所有 runner（约 1~2 秒）。\n\n确认继续？';
  const confirmed = confirm(confirmMsg);
  if (!confirmed) {
    st_showToast('已取消重载', 'success');
    return;
  }

  try {
    const r = await fetch(BASE_URL + '/config/reload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: instanceName }) });
    if (!r.ok) throw new Error('Reload failed: HTTP ' + r.status);
    st_showToast('设置已保存并重载成功', 'success');
  } catch (err) {
    st_showToast('配置已写入，但重载失败：' + err.message, 'error');
  }
}

function st_showToast(msg, type = 'success') {
  const existing = document.getElementById('st-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'st-toast';
  toast.textContent = msg;
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    padding: 12px 20px; border-radius: 6px; font-size: 13px;
    background: ${type === 'error' ? '#ef5350' : '#26a69a'};
    color: #fff; max-width: 400px; line-height: 1.5;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// ─── Sidebar nav ─────────────────────────
function st_renderNav() {
  const el = document.getElementById("st-nav");
  if (!el) return;
  const navs = [
    {id:"risk",   icon:"🛡️", l:"风险控制"},
    {id:"cancel", icon:"🔔", l:"撤单引擎"},
    {id:"events", icon:"📅", l:"事件回避"},
    {id:"fill",   icon:"🧪", l:"模拟模式"},
  ];
  el.innerHTML = navs.map(n => `<div onclick="st_setSec('${n.id}')" style="padding:14px 20px;cursor:pointer;
    border-left:${st_sec === n.id ? "6px solid #6366f1" : "6px solid transparent"};background:${st_sec === n.id ? "#0e0e22" : "transparent"}">
    <span style="font-size:22px;margin-right:10px">${n.icon}</span>
    <span style="color:${st_sec === n.id ? "#ccc" : "#555"};font-weight:600;font-size:20px">${n.l}</span>
  </div>`).join("");
}

function st_setSec(id) {
  st_sec = id;
  st_renderNav();
  st_renderContent();
}

// ─── Init ────────────────────────────────
window.initSettings = function() {
  const el = document.getElementById("page-set");
  if (!el) return;
  el.style.flexDirection = "row";
  el.innerHTML = `
    <div style="width:320px;background:#080814;border-right:2px solid #10102a;overflow:auto;flex-shrink:0;display:flex;flex-direction:column">
      <div style="padding:16px 20px;color:#2a2a40;font-size:16px;font-weight:600;letter-spacing:1px">通用设置</div>
      <div id="st-nav"></div>
      <div style="padding:20px;margin-top:auto;border-top:2px solid #10102a;color:#1a1a30;font-size:14px">所有设置对全部策略生效</div>
    </div>
    <div id="st-content" style="flex:1;overflow:auto;padding:28px;max-width:800px"></div>`;
  st_renderNav();
  st_renderContent();
};
