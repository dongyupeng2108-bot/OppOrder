// ─── New strategy ────────────────────────
function sl_newStrategy() {
  document.getElementById('sl-create-modal')?.remove();
  fetch(`${BASE_URL}/ui/instances`)
    .then(r => r.json())
    .then(d => _sl_showCreateModal((d.data || []).map(i => i.strategy_id)))
    .catch(() => _sl_showCreateModal([]));
}

function _sl_showCreateModal(existingNames) {
  const tplOpts = existingNames.map(n =>
    `<option value="${n}">${n}</option>`).join('');

  const overlay = document.createElement('div');
  overlay.id = 'sl-create-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
    'background:rgba(0,0,0,0.75);z-index:999;display:flex;align-items:center;justify-content:center';

  overlay.innerHTML = `
    <div style="background:#0d0d1a;border:1px solid #1e1e3a;border-radius:8px;
      padding:32px;width:480px;max-width:92vw">
      <div style="font-size:24px;color:#e0e0ff;font-weight:600;margin-bottom:24px">新建策略实例</div>

      <div style="margin-bottom:16px">
        <label style="color:#8080a0;font-size:16px;display:block;margin-bottom:6px">
          实例名称 <span style="color:#ff6b6b">*</span>
        </label>
        <input id="sl-cs-name" type="text" placeholder="如: btc_5m_maker_v2"
          style="width:100%;background:#0a0a18;border:1px solid #1e1e3a;color:#e0e0ff;
            padding:10px 12px;font-size:18px;border-radius:4px;box-sizing:border-box"/>
      </div>

      <div style="margin-bottom:16px">
        <label style="color:#8080a0;font-size:16px;display:block;margin-bottom:6px">策略类型</label>
        <select id="sl-cs-type"
          style="width:100%;background:#0a0a18;border:1px solid #1e1e3a;color:#e0e0ff;
            padding:10px 12px;font-size:18px;border-radius:4px;box-sizing:border-box">
          <option value="pair_cost_maker">S1 配对成本做市</option>
          <option value="low_price_sniper">S2 低价接博</option>
          <option value="bs_directional">BS 方向性交易</option>
        </select>
      </div>

      <div style="margin-bottom:20px">
        <label style="color:#8080a0;font-size:16px;display:block;margin-bottom:6px">复制自（可选）</label>
        <select id="sl-cs-base"
          style="width:100%;background:#0a0a18;border:1px solid #1e1e3a;color:#e0e0ff;
            padding:10px 12px;font-size:18px;border-radius:4px;box-sizing:border-box">
          <option value="">— 使用默认参数 —</option>
          ${tplOpts}
        </select>
      </div>

      <div id="sl-cs-error" style="color:#ff6b6b;font-size:16px;margin-bottom:12px;display:none"></div>

      <div style="display:flex;gap:12px;justify-content:flex-end">
        <button onclick="document.getElementById('sl-create-modal').remove()"
          style="padding:10px 24px;background:#1a1a2e;border:1px solid #1e1e3a;
            color:#8080a0;border-radius:4px;font-size:18px;cursor:pointer">取消</button>
        <button id="sl-cs-submit" onclick="_sl_submitCreate()"
          style="padding:10px 24px;background:#00d4aa;border:none;color:#000;
            border-radius:4px;font-size:18px;cursor:pointer;font-weight:600">创建</button>
      </div>
    </div>`;

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('sl-cs-name')?.focus(), 50);
}

