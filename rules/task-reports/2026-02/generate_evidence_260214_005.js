const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TASK_ID = '260214_005';
const ROOT_DIR = path.resolve(__dirname, '../../../');
const SERVER_SCRIPT = path.join(ROOT_DIR, 'OppRadar/mock_server_53122.mjs');
const TEST_SCRIPT = path.join(ROOT_DIR, 'scripts/test_news_store_260214_005.mjs');
const OUTPUT_DIR = path.join(ROOT_DIR, 'rules/task-reports/2026-02');
const NOTIFY_FILE = path.join(OUTPUT_DIR, `notify_${TASK_ID}.txt`);
const RESULT_FILE = path.join(OUTPUT_DIR, `result_${TASK_ID}.json`);
const HEALTHCHECK_FILE = path.join(OUTPUT_DIR, `${TASK_ID}_healthcheck_53122_root.txt`);

// Cleanup previous runs
try {
    if (fs.existsSync(NOTIFY_FILE)) fs.unlinkSync(NOTIFY_FILE);
    if (fs.existsSync(RESULT_FILE)) fs.unlinkSync(RESULT_FILE);
    if (fs.existsSync(HEALTHCHECK_FILE)) fs.unlinkSync(HEALTHCHECK_FILE);
} catch (e) {}

console.log('Starting mock server...');
const server = spawn('node', [SERVER_SCRIPT], {
    cwd: ROOT_DIR,
    stdio: 'pipe', 
    detached: false,
    env: { ...process.env, PORT: '53122' }
});

let serverLog = '';
server.stdout.on('data', d => { 
    const s = d.toString();
    serverLog += s;
    // console.log('[SERVER]', s); 
});
server.stderr.on('data', d => { 
    const s = d.toString();
    serverLog += s;
    console.error('[SERVER ERR]', s); 
});

// Give server time to start
setTimeout(async () => {
    let exitCode = 0;
    try {
        console.log('Running healthcheck...');
        execSync(`curl -v http://localhost:53122/ --output "${HEALTHCHECK_FILE}"`, { stdio: 'inherit' });
        
        console.log('Running tests...');
        const testOutput = execSync(`node "${TEST_SCRIPT}"`, { cwd: ROOT_DIR, encoding: 'utf8' });
        console.log(testOutput);

        console.log('Generating evidence...');
        
        // Notify
        const notifyContent = `Task ${TASK_ID} Completed\n\nPASS\n\nEvidence:\n- Healthcheck: PASS\n- Tests: PASS\n\nTest Output:\n${testOutput}`;
        fs.writeFileSync(NOTIFY_FILE, notifyContent);

        // Result
        const result = {
            task_id: TASK_ID,
            status: "success",
            run_id: "run_" + new Date().toISOString().replace(/[:.]/g, '-'),
            artifacts: [
                path.basename(NOTIFY_FILE),
                path.basename(HEALTHCHECK_FILE)
            ],
            metrics: {
                tests_passed: true,
                server_log_len: serverLog.length
            }
        };
        fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));
        
        console.log('Evidence generated successfully.');

    } catch (e) {
        console.error('Evidence generation FAILED:', e.message);
        if (e.stdout) console.log(e.stdout.toString());
        exitCode = 1;
    } finally {
        console.log('Stopping server...');
        server.kill();
        process.exit(exitCode);
    }
}, 5000);
