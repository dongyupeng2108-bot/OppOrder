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
// result_*.json validation
if (!evidence.status) errors.push('status缺失');
if (evidence.status !== 'DONE') errors.push(`status无效: ${evidence.status}`);

if (!evidence.dod_evidence) errors.push('dod_evidence缺失');
else {
    if (typeof evidence.dod_evidence.gate_light_exit === 'undefined') 
        errors.push('dod_evidence.gate_light_exit缺失');
    if (!Array.isArray(evidence.dod_evidence.healthcheck)) 
        errors.push('dod_evidence.healthcheck不是数组');
}

if (errors.length > 0) {
  console.error('[ValidateEvidence] FAIL:');
  errors.forEach(e => console.error('  -', e));
  process.exit(1);
}

console.log('[ValidateEvidence] PASS:', evidencePath);
