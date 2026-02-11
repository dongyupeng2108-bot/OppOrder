import http from 'http';
import fs from 'fs';
import path from 'path';

const TASK_ID = '260211_005';
const PORT = 53122;

const runId = 'mock_run_' + Date.now();
const postData = JSON.stringify({
    run_id: runId,
    provider: 'mock',
    limit: 5,
    model: 'mock-gpt-4'
});

const options = {
    hostname: 'localhost',
    port: PORT,
    path: '/opportunities/llm_route',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    }
};

console.log(`[Smoke] Sending POST to ${options.path}...`);

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log(`[Smoke] Response Status: ${res.statusCode}`);
        console.log(`[Smoke] Response Body: ${data}`);

        if (res.statusCode !== 200) {
            console.error('[Smoke] Failed: Status not 200');
            process.exit(1);
        }

        let json;
        try {
            json = JSON.parse(data);
        } catch (e) {
            console.error('[Smoke] Failed: Invalid JSON response');
            process.exit(1);
        }

        if (json.status !== 'ok') {
            console.error(`[Smoke] Failed: status=${json.status}`);
            process.exit(1);
        }

        // Generate Evidence File
        const evidenceDir = path.join('rules', 'task-reports', '2026-02');
        if (!fs.existsSync(evidenceDir)) {
            fs.mkdirSync(evidenceDir, { recursive: true });
        }
        const evidenceFile = path.join(evidenceDir, `M5_PR1_llm_json_${TASK_ID}.txt`);
        
        const summaryLine = `DOD_EVIDENCE_M5_PR1_LLM_JSON: ${evidenceFile.replace(/\\/g, '/')} => status=${json.status} items=${json.items ? json.items.length : 0} provider=${json.provider_used} model=${json.model_used}`;
        
        const fileContent = JSON.stringify(json, null, 2) + '\n' + summaryLine;
        
        fs.writeFileSync(evidenceFile, fileContent);
        console.log(`[Smoke] Evidence written to ${evidenceFile}`);
    });
});

req.on('error', (e) => {
    console.error(`[Smoke] Request error: ${e.message}`);
    process.exit(1);
});

req.write(postData);
req.end();
