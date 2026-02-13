const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const baseDir = path.join(__dirname);
const taskId = '260213_003';

const files = [
    `notify_${taskId}.txt`,
    `result_${taskId}.json`,
    `${taskId}_healthcheck_53122_root.txt`,
    `${taskId}_healthcheck_53122_pairs.txt`,
    `${taskId}_test_log.txt`,
    `trae_report_snippet_${taskId}.txt`,
    `ci_parity_${taskId}.json`,
    `ui_copy_details_${taskId}.json`
];

const index = {
    task_id: taskId,
    files: [],
    generated_at: new Date().toISOString()
};

files.forEach(file => {
    const filePath = path.join(baseDir, file);
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath);
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        const size = fs.statSync(filePath).size;
        index.files.push({
            path: file,
            sha256: hash,
            sha256_short: hash.substring(0, 8),
            size: size
        });
    } else {
        console.warn(`File not found: ${file}`);
    }
});

const indexContent = JSON.stringify(index, null, 2);
fs.writeFileSync(path.join(baseDir, `deliverables_index_${taskId}.json`), indexContent);

// Generate Envelope
const indexHash = crypto.createHash('sha256').update(indexContent).digest('hex');
const envelope = {
    task_id: taskId,
    deliverables_index_hash: indexHash,
    signature: 'simulated_signature_for_mock_environment'
};

fs.writeFileSync(path.join(baseDir, `envelope_${taskId}.json`), JSON.stringify(envelope, null, 2));

console.log('Index and Envelope generated successfully.');
