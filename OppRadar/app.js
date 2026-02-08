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
    const params = new URLSearchParams(window.location.search);
    const prefillTopic = params.get('topic');
    
    const scans = await fetchJSON('/scans');
    // Sort by timestamp desc
    scans.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    const options = scans.map(s => `<option value="${s.scan_id}">${s.scan_id} (${s.timestamp})</option>`).join('');

    // If prefillTopic exists, we should auto-trigger loadTimeline after render
    // We can do this by setting a global flag or simple timeout
    if (prefillTopic) {
        setTimeout(() => {
            const input = document.getElementById('tl_topic_key');
            if (input) {
                input.value = prefillTopic;
                window.loadTimeline();
                // Scroll to timeline panel
                document.querySelector('.timeline-panel').scrollIntoView();
            }
        }, 500);
    }

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
            <div style="margin-bottom: 10px;">
                <label>Topic Key: <input type="text" id="run_topic_key" value="default_topic"></label>
            </div>
            <div style="margin-bottom: 10px;">
                <label>Dedup Window (s): <input type="number" id="run_dedup_window" value="0"></label>
            </div>
            <div style="margin-bottom: 10px;">
                <label>Cache TTL (s): <input type="number" id="run_cache_ttl" value="900"></label>
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
                <p><strong>Dedup Skipped:</strong> <span id="m_dedup_skipped"></span></p>
                <p><strong>Cache:</strong> Hit <span id="m_cache_hit"></span> / Miss <span id="m_cache_miss"></span></p>
                <p><strong>Stages:</strong> <span id="m_stages"></span></p>
            </div>
        </div>

        <div class="batch-run-panel" style="border: 1px solid #ccc; padding: 15px; margin-bottom: 20px; background: #eef;">
            <h3>Batch Run</h3>
            <div style="margin-bottom: 10px;">
                <label style="display:block; margin-bottom:5px;">Topics (one per line):</label>
                <textarea id="batch_topics" rows="5" style="width: 100%; box-sizing: border-box;">topic_A