function _sl_submitCreate() {
  const name  = (document.getElementById('sl-cs-name')?.value || '').trim();
  const type  = document.getElementById('sl-cs-type')?.value;
  const base  = document.getElementById('sl-cs-base')?.value;
  const errEl = document.getElementById('sl-cs-error');
  const btn   = document.getElementById('sl-cs-submit');

  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    errEl.textContent = '实例名称只允许字母/数字/下划线/连字符';
    errEl.style.display = 'block';
    return;
  }
  btn.textContent = '创建中…'; btn.disabled = true;
  errEl.style.display = 'none';

  fetch(`${BASE_URL}/strategies/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, base_config: base || undefined, overrides: { 'strategy.type': type } })
  })
  .then(r => r.json())
  .then(d => {
    if (!d.ok) throw new Error(d.error);
    document.getElementById('sl-create-modal')?.remove();
    sl_pollInstances(name);
  })
  .catch(e => {
    errEl.textContent = e.message; errEl.style.display = 'block';
    btn.textContent = '创建'; btn.disabled = false;
  });
}

const SL_TM = { pair:{icon:"⚖️",short:"配对"}, revert:{icon:"🎯",short:"回归"}, breakout:{icon:"📐",short:"突破"} };

// ─── State ──────────────────────────────
let sl_sel = "s1";
let sl_sub = "edit";
let sl_checked = ["s1","s2","s3"];
let sl_offset = 0.03;
let sl_tranches = 3;
let sl_pairT = 0.97;
let sl_instances = null; // null=未加载; []=无策略; [...]= 已加载
let sl_deployed = new Set(); // DEPRECATED: replaced by sl_serverStatus
let sl_serverStatus = {}; // key=实例名, value={ name, desired_state, runtime_state, last_error, last_heartbeat }
let sl_isEditing = false; // 用户正在编辑参数期间不覆盖选中状态

const SL_MIN_POSTMORTEM = 50; // 统计意义所需最低记录数

async function sl_fetchAttribution() {
  try {
    const r = await fetch(BASE_URL + '/postmortem/attribution');
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}

async function sl_fetchLossModes() {
  try {
    const r = await fetch(BASE_URL + '/postmortem/loss-modes');
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}

async function sl_fetchCompareData() {
  try {
    const r = await fetch(BASE_URL + '/stats?group_by=strategy_id,config_hash');
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}

async function sl_fetchPostmortemCount() {
  try {
    // /stats 不存在时从 attribution regime_buckets 汇总总数
    const r = await fetch(BASE_URL + '/postmortem/attribution');
    if (!r.ok) return 0;
    const d = await r.json();
    const buckets = Array.isArray(d.regime_buckets) ? d.regime_buckets : [];
    return buckets.reduce((s, x) => s + (x.count || 0), 0);
  } catch (_) { return 0; }
}

async function sl_renderAttribution(containerEl) {
  const count = await sl_fetchPostmortemCount();
  if (count < SL_MIN_POSTMORTEM) {
    containerEl.innerHTML = `<div style="padding:24px;text-align:center;color:#666;font-size:13px;">数据积累中（当前 ${count} 条，需 ${SL_MIN_POSTMORTEM}+ 条才有统计意义）</div>`;
    return;
  }
  const data = await sl_fetchAttribution();
  if (!data) {
    containerEl.innerHTML = `<div style="padding:24px;text-align:center;color:var(--color-down);font-size:13px;">归因数据加载失败，请检查服务</div>`;
    return;
  }
  const regimeBuckets = Array.isArray(data.regime_buckets) ? data.regime_buckets : [];
  const hourBuckets = Array.isArray(data.hour_buckets) ? data.hour_buckets : [];
  const regimeRows = regimeBuckets.map(row =>
    `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #1a1a2e;">${row.regime_bucket || '—'}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a1a2e;text-align:right;">${row.count || 0}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a1a2e;text-align:right;color:${(row.total_pnl||0)>=0?'#26a69a':'#ef5350'};">${row.total_pnl !== undefined ? (row.total_pnl >= 0 ? '+' : '') + row.total_pnl.toFixed(4) : '—'}</td>
    </tr>`
  ).join('');
  const hourRows = hourBuckets.map(row =>
    `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #1a1a2e;">${row.hour_bucket || '—'}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a1a2e;text-align:right;">${row.count || 0}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a1a2e;text-align:right;color:${(row.total_pnl||0)>=0?'#26a69a':'#ef5350'};">${row.total_pnl !== undefined ? (row.total_pnl >= 0 ? '+' : '') + row.total_pnl.toFixed(4) : '—'}</td>
    </tr>`
  ).join('');
  containerEl.innerHTML = `
    <div style="font-size:12px;color:#888;margin-bottom:6px;padding:0 12px;">Regime 分桶</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="color:#aaa;">
        <th style="padding:6px 12px;text-align:left;border-bottom:1px solid #333;">市场状态</th>
        <th style="padding:6px 12px;text-align:right;border-bottom:1px solid #333;">样本数</th>
        <th style="padding:6px 12px;text-align:right;border-bottom:1px solid #333;">总 PnL</th>
      </tr></thead>
      <tbody>${regimeRows || '<tr><td colspan="3" style="padding:12px;text-align:center;color:#555;">暂无数据</td></tr>'}</tbody>
    </table>
    <div style="font-size:12px;color:#888;margin:10px 0 6px;padding:0 12px;">时段分桶</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="color:#aaa;">
        <th style="padding:6px 12px;text-align:left;border-bottom:1px solid #333;">时段</th>
        <th style="padding:6px 12px;text-align:right;border-bottom:1px solid #333;">样本数</th>
        <th style="padding:6px 12px;text-align:right;border-bottom:1px solid #333;">总 PnL</th>
      </tr></thead>
      <tbody>${hourRows || '<tr><td colspan="3" style="padding:12px;text-align:center;color:#555;">暂无数据</td></tr>'}</tbody>
    </table>`;
}

async function sl_renderLossModes(containerEl) {
  const count = await sl_fetchPostmortemCount();
  if (count < SL_MIN_POSTMORTEM) {
    containerEl.innerHTML = `<div style="padding:24px;text-align:center;color:#666;font-size:13px;">数据积累中（当前 ${count} 条，需 ${SL_MIN_POSTMORTEM}+ 条才有统计意义）</div>`;
    return;
  }
  const data = await sl_fetchLossModes();
  if (!data) {
    containerEl.innerHTML = `<div style="padding:24px;text-align:center;color:var(--color-down);font-size:13px;">失败模式数据加载失败，请检查服务</div>`;
    return;
  }
  const modes = Array.isArray(data.modes) ? data.modes : [];
  const items = modes.map(item =>
    `<div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #1a1a2e;font-size:13px;">
      <span style="color:#ccc;">${item.loss_mode || item.mode || '未知'}</span>
      <span style="color:var(--color-down);">${item.count || 0} 次${item.avg_cost !== undefined ? '（avg cost: ' + item.avg_cost.toFixed(4) + '）' : ''}</span>
    </div>`
  ).join('');
  containerEl.innerHTML = items || `<div style="padding:24px;text-align:center;color:#666;font-size:13px;">暂无失败记录</div>`;
}

async function sl_fetchStatus() {
  try {
    const r = await fetch(BASE_URL + '/strategies/status');
    if (!r.ok) return;
    const d = await r.json();
    sl_serverStatus = {};
    (d.instances || []).forEach(s => { sl_serverStatus[s.name] = s; });
  } catch (_) {}
}

async function sl_loadInstanceParams(name) {
  sl_isEditing = true;
  try {
    const r = await fetch(BASE_URL + `/strategies/${name}/config`);
    if (!r.ok) return;
    const config = await r.json();
    const s = config.strategy || {};
    if (s.entry_offset !== undefined)    sl_offset   = s.entry_offset;
    if (s.order_tranches !== undefined)  sl_tranches = s.order_tranches;
    if (s.pair_cost_target !== undefined) sl_pairT   = s.pair_cost_target;
    sl_renderEdit();
  } catch (_) {}
}

// ─── Instance fetch ───────────────────────
async function sl_pollInstances(autoSelect) {
  try {
    const res = await fetch(BASE_URL + '/ui/instances');
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok && Array.isArray(data.data)) {
      await sl_fetchStatus();
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
      if (!sl_isEditing) {
        if (autoSelect && sl_instances.find(i => i.id === autoSelect)) {
          sl_sel = autoSelect;
          sl_checked = sl_instances.slice(0, 3).map(s => s.id);
        } else if (sl_instances.length > 0 && (!sl_sel || !sl_instances.find(i => i.id === sl_sel))) {
          sl_sel = sl_instances[0].id;
          sl_checked = sl_instances.slice(0, 3).map(s => s.id);
        }
        sl_renderSidebar();
        sl_renderSubtabBar();
        sl_renderContent();
      }
    }
  } catch (_) {}
}

function sl_findStrat(id) {
  if (sl_instances) {
    const s = sl_instances.find(s => s.id === id);
    if (s) return s;
  }
  return null;
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
  const list = sl_instances ?? [];
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
      <button onclick="sl_saveParams()" style="margin-top:16px;width:100%;padding:14px 0;border-radius:10px;font-size:22px;font-weight:700;background:#00d4aa;border:none;color:#000;cursor:pointer">保存参数</button>
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
            <span style="font-family:var(--m);color:var(--color-up);font-size:20px;font-weight:700">+${r.pnl}${r.pnl === best ? '<span style="color:#f59e0b;margin-left:4px;font-size:14px">★</span>' : ""}</span>
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
      <div style="margin-top:20px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          ${sl_serverStatus[sl_sel]?.runtime_state === true
            ? `<span style="background:#26a69a20;color:#26a69a;padding:4px 10px;border-radius:4px;font-size:16px;font-weight:600">● 运行中</span>`
            : sl_serverStatus[sl_sel]?.desired_state === false
              ? `<span style="background:#44444420;color:#888;padding:4px 10px;border-radius:4px;font-size:16px">○ 已禁用</span>`
              : ''}
          ${sl_serverStatus[sl_sel]?.last_error
            ? `<span style="background:#ff444420;color:#ff6b6b;padding:4px 10px;border-radius:4px;font-size:16px;cursor:help" title="${sl_serverStatus[sl_sel].last_error}">⚠ 错误</span>`
            : ''}
        </div>
        ${sl_serverStatus[sl_sel]?.last_heartbeat
          ? `<div style="color:#444;font-size:14px;margin-bottom:8px">最后心跳：${Math.round((Date.now()-sl_serverStatus[sl_sel].last_heartbeat)/1000)}秒前</div>`
          : ''}
        ${sl_serverStatus[sl_sel]?.runtime_state === true
          ? `<button onclick="sl_stopDeploy()" style="width:100%;padding:14px;background:transparent;border:2px solid #ff6b6b;color:#ff6b6b;border-radius:6px;font-size:20px;cursor:pointer;font-weight:600">■ 停止部署</button>`
          : `<button onclick="sl_deployRun()" style="width:100%;padding:14px;background:#00d4aa;border:none;color:#000;border-radius:6px;font-size:20px;cursor:pointer;font-weight:600">→ 部署运行</button>`}
        <button onclick="sl_deleteStrategy()" style="width:100%;padding:14px;background:transparent;border:2px solid #ff4444;color:#ff4444;border-radius:6px;font-size:20px;cursor:pointer;font-weight:600;margin-top:12px">删除策略</button>
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
        <div id="sl-attribution-container" style="color:#2a2a40;font-size:13px;text-align:center;padding:24px 0">加载中…</div>
      </div>
      <div class="card">
        <div class="section-title" style="color:#ef5350">⚠️ 失败模式</div>
        <div id="sl-loss-modes-container" style="color:#2a2a40;font-size:13px;text-align:center;padding:24px 0">加载中…</div>
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
async function sl_renderCompare() {
  const container = document.getElementById('sl-compare-container');
  if (!container) return;

  container.innerHTML = `<div style="padding:24px;text-align:center;color:#666;font-size:13px;">加载中…</div>`;

  const data = await sl_fetchCompareData();
  const rows = data?.rows || [];

  if (rows.length === 0) {
    container.innerHTML = `<div style="padding:24px;text-align:center;color:#666;font-size:13px;">暂无复盘数据，运行策略后自动更新</div>`;
    return;
  }

  rows.sort((a, b) => (b.avg_pnl || 0) - (a.avg_pnl || 0));

  const tableRows = rows.map(row => {
    const pnl = row.avg_pnl || 0;
    const pnlColor = pnl >= 0 ? '#26a69a' : '#ef5350';
    const pnlStr = (pnl >= 0 ? '+' : '') + pnl.toFixed(4);
    const hash = row.config_hash ? row.config_hash.slice(0, 8) : '—';
    const winRate = row.win_rate !== undefined ? (row.win_rate * 100).toFixed(1) + '%' : '—';

    return `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #1a1a2e;font-size:12px;">${row.strategy_id || '—'}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a1a2e;font-size:12px;color:#888;">${hash}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a1a2e;font-size:12px;text-align:right;">${row.count || 0}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a1a2e;font-size:12px;text-align:right;color:${pnlColor};">${pnlStr}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a1a2e;font-size:12px;text-align:right;">${winRate}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="color:#888;font-size:11px;">
        <th style="padding:6px 12px;text-align:left;border-bottom:1px solid #333;">策略</th>
        <th style="padding:6px 12px;text-align:left;border-bottom:1px solid #333;">Config</th>
        <th style="padding:6px 12px;text-align:right;border-bottom:1px solid #333;">样本</th>
        <th style="padding:6px 12px;text-align:right;border-bottom:1px solid #333;">均PnL</th>
        <th style="padding:6px 12px;text-align:right;border-bottom:1px solid #333;">胜率</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div style="margin-top:8px;font-size:11px;color:#555;padding:0 12px;">
      主键：strategy_id + config_hash · 共 ${rows.length} 组 · 总样本 ${data.total_count || 0}
    </div>`;
}

// ─── Main render ─────────────────────────
function sl_renderContent() {
  const el = document.getElementById("sl-content");
  if (!el) return;
  if (sl_sub === "edit") el.innerHTML = sl_renderEdit();
  else if (sl_sub === "postmortem") el.innerHTML = sl_renderPostmortem();
  else { el.innerHTML = '<div id="sl-compare-container"></div>'; sl_renderCompare(); }
  if (sl_sub === "edit") sl_updateInfluence();
  if (sl_sub === "postmortem") {
    const attrEl = document.getElementById('sl-attribution-container');
    const lossEl = document.getElementById('sl-loss-modes-container');
    if (attrEl) sl_renderAttribution(attrEl);
    if (lossEl) sl_renderLossModes(lossEl);
  }
}

// ─── Event handlers ──────────────────────
async function sl_setSel(id) { sl_sel = id; sl_renderSidebar(); sl_renderSubtabBar(); sl_renderContent(); await sl_loadInstanceParams(id); }
function sl_setSub(sub) { sl_sub = sub; sl_renderSidebar(); sl_renderSubtabBar(); sl_renderContent(); }
function sl_toggleCheck(id) {
  sl_checked = sl_checked.includes(id) ? sl_checked.filter(x => x !== id) : [...sl_checked, id];
  sl_renderSidebar();
  if (sl_sub === "compare") sl_renderContent();
}

// ─── Deploy / Stop / Delete ──────────────
async function sl_deployRun() {
  if (!sl_sel) return;
  // 部署前自动保存当前滑条参数（静默，不弹 toast）
  try {
    await fetch(BASE_URL + `/strategies/${sl_sel}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy: { entry_offset: sl_offset, order_tranches: sl_tranches, pair_cost_target: sl_pairT } })
    });
  } catch (_) {}
  fetch(`${BASE_URL}/config/reload`, { method: 'POST' })
    .then(r => r.json())
    .then(async () => {
      await sl_fetchStatus();
      sl_renderContent();
      _sl_toast(`${sl_sel} 已部署`);
    })
    .catch(e => _sl_toast(`部署失败: ${e.message}`, true));
}

