const fs = require('fs');
const path = require('path');

const ARGS = process.argv.slice(2);
const taskId = ARGS.find(arg => arg.startsWith('--task_id='))?.split('=')[1];
const targetDir = ARGS.find(arg => arg.startsWith('--dir='))?.split('=')[1];

if (!taskId || !targetDir) {
    console.error('Usage: node scripts/evidence_smoke_test.mjs --task_id=<id> --dir=<evidence_dir>');
    process.exit(1);
}

const resolvePath = (filename) => path.resolve(targetDir, filename);
const manifestPath = resolvePath(`evidence_manifest_${taskId}.json`);

console.log(`[SmokeTest] Running Evidence Smoke Test for Task ${taskId} in ${targetDir}...`);

// 1. Check Manifest Existence
if (!fs.existsSync(manifestPath)) {
    console.error(`[SmokeTest] FAIL: Manifest not found: ${manifestPath}`);
    process.exit(1);
}

// 2. Validate Manifest Schema & Content
let manifest;
try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
    console.error(`[SmokeTest] FAIL: Manifest JSON parse error: ${e.message}`);
    process.exit(1);
}

const requiredFields = ['task_id', 'mode', 'generated_at', 'required_files'];
const missingFields = requiredFields.filter(f => !manifest[f]);
if (missingFields.length > 0) {
    console.error(`[SmokeTest] FAIL: Manifest missing fields: ${missingFields.join(', ')}`);
    process.exit(1);
}

if (manifest.task_id !== taskId) {
    console.error(`[SmokeTest] FAIL: Manifest task_id mismatch. Expected ${taskId}, got ${manifest.task_id}`);
    process.exit(1);
}

// 3. Check Required Files Existence
const requiredFiles = manifest.required_files;
if (!Array.isArray(requiredFiles) || requiredFiles.length === 0) {
    console.error(`[SmokeTest] FAIL: Manifest required_files is empty or invalid.`);
    process.exit(1);
}

const missingFiles = [];
requiredFiles.forEach(file => {
    const filePath = resolvePath(file);
    if (!fs.existsSync(filePath)) {
        missingFiles.push(file);
    }
});

if (missingFiles.length > 0) {
    console.error(`[SmokeTest] FAIL: Missing required files listed in manifest:`);
    missingFiles.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
}

// 4. Mandatory Files Check (Hardcoded safety net)
const mandatoryFiles = [
    `run_${taskId}.log`,
    `notify_${taskId}.txt`,
    `result_${taskId}.json`,
    `deliverables_index_${taskId}.json`,
    `workspace_healer_${taskId}.json`,
    `${taskId}_healthcheck_53122_root.txt`,
    `${taskId}_healthcheck_53122_pairs.txt`
];

const missingMandatory = mandatoryFiles.filter(f => !requiredFiles.includes(f));
if (missingMandatory.length > 0) {
    console.error(`[SmokeTest] FAIL: Manifest required_files missing mandatory items: ${missingMandatory.join(', ')}`);
    process.exit(1);
}

console.log(`[SmokeTest] PASS: All ${requiredFiles.length} required files exist and manifest is valid.`);
process.exit(0);
