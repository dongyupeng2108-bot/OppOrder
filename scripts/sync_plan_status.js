const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PLAN_FILE = path.join(__dirname, '../rules/rules/PROJECT_MASTER_PLAN.md');
const LOCKS_DIR = path.join(__dirname, '../rules/task-reports/locks');
const RUNS_DIR = path.join(__dirname, '../rules/task-reports/runs');

// 1. System Identity
const SYSTEM_IDENTITY = `## 1. System Identity
*   **System Type**: Engineering-Centric System (Fact-Driven, CI-Authoritative)
*   **Governance Model**: Gate Light v3.9 (Fail-Fast, Immutable Integrate)
*   **Status Source**: GitHub Actions CI + Immutable Lock Files (Single Source of Truth)
*   **Documentation Role**: System Mirror (Auto-Generated Snapshot), NOT Workflow Driver`;

// Helper: Get Active Branches
function getActiveBranches() {
    try {
        const cmd = `git branch -r`;
        const output = execSync(cmd, { encoding: 'utf8' });
        const branches = output.split('\n')
            .map(b => b.trim())
            .filter(b => b && !b.includes('HEAD') && b.startsWith('origin/'));
        
        if (branches.length === 0) return "*   *No active remote branches detected.*";
        return branches.map(b => `*   \`${b}\``).join('\n');
    } catch (e) {
        return `*   *Error fetching branches: ${e.message}*`;
    }
}

// Helper: Get PR State Snapshot
function getPRSnapshot() {
    try {
        const cmd = `gh pr list --state all --json number,title,state,mergedAt,url,headRefName --limit 50`;
        const output = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        
        if (!output || output.trim() === '') return "*   *No PRs found or GH CLI not authenticated.*";

        let prs;
        try {
            prs = JSON.parse(output);
        } catch (parseError) {
             return `*   *Error parsing GH CLI output: ${parseError.message}*`;
        }
        
        if (prs.length === 0) return "*   *No PRs found.*";
        
        let table = `| PR # | State | Branch | Title | Merged At |\n| :--- | :--- | :--- | :--- | :--- |\n`;
        
        prs.forEach(pr => {
            const mergedAt = pr.mergedAt ? pr.mergedAt.substring(0, 10) : '-';
            // Escape pipes in title
            const title = (pr.title || '').replace(/\|/g, '-');
            table += `| [${pr.number}](${pr.url}) | **${pr.state}** | \`${pr.headRefName}\` | ${title} | ${mergedAt} |\n`;
        });
        
        return table;
    } catch (e) {
        return `*   *Error fetching PRs (gh cli required): ${e.message}*`;
    }
}

// Helper: Get Gate / Lock Snapshot
function getLockSnapshot() {
    if (!fs.existsSync(LOCKS_DIR)) return "*   *No locks directory found.*";
    
    let files;
    try {
        files = fs.readdirSync(LOCKS_DIR).filter(f => f.endsWith('.lock.json'));
    } catch (e) {
        return `*   *Error reading locks directory: ${e.message}*`;
    }

    if (files.length === 0) return "*   *No locks found.*";
    
    files.sort();
    
    let table = `| Task ID | Lock File | Locked At | Run Dir |\n| :--- | :--- | :--- | :--- |\n`;
    
    files.forEach(file => {
        const taskId = file.replace('.lock.json', '');
        try {
            const content = JSON.parse(fs.readFileSync(path.join(LOCKS_DIR, file), 'utf8'));
            const lockedAt = content.locked_at || '-';
            const runDir = content.run_dir ? path.basename(content.run_dir) : '-';
            // Use relative path for link
            table += `| \`${taskId}\` | [Link](file:///rules/task-reports/locks/${file}) | ${lockedAt} | \`${runDir}\` |\n`;
        } catch (e) {
             table += `| \`${taskId}\` | *Error Reading File* | - | - |\n`;
        }
    });
    
    return table;
}

// Helper: Get Evidence Index
function getEvidenceIndex() {
    if (!fs.existsSync(RUNS_DIR)) return "*   *No runs directory found.*";
    
    let taskDirs;
    try {
        taskDirs = fs.readdirSync(RUNS_DIR).filter(f => {
            try {
                return fs.statSync(path.join(RUNS_DIR, f)).isDirectory();
            } catch { return false; }
        });
    } catch (e) {
        return `*   *Error reading runs directory: ${e.message}*`;
    }

    if (taskDirs.length === 0) return "*   *No evidence runs found.*";
    
    taskDirs.sort();
    
    let list = "";
    taskDirs.forEach(taskId => {
        const taskPath = path.join(RUNS_DIR, taskId);
        try {
            const runs = fs.readdirSync(taskPath).filter(f => {
                try {
                    return fs.statSync(path.join(taskPath, f)).isDirectory();
                } catch { return false; }
            });
            
            list += `*   **${taskId}**\n`;
            runs.forEach(runId => {
                 list += `    *   \`${runId}\` (Archived)\n`;
            });
        } catch (e) {
            list += `*   **${taskId}** (Error reading runs)\n`;
        }
    });
    
    return list;
}

// Helper: Architecture Version
function getArchVersion() {
    return `*   **Governance Version**: v3.9 (Gate Light)
*   **Snapshot Engine**: sync_plan_status.js v1.0
*   **Last Full Sync**: ${new Date().toISOString()}`;
}


function generateSnapshot() {
    console.log("Generating System Snapshot...");
    
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    
    const content = `# OppRadar Engineering System Snapshot
> **Note**: This file is an **auto-generated system snapshot**. 
> **Do NOT edit manually.** All status fields are derived from the Engineering System (Git/GitHub/CI/Locks).
> **Last Synced**: ${timestamp}

${SYSTEM_IDENTITY}

## 2. Active Branches Snapshot (Auto-Generated)
${getActiveBranches()}

## 3. PR State Snapshot (Auto-Generated)
${getPRSnapshot()}

## 4. Gate / Lock Snapshot (Auto-Generated)
${getLockSnapshot()}

## 5. Evidence Index
${getEvidenceIndex()}

## 6. Architecture Version
${getArchVersion()}
`;

    fs.writeFileSync(PLAN_FILE, content, 'utf8');
    console.log(`Snapshot generated successfully at ${PLAN_FILE}`);
}

generateSnapshot();
