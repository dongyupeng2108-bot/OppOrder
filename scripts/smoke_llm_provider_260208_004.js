import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TASK_ID = '260208_004';
const REPORT_DIR = path.resolve(__dirname, '../rules/task-reports/2026-02');
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

const BASE_URL = 'http://localhost:53122';

async function fetchJSON(url, options = {}) {
    try {
        const res = await fetch(url, options);
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Fetch failed: ${res.status} ${text}`);
        }
        
        // Check for JSON content type if expecting JSON
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return { data: await res.json(), headers: res.headers, status: res.status };
        } else {
             // For non-JSON responses (like UI), just return status
             return { status: res.status, headers: res.headers, text: await res.text() };
        }
    } catch (e) {
        throw e;
    }
}

async function checkOllama() {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    console.log(`[Smoke] Checking Ollama at ${ollamaUrl}...`);
    try {
        const res = await fetch(`${ollamaUrl}/api/tags`); // or /api/version
        if (res.ok) {
            console.log(`[Smoke] Ollama is REACHABLE.`);
            return true;
        }
    } catch (e) {
        console.log(`[Smoke] Ollama is NOT reachable: ${e.message}`);
    }
    return false;
}

async function runSmoke() {
    console.log(`[Smoke] Starting ${TASK_ID}...`);
    const results = { steps: [] };

    try {
        // 1. Mock Provider Test
        console.log('[Smoke] Step 1: Testing Mock Provider...');
        const mockRes = await fetchJSON(`${BASE_URL}/scans/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                n_opps: 10,
                seed: 111,
                llm_provider: 'mock'
            })
        });
        
        const mockScan = mockRes.data.scan;
        const mockOpps = mockRes.data.opportunities;
        
        // Assertions for Mock
        if (!mockScan.stage_logs.find(s => s.stage_id === 'llm_analyze')) throw new Error("Missing llm_analyze stage");
        if (mockOpps.length !== 10) throw new Error("Expected 10 opps");
        mockOpps.forEach(o => {
            if (o.llm_provider !== 'mock') throw new Error(`Expected provider 'mock', got ${o.llm_provider}`);
            if (!o.llm_summary) throw new Error(`Missing llm_summary for ${o.opp_id}`);
        });
        console.log('[Smoke] Step 1 PASS (Mock)');
        results.steps.push("Step 1: Mock PASS");

        // 2. Ollama Provider Test (Conditional)
        const isOllamaUp = await checkOllama();
        let ollamaScanId = null;

        if (isOllamaUp) {
            console.log('[Smoke] Step 2: Testing Ollama Provider...');
            const ollamaRes = await fetchJSON(`${BASE_URL}/scans/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    n_opps: 3, // Keep it small for smoke
                    seed: 222,
                    llm_provider: 'ollama'
                })
            });
            
            const ollamaScan = ollamaRes.data.scan;
            ollamaScanId = ollamaScan.scan_id;
            const ollamaOpps = ollamaRes.data.opportunities;
            
            const llmStage = ollamaScan.stage_logs.find(s => s.stage_id === 'llm_analyze');
            if (!llmStage) throw new Error("Missing llm_analyze stage in Ollama run");
            
            console.log(`[Smoke] Ollama Stats: Analyzed=${llmStage.output_summary.analyzed_count}, Fallback=${llmStage.output_summary.fallback_count}`);
            
            if (llmStage.output_summary.analyzed_count === 0) throw new Error("Ollama analyzed_count is 0");
            
            ollamaOpps.forEach(o => {
                if (o.llm_provider !== 'ollama') throw new Error(`Expected provider 'ollama', got ${o.llm_provider}`);
                if (o.llm_latency_ms === undefined) throw new Error(`Missing latency for ${o.opp_id}`);
            });
            console.log('[Smoke] Step 2 PASS (Ollama)');
            results.steps.push("Step 2: Ollama PASS");
        } else {
            console.log('[Smoke] Step 2 SKIPPED (Ollama unreachable)');
            results.steps.push("Step 2: Ollama SKIPPED");
        }

        // 3. Export Test
        console.log('[Smoke] Step 3: Testing Export...');
        const targetScanId = ollamaScanId || mockScan.scan_id;
        const exportRes = await fetchJSON(`${BASE_URL}/export/llm_analyze.json?scan=${targetScanId}`);
        
        fs.writeFileSync(path.join(REPORT_DIR, `${TASK_ID}_export_llm_analyze.json`), JSON.stringify(exportRes.data, null, 2));
        
        // Save headers
        const headersStr = Array.from(exportRes.headers.entries()).map(([k,v]) => `${k}: ${v}`).join('\n');
        fs.writeFileSync(path.join(REPORT_DIR, `${TASK_ID}_export_headers.txt`), headersStr);
        
        console.log('[Smoke] Step 3 PASS (Export)');
        results.steps.push("Step 3: Export PASS");

        // 4. UI Check
        console.log('[Smoke] Step 4: Testing UI Replay...');
        const uiRes = await fetchJSON(`${BASE_URL}/ui/replay`);
        fs.writeFileSync(path.join(REPORT_DIR, `${TASK_ID}_ui_replay_status.txt`), `Status: ${uiRes.status}\n`);
        
        if (uiRes.status !== 200) throw new Error(`UI Replay returned ${uiRes.status}`);
        console.log('[Smoke] Step 4 PASS (UI)');
        results.steps.push("Step 4: UI PASS");

        console.log('[Smoke] ALL STEPS PASSED');
        fs.writeFileSync(path.join(REPORT_DIR, `${TASK_ID}_smoke_result.txt`), JSON.stringify(results, null, 2));

    } catch (e) {
        console.error('[Smoke] FAILED:', e.message);
        fs.writeFileSync(path.join(REPORT_DIR, `${TASK_ID}_smoke_error.txt`), e.message);
        process.exit(1);
    }
}

runSmoke();
