const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'rules', 'task-reports', '2026-02');
const ENVELOPES_DIRS = [
    path.join(ROOT, 'rules', 'reports', 'envelopes'),
    path.join(ROOT, 'rules', 'task-reports', 'envelopes')
];

function findEnvelope(taskId) {
    for (const dir of ENVELOPES_DIRS) {
        if (!fs.existsSync(dir)) continue;
        const p = path.join(dir, `${taskId}.envelope.json`);
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function main() {
    if (!fs.existsSync(REPORTS_DIR)) {
        console.error(`Reports dir not found: ${REPORTS_DIR}`);
        process.exit(1);
    }
    
    const files = fs.readdirSync(REPORTS_DIR);
    const results = files.filter(f => f.startsWith('result_') && f.endsWith('.json'));
    const tasks = [];

    for (const resFile of results) {
        const taskId = resFile.replace('result_', '').replace('.json', '');
        const resPath = path.join(REPORTS_DIR, resFile);
        
        let resultData = {};
        try {
            resultData = JSON.parse(fs.readFileSync(resPath, 'utf8'));
        } catch (e) {
            console.error(`Failed to parse ${resFile}: ${e.message}`);
            continue;
        }

        const notifyPath = path.join(REPORTS_DIR, `notify_${taskId}.txt`);
        const indexPath = path.join(REPORTS_DIR, `deliverables_index_${taskId}.json`);
        const envelopePath = findEnvelope(taskId);

        const hasNotify = fs.existsSync(notifyPath);
        const hasIndex = fs.existsSync(indexPath);
        const hasEnvelope = !!envelopePath;

        let prLink = 'N/A';
        if (hasNotify) {
            try {
                const notifyContent = fs.readFileSync(notifyPath, 'utf8');
                const match = notifyContent.match(/PR: (http.*)/);
                if (match) prLink = match[1];
            } catch (e) {}
        }

        tasks.push({
            taskId,
            status: resultData.status || 'UNKNOWN',
            hasEvidence: hasNotify && hasIndex && hasEnvelope,
            evidence: {
                result: resFile,
                notify: hasNotify ? `notify_${taskId}.txt` : null,
                index: hasIndex ? `deliverables_index_${taskId}.json` : null,
                envelope: envelopePath ? path.relative(ROOT, envelopePath) : null
            },
            prLink
        });
    }

    // Sort by taskId descending
    tasks.sort((a, b) => b.taskId.localeCompare(a.taskId));

    // Generate Markdown
    let md = '# Task Reports Index\n\n';
    md += '| Task ID | Status | PR | Evidence | Valid |\n';
    md += '|---------|--------|----|----------|-------|\n';

    for (const t of tasks) {
        const evidenceStr = [
            t.evidence.result ? '[Result]' : '',
            t.evidence.notify ? '[Notify]' : '',
            t.evidence.index ? '[Index]' : '',
            t.evidence.envelope ? '[Env]' : ''
        ].join(' ');
        
        md += `| ${t.taskId} | ${t.status} | ${t.prLink !== 'N/A' ? `[Link](${t.prLink})` : 'N/A'} | ${evidenceStr} | ${t.hasEvidence ? '✅' : '❌'} |\n`;
    }

    fs.writeFileSync(path.join(ROOT, 'rules', 'TASK_REPORTS_INDEX.md'), md);
    console.log('Generated rules/TASK_REPORTS_INDEX.md');

    // Update LATEST.json
    const latestValid = tasks.find(t => t.hasEvidence);
    if (latestValid) {
        const latestData = {
            task_id: latestValid.taskId,
            result_dir: "rules/task-reports/2026-02",
            timestamp: new Date().toISOString()
        };
        fs.writeFileSync(path.join(ROOT, 'rules', 'LATEST.json'), JSON.stringify(latestData, null, 2));
        console.log(`Updated rules/LATEST.json to ${latestValid.taskId}`);
    } else {
        console.warn('No valid task found with full evidence!');
    }
}

main();
