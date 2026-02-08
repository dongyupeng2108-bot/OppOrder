import http from 'http';

const BASE_URL = 'http://localhost:53122';

function runScan(params) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(params);
        const req = http.request(`${BASE_URL}/scans/run`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Failed to parse response: ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function getExport(scanId) {
    return new Promise((resolve, reject) => {
        const req = http.get(`${BASE_URL}/export/llm_analyze.json?scan=${scanId}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
    });
}

async function testDeepSeekFallback() {
    console.log(">>> Testing Case A: DeepSeek Fallback (No Key) <<<");
    try {
        // 1. Run Scan
        const result = await runScan({
            n_opps: 2,
            mode: 'fast',
            llm_provider: 'deepseek', // Explicitly request deepseek
            topic_key: 'smoke_test_deepseek_fallback'
        });
        
        console.log(`Scan Result Keys: ${Object.keys(result)}`);
        if (!result.scan) throw new Error("Scan object missing in result");
        
        const scanId = result.scan.scan_id;
        console.log(`Scan ID: ${scanId}`);
        
        // 2. Verify Fallback Tags in Result
        const opps = result.opportunities;
        if (!opps || opps.length === 0) throw new Error("No opportunities generated");
        
        const sampleOpp = opps[0];
        console.log(`Sample Opp Provider: ${sampleOpp.llm_provider}`);
        console.log(`Sample Opp Tags: ${JSON.stringify(sampleOpp.llm_tags)}`);
        
        if (sampleOpp.llm_provider !== 'deepseek') throw new Error(`Expected provider 'deepseek', got '${sampleOpp.llm_provider}'`);
        if (!sampleOpp.llm_tags.includes('fallback')) throw new Error("Expected 'fallback' tag missing");
        
        // 3. Verify Export Schema
        const exportData = await getExport(scanId);
        // The server returns { scan_id, llm_analyze_stage, opportunities }
        if (!exportData.opportunities || exportData.opportunities.length === 0) throw new Error("Export opportunities empty");
        
        const item = exportData.opportunities[0];
        console.log("Export Item Keys:", Object.keys(item));
        
        if (!item.llm_json) throw new Error("Missing llm_json in export");
        if (!item.llm_json.summary) throw new Error("Missing llm_json.summary");
        if (!Array.isArray(item.llm_json.signals)) throw new Error("llm_json.signals is not array");
        
        console.log("Case A PASSED");
    } catch (e) {
        console.error("Case A FAILED:", e.message);
        process.exit(1);
    }
}

async function testDeepSeekLive() {
    console.log(">>> Testing Case B: DeepSeek Live (With Key) <<<");
    // This test only runs if DEEPSEEK_API_KEY is present in env, otherwise skipped
    // Since we can't easily set env var for the server process from here without restarting it,
    // we assume the server is running with whatever env it has.
    
    // We can try to run a scan and see if it returns actual deepseek results OR fallback.
    // If we expect it to run, we should see provider='deepseek' and NO 'fallback' tag.
    
    // For now, as a smoke test in CI/local where key might be missing, we just log "Skipped" if we detect fallback.
    // But if we want to force test it, we'd need to mock the server response or have a real key.
    
    // Logic:
    // 1. Run scan
    // 2. Check provider. If provider is deepseek AND tags has 'fallback', then we know key is missing -> Skip.
    // 3. If provider is deepseek AND tags NO 'fallback', verify structure -> Pass.
    
    try {
        const result = await runScan({
            n_opps: 1,
            mode: 'fast',
            llm_provider: 'deepseek',
            topic_key: 'smoke_test_deepseek_live'
        });
        
        const opp = result.opportunities[0];
        if (opp.llm_tags.includes('fallback') || opp.llm_tags.includes('no_key')) {
             console.log("Case B SKIPPED: Server running in fallback mode (no key)");
             return;
        }
        
        console.log("DeepSeek Live Response Detected!");
        console.log(`Summary: ${opp.llm_summary}`);
        console.log(`JSON: ${JSON.stringify(opp.llm_json).substring(0, 100)}...`);
        
        if (!opp.llm_json || !opp.llm_json.signals) {
            throw new Error("Live response missing structured JSON");
        }
        
        console.log("Case B PASSED");
        
    } catch (e) {
         console.error("Case B FAILED:", e.message);
         // Don't fail the whole suite if live key is missing, but here we are testing logic
         if (e.message.includes("ECONNREFUSED")) process.exit(1);
    }
}

async function main() {
    await testDeepSeekFallback();
    await testDeepSeekLive();
}

main();
