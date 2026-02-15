import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 53122;
// Fix path relative to scripts/
const SCHEMA_PATH = path.resolve(__dirname, '../OppRadar/contracts/opps_run_export_v1.schema.json');

// --- Simple Validator (reused from rank_v2 verifier) ---
function validate(instance, schema, pathStr = 'root') {
    if (!schema) return { valid: true };

    // 1. Type Check
    if (schema.type) {
        let types = Array.isArray(schema.type) ? schema.type : [schema.type];
        let actualType = typeof instance;
        if (instance === null) actualType = 'null';
        else if (Array.isArray(instance)) actualType = 'array';

        // Allow integer to match number type if needed, but schema usually distinguishes
        if (!types.includes(actualType)) {
             // JSON Schema: 'number' includes integers
             if (types.includes('number') && typeof instance === 'number') {
                 // ok
             } else if (types.includes('integer') && Number.isInteger(instance)) {
                 // ok
             } else {
                 return { valid: false, errors: [`${pathStr}: Expected type ${types.join('|')}, got ${actualType}`] };
             }
        }
    }

    // 2. Items (Array)
    if (schema.items && Array.isArray(instance)) {
        for (let i = 0; i < instance.length; i++) {
            const res = validate(instance[i], schema.items, `${pathStr}[${i}]`);
            if (!res.valid) return res;
        }
    }

    // 3. Properties (Object)
    if (instance && typeof instance === 'object' && !Array.isArray(instance)) {
        // Check required
        if (schema.required) {
            for (const req of schema.required) {
                if (instance[req] === undefined) {
                    return { valid: false, errors: [`${pathStr}: Missing required property '${req}'`] };
                }
            }
        }

        // Check properties
        if (schema.properties) {
            for (const [key, propSchema] of Object.entries(schema.properties)) {
                if (instance[key] !== undefined) {
                    const res = validate(instance[key], propSchema, `${pathStr}.${key}`);
                    if (!res.valid) return res;
                }
            }
        }
    }

    return { valid: true };
}

// --- Fetch Helper ---
function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, data }));
        });
        req.on('error', reject);
    });
}

// --- Main ---
async function main() {
    console.log('=== Export V1 Contract Verification ===');
    
    // 1. Load Schema
    if (!fs.existsSync(SCHEMA_PATH)) {
        console.error(`Schema not found: ${SCHEMA_PATH}`);
        process.exit(1);
    }
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    console.log('Schema loaded.');

    // 2. Check/Start Server
    let serverProcess = null;
    let serverStarted = false;
    
    try {
        // Try healthcheck first
        try {
            await new Promise((resolve, reject) => {
                const req = http.get(`http://localhost:${PORT}/`, (res) => {
                    if (res.statusCode === 200) resolve();
                    else reject(new Error('Status not 200'));
                });
                req.on('error', reject);
            });
            console.log('Server already running.');
        } catch (e) {
            console.log('Starting mock server...');
            // Assuming mock_server_53122.mjs is in OppRadar/
            const serverScript = path.resolve(__dirname, '../OppRadar/mock_server_53122.mjs');
            serverProcess = spawn('node', [serverScript], { stdio: 'inherit', detached: false });
            serverStarted = true;
            // Wait for start
            await new Promise(r => setTimeout(r, 2000));
        }

    // 2. Generate a run_id via POST /scans/run (which persists assets)
    // We must use POST /scans/run with persist=true to ensure data is written to disk
    const generateUrl = `http://localhost:${PORT}/scans/run`;
    console.log(`Generating Run assets via ${generateUrl}...`);
    
    const genBody = JSON.stringify({
        n_opps: 3,
        persist: true,
        mode: 'fast',
        provider: 'mock',
        seed: 12345 // Deterministic seed
    });
    
    // Use inline request since fetchUrl is GET-only
    const genRes = await new Promise((resolve, reject) => {
        const req = http.request(generateUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(genBody)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, data }));
        });
        req.on('error', reject);
        req.write(genBody);
        req.end();
    });
    
    if (genRes.statusCode !== 200) {
        console.error(`Generation Failed: ${genRes.statusCode} - ${genRes.data}`);
        process.exit(1);
    }
    
    let runId;
    try {
        const genJson = JSON.parse(genRes.data);
        // Structure is { scan: { scan_id: "..." }, ... }
        if (genJson.scan && genJson.scan.scan_id) {
            runId = genJson.scan.scan_id;
        } else {
            console.error('Generation response missing scan.scan_id:', genRes.data);
            process.exit(1);
        }
    } catch (e) {
        console.error('Failed to parse generation response:', e);
        process.exit(1);
    }
    
    console.log(`Run assets generated. Run ID: ${runId}`);

    // 3. Call Export V1 API
    const exportUrl = `http://localhost:${PORT}/opportunities/runs/export_v1?run_id=${runId}`;
        console.log(`Fetching Export: ${exportUrl}...`);
        const { statusCode, data } = await fetchUrl(exportUrl);
        
        if (statusCode !== 200) {
            console.error(`Export Failed: ${statusCode} - ${data}`);
            process.exit(1);
        }

        const json = JSON.parse(data);
        console.log(`Received Export JSON.`);

        // 5. Validate Schema
        console.log('Validating against schema...');
        const validation = validate(json, schema);
        if (!validation.valid) {
            console.error('Schema Validation FAILED:', validation.errors);
            process.exit(1);
        }
        console.log('Export Schema Validation PASSED.');

        // 6. Deterministic Check (Hash)
        const content = JSON.stringify(json);
        const hash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 8);
        console.log(`Export Hash: ${hash}`);
        
        // Output for evidence
        console.log(`::set-output name=export_v1_hash::${hash}`);
        console.log('EXPORT_CONTRACT_VERIFICATION_SUCCESS');

    } catch (e) {
        console.error('Verification Error:', e);
        process.exit(1);
    } finally {
        if (serverProcess) {
            console.log('Stopping temp server...');
            serverProcess.kill();
        }
    }
}

main();
