import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const getArg = (name) => {
    const flag = `--${name}`;
    const index = args.indexOf(flag);
    if (index !== -1 && index + 1 < args.length) return args[index + 1];
    const inline = args.find(a => a.startsWith(`${flag}=`));
    if (inline) return inline.split('=').slice(1).join('=');
    return null;
};

const norm = (v) => (v ?? '').toString().trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

const taskId = norm(getArg('task_id'));
if (!taskId) {
    console.error('Usage: node scripts/escalation_report.mjs --task_id <id> [--out_dir <dir>] [--error_class <cls>] [--fail_reason <reason>] [--log_path <path>] [--fix_actions <json>] [--arg_task_id <id>] [--branch_task_id <id>] [--latest_task_id <id>] [--pr_task_id_detected <id>]');
    process.exit(1);
}

const outDir = norm(getArg('out_dir')) || `rules/task-reports/${new Date().toISOString().slice(0, 7)}`;
const errorClass = norm(getArg('error_class')) || 'UNKNOWN_ERROR';
const failReason = norm(getArg('fail_reason')) || 'UNKNOWN_FAIL_REASON';
const argTaskId = norm(getArg('arg_task_id')) || taskId;
const branchTaskId = norm(getArg('branch_task_id')) || 'UNKNOWN';
const latestTaskId = norm(getArg('latest_task_id')) || 'UNKNOWN';
const prTaskIdDetected = norm(getArg('pr_task_id_detected')) || 'UNKNOWN';
const logPath = norm(getArg('log_path'));
const fixActionsRaw = getArg('fix_actions');

let fixActions = [];
if (fixActionsRaw) {
    try {
        const parsed = JSON.parse(fixActionsRaw);
        if (Array.isArray(parsed)) fixActions = parsed;
    } catch (e) {
        fixActions = [];
    }
}
fixActions = fixActions.filter(v => typeof v === 'string' && v.trim()).slice(0, 5);

let tailLines = [];
if (logPath && fs.existsSync(logPath)) {
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n');
    let lastIndex = -1;
    lines.forEach((line, idx) => {
        if (line.includes('FAIL_ROOT_CAUSE_BLOCK')) lastIndex = idx;
    });
    const start = lastIndex >= 0 ? lastIndex : Math.max(lines.length - 40, 0);
    const slice = lines.slice(start);
    tailLines = slice.slice(-40);
} else {
    tailLines = ['N/A'];
}

const reportLines = [
    '# Escalation Report',
    '',
    `TASK_ID: ${taskId}`,
    `ERROR_CLASS: ${errorClass}`,
    `FAIL_REASON: ${failReason}`,
    `ARG_TASK_ID: ${argTaskId}`,
    `BRANCH_TASK_ID: ${branchTaskId}`,
    `LATEST_TASK_ID: ${latestTaskId}`,
    `PR_TASK_ID_DETECTED: ${prTaskIdDetected || 'UNKNOWN'}`,
    '',
    'RECENT_FAIL_ROOT_CAUSE_BLOCK (TAIL 40):',
    '```',
    ...tailLines,
    '```',
    '',
    'ATTEMPTED_FIX_ACTIONS:',
    ...(fixActions.length ? fixActions.map((a, i) => `${i + 1}. ${a}`) : ['(None)']),
    '',
    'QUESTION:',
    'A) 保持当前 task_id，人工定位根因并修复后再由人触发重跑',
    'B) 暂停当前 task_id，由人决定是否创建全新 task_id 后重新规划'
];

const reportContent = reportLines.join('\n') + '\n';

if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

const reportPath = path.join(outDir, `escalation_${taskId}.md`);
fs.writeFileSync(reportPath, reportContent);
process.stdout.write(reportPath);
