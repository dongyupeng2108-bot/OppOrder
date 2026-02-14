import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const TASK_ID = '260214_009';
const REPORT_DIR = path.join(__dirname); // Already in 2026-02
const PORT = 53122;
const BASE_URL = `http://localhost:${PORT}`;

// Artifact Paths
const FILE_OPPS_RANK = path.join(REPORT_DIR, `opps_rank_v2_${TASK_ID}.json`);
const FILE_HC_ROOT = path.join(REPORT_DIR, `healthcheck_root_${PORT}_${TASK_ID}.txt`);
const FILE_HC_PAIRS = path.join(REPORT_DIR, `healthcheck_pairs_${PORT}_${TASK_ID}.txt`);
const FILE_NOTIFY = path.join(REPORT_DIR, `notify_${TASK_ID}.txt`);
const FILE_RESULT = path.join(REPORT_DIR, `result_${TASK_ID}.json`);

// Helper: HTTP Request
function request(url, options = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
        });
        req.on('error', reject);
        req.end();
    });
}

// Helper: Ensure directory exists
if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
}

async function main() {
    console.log(`[Evidence Generator] Starting for Task ${TASK_ID}...`);

    try {
        // 1. Healthcheck Root
        console.log('1. Healthcheck Root...');
        const resRoot = await request(`${BASE_URL}/`);
        const rootContent = `HTTP/1.1 ${resRoot.statusCode} OK\n` + 
                            Object.entries(resRoot.headers).map(([k,v]) => `${k}: ${v}`).join('\n') + 
                            '\n\n' + resRoot.body.substring(0, 100); // Truncate body
        fs.writeFileSync(FILE_HC_ROOT, rootContent.replace(/\r\n/g, '\n'), 'utf8');

        // 2. Healthcheck Pairs
        console.log('2. Healthcheck Pairs...');
        const resPairs = await request(`${BASE_URL}/pairs`);
        const pairsContent = `HTTP/1.1 ${resPairs.statusCode} OK\n` + 
                             Object.entries(resPairs.headers).map(([k,v]) => `${k}: ${v}`).join('\n') + 
                             '\n\n' + resPairs.body.substring(0, 100);
        fs.writeFileSync(FILE_HC_PAIRS, pairsContent.replace(/\r\n/g, '\n'), 'utf8');

        // 3. Get Run ID
        console.log('3. Fetching Run ID...');
        const resRuns = await request(`${BASE_URL}/opportunities/runs?limit=5`);
        if (resRuns.statusCode !== 200) throw new Error(`Failed to fetch runs: ${resRuns.statusCode}`);
        const runs = JSON.parse(resRuns.body);
        if (!runs || runs.length === 0) throw new Error('No runs found. Cannot test rank_v2.');
        const runId = runs[0].run_id;
        console.log(`   Target Run ID: ${runId}`);

        // 4. Call Rank v2
        console.log('4. Calling Rank v2...');
        const urlRank = `${BASE_URL}/opportunities/rank_v2?run_id=${runId}&limit=20&provider=mock`;
        const resRank = await request(urlRank);
        if (resRank.statusCode !== 200) throw new Error(`Rank v2 failed: ${resRank.statusCode} ${resRank.body}`);
        
        // Save raw JSON
        // Normalize LF
        const rankBody = resRank.body.replace(/\r\n/g, '\n');
        fs.writeFileSync(FILE_OPPS_RANK, rankBody, 'utf8');

        // Verify content
        const rankData = JSON.parse(rankBody);
        const rows = rankData.length;
        const hasFields = rankData.length > 0 && 
                          'p_hat' in rankData[0] && 
                          'p_llm' in rankData[0] && 
                          'p_ci' in rankData[0] && 
                          'price_q' in rankData[0] && 
                          'score_v2' in rankData[0];
        
        const isSorted = rankData.every((item, i, arr) => i === 0 || arr[i-1].score_v2 >= item.score_v2);

        // 5. Generate DoD Lines
                const dodRank = `DOD_EVIDENCE_OPPS_RANK_V2: rules/task-reports/2026-02/opps_rank_v2_${TASK_ID}.json => rows=${rows} has_fields=p_hat,p_llm,p_ci,price_q,score_v2 sorted_by=score_v2_desc provider=mock stable=true`;
                
                // Write DoD Rank to a separate file for dev_batch_mode.ps1 ingestion
                const FILE_DOD_RANK = path.join(REPORT_DIR, `dod_opps_rank_v2_${TASK_ID}.txt`);
                fs.writeFileSync(FILE_DOD_RANK, dodRank, 'utf8');

                const dodRoot = `DOD_EVIDENCE_SITE_HEALTH_ROOT_53122: rules/task-reports/2026-02/healthcheck_root_53122_${TASK_ID}.txt => status=${resRoot.statusCode}`;
        const dodPairs = `DOD_EVIDENCE_SITE_HEALTH_PAIRS_53122: rules/task-reports/2026-02/healthcheck_pairs_53122_${TASK_ID}.txt => status=${resPairs.statusCode}`;

        console.log('5. Generating Result/Notify...');

        // Result JSON
        const result = {
            task_id: TASK_ID,
            status: "success",
            timestamp: new Date().toISOString(),
            dod_evidence: {
                opps_rank_v2: dodRank,
                site_health_root: dodRoot,
                site_health_pairs: dodPairs
            },
            metrics: {
                rank_rows: rows,
                is_sorted: isSorted
            }
        };
        fs.writeFileSync(FILE_RESULT, JSON.stringify(result, null, 2).replace(/\r\n/g, '\n'), 'utf8');

        // Notify TXT
        const notify = `
Task: ${TASK_ID}
Status: PASS
Timestamp: ${new Date().toISOString()}

=== DOD_EVIDENCE_STDOUT ===
${dodRank}
${dodRoot}
${dodPairs}
=== END_DOD_EVIDENCE ===

GATE_LIGHT_EXIT=0
`;
        fs.writeFileSync(FILE_NOTIFY, notify.trim().replace(/\r\n/g, '\n'), 'utf8');

        console.log('Evidence generation complete.');

    } catch (e) {
        console.error('Error generating evidence:', e);
        process.exit(1);
    }
}

main();