function sl_stopDeploy() {
  if (!sl_sel) return;
  fetch(`${BASE_URL}/strategies/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: sl_sel })
  })
  .then(r => r.json())
  .then(async d => {
    if (!d.ok) throw new Error(d.error);
    await sl_fetchStatus();
    sl_renderContent();
    _sl_toast(`${sl_sel} 已停止`);
  })
  .catch(e => _sl_toast(`停止失败: ${e.message}`, true));
}

function sl_deleteStrategy() {
  if (!sl_sel) return;
  if (!confirm(`确认删除策略实例「${sl_sel}」？\n\n此操作不可撤销，实例配置文件将被永久删除。`)) return;

  fetch(`${BASE_URL}/strategies/${encodeURIComponent(sl_sel)}`, { method: 'DELETE' })
    .then(r => r.json())
    .then(d => {
      if (!d.ok) throw new Error(d.error);
      _sl_toast(`${sl_sel} 已删除`);
      sl_pollInstances();
    })
    .catch(e => _sl_toast(`删除失败: ${e.message}`, true));
}

function _sl_toast(msg, isError = false) {
  document.getElementById('sl-toast')?.remove();
  const el = document.createElement('div');
  el.id = 'sl-toast';
  el.textContent = msg;
  el.style.cssText = 'position:fixed;bottom:32px;left:50%;transform:translateX(-50%);' +
    `background:${isError ? '#ff4444' : '#00d4aa'};color:#000;` +
    'padding:12px 28px;border-radius:6px;font-size:18px;font-weight:600;' +
    'z-index:9999;pointer-events:none';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function sl_showSaveToast(msg, type = 'success') {
  const existing = document.getElementById('sl-save-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'sl-save-toast';
  toast.textContent = msg;
  toast.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;` +
    `padding:12px 20px;border-radius:6px;font-size:13px;` +
    `background:${type === 'error' ? '#ef5350' : '#26a69a'};` +
    `color:#fff;max-width:420px;line-height:1.5;` +
    `box-shadow:0 4px 12px rgba(0,0,0,0.4);`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

async function sl_saveParams() {
  if (!sl_sel) return;
  const patch = {
    strategy: {
      entry_offset: sl_offset,
      order_tranches: sl_tranches,
      pair_cost_target: sl_pairT,
    }
  };
  try {
    const r = await fetch(BASE_URL + `/strategies/${sl_sel}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Save failed');
    sl_isEditing = false;
    sl_showSaveToast('参数已保存。点击「重新加载」使策略立即生效（将短暂中断所有 runner）。', 'success');
  } catch (err) {
    sl_isEditing = false;
    sl_showSaveToast('保存失败：' + err.message, 'error');
  }
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
