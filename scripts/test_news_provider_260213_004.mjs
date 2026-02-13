import http from 'http';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:53122';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(path) {
    return new Promise((resolve, reject) => {
        http.get(`${BASE_URL}${path}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, data: json });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        }).on('error', reject);
    });
}

async function runTests() {
    console.log('Starting News Provider Tests...');

    // 1. Healthcheck
    try {
        const root = await fetchJson('/');
        if (root.status !== 200) throw new Error(`Healthcheck / failed: ${root.status}`);
        console.log('[PASS] Healthcheck /');

        const pairs = await fetchJson('/pairs');
        if (pairs.status !== 200) throw new Error(`Healthcheck /pairs failed: ${pairs.status}`);
        console.log('[PASS] Healthcheck /pairs');
    } catch (e) {
        console.error('[FAIL] Healthcheck:', e.message);
        process.exit(1);
    }

    // 2. Default Pull (Mock)
    let firstBatch = [];
    try {
        const res = await fetchJson('/news/pull?limit=5');
        if (res.status !== 200) throw new Error(`Default pull failed: ${res.status}`);
        if (res.data.provider_used !== 'mock') throw new Error(`Wrong provider: ${res.data.provider_used}`);
        if (!Array.isArray(res.data.items) || res.data.items.length !== 5) throw new Error('Items length mismatch');
        
        firstBatch = res.data.items;
        console.log('[PASS] Default Pull (Mock, Limit 5)');
    } catch (e) {
        console.error('[FAIL] Default Pull:', e.message);
        process.exit(1);
    }

    // 3. Idempotency (Deterministic)
    try {
        const res = await fetchJson('/news/pull?limit=5');
        const secondBatch = res.data.items;
        
        const json1 = JSON.stringify(firstBatch);
        const json2 = JSON.stringify(secondBatch);
        
        if (json1 !== json2) throw new Error('Non-deterministic result');
        console.log('[PASS] Idempotency (Deterministic)');
    } catch (e) {
        console.error('[FAIL] Idempotency:', e.message);
        process.exit(1);
    }

    // 4. Pagination (since_id)
    try {
        // Mock data IDs are "0000000100" down to "0000000001" (since we sort DESC)
        // firstBatch[0] should be ID "0000000100"
        // firstBatch[4] should be ID "0000000096"
        
        const sinceId = firstBatch[2].id; // ID "0000000098"
        // Request with since_id = 98. Should return IDs 100, 99.
        
        const res = await fetchJson(`/news/pull?limit=5&since_id=${sinceId}`);
        const items = res.data.items;
        
        if (items.length !== 2) throw new Error(`Pagination length mismatch. Expected 2, got ${items.length}`);
        if (items[0].id !== firstBatch[0].id) throw new Error('Pagination content mismatch (item 0)');
        if (items[1].id !== firstBatch[1].id) throw new Error('Pagination content mismatch (item 1)');
        
        console.log('[PASS] Pagination (since_id)');
    } catch (e) {
        console.error('[FAIL] Pagination:', e.message);
        process.exit(1);
    }

    // 5. Boundary Tests
    try {
        // Huge Limit -> Clamp to 50
        const resHuge = await fetchJson('/news/pull?limit=1000');
        if (resHuge.data.items.length !== 50) throw new Error(`Huge limit failed. Expected 50, got ${resHuge.data.items.length}`);
        
        // Zero/Negative Limit -> Default 5
        const resZero = await fetchJson('/news/pull?limit=0');
        if (resZero.data.items.length !== 5) throw new Error(`Zero limit failed. Expected 5, got ${resZero.data.items.length}`);
        
        const resNeg = await fetchJson('/news/pull?limit=-10');
        if (resNeg.data.items.length !== 5) throw new Error(`Negative limit failed. Expected 5, got ${resNeg.data.items.length}`);

        console.log('[PASS] Boundary Tests (Clamp)');
    } catch (e) {
        console.error('[FAIL] Boundary Tests:', e.message);
        process.exit(1);
    }

    console.log('All Tests Passed!');
}

runTests();
