const API_BASE = '';

async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch ' + url);
    return res.json();
}

function renderNav() {
    return `
        <nav>
            <a href="/ui" onclick="route(event)">Home</a>
            <a href="/ui/strategies" onclick="route(event)">Strategies</a>
            <a href="/ui/opportunities" onclick="route(event)">Opportunities</a>
            <a href="/ui/diff" onclick="route(event)">Diff</a>
            <a href="/ui/replay" onclick="route(event)">Replay</a>
        </nav>
    `;
}

async function renderReplayList() {
    const scans = await fetchJSON('/scans');
    // Sort by timestamp desc
    scans.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    const options = scans.map(s => `<option value="${s.scan_id}">${s.scan_id} (${s.timestamp})</option>`).join('');

    return `
        ${renderNav()}
        <h1>Replay Scan</h1>
        
        <div class="run-panel" style="border: 1px solid #ccc; padding: 15px; margin-bottom: 20px; background: #f9f9f9;">
            <h3>Run New Scan</h3>
            <div style="margin-bottom: 10px;">
                <label>Seed: <input type="number" id="run_seed" value="111"></label>
            </div>
            <div style="margin-bottom: 10px;">
                <label>N Opps (1-50): <input type="number" id="run_n_opps" value="5" min="1" max="50"></label>
            </div>
            <div style="margin-bottom: 10px;">
                <label>Mode: 
                    <select id="run_mode">
                        <option value="fast">Fast</option>
                        <option value="normal">Normal</option>
                    </select>
                </label>
            </div>
            <div style="margin-bottom: 10px;">
                <label><input type="checkbox" id="run_persist" checked> Persist to Disk</label>
            </div>
            <button onclick="runScan()" style="padding: 5px 15px; background: #007bff; color: white; border: none; cursor: pointer;">Run Scan</button>
            <div id="run_status" style="margin-top: 10px; color: blue;"></div>
            
            <div id="last_metrics" style="display: none; margin-top: 15px; border-top: 1px dashed #aaa; padding-top: 10px;">
                <h4>Last Run Metrics</h4>
                <p><strong>Scan ID:</strong> <span id="m_scan_id"></span></p>
                <p><strong>Duration:</strong> <span id="m_duration"></span> ms</p>
                <p><strong>Opps Count:</strong> <span id="m_opps_count"></span> <span id="m_opps_extra" style="font-size: 0.9em; color: gray;"></span></p>
                <p><strong>Persist:</strong> <span id="m_persist"></span></p>
                <p><strong>Truncated:</strong> <span id="m_truncated"></span></p>
                <p><strong>Stages:</strong> <span id="m_stages"></span></p>
            </div>
        </div>

        <div class="controls">
            <h3>Replay Existing</h3>
            <label>Select Scan: <select id="replay_scan">${options}</select></label>
            <button onclick="goToReplay()">Replay</button>
        </div>
    `;
}

window.runScan = async function() {
    const statusEl = document.getElementById('run_status');
    const metricsPanel = document.getElementById('last_metrics');
    
    try {
        statusEl.textContent = 'Running...';
        metricsPanel.style.display = 'none';
        
        const seed = document.getElementById('run_seed').value;
        const n_opps = document.getElementById('run_n_opps').value;
        const mode = document.getElementById('run_mode').value;
        const persist = document.getElementById('run_persist').checked;

        const res = await fetch('/scans/run', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ seed, n_opps, mode, persist })
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Run scan failed');
        }
        
        const data = await res.json();
        const scan = data.scan;
        const m = scan.metrics || {};
        
        // Update Metrics UI
        document.getElementById('m_scan_id').textContent = scan.scan_id;
        document.getElementById('m_duration').textContent = scan.duration_ms;
        document.getElementById('m_opps_count').textContent = scan.summary ? scan.summary.opp_count : (scan.opp_ids || []).length;
        
        if (m.n_opps_requested && m.n_opps_actual) {
             document.getElementById('m_opps_extra').textContent = `(Req: ${m.n_opps_requested}, Act: ${m.n_opps_actual})`;
        } else {
             document.getElementById('m_opps_extra').textContent = '';
        }

        document.getElementById('m_persist').textContent = m.persist_enabled !== undefined ? m.persist_enabled : 'N/A';
        document.getElementById('m_truncated').textContent = m.truncated !== undefined ? m.truncated : 'N/A';
        
        let stagesStr = '';
        if (m.stage_ms) {
            stagesStr = Object.entries(m.stage_ms)
                .map(([k, v]) => `${k}: ${v}ms`)
                .join(', ');
        }
        document.getElementById('m_stages').textContent = stagesStr;
        metricsPanel.style.display = 'block';
        
        statusEl.textContent = 'Done. Scan ID: ' + scan.scan_id;
        
    } catch (e) {
        statusEl.textContent = 'Error: ' + e.message;
        alert('Error running scan: ' + e.message);
    }
}

