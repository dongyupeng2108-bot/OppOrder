import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Args:
// --task_id <id>
// --mode <Dev|Integrate>
// --step <step_name>
// --error_class <class>
// --evidence_dir <dir>
// --log_file <path_to_log> (optional, to extract snippet)

const args = process.argv.slice(2);
function getArgValue(key, fallback) {
    const index = args.indexOf(key);
    if (index !== -1 && index + 1 < args.length) return args[index + 1];
    return fallback;
}

const taskId = getArgValue('--task_id');
const mode = getArgValue('--mode');
const step = getArgValue('--step', 'Unknown');
const errorClass = getArgValue('--error_class', 'UNKNOWN');
const evidenceDir = getArgValue('--evidence_dir', '');
const logFile = getArgValue('--log_file', '');

if (!taskId) {
    console.error('Error: --task_id required');
    process.exit(1);
}

const repoRoot = process.cwd(); // Assume run from root
const statsFile = path.join(repoRoot, 'rules/task-reports/index/error_stats.jsonl');
const governanceDir = path.join(repoRoot, 'rules/task-reports/governance-backlog');

// Ensure directories exist
if (!fs.existsSync(path.dirname(statsFile))) fs.mkdirSync(path.dirname(statsFile), { recursive: true });
if (!fs.existsSync(governanceDir)) fs.mkdirSync(governanceDir, { recursive: true });

// 1. Get current git info
let headSha = 'unknown';
try {
    headSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
} catch (e) {}

// 2. Prepare Record
const record = {
    task_id: taskId,
    mode: mode,
    step: step,
    error_class: errorClass,
    head_sha: headSha,
    timestamp: new Date().toISOString(),
    evidence_dir: evidenceDir
};

// 3. Append to stats file
fs.appendFileSync(statsFile, JSON.stringify(record) + '\n');
console.log(`[Error Governance] Recorded error: ${errorClass} for task ${taskId}`);

// 4. Check for Trigger (Last 50 records)
try {
    const content = fs.readFileSync(statsFile, 'utf8');
    const lines = content.trim().split('\n');
    const last50 = lines.slice(-50).map(line => {
        try { return JSON.parse(line); } catch (e) { return null; }
    }).filter(Boolean);

    // Filter by current ERROR_CLASS
    const matches = last50.filter(r => r.error_class === errorClass);
    
    if (matches.length >= 3) {
        // Trigger condition met
        const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const govFilename = `GOV_${today}_${errorClass}.md`;
        const govFilePath = path.join(governanceDir, govFilename);

        if (fs.existsSync(govFilePath)) {
            console.log(`[Error Governance] Governance backlog item already exists for today: ${govFilename}`);
        } else {
            console.log(`[Error Governance] TRIGGER: ${errorClass} occurred ${matches.length} times in last 50 records.`);
            
            // Extract evidence snippet
            let snippet = "No log file provided.";
            if (logFile && fs.existsSync(logFile)) {
                try {
                    const logContent = fs.readFileSync(logFile, 'utf8');
                    // Find FAIL_ROOT_CAUSE_BLOCK
                    const blockMatch = logContent.match(/========== FAIL_ROOT_CAUSE_BLOCK ==========\s*([\s\S]*?)\s*==========================================/);
                    if (blockMatch) {
                        snippet = blockMatch[1].trim();
                    } else {
                        // Fallback: Last 20 lines
                        const logLines = logContent.split('\n');
                        snippet = logLines.slice(-20).join('\n');
                    }
                } catch (e) {
                    snippet = `Error reading log file: ${e.message}`;
                }
            }

            // Generate Markdown Content
            const mdContent = `# Governance Backlog: ${errorClass}

**Date**: ${new Date().toISOString().split('T')[0]}
**Trigger**: ${errorClass} count = ${matches.length} (Threshold: 3) in last 50 records.

## Trigger Condition
*   **Error Class**: ${errorClass}
*   **Window**: Last 50 records
*   **Count**: ${matches.length}

## Associated Tasks (Recent 3)
${matches.slice(-3).reverse().map(m => `*   **${m.task_id}** (${m.mode}) - Step: ${m.step}`).join('\n')}

## Suggested Mechanism Fix
*   **Root Cause Hint**: (Auto-generated placeholder) Please analyze the logs below.
*   **Action Item**:
    1.  Investigate why ${errorClass} is recurring.
    2.  Implement a hard mechanism fix (e.g., Fail-Fast, Auto-Heal, or better detection).
    3.  Update rules/rules/ERROR_TAXONOMY.md if needed.

## Evidence Snippet
\`\`\`text
${snippet}
\`\`\`
`;
            fs.writeFileSync(govFilePath, mdContent);
            console.log(`[Error Governance] Created Governance Backlog: ${govFilePath}`);
        }
    }
} catch (e) {
    console.error(`[Error Governance] Failed to process stats: ${e.message}`);
}
