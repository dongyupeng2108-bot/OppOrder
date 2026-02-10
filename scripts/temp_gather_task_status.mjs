import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const TASKS = [
    '260209_008',
    '260209_009',
    '260209_010',
    '260210_001',
    '260210_002',
    '260210_003',
    '260210_005',
    '260210_006',
    '260210_007'
];

const REPORT_DIR = 'rules/task-reports/2026-02';

console.log('| Task ID | Purpose | Branch | PR | Status | Gate Light | Note |');
console.log('|---|---|---|---|---|---|---|');

TASKS.forEach(taskId => {
    let branch = 'UNKNOWN';
    let pr = 'UNKNOWN';
    let status = 'UNKNOWN';
    let gateLight = 'MISSING';
    let purpose = 'UNKNOWN'; // Need to infer or leave blank

    // 1. Check Snippet for Branch/Commit
    const snippetPath = path.join(REPORT_DIR, `trae_report_snippet_${taskId}.txt`);
    let snippetContent = '';
    if (fs.existsSync(snippetPath)) {
        snippetContent = fs.readFileSync(snippetPath, 'utf8');
        const branchMatch = snippetContent.match(/BRANCH:\s*(.+)/);
        if (branchMatch) branch = branchMatch[1].trim();
        
        const gateLightMatch = snippetContent.match(/GATE_LIGHT_EXIT=(\d+)/);
        if (gateLightMatch) {
            gateLight = gateLightMatch[1] === '0' ? 'PASS' : `FAIL(${gateLightMatch[1]})`;
        }
    }

    // 2. Fallback Branch Detection
    if (branch === 'UNKNOWN') {
        try {
            const logs = execSync(`git log --all --grep "${taskId}" -n 1 --pretty=format:"%D"`, { encoding: 'utf8' });
            // origin/feat/xxx, feat/xxx
            const match = logs.match(/feat\/[\w-]+/);
            if (match) branch = match[0];
        } catch (e) {}
    }

    // 3. PR Status
    if (branch !== 'UNKNOWN') {
        try {
            // Remove 'origin/' if present for gh cli
            const cleanBranch = branch.replace('origin/', '');
            const prJson = execSync(`gh pr list --head "${cleanBranch}" --state all --json number,url,state,mergedAt`, { encoding: 'utf8' });
            const prs = JSON.parse(prJson);
            if (prs.length > 0) {
                const p = prs[0];
                pr = `[#${p.number}](${p.url})`;
                status = p.state; // MERGED, OPEN, CLOSED
                if (p.mergedAt) status = 'MERGED';
            }
        } catch (e) {
            // console.error(e.message);
        }
    }

    // 4. Gate Light File Check (Direct file preferred over snippet)
    const gateLogPath = path.join(REPORT_DIR, `gate_light_ci_${taskId}.txt`);
    if (fs.existsSync(gateLogPath)) {
         // Could check content, but snippet exit code is usually enough.
         // If snippet missing but log exists, we might infer.
         if (gateLight === 'MISSING') gateLight = 'LOG_FOUND';
    }

    // 5. Purpose (Try to read title from result/notify)
    const notifyPath = path.join(REPORT_DIR, `notify_${taskId}.txt`);
    if (fs.existsSync(notifyPath)) {
        const content = fs.readFileSync(notifyPath, 'utf8');
        const titleMatch = content.match(/Task.*Title:\s*(.+)/i); // Adjust regex as needed
        if (titleMatch) purpose = titleMatch[1].trim();
    }
    
    // Formatting
    const gateRef = fs.existsSync(gateLogPath) ? `[Log](rules/task-reports/2026-02/gate_light_ci_${taskId}.txt)` : (fs.existsSync(snippetPath) ? `[Snippet](rules/task-reports/2026-02/trae_report_snippet_${taskId}.txt)` : 'None');
    
    console.log(`| ${taskId} | ${purpose} | \`${branch}\` | ${pr} | ${status} | ${gateLight} (${gateRef}) | |`);
});
