import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Utils ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// Helper to parse args
function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {
        action: null,
        task_id: null,
        mode: null,
        entry: null,
        reason: null,
        extra_json: null
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--action') parsed.action = args[++i];
        else if (arg === '--task_id') parsed.task_id = args[++i];
        else if (arg === '--mode') parsed.mode = args[++i];
        else if (arg === '--entry') parsed.entry = args[++i];
        else if (arg === '--reason') parsed.reason = args[++i];
        else if (arg === '--extra_json') parsed.extra_json = args[++i];
    }
    return parsed;
}

const args = parseArgs();

// --- Validation ---
if (!args.action || !['check', 'write'].includes(args.action)) {
    console.error('Usage: node ops_hardstop_latch.mjs --action <check|write> ...');
    process.exit(1);
}

if (!args.task_id) {
    // If checking without task_id, we might be in a generic context, but spec says task_id is required.
    // For safe_commit/push, if we can't determine task_id, maybe we skip check?
    // Spec: "--task_id <id>" is required.
    console.error('Missing --task_id');
    process.exit(1);
}

// --- Path Logic ---
// <YYYY-MM> from task_id (first 6 digits: DDMMYY -> 20YY-MM)
// Wait, task_id format is usually DDMMYY_NNN (e.g. 260225_003 -> 25 Feb 2026).
// The spec says: <YYYY-MM> from task_id first 6 chars: 260225 -> 2026-02.
// Let's implement that strictly.
function getYearMonth(taskId) {
    // taskId: 260225_...
    // 26 -> Day, 02 -> Month, 25 -> Year (2025? No, today is 2026-02-25)
    // Wait, let's check date format.
    // 260225 -> 26th Feb 2025? Or 2026?
    // The spec example: 260225_003 -> 2026-02.
    // Ah, year is likely the last 2 digits.
    // Let's check existing convention.
    // Core Memory says Today's date: 2026-02-25.
    // TaskId 260225 matches today. So format is DDMMYY.
    // 26(Day) 02(Month) 25(Year -> 2025??)
    // Wait, if today is 2026, then 25 means 2025? That's in the past.
    // Let me re-read the spec example carefully.
    // "260225_003 -> 2026-02"
    // If the input is 260225, and output is 2026-02, then the year part '25' maps to '2026'?
    // That's weird.
    // Let's check if the user meant 260226? Or maybe the task ID year is offset?
    // Let's look at existing paths. "rules/task-reports/2026-02/" exists.
    // If I use 260225 (Day 26, Month 02, Year 25), that would be Feb 2025.
    // But the folder is 2026-02.
    // Maybe the format is YYMMDD? 260225 -> 2026 Feb 25th.
    // Let's assume YYMMDD.
    // 26(Year) 02(Month) 25(Day).
    // Yes, that matches 2026-02.
    
    const year = '20' + taskId.substring(0, 2);
    const month = taskId.substring(2, 4);
    return `${year}-${month}`;
}

const yearMonth = getYearMonth(args.task_id);
let latchRoot = process.env.HARDSTOP_LATCH_ROOT;

// Integrate/CI Guard for Latch Root Override
if (latchRoot && args.mode !== 'Dev') {
    // Violation!
    console.log('HARD_STOP=1');
    console.log('HARD_STOP_REASON=INTEGRATE_ENV_VIOLATION_LATCH_ROOT_OVERRIDE');
    console.log('NEXT_ACTION=STOP_AND_REPORT');
    process.exit(33); // Using 33 as generic HardStop exit code based on context
}

if (!latchRoot) {
    latchRoot = path.join(REPO_ROOT, 'rules', 'task-reports', yearMonth);
} else {
    latchRoot = path.resolve(latchRoot); // Resolve relative path if any
}

const latchFile = path.join(latchRoot, `.hardstop_latch_${args.task_id}.json`);

// --- Action: Check ---
if (args.action === 'check') {
    if (fs.existsSync(latchFile)) {
        // Latch exists -> STOP
        // Read reason if possible
        let reason = 'UNKNOWN';
        try {
            const content = fs.readFileSync(latchFile, 'utf8');
            const json = JSON.parse(content);
            if (json.reason) reason = json.reason;
        } catch (e) {
            // ignore
        }

        console.log('HARD_STOP=1');
        console.log(`HARD_STOP_REASON=${reason}`);
        console.log('NEXT_ACTION=STOP_AND_REPORT');
        process.exit(33);
    }
    // No latch -> Pass
    process.exit(0);
}

// --- Action: Write ---
if (args.action === 'write') {
    if (!args.reason) {
        console.error('Missing --reason for write action');
        process.exit(1);
    }

    // Ensure directory exists
    if (!fs.existsSync(latchRoot)) {
        fs.mkdirSync(latchRoot, { recursive: true });
    }

    const payload = {
        task_id: args.task_id,
        reason: args.reason,
        timestamp: new Date().toISOString(),
        mode: args.mode
    };

    if (args.extra_json) {
        try {
            const extraContent = fs.readFileSync(args.extra_json, 'utf8');
            const extra = JSON.parse(extraContent);
            Object.assign(payload, extra);
        } catch (e) {
            // Ignore extra json errors, but log warning? No, keep it clean.
        }
    }

    fs.writeFileSync(latchFile, JSON.stringify(payload, null, 2), { encoding: 'utf8' });
    
    // Output standard block even on write (to confirm)
    console.log('HARD_STOP=1');
    console.log(`HARD_STOP_REASON=${args.reason}`);
    console.log('NEXT_ACTION=STOP_AND_REPORT');
    process.exit(33);
}
