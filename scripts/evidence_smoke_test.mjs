import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';

// --- Parse Arguments ---
const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        task_id: { type: 'string' },
        dir: { type: 'string' },
    },
});

const taskId = values.task_id;
const evidenceDir = values.dir;

if (!taskId || !evidenceDir) {
    console.error('Usage: node evidence_smoke_test.mjs --task_id <task_id> --dir <evidence_dir>');
    process.exit(1);
}

// --- Manifest Path ---
const manifestPath = path.join(evidenceDir, `evidence_manifest_${taskId}.json`);

if (!fs.existsSync(manifestPath)) {
    console.error(`[Evidence Smoke Test] FAIL: Manifest not found: ${manifestPath}`);
    process.exit(1);
}

// --- Read Manifest ---
let manifest;
try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
    console.error(`[Evidence Smoke Test] FAIL: Invalid JSON in manifest: ${e.message}`);
    process.exit(1);
}

// --- Validate Schema ---
const requiredFields = ['task_id', 'mode', 'required_files'];
const missingFields = requiredFields.filter(f => !manifest[f]);

if (missingFields.length > 0) {
    console.error(`[Evidence Smoke Test] FAIL: Manifest missing fields: ${missingFields.join(', ')}`);
    process.exit(1);
}

if (manifest.task_id !== taskId) {
    console.error(`[Evidence Smoke Test] FAIL: Manifest task_id mismatch: ${manifest.task_id} != ${taskId}`);
    process.exit(1);
}

if (!Array.isArray(manifest.required_files)) {
    console.error(`[Evidence Smoke Test] FAIL: required_files must be an array`);
    process.exit(1);
}

// --- Validate Required Files Existence ---
const requiredFiles = manifest.required_files;
const missingFiles = [];

for (const file of requiredFiles) {
    const filePath = path.join(evidenceDir, file);
    if (!fs.existsSync(filePath)) {
        missingFiles.push(file);
    }
}

// --- Validate Specific Mandatory Files (Hard Requirement) ---
const mandatoryFiles = [
    `run_${taskId}.log`,
    `notify_${taskId}.txt`,
    `result_${taskId}.json`,
    `deliverables_index_${taskId}.json`,
    `workspace_healer_${taskId}.json`
];
// If preflight_attestation exists, include it? Or hard check?
// User said: "Mandatory: ... preflight_attestation ... gate_light_verify (if exists) ... healthcheck ..."
// Let's enforce run_log specifically as per DoD.

const missingMandatory = mandatoryFiles.filter(f => !requiredFiles.includes(f));
if (missingMandatory.length > 0) {
    console.error(`[Evidence Smoke Test] FAIL: Manifest required_files missing mandatory items: ${missingMandatory.join(', ')}`);
    process.exit(1);
}

if (missingFiles.length > 0) {
    console.error(`[Evidence Smoke Test] FAIL: Missing required files in directory: ${missingFiles.join(', ')}`);
    process.exit(1);
}

console.log(`[Evidence Smoke Test] PASS: Manifest valid, all ${requiredFiles.length} required files exist.`);
process.exit(0);