window.goToReplay = function() {
    const scanId = document.getElementById('replay_scan').value;
    if (scanId) {
        history.pushState(null, '', `/ui/replay/${scanId}`);
        router();
    }
}

async function renderReplayDetail(scanId) {
    let data;
    try {
        data = await fetchJSON(`/replay?scan=${scanId}`);
    } catch (e) {
        return `${renderNav()}<h1>Error loading replay</h1><p>${e.message}</p>`;
    }
    
    const { scan, opportunities, missing_opp_ids } = data;
    
    const rows = opportunities.map(o => `
        <tr>
            <td><a href="/ui/opportunities/${o.opp_id}" onclick="route(event)">${o.opp_id}</a></td>
            <td>${o.strategy_id}</td>
            <td>${o.score_baseline || o.score}</td>
            <td>${o.tradeable_state}</td>
            <td>${o.tradeable_reason}</td>
            <td><span title="${o.llm_summary || ''}">${(o.llm_summary || '').substring(0, 30)}...</span></td>
            <td>${o.created_at}</td>
        </tr>
    `).join('');
    
    const missingHtml = missing_opp_ids.length > 0 
        ? `<div class="warning">Warning: Missing Opp IDs: ${missing_opp_ids.join(', ')}</div>` 
        : '';

    // New Metrics Section
    const summary = scan.summary || {};
    const steps = scan.steps || [];

    const stepsHtml = steps.length > 0 ? `
        <h3>Pipeline Steps</h3>
        <table style="width: 100%; margin-bottom: 20px; border-collapse: collapse;">
            <tr style="background: #f0f0f0;">
                <th style="border: 1px solid #ddd; padding: 8px;">Step</th>
                <th style="border: 1px solid #ddd; padding: 8px;">Duration (ms)</th>
                <th style="border: 1px solid #ddd; padding: 8px;">Status</th>
                <th style="border: 1px solid #ddd; padding: 8px;">Note</th>
            </tr>
            ${steps.map(s => `
                <tr>
                    <td style="border: 1px solid #ddd; padding: 8px;">${s.name}</td>
                    <td style="border: 1px solid #ddd; padding: 8px;">${s.duration_ms}</td>
                    <td style="border: 1px solid #ddd; padding: 8px; color: ${s.ok ? 'green' : 'red'};">${s.ok ? 'OK' : 'FAIL'}</td>
                    <td style="border: 1px solid #ddd; padding: 8px;">${s.note || ''}</td>
                </tr>
            `).join('')}
        </table>
    ` : '';

    const summaryHtml = scan.summary ? `
        <div class="summary-box" style="background: #eef; padding: 10px; margin-bottom: 20px; border-radius: 4px;">
            <h3 style="margin-top: 0;">Scan Summary</h3>
            <p><strong>Total Opps:</strong> ${summary.opp_count}</p>
            <p><strong>Distribution:</strong> <span style="color:green">${summary.tradeable_yes_count} YES</span>, <span style="color:red">${summary.tradeable_no_count} NO</span>, <span style="color:gray">${summary.tradeable_unknown_count} UNKNOWN</span></p>
        </div>
    ` : '';

    return `
        ${renderNav()}
        <h1>Replay: ${scan.scan_id}</h1>
        <div class="meta">
            <p><strong>Timestamp:</strong> ${scan.timestamp}</p>
            <p><strong>Duration:</strong> ${scan.duration_ms}ms</p>
            <p><strong>Opp Count:</strong> ${(scan.opp_ids || []).length}</p>
            <p><strong>Seed:</strong> ${scan.seed || 'Random'}</p>
            <a href="/export/replay.json?scan=${scanId}" target="_blank" class="button">Export JSON</a>
            <a href="/export/replay.csv?scan=${scanId}" target="_blank" class="button">Export CSV</a>
        </div>
        ${summaryHtml}
        ${stepsHtml}
        ${missingHtml}
        <table>
            <tr>
                <th>Opp ID</th>
                <th>Strategy</th>
                <th>Score</th>
                <th>State</th>
                <th>Reason</th>
                <th>LLM Summary</th>
                <th>Created At</th>
            </tr>
            ${rows}
        </table>
    `;
}

async function renderHome() {
    return `
        ${renderNav()}
        <h1>Welcome to OppRadar</h1>
        <ul>
            <li><a href="/ui/strategies" onclick="route(event)">Browse Strategies</a></li>
            <li><a href="/ui/opportunities" onclick="route(event)">Browse Opportunities</a></li>
            <li><a href="/ui/diff" onclick="route(event)">Compare Scans</a></li>
            <li><a href="/ui/replay" onclick="route(event)">Replay Scans</a></li>
        </ul>
    `;
}

