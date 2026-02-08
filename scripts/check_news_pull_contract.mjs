import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCHEMA_PATH = path.resolve(__dirname, '../OppRadar/contracts/news_pull_response.schema.json');

// --- Simple Validator Implementation ---
function validate(instance, schema, pathStr = 'root') {
    if (!schema) return { valid: true };

    // 1. oneOf
    if (schema.oneOf) {
        const errors = [];
        const passed = schema.oneOf.some((subSchema, index) => {
            const res = validate(instance, subSchema, `${pathStr}.oneOf[${index}]`);
            if (!res.valid) errors.push(res.errors);
            return res.valid;
        });
        if (!passed) {
            return { 
                valid: false, 
                errors: [`${pathStr}: Matches none of oneOf schemas. Details: ${JSON.stringify(errors)}`] 
            };
        }
        return { valid: true };
    }

    // 2. Type Check
    if (schema.type) {
        const type = schema.type;
        const actualType = Array.isArray(instance) ? 'array' : (instance === null ? 'null' : typeof instance);
        
        // Handle type: ["string", "null"]
        if (Array.isArray(type)) {
            if (!type.includes(actualType) && !(type.includes('integer') && Number.isInteger(instance))) {
                 return { valid: false, errors: [`${pathStr}: Expected type ${type.join('|')}, got ${actualType}`] };
            }
        } else {
             if (type === 'integer') {
                if (!Number.isInteger(instance)) return { valid: false, errors: [`${pathStr}: Expected integer, got ${actualType}`] };
            } else if (type !== actualType) {
                return { valid: false, errors: [`${pathStr}: Expected type ${type}, got ${actualType}`] };
            }
        }
    }

    // 3. Const
    if (schema.const !== undefined) {
        if (instance !== schema.const) {
            return { valid: false, errors: [`${pathStr}: Expected const '${schema.const}', got '${instance}'`] };
        }
    }

    // 4. Enum
    if (schema.enum) {
        if (!schema.enum.includes(instance)) {
            return { valid: false, errors: [`${pathStr}: Value '${instance}' not in enum [${schema.enum.join(', ')}]`] };
        }
    }

    // 5. Required
    if (schema.required) {
        for (const req of schema.required) {
            if (instance[req] === undefined) {
                return { valid: false, errors: [`${pathStr}: Missing required property '${req}'`] };
            }
        }
    }

    // 6. Properties
    if (schema.properties && instance && typeof instance === 'object') {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
            if (instance[key] !== undefined) {
                const res = validate(instance[key], propSchema, `${pathStr}.${key}`);
                if (!res.valid) return res;
            }
        }
    }
    
    // 7. Minimum
    if (schema.minimum !== undefined && typeof instance === 'number') {
        if (instance < schema.minimum) {
             return { valid: false, errors: [`${pathStr}: Value ${instance} is less than minimum ${schema.minimum}`] };
        }
    }

    return { valid: true };
}

// --- Main ---
console.log('[Contract Check] Loading schema from:', SCHEMA_PATH);
if (!fs.existsSync(SCHEMA_PATH)) {
    console.error('Schema file not found!');
    process.exit(1);
}
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

// Sample 1: Success Response
const successSample = {
    status: "ok",
    provider_used: "local",
    fallback: false,
    cached: false,
    cache_key: "abc123hash",
    inserted_count: 5,
    deduped_count: 0,
    fetched_count: 5,
    written_count: 5,
    request: {
        provider: "local",
        topic_key: "Gold",
        query: "Gold price",
        timespan: "1d",
        maxrecords: 10
    }
};

// Sample 2: Error Response (maxrecords > 50)
const errorSample = {
    status: "error",
    code: "MAXRECORDS_LIMIT",
    message: "maxrecords cannot exceed 50",
    request: {
        provider: "gdelt",
        topic_key: "Silver",
        maxrecords: 100
    }
};

console.log('[Contract Check] Validating Success Sample...');
const res1 = validate(successSample, schema);
if (!res1.valid) {
    console.error('Success Sample Validation FAILED:', res1.errors);
    process.exit(1);
}
console.log('PASS');

console.log('[Contract Check] Validating Error Sample...');
const res2 = validate(errorSample, schema);
if (!res2.valid) {
    console.error('Error Sample Validation FAILED:', res2.errors);
    process.exit(1);
}
console.log('PASS');

console.log('[Contract Check] All samples validated against schema.');
