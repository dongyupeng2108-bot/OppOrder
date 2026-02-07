
const fs = require('fs');
const path = require('path');

const taskId = '260206_019';
const notifyFile = path.join('rules', 'task-reports', '2026-02', `notify_${taskId}.txt`);
const outputFile = path.join('rules', 'task-reports', '2026-02', `${taskId}_notify_smoke.txt`);

try {
    if (!fs.existsSync(notifyFile)) {
        throw new Error(`Notify file not found: ${notifyFile}`);
    }

    const content = fs.readFileSync(notifyFile, 'utf8');
    const failures = [];

    // Patterns to forbid
    const forbiddenPatterns = [
        '"+ status +"',
        '"+ summary +"',
        '"+ task_id +"',
        '${status}',
        '${summary}',
        '${task_id}'
    ];

    // Check for specific patterns
    for (const pattern of forbiddenPatterns) {
        if (content.includes(pattern)) {
            failures.push(`Found forbidden pattern: ${pattern}`);
        }
    }

    // Check for generic concatenation artifacts
    if (content.match(/"\s*\+\s*"/)) {
         failures.push('Found generic concatenation artifact: " + "');
    }
    
    // Check for unreplaced variable artifacts (simplified check for " + var + ")
    if (content.match(/"\s*\+\s*[a-zA-Z_]+\s*\+\s*"/)) {
         failures.push('Found variable concatenation artifact: " + var + "');
    }

    let result = '';
    if (failures.length > 0) {
        result = 'FAIL\n' + failures.join('\n');
        console.error('Notify Smoke Test FAILED');
        console.error(result);
    } else {
        result = 'PASS\nNo forbidden patterns found.';
        console.log('Notify Smoke Test PASS');
    }

    fs.writeFileSync(outputFile, result);

} catch (err) {
    console.error('Error running smoke test:', err);
    fs.writeFileSync(outputFile, 'FAIL\nError: ' + err.message);
    process.exit(1);
}
