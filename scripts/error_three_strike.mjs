import fs from 'fs';
import path from 'path';

/**
 * Three-Strike Automatic Governance
 * 
 * Scans the error stats index (last 50 records) for recurring errors.
 * If an error class (>= P3) appears >= 3 times, checks for a governance backlog item.
 * If missing, generates a GOV file.
 * 
 * Usage:
 * node scripts/error_three_strike.mjs [--index_file <path>] [--backlog_dir <path>] [--run_id <id>] [--dry_run]
 */

const getArg = (args, key) => {
    const prefix = `--${key}=`;
    const arg = args.find(a => a.startsWith(prefix));
    if (arg) return arg.substring(prefix.length);
    const idx = args.indexOf(`--${key}`);
    if (idx !== -1 && idx < args.length - 1) return args[idx + 1];
    return null;
};

const hasArg = (args, key) => {
    return args.includes(`--${key}`);
};

const args = process.argv.slice(2);
const indexFile = getArg(args, 'index_file') || 'rules/task-reports/index/error_stats.jsonl';
const backlogDir = getArg(args, 'backlog_dir') || 'rules/task-reports/governance-backlog';
const runId = getArg(args, 'run_id') || 'UNKNOWN_RUN';
const dryRun = hasArg(args, 'dry_run');

// Ensure backlog dir exists
if (!fs.existsSync(backlogDir) && !dryRun) {
    fs.mkdirSync(backlogDir, { recursive: true });
}

if (!fs.existsSync(indexFile)) {
    if (dryRun) {
        console.log('[ThreeStrike] Index file not found (Dry Run). Skipping.');
        process.exit(0);
    }
    console.error(`Index file not found: ${indexFile}`);
    process.exit(1);
}

// Read last 50 lines
const content = fs.readFileSync(indexFile, 'utf-8');
const lines = content.split('\n').filter(line => line.trim());
const last50 = lines.slice(-50);
const records = last50.map(line => {
    try {
        return JSON.parse(line);
    } catch (e) {
        return null;
    }
}).filter(r => r);

// Group by error_class
const counts = {};
const samples = {}; // Keep track of samples for the report

records.forEach(r => {
    if (r.error_class === 'NO_ERROR') return;
    
    // Check severity? Policy says P2/P3 errors -> P1.
    // The instructions say "If any class >= 3". It implies all classes except NO_ERROR.
    
    if (!counts[r.error_class]) {
        counts[r.error_class] = 0;
        samples[r.error_class] = [];
    }
    counts[r.error_class]++;
    if (samples[r.error_class].length < 3) {
        samples[r.error_class].push(r);
    }
});

// Check triggers
const triggers = Object.keys(counts).filter(cls => counts[cls] >= 3);

if (triggers.length === 0) {
    console.log('[ThreeStrike] No triggers detected (max count < 3).');
    process.exit(0);
}

// Process triggers
triggers.forEach(cls => {
    console.log(`[ThreeStrike] Trigger detected: ${cls} (Count: ${counts[cls]})`);
    
    // Check if GOV file exists
    // Pattern: GOV_*_<cls>.md
    // We need to list files in backlogDir
    let exists = false;
    if (fs.existsSync(backlogDir)) {
        const files = fs.readdirSync(backlogDir);
        exists = files.some(f => f.startsWith('GOV_') && f.endsWith(`_${cls}.md`));
    }

    if (exists) {
        console.log(`[ThreeStrike] Governance file already exists for ${cls}. Skipping.`);
    } else {
        // Generate GOV file
        // Date from runId prefix (first 8 chars) or fallback to now
        let dateStr = runId.length >= 8 ? runId.substring(0, 8) : new Date().toISOString().slice(0, 10).replace(/-/g, '');
        // Validate runId prefix is date-like? User said "run_id前8位".
        // If runId is 'UNKNOWN_RUN', use current date.
        if (runId === 'UNKNOWN_RUN') {
            dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        }

        const filename = `GOV_${dateStr}_${cls}.md`;
        const filepath = path.join(backlogDir, filename);
        
        const fileContent = `# Governance Backlog: ${cls}

## Trigger Info
- **Date**: ${new Date().toISOString()}
- **Error Class**: ${cls}
- **Strike Count**: ${counts[cls]} (Last 50 records)
- **Run ID**: ${runId}

## Samples
${samples[cls].map(s => `- **${s.task_id}** (${s.commit.substring(0, 7)}): ${s.message}`).join('\n')}

## Suggested Action
- Refer to [ERROR_TRIAGE_POLICY](../rules/ERROR_TRIAGE_POLICY.md)
- Default Severity: P1 (Upgraded from recurring error)
- **Action**: Create a fix task or verify environment stability.

## Status
- [ ] Analysis
- [ ] Fix Implemented
- [ ] Verified
`;

        if (dryRun) {
            console.log(`[ThreeStrike] [DRY RUN] Would generate: ${filepath}`);
            console.log(fileContent);
        } else {
            fs.writeFileSync(filepath, fileContent, 'utf-8');
            console.log(`[ThreeStrike] Generated governance backlog: ${filepath}`);
        }
    }
});
