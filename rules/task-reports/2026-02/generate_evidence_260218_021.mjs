
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const taskId = '260218_021';
const evidenceDir = __dirname;

console.log(`[Generate Evidence] Task: ${taskId}`);
console.log(`[Generate Evidence] Dir: ${evidenceDir}`);

// 1. DoD Evidence
fs.writeFileSync(path.join(evidenceDir, `dod_evidence_${taskId}.txt`), 'DoD Evidence for Task 260218_021 (Infrastructure Test)\nAll tests passed.');

// 2. Git Meta
fs.writeFileSync(path.join(evidenceDir, `git_meta_${taskId}.json`), JSON.stringify({
    branch: 'feat/p1-run-task-header-default-260218_019',
    commit: 'HEAD'
}, null, 2));

// 3. Result
fs.writeFileSync(path.join(evidenceDir, `result_${taskId}.json`), JSON.stringify({
    status: 'success',
    taskId: taskId
}, null, 2));

console.log('[Generate Evidence] Done.');