async function renderDiff() {
    const scans = await fetchJSON('/scans');
    // Sort by timestamp desc
    scans.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    const options = scans.map(s => `<option value="${s.scan_id}">${s.scan_id} (${s.timestamp})</option>`).join('');

    return `
        ${renderNav()}
        <h1>Diff Scans</h1>
        <div class="controls">
            <label>From: <select id="from_scan">${options}</select></label>
            <label>To: <select id="to_scan">${options}</select></label>
            <button onclick="runDiff()">Compare</button>
        </div>
        <div id="diff-results"></div>
    `;
}

window.runDiff = async function() {
    const from = document.getElementById('from_scan').value;
    const to = document.getElementById('to_scan').value;
    const resultDiv = document.getElementById('diff-results');

    if (!from || !to) {
        resultDiv.innerHTML = '<p class="error">Please select both scans.</p>';
        return;
    }

    resultDiv.innerHTML = 'Loading...';

    try {
        const data = await fetchJSON(`/diff?from_scan=${from}&to_scan=${to}`);
        
        const addedHtml = data.added_opp_ids.length 
            ? `<ul>${data.added_opp_ids.map(id => `<li><a href="/ui/opportunities/${id}" onclick="route(event)">${id}</a></li>`).join('')}</ul>`
            : '<p>None</p>';
            
        const removedHtml = data.removed_opp_ids.length 
            ? `<ul>${data.removed_opp_ids.map(id => `<li>${id}</li>`).join('')}</ul>`
            : '<p>None</p>';
            
        const changedHtml = data.changed.length 
            ? `<ul>${data.changed.map(c => `
                <li>
                    <a href="/ui/opportunities/${c.opp_id}" onclick="route(event)">${c.opp_id}</a>
                    <br>Changes: ${JSON.stringify(c.fields)}
                </li>`).join('')}</ul>`
            : '<p>None</p>';

        resultDiv.innerHTML = `
            <div class="actions" style="margin-bottom: 1em;">
                <a href="/export/diff.json?from_scan=${from}&to_scan=${to}" target="_blank" class="button">Export JSON</a>
                <a href="/export/diff.csv?from_scan=${from}&to_scan=${to}" target="_blank" class="button">Export CSV</a>
            </div>
            <div class="diff-section">
                <h3>Added (${data.added_opp_ids.length})</h3>
                ${addedHtml}
            </div>
            <div class="diff-section">
                <h3>Removed (${data.removed_opp_ids.length})</h3>
                ${removedHtml}
            </div>
            <div class="diff-section">
                <h3>Changed (${data.changed.length})</h3>
                ${changedHtml}
            </div>
        `;
    } catch (e) {
        resultDiv.innerHTML = `<p class="error">Error: ${e.message}</p>`;
    }
}

async function renderStrategies() {
    const list = await fetchJSON('/strategies');
    const rows = list.map(s => `
        <tr>
            <td><a href="/ui/strategies/${s.strategy_id}" onclick="route(event)">${s.strategy_id}</a></td>
            <td>${s.name}</td>
            <td>${s.status}</td>
        </tr>
    `).join('');
    return `
        ${renderNav()}
        <h1>Strategies</h1>
        <table>
            <tr><th>ID</th><th>Name</th><th>Status</th></tr>
            ${rows}
        </table>
    `;
}

async function renderStrategyDetail(id) {
    const strategies = await fetchJSON('/strategies');
    const strategy = strategies.find(s => s.strategy_id === id);
    
    if (!strategy) return `${renderNav()}<h1>Strategy Not Found</h1>`;

    // Fetch related
    const snapshots = await fetchJSON('/snapshots');
    const opportunities = await fetchJSON('/opportunities');

    const relatedSnapshots = snapshots.filter(s => s.strategy_id === id);
    const relatedOpps = opportunities.filter(o => o.strategy_id === id);

    return `
        ${renderNav()}
        <h1>Strategy: ${strategy.name}</h1>
        <p><strong>ID:</strong> ${strategy.strategy_id}</p>
        <p><strong>Status:</strong> ${strategy.status}</p>
        <p><strong>Description:</strong> ${strategy.description || '-'}</p>

        <div class="detail-section">
            <h3>Related Snapshots (${relatedSnapshots.length})</h3>
            <ul>${relatedSnapshots.map(s => `<li>${s.snapshot_id} (${s.created_at})</li>`).join('')}</ul>
        </div>

        <div class="detail-section">
            <h3>Related Opportunities (${relatedOpps.length})</h3>
            <ul>${relatedOpps.map(o => `<li><a href="/ui/opportunities/${o.opp_id}" onclick="route(event)">${o.opp_id}</a> (Score: ${o.score})</li>`).join('')}</ul>
        </div>
    `;
}

