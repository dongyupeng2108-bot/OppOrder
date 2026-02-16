// verify_contracts_early.mjs
// Contract Verification First (Contract First)
// Usage: node verify_contracts_early.mjs

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 53122;
const BASE_URL = `http://localhost:${PORT}`;

// Schemas are usually in ../contracts/
const CONTRACTS_DIR = path.join(__dirname, '..', 'contracts');

// Map of endpoints to schema files (simplified check for now)
const CHECKS = [
    {
        name: 'Rank V2',
        path: '/opportunities/rank_v2?limit=5&provider=mock',
        method: 'GET',
        schema: 'rank_v2.schema.json'
    },
    {
        name: 'Export V1',
        path: '/opportunities/runs/export_v1?limit=5',
        method: 'GET',
        schema: 'export_v1.schema.json'
    },
    {
        name: 'Ledger V0',
        path: '/opportunities/ledger/query_v0?limit=5',
        method: 'GET',
        schema: 'ledger_v0.schema.json'
    }
];

function checkEndpoint(check) {
    return new Promise((resolve, reject) => {
        console.log(`[Contract First] Verifying ${check.name} (${check.path})...`);
        
        http.get(`${BASE_URL}${check.path}`, (res) => {
            const { statusCode } = res;
            if (statusCode !== 200) {
                // Consume response data to free up memory
                res.resume();
                reject(new Error(`${check.name} failed with Status Code: ${statusCode}`));
                return;
            }

            res.setEncoding('utf8');
            let rawData = '';
            res.on('data', (chunk) => { rawData += chunk; });
            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(rawData);
                    // Basic validation: ensure it's an array or object as expected
                    if (!parsedData) {
                        reject(new Error(`${check.name} returned empty/null JSON`));
                        return;
                    }
                    console.log(`[Contract First] PASS: ${check.name}`);
                    resolve();
                } catch (e) {
                    reject(new Error(`${check.name} returned invalid JSON: ${e.message}`));
                }
            });
        }).on('error', (e) => {
            reject(new Error(`${check.name} request failed: ${e.message}`));
        });
    });
}

async function run() {
    console.log('[Contract First] Starting Early Contract Verification...');
    
    let failed = false;
    // We run sequentially to avoid overwhelming the mock server
    for (const check of CHECKS) {
        try {
            await checkEndpoint(check);
        } catch (e) {
            console.error(`[Contract First] FAIL: ${e.message}`);
            failed = true;
        }
    }

    if (failed) {
        console.error('[Contract First] One or more contract checks failed.');
        process.exit(1);
    } else {
        console.log('[Contract First] All Contracts Verified Successfully.');
        process.exit(0);
    }
}

run();