topic_B
topic_C</textarea>
            </div>
            <div style="margin-bottom: 10px;">
                <label>Concurrency (1-16): <input type="number" id="batch_concurrency" value="4" min="1" max="16"></label>
            </div>
            <div style="margin-bottom: 10px;">
                <label><input type="checkbox" id="batch_persist" checked> Persist to Disk</label>
            </div>
            <div style="margin-bottom: 10px;">
                <label>N Opps (Optional): <input type="number" id="batch_n_opps" placeholder="default"></label>
            </div>
            <div style="margin-bottom: 10px;">
                <label>Seed (Optional): <input type="number" id="batch_seed" placeholder="default"></label>
            </div>
            <button onclick="runBatchScan()" style="padding: 5px 15px; background: #28a745; color: white; border: none; cursor: pointer;">Run Batch</button>
            <div id="batch_status" style="margin-top: 10px; color: blue;"></div>
            
            <div id="batch_results" style="display: none; margin-top: 15px; border-top: 1px dashed #aaa; padding-top: 10px;">
                <h4>Batch Results</h4>
                <div style="margin-bottom: 10px;">
                    <a id="batch_export_link" href="#" target="_blank" class="button">Export Batch JSON</a>
                </div>
                <div id="batch_summary"></div>
                <table id="batch_table" style="width:100%; border-collapse: collapse; margin-top: 10px;">
                    <thead>
                        <tr style="background: #ddd;">
                            <th style="border: 1px solid #ccc; padding: 5px;">Topic</th>
                            <th style="border: 1px solid #ccc; padding: 5px;">Status</th>
                            <th style="border: 1px solid #ccc; padding: 5px;">Scan ID</th>
                            <th style="border: 1px solid #ccc; padding: 5px;">Dur (ms)</th>
                            <th style="border: 1px solid #ccc; padding: 5px;">Info</th>
                        </tr>
                    </thead>
                    <tbody id="batch_table_body"></tbody>
                </table>
            </div>
        </div>

        <div class="batch-view-panel" style="border: 1px solid #ccc; padding: 15px; margin-bottom: 20px; background: #eef;">
            <h3>Batch View (Replay)</h3>
            <div style="margin-bottom: 10px;">
                <label>Batch ID: <input type="text" id="view_batch_id" placeholder="batch_..."></label>
                <button onclick="loadBatchView()" style="padding: 5px 15px; background: #17a2b8; color: white; border: none; cursor: pointer;">Load Batch</button>
            </div>
            <div id="view_batch_status" style="margin-top: 10px; color: blue;"></div>
            
            <div id="view_batch_results" style="display: none; margin-top: 15px; border-top: 1px dashed #aaa; padding-top: 10px;">
                <h4>Batch Summary</h4>
                <div style="margin-bottom: 10px;">
                    <a id="view_batch_export_json" href="#" target="_blank" class="button" style="margin-right: 10px;">Export JSON</a>
                    <a id="view_batch_export_jsonl" href="#" target="_blank" class="button">Export Dataset (JSONL)</a>
                </div>
                <div id="view_batch_summary_text"></div>
                <table id="view_batch_table" style="width:100%; border-collapse: collapse; margin-top: 10px;">
                    <thead>
                        <tr style="background: #ddd;">
                            <th style="border: 1px solid #ccc; padding: 5px;">Topic</th>
                            <th style="border: 1px solid #ccc; padding: 5px;">Status</th>
                            <th style="border: 1px solid #ccc; padding: 5px;">Scan ID</th>
                            <th style="border: 1px solid #ccc; padding: 5px;">Opps</th>
                            <th style="border: 1px solid #ccc; padding: 5px;">Dur (ms)</th>
                            <th style="border: 1px solid #ccc; padding: 5px;">Info</th>
                        </tr>
                    </thead>
                    <tbody id="view_batch_table_body"></tbody>
                </table>
            </div>
        </div>

        <div class="timeline-panel" style="border: 1px solid #ccc; padding: 15px; margin-bottom: 20px; background: #fff8f0;">
            <h3>Timeline (DB)</h3>
            <div style="margin-bottom: 10px;">
                <label>Topic Key: <input type="text" id="tl_topic_key" placeholder="e.g. topic_A"></label>
                <button onclick="loadTimeline()" style="padding: 5px 15px; background: #ffc107; color: black; border: none; cursor: pointer;">Load Timeline</button>
                <button onclick="pullNews()" style="padding: 5px 15px; background: #0dcaf0; color: white; border: none; cursor: pointer; margin-left: 10px;">Pull News</button>
            </div>
            <div id="tl_status" style="margin-top: 5px; color: blue;"></div>
            
            <div id="tl_results" style="display: none; margin-top: 15px;">
                <div style="margin-bottom: 10px;">
                    <a id="tl_export_link" href="#" target="_blank" class="button">Export Timeline JSONL</a>
                </div>
                <table style="width:100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #ddd;">
                            <th style="border: 1px solid #ccc; padding: 5px;">Time</th>
                            <th style="border: 1px solid #ccc; padding: 5px;">Type</th>
                            <th style="border: 1px solid #ccc; padding: 5px;">Details</th>
                        </tr>
                    </thead>
                    <tbody id="tl_table_body"></tbody>
                </table>
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
        const topic_key = document.getElementById('run_topic_key').value;
        const dedup_window_sec = document.getElementById('run_dedup_window').value;
        const cache_ttl_sec = document.getElementById('run_cache_ttl').value;

        const res = await fetch('/scans/run', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ seed, n_opps, mode, persist, topic_key, dedup_window_sec, cache_ttl_sec })
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Run scan failed');
        }
        
        const data = await res.json();
        const scan = data.scan || data; // Handle if skipped scan is returned directly
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
        document.getElementById('m_dedup_skipped').textContent = m.dedup_skipped_count || 0;
        document.getElementById('m_cache_hit').textContent = m.cache_hit_count || 0;
        document.getElementById('m_cache_miss').textContent = m.cache_miss_count || 0;
        
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

