
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const BASE_URL = 'http://localhost:53122';
const TASK_ID = '260207_004';
const REPORT_DIR = path.resolve(__dirname, '../rules/task-reports/2026-02');

// Ensure report directory exists
if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
}

const RESULT_FILE = path.join(REPORT_DIR, `${TASK_ID}_runscan.json`);
const ASSERTION_FILE = path.join(REPORT_DIR, `${TASK_ID}_assertions.txt`);

async function runSmokeTest() {
    console.log(`[Smoke] Starting Task ${TASK_ID} verification...`);
    
    // 1. Run Scan (persist=false to avoid disk I/O, seed=111 for reproducibility)
    console.log(`[Smoke] Requesting POST /scans/run (seed=111, n_opps=10, persist=false)...`);
    const startTime = Date.now();
    
    let result;
    try {
        const response = await fetch(`${BASE_URL}/scans/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                seed: 111,
                n_opps: 10,
                persist: false
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }
        
        result = await response.json();
    } catch (err) {
        console.error(`[Smoke] Failed to fetch /scans/run:`, err);
        process.exit(1);
    }
    
    const duration = Date.now() - startTime;
    console.log(`[Smoke] Scan completed in ${duration}ms.`);
    
    // 2. Save raw result
    fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));
    console.log(`[Smoke] Saved raw result to ${RESULT_FILE}`);
    
    // 3. Assertions
    const assertions = [];
    const opps = result.opportunities || [];
    
    assertions.push(`Total Opportunities: ${opps.length} (Expected 10)`);
    if (opps.length !== 10) console.warn(`[Warn] Expected 10 opps, got ${opps.length}`);

    let passCount = 0;
    
    opps.forEach((opp, idx) => {
        const checks = [];
        
        // Check baseline score
        const hasScore = typeof opp.score_baseline === 'number' && opp.score_baseline >= 0 && opp.score_baseline <= 100;
        checks.push(hasScore ? '[PASS] score_baseline' : `[FAIL] score_baseline: ${opp.score_baseline}`);
        
        // Check components
        const hasComponents = opp.score_components && 
                            typeof opp.score_components.spread_edge === 'number' &&
                            typeof opp.score_components.liquidity === 'number';
        checks.push(hasComponents ? '[PASS] score_components' : '[FAIL] score_components missing/invalid');
        
        // Check LLM fields (Mock)
        const hasLLM = typeof opp.llm_summary === 'string' && 
                       opp.llm_summary.includes('Mock') && 
                       typeof opp.llm_confidence === 'number';
        checks.push(hasLLM ? '[PASS] llm_summary (Mock)' : `[FAIL] llm_summary: ${opp.llm_summary}`);
        
        // Check determinism (Seed 111 should produce consistent results)
        // For opp_id, we expect specific values if RNG is consistent, but just checking structure here.
        
        const allPass = hasScore && hasComponents && hasLLM;
        if (allPass) passCount++;
        
        if (idx < 3) { // Log details for first 3
            assertions.push(`Opp #${idx} (${opp.opp_id}): ${checks.join(', ')}`);
            assertions.push(`  - Summary: ${opp.llm_summary}`);
            assertions.push(`  - Score: ${opp.score_baseline} (Components: ${JSON.stringify(opp.score_components)})`);
        }
    });
    
    assertions.push(`Summary: ${passCount}/${opps.length} Opportunities passed all structure checks.`);
    
    // Write assertions
    fs.writeFileSync(ASSERTION_FILE, assertions.join('\n'));
    console.log(`[Smoke] Saved assertions to ${ASSERTION_FILE}`);
    
    if (passCount === opps.length) {
        console.log(`[Smoke] SUCCESS: All checks passed.`);
        process.exit(0);
    } else {
        console.error(`[Smoke] FAILURE: Only ${passCount}/${opps.length} passed.`);
        process.exit(1);
    }
}

runSmokeTest().catch(err => {
    console.error(`[Smoke] Uncaught error:`, err);
    process.exit(1);
});
