import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORT_DIR = path.join(__dirname, '../rules/task-reports/2026-02');

// Ensure report dir exists
if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
}

const LOG_FILE = path.join(REPORT_DIR, 'test_260212_001.log');
const PORT = 53122;
const BASE_URL = `http://localhost:${PORT}`;

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync(LOG_FILE, line + '\n');
}

async function runTest() {
    log('Starting Test 260212_001: News Pull Endpoint');

    // Case 1: Success (Default limit)
    try {
        log('Test Case 1: GET /news/pull (Default)');
        const res = await fetch(`${BASE_URL}/news/pull`);
        const data = await res.json();
        
        if (res.status !== 200) throw new Error(`Status ${res.status}`);
        if (data.status !== 'ok') throw new Error(`Response status not ok: ${data.status}`);
        if (typeof data.fetched_count !== 'number') throw new Error('fetched_count missing');
        
        log('PASS: Case 1');
    } catch (e) {
        log(`FAIL: Case 1 - ${e.message}`);
        process.exit(1);
    }

    // Case 2: Error (Simulated)
    try {
        log('Test Case 2: GET /news/pull?sim_error=true (Error Response)');
        const res = await fetch(`${BASE_URL}/news/pull?sim_error=true`);
        const data = await res.json();
        
        if (res.status !== 500) throw new Error(`Expected 500, got ${res.status}`);
        if (data.status !== 'error') throw new Error(`Response status not error: ${data.status}`);
        if (data.code !== 'SIMULATED_ERROR') throw new Error(`Unexpected code: ${data.code}`);
        
        log('PASS: Case 2');
    } catch (e) {
        log(`FAIL: Case 2 - ${e.message}`);
        process.exit(1);
    }

    // Case 3: Limit > 50 (Boundary)
    try {
        log('Test Case 3: GET /news/pull?limit=60 (Boundary)');
        const res = await fetch(`${BASE_URL}/news/pull?limit=60`);
        const data = await res.json();
        
        if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
        if (data.status !== 'error') throw new Error(`Response status not error: ${data.status}`);
        if (data.code !== 'INVALID_LIMIT') throw new Error(`Unexpected code: ${data.code}`);
        
        log('PASS: Case 3');
    } catch (e) {
        log(`FAIL: Case 3 - ${e.message}`);
        process.exit(1);
    }

    log('All Tests Passed.');
}

// Run
// Wait a bit for server if needed, but we assume server is running (User instructions say start server first? Or we can check health)
// We'll just try running.
runTest().catch(e => {
    log(`FATAL: ${e.message}`);
    process.exit(1);
});