window.runBatchScan = async function() {
    const statusEl = document.getElementById('batch_status');
    const resultsPanel = document.getElementById('batch_results');
    const tableBody = document.getElementById('batch_table_body');
    const summaryDiv = document.getElementById('batch_summary');
    const exportLink = document.getElementById('batch_export_link');

    try {
        statusEl.textContent = 'Running Batch...';
        resultsPanel.style.display = 'none';
        tableBody.innerHTML = '';
        
        const topicsStr = document.getElementById('batch_topics').value;
        const topics = topicsStr.split('\n').map(t => t.trim()).filter(t => t);
        
        const concurrency = document.getElementById('batch_concurrency').value;
        const persist = document.getElementById('batch_persist').checked;
        
        // Optional params
        const n_opps_val = document.getElementById('batch_n_opps').value;
        const seed_val = document.getElementById('batch_seed').value;
        
        const payload = {
            topics: topics,
            concurrency: concurrency ? parseInt(concurrency) : 4,
            persist: persist
        };
        
        if (n_opps_val) payload.n_opps = parseInt(n_opps_val);
        if (seed_val) payload.seed = parseInt(seed_val);

        const res = await fetch('/scans/batch_run', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Batch run failed');
        }
        
        const data = await res.json();
        const results = data.results || [];
        const summary = data.summary_metrics || {};

        // Update Export Link
        exportLink.href = `/export/batch_run.json?batch_id=${data.batch_id}`;
        
        // Update Summary
        summaryDiv.innerHTML = `
            <p><strong>Batch ID:</strong> ${data.batch_id}</p>
            <p><strong>Total Duration:</strong> ${summary.total_duration_ms} ms</p>
            <p><strong>Success:</strong> <span style="color:green">${summary.success_count}</span> | 
               <strong>Failed:</strong> <span style="color:red">${summary.fail_count}</span> | 
               <strong>Skipped:</strong> <span style="color:orange">${summary.skipped_count}</span></p>
        `;

        // Update Table
        results.forEach(r => {
            const row = document.createElement('tr');
            const isError = r.topic_status === 'FAILED';
            const isSkipped = r.topic_status === 'SKIPPED';
            const statusColor = isError ? 'red' : (isSkipped ? 'orange' : 'green');
            
            row.innerHTML = `
                <td style="border: 1px solid #ccc; padding: 5px;">${r.topic_key}</td>
                <td style="border: 1px solid #ccc; padding: 5px; color: ${statusColor}; font-weight: bold;">${r.topic_status}</td>
                <td style="border: 1px solid #ccc; padding: 5px;">${r.scan_id || '-'}</td>
                <td style="border: 1px solid #ccc; padding: 5px;">${r.duration_ms}</td>
                <td style="border: 1px solid #ccc; padding: 5px; font-size: 0.9em;">
                    ${r.error ? `<span style="color:red">${r.error}</span>` : ''}
                    ${r.metrics ? `Dedup Skip: ${r.metrics.dedup_skipped_count || 0}` : ''}
                </td>
            `;
            tableBody.appendChild(row);
        });

        resultsPanel.style.display = 'block';
        statusEl.textContent = 'Batch Run Completed.';

    } catch (e) {
        statusEl.textContent = 'Error: ' + e.message;
        alert('Error running batch: ' + e.message);
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
            <td>${o.score}</td>
            <td>${o.tradeable_state}</td>
            <td>${o.risk_level}</td>
            <td>${JSON.stringify(o.market_data || {})}</td>
        </tr>
    `).join('');

    const monitorHtml = `
        <div class="monitor-panel" style="border: 1px solid #ccc; padding: 15px; margin-bottom: 20px; background: #eef;">
            <h3>Monitor Simulation</h3>
            <div style="margin-bottom: 10px;">
                <button onclick="runMonitorTick('${scan.scan_id}')" style="padding: 5px 10px; background: #17a2b8; color: white; border: none; cursor: pointer;">Run Tick</button>
                <button onclick="planReeval()" style="padding: 5px 10px; background: #6610f2; color: white; border: none; cursor: pointer;">Plan Reeval</button>
                <button onclick="runReeval()" style="padding: 5px 10px; background: #d63384; color: white; border: none; cursor: pointer;">Run Reeval</button>
            </div>
            <div id="monitor_status" style="margin-top: 5px; color: blue;"></div>
            
            <div style="display: flex; gap: 20px; margin-top: 15px;">
                <div style="flex: 1; border: 1px solid #ddd; padding: 10px;">
                    <h4>Top Moves (>0.01)</h4>
                    <ul id="list_top_moves" style="font-size: 0.9em; padding-left: 20px;"><li>-</li></ul>
                </div>
                <div style="flex: 1; border: 1px solid #ddd; padding: 10px;">
                    <h4>Reeval Jobs (Plan)</h4>
                    <ul id="list_reeval_jobs" style="font-size: 0.9em; padding-left: 20px;"><li>-</li></ul>
                </div>
                <div style="flex: 1; border: 1px solid #ddd; padding: 10px;">
                    <h4>Reeval Results</h4>
                    <ul id="list_reeval_results" style="font-size: 0.9em; padding-left: 20px;"><li>-</li></ul>
                </div>
            </div>
        </div>
    `;

    const stageLogs = scan.stage_logs || {};
    const stageLogsHtml = Object.keys(stageLogs).length > 0 
        ? `<div style="margin-top: 20px; border: 1px dashed #aaa; padding: 10px;">
             <h4>Stage Logs</h4>
             ${Object.entries(stageLogs).map(([k, v]) => `
                <details>
                    <summary>${k} (${Array.isArray(v) ? v.length : 'obj'})</summary>
                    <pre style="font-size:0.8em; background:#eee; padding:5px;">${JSON.stringify(v, null, 2)}</pre>
                </details>
             `).join('')}
           </div>`
        : '';

    const missingHtml = missing_opp_ids && missing_opp_ids.length > 0 
        ? `<div style="color: red; margin-bottom: 10px;">Missing Opps in DB: ${missing_opp_ids.join(', ')}</div>` 
        : '';

    return `
        ${renderNav()}
        <h1>Replay Scan: ${scan.scan_id}</h1>
        <p><strong>Topic:</strong> ${scan.topic_key || 'N/A'}</p>
        <p><strong>Timestamp:</strong> ${scan.timestamp}</p>
        <p><strong>Duration:</strong> ${scan.duration_ms} ms</p>
        <p><strong>Metrics:</strong> ${JSON.stringify(scan.metrics || {})}</p>
        
        ${monitorHtml}
        ${stageLogsHtml}
        ${missingHtml}
        
        <table>
            <tr><th>Opp ID</th><th>Score</th><th>State</th><th>Risk</th><th>Market Data</th></tr>
            ${rows}
        </table>
    `;
}

async function renderDiff() {
    return `
        ${renderNav()}
        <h1>Diff Scans</h1>
        <form onsubmit="event.preventDefault(); diffScans();">
            <label>From Scan ID: <input type="text" id="diff_from" required></label>
            <label>To Scan ID: <input type="text" id="diff_to" required></label>
            <button type="submit">Compare</button>
        </form>
        <div id="diff_result"></div>
    `;
}

async function diffScans() {
    const from = document.getElementById('diff_from').value;
    const to = document.getElementById('diff_to').value;
    const resultDiv = document.getElementById('diff_result');
    
    try {
        resultDiv.innerHTML = 'Loading...';
        const data = await fetchJSON(`/diff?from_scan=${from}&to_scan=${to}`);
        
        const addedHtml = data.added_opp_ids.length 
            ? `<ul>${data.added_opp_ids.map(id => `<li><a href="/ui/opportunities/${id}" onclick="route(event)">${id}</a></li>`).join('')}</ul>`
            : '<p>None</p>';
            
        const removedHtml = data.removed_opp_ids.length 
            ? `<ul>${data.removed_opp_ids.map(id => `<li><a href="/ui/opportunities/${id}" onclick="route(event)">${id}</a></li>`).join('')}</ul>`
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
    const limit = params.get('limit') || '20';

    let list = [];
    let error = null;
    try {
        list = await fetchJSON(`/opportunities/top?limit=${limit}`);
    } catch (e) {
        error = e.message;
    }

    const rows = list.map(o => {
        const bd = o.score_breakdown || {};
        const scoreTitle = Object.entries(bd).map(([k,v]) => `${k}: ${v.toFixed(2)}`).join('\n');
        
        return `
        <tr>
            <td><a href="/ui/replay?topic=${encodeURIComponent(o.topic_key)}" onclick="route(event)">${o.topic_key}</a></td>
            <td title="${scoreTitle}">${o.score}</td>
            <td>${o.delta_1h !== undefined ? o.delta_1h.toFixed(4) : '-'}</td>
            <td>${o.news_count_6h !== undefined ? o.news_count_6h : '-'}</td>
            <td>${o.llm_confidence !== undefined ? o.llm_confidence : '-'}</td>
            <td>${o.staleness_sec !== undefined ? o.staleness_sec + 's' : '-'}</td>
        </tr>
    `}).join('');

    return `
        ${renderNav()}
        <h1>Top Opportunities</h1>
        
        <div style="margin-bottom: 20px; padding: 15px; border: 1px solid #ccc; background: #f8f9fa;">
            <h3>Build Opportunities</h3>
            <label>Max Topics: 
                <select id="build_limit">
                    <option value="20">20</option>
                    <option value="50" selected>50</option>
                </select>
            </label>
            <button onclick="buildOpportunities()" style="margin-left: 10px; padding: 5px 15px; background: #28a745; color: white; border: none; cursor: pointer;">Build Now</button>
            <div id="build_status" style="margin-top: 10px; color: blue;"></div>
        </div>

        <div style="margin-bottom: 20px;">
            <label>Show Top: 
                <select onchange="changeOppLimit(this.value)">
                    <option value="10" ${limit === '10' ? 'selected' : ''}>10</option>
                    <option value="20" ${limit === '20' ? 'selected' : ''}>20</option>
                    <option value="50" ${limit === '50' ? 'selected' : ''}>50</option>
                </select>
            </label>
            <a href="/opportunities/export" target="_blank" class="button" style="margin-left: 10px;">Export JSONL</a>
        </div>

        ${error ? `<p style="color:red">Error: ${error}</p>` : ''}

        <table style="width:100%; border-collapse: collapse;">
            <thead>
                <tr style="background: #ddd;">
                    <th style="border: 1px solid #ccc; padding: 5px;">Topic (Timeline)</th>
                    <th style="border: 1px solid #ccc; padding: 5px;">Score</th>
                    <th style="border: 1px solid #ccc; padding: 5px;">Delta 1h</th>
                    <th style="border: 1px solid #ccc; padding: 5px;">News 6h</th>
                    <th style="border: 1px solid #ccc; padding: 5px;">LLM Conf</th>
                    <th style="border: 1px solid #ccc; padding: 5px;">Staleness</th>
                </tr>
            </thead>
            <tbody>
                ${rows.length > 0 ? rows : '<tr><td colspan="6" style="text-align:center; padding: 20px;">No opportunities found. Try building some!</td></tr>'}
            </tbody>
        </table>
    `;
}

window.changeOppLimit = function(limit) {
    history.pushState(null, '', `/ui/opportunities?limit=${limit}`);
    router();
}

window.buildOpportunities = async function() {
    const status = document.getElementById('build_status');
    const limit = document.getElementById('build_limit').value;
    
    status.textContent = 'Building...';
    try {
        const res = await fetch('/opportunities/build', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ limit_topics: parseInt(limit) })
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Build failed');
        }

        const data = await res.json();
        status.textContent = `Success! Built: ${data.built_count} / ${data.topic_count} topics. Run ID: ${data.build_run_id}`;
        
        // Refresh list
        setTimeout(() => router(), 1000);
    } catch (e) {
        status.textContent = 'Error: ' + e.message;
    }
}

async function renderOppDetail(id) {
    let opp;
    try {
        opp = await fetchJSON(`/opportunities/${id}`);
    } catch (e) {
        return `${renderNav()}<h1>Opp Not Found</h1>`;
    }

    return `
        ${renderNav()}
        <h1>Opportunity: ${opp.opp_id}</h1>
        <p><strong>Strategy:</strong> ${opp.strategy_id}</p>
        <p><strong>State:</strong> ${opp.tradeable_state}</p>
        <p><strong>Score:</strong> ${opp.score}</p>
        <p><strong>Risk:</strong> ${opp.risk_level}</p>
        
        <h3>Market Data</h3>
        <pre>${JSON.stringify(opp.market_data, null, 2)}</pre>
        
        <h3>Full JSON</h3>
        <pre>${JSON.stringify(opp, null, 2)}</pre>
    `;
}

// Router
async function route(event) {
    if (event) {
        event.preventDefault();
        history.pushState(null, '', event.target.href);
    }
    await router();
}

async function router() {
    const path = window.location.pathname;
    const app = document.getElementById('app');
    
    if (path === '/ui' || path === '/ui/') {
        app.innerHTML = `
            ${renderNav()}
            <h1>OppRadar Dashboard</h1>
            <p>Welcome to OppRadar UI.</p>
        `;
    } else if (path === '/ui/strategies') {
        app.innerHTML = await renderStrategies();
    } else if (path.startsWith('/ui/strategies/')) {
        const id = path.split('/').pop();
        app.innerHTML = await renderStrategyDetail(id);
    } else if (path === '/ui/opportunities') {
        app.innerHTML = await renderOpportunities();
    } else if (path.startsWith('/ui/opportunities/')) {
        const id = path.split('/').pop();
        app.innerHTML = await renderOppDetail(id);
    } else if (path === '/ui/diff') {
        app.innerHTML = await renderDiff();
    } else if (path === '/ui/replay') {
        app.innerHTML = await renderReplayList();
    } else if (path.startsWith('/ui/replay/')) {
        const id = path.split('/').pop();
        app.innerHTML = await renderReplayDetail(id);
    } else {
        app.innerHTML = `${renderNav()}<h1>404 Not Found</h1>`;
    }
}

window.onpopstate = router;
router();

// Monitor Functions
window.runMonitorTick = async function(scanId) {
    const status = document.getElementById('monitor_status');
    status.textContent = 'Running Monitor Tick...';
    try {
        const res = await fetch('/monitor/tick', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ universe: 'scan:' + scanId, simulate_price_move: true })
        });
        const data = await res.json();
        status.textContent = `Tick Done. Updated: ${data.updated_count}, Changed: ${data.changed_count}`;
        
        const list = document.getElementById('list_top_moves');
        if (data.top_moves && data.top_moves.length > 0) {
            list.innerHTML = data.top_moves.map(m => `<li>${m.opp_id}: ${m.delta > 0 ? '+' : ''}${m.delta} -> ${m.new_prob}</li>`).join('');
        } else {
            list.innerHTML = '<li>No moves > 0.01</li>';
        }
    } catch (e) {
        status.textContent = 'Error: ' + e.message;
    }
}

window.planReeval = async function() {
    const status = document.getElementById('monitor_status');
    status.textContent = 'Planning Reeval...';
    try {
        const res = await fetch('/reeval/plan', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ abs_threshold: 5, rel_threshold: 0.1, max_jobs: 5 }) // Low thresholds for demo
        });
        const data = await res.json();
        status.textContent = `Plan Done. Jobs: ${data.jobs.length}`;
        
        const list = document.getElementById('list_reeval_jobs');
        if (data.jobs && data.jobs.length > 0) {
            window._pendingJobs = data.jobs; // Store for runReeval
            list.innerHTML = data.jobs.map(j => `<li>${j.option_id}: ${j.reason} (${j.from_prob} -> ${j.to_prob})</li>`).join('');
        } else {
            window._pendingJobs = [];
            list.innerHTML = '<li>No jobs triggered</li>';
        }
    } catch (e) {
        status.textContent = 'Error: ' + e.message;
    }
}

window.runReeval = async function() {
    const status = document.getElementById('monitor_status');
    if (!window._pendingJobs || window._pendingJobs.length === 0) {
        status.textContent = 'No pending jobs. Run Plan first.';
        return;
    }
    
    status.textContent = 'Running Reeval...';
    try {
        const res = await fetch('/reeval/run', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ jobs: window._pendingJobs, provider: 'mock' })
        });
        const data = await res.json();
        status.textContent = `Reeval Done. Processed: ${data.reevaluated_count}`;
        
        const list = document.getElementById('list_reeval_results');
        if (data.results && data.results.length > 0) {
            list.innerHTML = data.results.map(r => `<li>${r.option_id}: ${r.new_baseline}</li>`).join('');
        } else {
            list.innerHTML = '<li>No results</li>';
        }
    } catch (e) {
        status.textContent = 'Error: ' + e.message;
    }
}

window.pullNews = async function() {
    const topicKey = document.getElementById('tl_topic_key').value;
    if (!topicKey) {
        alert('Please enter a topic key');
        return;
    }
    
    const statusEl = document.getElementById('tl_status');
    try {
        statusEl.textContent = 'Pulling news...';
        const res = await fetch('/news/pull', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic_key: topicKey, limit: 5 })
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Pull failed');
        }
        
        const data = await res.json();
        statusEl.textContent = `News Pulled: Fetched ${data.fetched_count}, Written ${data.written_count}, Deduped ${data.deduped_count || 0}`;
        
        // Auto reload timeline
        await loadTimeline();
        
    } catch (e) {
        statusEl.textContent = 'Error: ' + e.message;
    }
}

window.loadTimeline = async function() {
    const topicKey = document.getElementById('tl_topic_key').value;
    if (!topicKey) {
        alert('Please enter a topic key');
        return;
    }
    
    const statusEl = document.getElementById('tl_status');
    const resultsPanel = document.getElementById('tl_results');
    const tbody = document.getElementById('tl_table_body');
    const exportLink = document.getElementById('tl_export_link');

    try {
        statusEl.textContent = 'Loading...';
        resultsPanel.style.display = 'none';
        tbody.innerHTML = '';
        
        const res = await fetch(`/timeline/topic?topic_key=${encodeURIComponent(topicKey)}&limit=50`);
        if (!res.ok) throw new Error('Failed to load timeline');
        
        const rows = await res.json();
        
        // Update export link
        exportLink.href = `/export/timeline.jsonl?topic_key=${encodeURIComponent(topicKey)}`;
        
        rows.forEach(r => {
            const tr = document.createElement('tr');
            let type = 'Unknown';
            let details = '';
            const ts = new Date(r.ts).toISOString();
            
            if (r.type === 'snapshot' || r.prob !== undefined) {
                type = 'Snapshot';
                details = `Prob: ${r.val1 !== undefined ? r.val1.toFixed(4) : r.prob}, Price: ${r.val2 || r.market_price}`;
            } else if (r.type === 'llm' || r.provider !== undefined) {
                type = 'LLM';
                details = `Model: ${r.info || r.model}, Latency: ${r.val1 || r.latency_ms}ms`;
                if (r.news_refs) {
                    try {
                        const refs = JSON.parse(r.news_refs);
                        if (refs.length > 0) details += `<br><span style="color: #666; font-size: 0.9em;">News Refs: ${refs.length}</span>`;
                    } catch (e) {}
                }
            } else if (r.type === 'reeval' || r.trigger_json !== undefined) {
                type = 'Reeval';
                const trigger = JSON.parse(r.raw_json || r.trigger_json || '{}');
                details = `Trigger: ${trigger.reason || r.info || 'Manual'}`;
                if (r.news_refs) {
                    try {
                        const refs = JSON.parse(r.news_refs);
                        if (refs.length > 0) details += `<br><span style="color: #666; font-size: 0.9em;">News Refs: ${refs.length}</span>`;
                    } catch (e) {}
                }
            } else if (r.type === 'news') {
                type = 'News';
                const raw = r.raw_json ? JSON.parse(r.raw_json) : {};
                details = `Source: ${r.info}, Cred: ${r.val1}<br><small><a href="${raw.url || '#'}" target="_blank">${raw.title || 'No Title'}</a></small>`;
            }
            
            tr.innerHTML = `
                <td style="border: 1px solid #ccc; padding: 5px;">${ts}</td>
                <td style="border: 1px solid #ccc; padding: 5px;">${type}</td>
                <td style="border: 1px solid #ccc; padding: 5px;">${details}</td>
            `;
            tbody.appendChild(tr);
        });
        
        resultsPanel.style.display = 'block';
        statusEl.textContent = `Loaded ${rows.length} events.`;
        
    } catch (e) {
        statusEl.textContent = 'Error: ' + e.message;
    }
}

window.loadBatchView = async function() {
    const batchId = document.getElementById('view_batch_id').value.trim();
    const statusEl = document.getElementById('view_batch_status');
    const resultsPanel = document.getElementById('view_batch_results');
    const tableBody = document.getElementById('view_batch_table_body');
    const summaryDiv = document.getElementById('view_batch_summary_text');
    const exportJsonLink = document.getElementById('view_batch_export_json');
    const exportJsonlLink = document.getElementById('view_batch_export_jsonl');

    if (!batchId) {
        statusEl.textContent = 'Please enter a Batch ID';
        return;
    }

    try {
        statusEl.textContent = 'Loading...';
        resultsPanel.style.display = 'none';

        const res = await fetch(`/export/batch_run.json?batch_id=${batchId}`);
        
        if (!res.ok) {
            throw new Error('Batch not found or error loading');
        }
        
        const batch = await res.json();
        
        // Update UI
        exportJsonLink.href = `/export/batch_run.json?batch_id=${batchId}`;
        exportJsonlLink.href = `/export/batch_dataset.jsonl?batch_id=${batchId}`;
        
        const sm = batch.summary_metrics || {};
        summaryDiv.innerHTML = `
            <p><strong>Started:</strong> ${batch.started_at}</p>
            <p><strong>Total Topics:</strong> ${sm.total_topics} (OK: ${sm.success_count}, Fail: ${sm.failed_count}, Skip: ${sm.skipped_count})</p>
            <p><strong>Total Duration:</strong> ${sm.total_duration_ms} ms</p>
        `;
        
        tableBody.innerHTML = '';
        (batch.results || []).forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="border: 1px solid #ccc; padding: 5px;">${r.topic_key}</td>
                <td style="border: 1px solid #ccc; padding: 5px; color: ${r.topic_status === 'OK' ? 'green' : 'red'}">${r.topic_status}</td>
                <td style="border: 1px solid #ccc; padding: 5px;">${r.scan_id || '-'}</td>
                <td style="border: 1px solid #ccc; padding: 5px;">${r.opps_count !== undefined ? r.opps_count : '-'}</td>
                <td style="border: 1px solid #ccc; padding: 5px;">${r.duration_ms}</td>
                <td style="border: 1px solid #ccc; padding: 5px;">${r.error || (r.metrics ? 'Dedup:' + r.metrics.dedup_skipped_count : '')}</td>
            `;
            tableBody.appendChild(tr);
        });
        
        resultsPanel.style.display = 'block';
        statusEl.textContent = 'Loaded.';
        
    } catch (e) {
        statusEl.textContent = 'Error: ' + e.message;
    }
}