import { readFileSync } from 'fs';

const [,, evidencePath] = process.argv;
if (!evidencePath) {
  console.error('[ValidateEvidence] 需要提供evidence.json路径');
  process.exit(1);
}

let evidence;
try {
  evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
} catch (err) {
  console.error(`[ValidateEvidence] 无法读取: ${err.message}`);
  process.exit(1);
}

const errors = [];
if (!evidence.task_id) errors.push('缺少task_id');
if (!evidence.timestamp) errors.push('缺少timestamp');
if (!['PASS','FAIL'].includes(evidence.result)) 
  errors.push(`result无效: ${evidence.result}`);
if (!evidence.healthcheck_root?.status) 
  errors.push('healthcheck_root.status缺失');
if (!evidence.healthcheck_pairs?.pairs) 
  errors.push('healthcheck_pairs.pairs缺失');

if (errors.length > 0) {
  console.error('[ValidateEvidence] FAIL:');
  errors.forEach(e => console.error('  -', e));
  process.exit(1);
}

console.log('[ValidateEvidence] PASS:', evidencePath);
