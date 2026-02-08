
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const dbPath = path.join(projectRoot, 'data', 'runtime', 'oppradar.sqlite');

function makeRequest(postData) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 53122,
            path: '/news/pull',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                resolve({ statusCode: res.statusCode, body: data });
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.write(postData);
        req.end();
    });
}

function verifyDb(expectedProvider) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) return reject(err);
        });

        db.all(`SELECT * FROM news_stub WHERE provider = ? ORDER BY id DESC LIMIT 10`, [expectedProvider], (err, rows) => {
            if (err) {
                db.close();
                return reject(err);
            }
            db.close();
            console.log(`DB Check (${expectedProvider}): Found ${rows.length} rows.`);
            if (rows.length > 0) {
                console.log('Sample row:', JSON.stringify(rows[0], null, 2));
            }
            resolve(rows.length);
        });
    });
}

async function run() {
    console.log('--- Starting Smoke Test for GDELT News Provider ---');

    // 1. Test GDELT Provider
    console.log('\n1. Requesting GDELT news...');
    const gdeltData = JSON.stringify({
        topic_key: 'Gold price volatility',
        limit: 5,
        provider: 'gdelt'
    });

    try {
        const res1 = await makeRequest(gdeltData);
        console.log('Response Status:', res1.statusCode);
        console.log('Response Body Preview:', res1.body.substring(0, 200) + '...');
        
        const json1 = JSON.parse(res1.body);
        if (json1.fallback) {
            console.warn('WARNING: Fallback occurred! GDELT might be unreachable or timed out.');
        } else {
            console.log('Success: GDELT provider used.');
        }
        
        // Check DB
        await verifyDb('gdelt');

        // 2. Test Deduplication
        console.log('\n2. Testing Deduplication (sending same request)...');
        const res2 = await makeRequest(gdeltData);
        const json2 = JSON.parse(res2.body);
        console.log(`Second request written: ${json2.written}, deduped: ${json2.deduped}`);
        
        if (json2.written === 0 && json2.deduped > 0) {
            console.log('PASS: Deduplication working (0 written).');
        } else {
            console.log('FAIL: Deduplication failed.');
        }

    } catch (err) {
        console.error('Test failed:', err);
        process.exit(1);
    }
}

// Wait for server to start roughly (already started, but give it a moment)
setTimeout(run, 1000);
