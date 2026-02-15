import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 53122;
const SCHEMA_PATH = path.resolve(__dirname, '../OppRadar/contracts/opps_rank_v2_response.schema.json');

// --- Validator ---
function validate(instance, schema, pathStr = 'root') {
    if (!schema) return { valid: true };

    // 1. Type Check
    if (schema.type) {
        let types = Array.isArray(schema.type) ? schema.type : [schema.type];
        let actualType = typeof instance;
        if (instance === null) actualType = 'null';
        else if (Array.isArray(instance)) actualType = 'array';

        if (!types.includes(actualType) && !(types.includes('integer') && Number.isInteger(instance))) {
            return { valid: false, errors: [`${pathStr}: Expected type ${types.join('|')}, got ${actualType}`] };
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
    if (schema.properties && instance && typeof instance === 'object' && !Array.isArray(instance)) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
            if (instance[key] !== undefined) {
                const res = validate(instance[key], propSchema, `${pathStr}.${key}`);
                if (!res.valid) return res;
            }
        }
    }

    // 4. Required
    if (schema.required && typeof instance === 'object') {
        for (const req of schema.required) {
            if (instance[req] === undefined) {
                return { valid: false, errors: [`${pathStr}: Missing required property '${req}'`] };
            }
        }
    }

    // 5. Minimum/Maximum
    if (typeof instance === 'number') {
        if (schema.minimum !== undefined && instance < schema.minimum) {
            return { valid: false, errors: [`${pathStr}: Value ${instance} < minimum ${schema.minimum}`] };
        }
        if (schema.maximum !== undefined && instance > schema.maximum) {
            return { valid: false, errors: [`${pathStr}: Value ${instance} > maximum ${schema.maximum}`] };
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
    console.log('=== Rank V2 Contract Verification ===');
    
    // 1. Load Schema
    if (!fs.existsSync(SCHEMA_PATH)) {
        console.error(`Schema not found: ${SCHEMA_PATH}`);
        process.exit(1);
    }
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    console.log('Schema loaded.');

    // 2. Check/Start Server
    let serverProcess = null;
    try {
        // Try healthcheck first
        try {
            await fetchUrl(`http://localhost:${PORT}/`);
            console.log('Server already running.');
        } catch (e) {
            console.log('Starting mock server...');
            const serverScript = path.resolve(__dirname, '../OppRadar/mock_server_53122.mjs');
            serverProcess = spawn('node', [serverScript], { stdio: 'inherit', detached: false });
            // Wait for start
            await new Promise(r => setTimeout(r, 2000));
        }

        // 3. Call API
        const url = `http://localhost:${PORT}/opportunities/rank_v2?provider=mock&limit=5&run_id=verify_rank_v2`;
        console.log(`Fetching ${url}...`);
        const { statusCode, data } = await fetchUrl(url);
        
        if (statusCode !== 200) {
            console.error(`API Failed: ${statusCode} - ${data}`);
            process.exit(1);
        }

        const json = JSON.parse(data);
        console.log(`Received ${json.length} items.`);

        // 4. Validate Schema
        console.log('Validating against schema...');
        const validation = validate(json, schema);
        if (!validation.valid) {
            console.error('Schema Validation FAILED:', validation.errors);
            process.exit(1);
        }
        console.log('Schema Validation PASSED.');

        // 5. Deterministic Check (Hash)
        const content = JSON.stringify(json);
        const hash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 8);
        console.log(`Response Hash: ${hash}`);
        
        // Output for evidence
        console.log(`::set-output name=rank_v2_hash::${hash}`);
        console.log('VERIFICATION_SUCCESS');

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
