const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const taskId = '260216_010';
const reportDir = __dirname;
const dodFile = path.join(reportDir, `dod_evidence_${taskId}.txt`);
const gitMetaFile = path.join(reportDir, `git_meta_${taskId}.json`);
const resultFile = path.join(reportDir, `result_${taskId}.json`);

console.log(`Generating Evidence for Task ${taskId}...`);

// 1. Run Tests & Capture Output for DoD
console.log("Running Fail Budget Tests (test_fail_budget.ps1)...");
let testOutput = '';
try {
    // Run from Repo Root (assumed CWD)
    testOutput = execSync('powershell -ExecutionPolicy Bypass -File scripts/test_fail_budget.ps1', { encoding: 'utf8' });
    console.log(testOutput);
} catch (e) {
    console.error("Fail Budget Tests Failed!");
    console.error(e.stdout);
    testOutput = e.stdout || e.message;
    // We exit 1 if tests fail
    process.exit(1);
}

// 2. Write DoD Evidence
const dodContent = `
Task: ${taskId}
Status: DONE
Test Output:
${testOutput}
`;
fs.writeFileSync(dodFile, dodContent);
console.log(`DoD Evidence written to: ${dodFile}`);

// 3. Generate Git Meta
try {
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    const author = execSync('git log -1 --pretty=format:%an', { encoding: 'utf8' }).trim();
    const timestamp = new Date().toISOString();
    
    const gitMeta = {
        commit,
        branch,
        author,
        timestamp,
        repo_root: process.cwd()
    };
    fs.writeFileSync(gitMetaFile, JSON.stringify(gitMeta, null, 2));
    console.log(`Git Meta written to: ${gitMetaFile}`);
} catch (e) {
    console.warn("Failed to generate Git Meta:", e.message);
    fs.writeFileSync(gitMetaFile, JSON.stringify({ error: "git_failed" }));
}

// 4. Generate Result JSON
const resultData = {
    task_id: taskId,
    status: "success",
    tests: "passed",
    timestamp: new Date().toISOString(),
    details: "Fail Budget and Non-Interactive mechanisms implemented and verified."
};
fs.writeFileSync(resultFile, JSON.stringify(resultData, null, 2));
console.log(`Result JSON written to: ${resultFile}`);

// 5. Final Output
console.log("\n[DOD_EVIDENCE_START]");
console.log(`Task ${taskId} Evidence Generation Complete.`);
console.log("See dod_evidence file for details.");
console.log("[DOD_EVIDENCE_END]");

console.log("GATE_LIGHT_EXIT=0");
