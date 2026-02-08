import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const taskId = process.argv[2];
const reportsDir = process.argv[3];

if (!taskId || !reportsDir) {
    console.error("Usage: node generate_index_temp.mjs <task_id> <reports_dir>");
    process.exit(1);
}

const indexFilename = `deliverables_index_${taskId}.json`;
const notifyFilename = `notify_${taskId}.txt`;
const resultFilename = `result_${taskId}.json`;
const manualFilename = `manual_verification.json`;
const healthcheckFilename = `${taskId}_healthcheck_53122.txt`; // Based on summary

const filesToIndex = [
    notifyFilename,
    resultFilename,
    manualFilename,
    healthcheckFilename
];

// Add other files found in the dir that look related
const allFiles = fs.readdirSync(reportsDir);
const additionalFiles = allFiles.filter(f => 
    f.includes(taskId) && 
    !filesToIndex.includes(f) && 
    f !== indexFilename &&
    !f.endsWith('.envelope.json')
);

const finalFiles = [...filesToIndex, ...additionalFiles];
const entries = [];

for (const file of finalFiles) {
    const p = path.join(reportsDir, file);
    if (fs.existsSync(p)) {
        const content = fs.readFileSync(p);
        const size = content.length;
        const sha256_short = crypto.createHash('sha256').update(content).digest('hex').substring(0, 8);
        entries.push({
            name: file,
            size: size,
            sha256_short: sha256_short
        });
        console.log(`Added ${file}: size=${size}, sha=${sha256_short}`);
    } else {
        console.warn(`Warning: File not found ${file}`);
    }
}

const indexData = {
    files: entries
};

fs.writeFileSync(path.join(reportsDir, indexFilename), JSON.stringify(indexData, null, 2));
console.log(`Generated ${indexFilename}`);
