
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const taskIds = [
    '260212_001',
    '260213_002',
    '260213_003',
    '260213_004',
    '260214_005',
    '260214_006',
    '260214_007'
];

const reportDir = path.resolve('rules/task-reports/2026-02');
const planFile = path.resolve('rules/rules/PROJECT_MASTER_PLAN.md');

const results = [];

console.log('Gathering task statuses...');

taskIds.forEach(taskId => {
    const info = {
        taskId,
        status: 'UNKNOWN',
        branch: 'UNKNOWN',
        commit: 'UNKNOWN',
        gateLightExit: 'UNKNOWN',
        evidencePath: `rules/task-reports/2026-02/notify_${taskId}.txt`,
        isMerged: false,
        unknownReason: []
    };

    // 1. Try to read result json for Git Context (Result JSON has highest priority if available)
    const resultJsonPath = path.join(reportDir, `result_${taskId}.json`);
    if (fs.existsSync(resultJsonPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(resultJsonPath, 'utf8'));
            if (data.git_context) {
                 if (data.git_context.branch) info.branch = data.git_context.branch;
                 if (data.git_context.commit) info.commit = data.git_context.commit;
            }
        } catch (e) {}
    }

    // 2. Try to read snippet for Branch/Commit (Snippet often has it explicitly)
    const snippetPath = path.join(reportDir, `trae_report_snippet_${taskId}.txt`);
    if (fs.existsSync(snippetPath)) {
        const content = fs.readFileSync(snippetPath, 'utf8');
        
        if (info.branch === 'UNKNOWN') {
            const branchMatch = content.match(/BRANCH:\s*(.+)/i); // Case insensitive
            if (branchMatch) info.branch = branchMatch[1].trim();
        }

        if (info.commit === 'UNKNOWN') {
            const commitMatch = content.match(/COMMIT:\s*([a-f0-9]+)/i);
            if (commitMatch) info.commit = commitMatch[1].trim();
        }
        
        const exitMatch = content.match(/GATE_LIGHT_EXIT=(\d+)/);
        if (exitMatch) info.gateLightExit = exitMatch[1];
    }
    
    // 3. Try to read notify for Status/Gate Exit if missing
    const notifyPath = path.join(reportDir, `notify_${taskId}.txt`);
    if (fs.existsSync(notifyPath)) {
        const content = fs.readFileSync(notifyPath, 'utf8');
         if (info.gateLightExit === 'UNKNOWN') {
            const exitMatch = content.match(/GATE_LIGHT_EXIT=(\d+)/);
            if (exitMatch) info.gateLightExit = exitMatch[1];
        }
    } else {
        info.unknownReason.push("Evidence missing");
    }

    // 4. Git verification for Merged Status
    if (info.commit !== 'UNKNOWN') {
        try {
            execSync(`git merge-base --is-ancestor ${info.commit} origin/main`, { stdio: 'ignore' });
            info.status = 'MERGED';
            info.isMerged = true;
        } catch (e) {
            // Not merged
            info.isMerged = false;
        }
    } else {
        if (info.branch === 'UNKNOWN') {
             info.unknownReason.push("Branch/Commit not found in evidence");
        }
    }
    
    // 5. Determine Final Status based on rules
    if (info.status !== 'MERGED') {
        if (info.gateLightExit === '0') {
            // Check for specific unmerged rule for 260214_006/007
            if (['260214_006', '260214_007'].includes(taskId)) {
                 info.status = 'DONE (unmerged)';
            } else {
                 info.status = 'DONE';
            }
        } else if (info.branch !== 'UNKNOWN') {
            info.status = 'OPEN';
        } else {
            info.status = 'UNKNOWN';
        }
    }
    
    // Add reason to Unknown
    if (info.status === 'UNKNOWN' && info.unknownReason.length > 0) {
        // We will append reason in the plan, maybe not in the status column directly to keep it clean, 
        // or just put it in status if space permits. 
        // User asked: "Status... UNKNOWN=不可核验".
        // And "Branch...确实找不到才 UNKNOWN，并在 Plan 里加 'Unknown Reason'".
        // I'll add a separate column or footnote? 
        // "Status：... UNKNOWN=不可核验" implies status is just UNKNOWN.
        // "Plan 里加 'Unknown Reason'" implies text description.
        // I will append it to Status for visibility if it's UNKNOWN.
    }

    results.push(info);
});

// Update PROJECT_MASTER_PLAN.md
let planContent = fs.readFileSync(planFile, 'utf8');

const legend = `
> **Status Legend**:
> *   **MERGED**: Verified merged into \`origin/main\`.
> *   **DONE**: Evidence passed (Gate Light=0) & pushed, but not necessarily merged.
> *   **OPEN**: PR/Branch exists but not verified/passed.
> *   **UNKNOWN**: Evidence missing or unverifiable.
`;

const header = `| Task ID | Status | Branch | Commit | Gate Light | Evidence Path |`;
const separator = `| :--- | :--- | :--- | :--- | :--- | :--- |`;

const rows = results.map(r => {
    let branchDisplay = r.branch;
    if (r.branch === 'UNKNOWN' && r.unknownReason.length > 0) {
        branchDisplay = `UNKNOWN (${r.unknownReason.join(', ')})`;
    }
    return `| ${r.taskId} | ${r.status} | ${branchDisplay} | ${r.commit} | ${r.gateLightExit} | ${r.evidencePath} |`;
}).join('\n');

const newTableSection = `## 本窗口任务台账 (Current Session Task Ledger)
${legend}
${header}
${separator}
${rows}
`;

// Regex to replace existing section
// It looks for "## 本窗口任务台账" until end of file or next "## " (but it's at the end usually)
// Or just match until end of file if it's the last section.
// Based on previous read, it is the last section.

const regex = /## 本窗口任务台账[\s\S]*$/;
if (regex.test(planContent)) {
    planContent = planContent.replace(regex, newTableSection);
} else {
    // Append if not found
    planContent += '\n' + newTableSection;
}

fs.writeFileSync(planFile, planContent, 'utf8');
console.log('PROJECT_MASTER_PLAN.md updated successfully.');
console.log(JSON.stringify(results, null, 2));