async function renderOpportunities() {
    const params = new URLSearchParams(window.location.search);
    const filterState = params.get('tradeable_state');
    const filterScore = params.get('score_min');

    let list = await fetchJSON('/opportunities');

    if (filterState) {
        list = list.filter(o => o.tradeable_state === filterState);
    }
    if (filterScore) {
        list = list.filter(o => (o.score || 0) >= Number(filterScore));
    }

    const rows = list.map(o => `
        <tr>
            <td><a href="/ui/opportunities/${o.opp_id}" onclick="route(event)">${o.opp_id}</a></td>
            <td><a href="/ui/strategies/${o.strategy_id}" onclick="route(event)">${o.strategy_id}</a></td>
            <td>${o.score}</td>
            <td>${o.tradeable_state}</td>
        </tr>
    `).join('');

    return `
        ${renderNav()}
        <h1>Opportunities</h1>
        <form onsubmit="applyFilter(event)">
            <label>State: <input name="tradeable_state" value="${filterState || ''}" placeholder="e.g. YES"></label>
            <label>Min Score: <input name="score_min" type="number" value="${filterScore || ''}" placeholder="e.g. 80"></label>
            <button type="submit">Filter</button>
        </form>
        <table>
            <tr><th>ID</th><th>Strategy</th><th>Score</th><th>State</th></tr>
            ${rows}
        </table>
    `;
}

window.applyFilter = function(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const search = new URLSearchParams(fd).toString();
    history.pushState(null, '', `/ui/opportunities?${search}`);
    router();
}

async function renderOpportunityDetail(id) {
    const list = await fetchJSON('/opportunities');
    const item = list.find(o => o.opp_id === id);

    if (!item) return `${renderNav()}<h1>Opportunity Not Found</h1>`;

    return `
        ${renderNav()}
        <h1>Opportunity: ${item.opp_id}</h1>
        <p><strong>Strategy ID:</strong> <a href="/ui/strategies/${item.strategy_id}" onclick="route(event)">${item.strategy_id}</a></p>
        <p><strong>Snapshot ID:</strong> ${item.snapshot_id}</p>
        <p><strong>Score:</strong> ${item.score}</p>
        <p><strong>Baseline Score:</strong> ${item.score_baseline || 'N/A'}</p>
        <p><strong>Components:</strong> ${item.score_components ? JSON.stringify(item.score_components) : 'N/A'}</p>
        <p><strong>Created At:</strong> ${item.created_at}</p>
        <p><strong>Tradeable:</strong> ${item.tradeable_state}</p>
        <p><strong>Reason:</strong> ${item.tradeable_reason}</p>
        
        <div class="llm-section" style="background: #f0f8ff; padding: 15px; margin-top: 20px; border-left: 5px solid #007bff;">
            <h3 style="margin-top: 0;">LLM Analysis</h3>
            <p><strong>Summary:</strong> ${item.llm_summary || 'N/A'}</p>
            <p><strong>Confidence:</strong> ${item.llm_confidence !== undefined ? item.llm_confidence : 'N/A'}</p>
            <p><strong>Tags:</strong> ${(item.llm_tags || []).join(', ')}</p>
        </div>
    `;
}

async function router() {
    const app = document.getElementById('app');
    const path = window.location.pathname;
    
    app.innerHTML = 'Loading...';

    try {
        if (path === '/ui' || path === '/ui/') {
            app.innerHTML = await renderHome();
        } else if (path === '/ui/strategies') {
            app.innerHTML = await renderStrategies();
        } else if (path.startsWith('/ui/strategies/')) {
            const id = path.split('/')[3];
            app.innerHTML = await renderStrategyDetail(id);
        } else if (path === '/ui/opportunities') {
            app.innerHTML = await renderOpportunities();
        } else if (path.startsWith('/ui/opportunities/')) {
            const id = path.split('/')[3];
            app.innerHTML = await renderOpportunityDetail(id);
        } else if (path === '/ui/diff') {
            app.innerHTML = await renderDiff();
        } else if (path === '/ui/replay') {
            app.innerHTML = await renderReplayList();
        } else if (path.startsWith('/ui/replay/')) {
            const id = path.split('/')[3];
            app.innerHTML = await renderReplayDetail(id);
        } else {
            app.innerHTML = 'Not Found';
        }
    } catch (e) {
        console.error(e);
        app.innerHTML = 'Error: ' + e.message;
    }
}

window.route = function(e) {
    e.preventDefault();
    history.pushState(null, '', e.target.href);
    router();
}

window.onpopstate = router;
router();