// scripts/write_scope_lock.mjs
// 用法：node scripts/write_scope_lock.mjs --task_id=260305_018 --evidence_dir=... --files="file1,file2"

import { writeFileSync } from 'fs';
import path from 'path';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, v] = a.slice(2).split('='); return [k, v]; })
);

const { task_id, evidence_dir, files } = args;
if (!task_id || !evidence_dir || !files) {
  console.error('Missing required args: --task_id --evidence_dir --files');
  process.exit(1);
}

const allowed = files.split(',').map(f => f.trim()).filter(Boolean);

// 以下文件由 run_task.ps1 自动生成，永远豁免
const AUTO_EXEMPT = [
  'rules/LATEST.json',
  'rules/task-reports/index/error_stats.jsonl',
];

const payload = {
  task_id,
  allowed_files: allowed,
  auto_exempt: AUTO_EXEMPT,
  created_at: new Date().toISOString(),
};

const outPath = path.join(evidence_dir, `scope_lock_${task_id}.json`);
writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
console.log(`[scope_lock] Written: ${outPath}`);
console.log(`[scope_lock] Allowed: ${allowed.join(', ')}`);
