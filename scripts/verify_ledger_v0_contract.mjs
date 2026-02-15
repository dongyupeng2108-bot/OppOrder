import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 53122;
const SCHEMA_PATH = path.resolve(__dirname, '../OppRadar/contracts/opps_ledger_query_v0.schema.json');
const SERVER_SCRIPT = path.resolve(__dirname, '../OppRadar/mock_server_53122.mjs');

// --- Simple Validator ---
function validate(instance, schema, pathStr = 'root') {
    if (!schema) return { valid: true };

    // 1. Type Check
    if (schema.type) {
        let types = Array.isArray(schema.type) ? schema.type : [schema.type];
        let actualType = typeof instance;
        if (instance === null) actualType = 'null';
        else if (Array.isArray(instance)) actualType = 'array';

        if (!types.includes(actualType)) {
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
        if (schema.required) {
            for (const req of schema.required) {
                if (instance[req] === undefined) {
                    return { valid: false, errors: [`${pathStr}: Missing required property '${req}'`] };
                }
            }
        }
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

// --- Sleep Helper ---
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
    console.log('=== Ledger V0 Contract Verification ===');
    
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
        // Try ping first
        try {
            await fetchUrl(`http://localhost:${PORT}/health`);
            serverStarted = true;
            console.log('Server already running.');
        } catch (e) {
            console.log('Starting server...');
            serverProcess = spawn('node', [SERVER_SCRIPT], {
                cwd: path.dirname(SERVER_SCRIPT),
                stdio: 'ignore' 
            });
            // Wait
            for (let i=0; i<10; i++) {
                await sleep(500);
                try {
                    await fetchUrl(`http://localhost:${PORT}/health`);
                    serverStarted = true;
                    break;
                } catch(e) {}
            }
        }

        if (!serverStarted) {
            console.error('Failed to start server.');
            process.exit(1);
        }

        // 3. Fetch Data
        console.log('Fetching /opportunities/ledger/query_v0?limit=1...');
        const res = await fetchUrl(`http://localhost:${PORT}/opportunities/ledger/query_v0?limit=1`);
        if (res.statusCode !== 200) {
            console.error(`Request failed: Status ${res.statusCode}`);
            process.exit(1);
        }
        
        let json;
        try {
            json = JSON.parse(res.data);
        } catch (e) {
            console.error('Invalid JSON response');
            process.exit(1);
        }

        // 4. Validate
        console.log('Validating against schema...');
        const result = validate(json, schema);
        if (!result.valid) {
            console.error('Validation FAILED:', result.errors);
            process.exit(1);
        }
        
        console.log('Validation PASSED.');

    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    } finally {
        if (serverProcess) {
            serverProcess.kill();
        }
    }
}

main();
