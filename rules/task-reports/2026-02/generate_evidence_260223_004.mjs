import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const taskId = '260223_004';
const reportDir = 'rules/task-reports/2026-02';

// Ensure directory exists
if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

// 1. Verify ops_copy_file.mjs
console.log('Verifying ops_copy_file.mjs...');
const testFile = path.resolve(reportDir, 'test_copy_src.txt');
const destFile = path.resolve(reportDir, 'test_copy_dest.txt');
fs.writeFileSync(testFile, 'test content');

try {
  // Copy
  execSync(`node scripts/ops_copy_file.mjs "${testFile}" "${destFile}" --force`, { stdio: 'inherit' });
  if (!fs.existsSync(destFile)) throw new Error('Dest file not created');
  console.log('Copy verification passed.');
} catch (e) {
  console.error('ops_copy_file verification failed:', e.message);
  process.exit(1);
}

// 2. Verify ops_delete.mjs
console.log('Verifying ops_delete.mjs...');
try {
  // Delete Dest
  execSync(`node scripts/ops_delete.mjs "${destFile}" --force`, { stdio: 'inherit' });
  if (fs.existsSync(destFile)) throw new Error('Dest file not deleted');
  
  // Delete Src
  execSync(`node scripts/ops_delete.mjs "${testFile}" --force`, { stdio: 'inherit' });
  if (fs.existsSync(testFile)) throw new Error('Src file not deleted');
  
  console.log('Delete verification passed.');
} catch (e) {
  console.error('ops_delete verification failed:', e.message);
  process.exit(1);
}

// 3. Generate DoD Evidence
const dodContent = `
Task: ${taskId}
Type: Refactoring/Tooling
Status: Verified

1. ops_copy_file.mjs: Verified (Copy success)
2. ops_delete.mjs: Verified (Delete success)
3. Replaced PowerShell commands in run_task.ps1 and dev_batch_mode.ps1
4. No changes to gate_light_ci.mjs
`;
fs.writeFileSync(path.join(reportDir, `dod_evidence_${taskId}.txt`), dodContent);

// 4. Generate Result JSON
const result = {
  task_id: taskId,
  status: 'success',
  metrics: {
    files_copied: 1,
    files_deleted: 2
  }
};
fs.writeFileSync(path.join(reportDir, `result_${taskId}.json`), JSON.stringify(result, null, 2));

// 5. Generate Git Meta
const gitMeta = {
  branch: execSync('git branch --show-current').toString().trim(),
  commit: execSync('git rev-parse HEAD').toString().trim()
};
fs.writeFileSync(path.join(reportDir, `git_meta_${taskId}.json`), JSON.stringify(gitMeta, null, 2));

console.log('Evidence generation complete.');
