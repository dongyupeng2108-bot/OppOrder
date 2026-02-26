import { strict as assert } from 'assert';
import { createHash } from 'crypto';

console.log('[TEST] Running mock_determinism...');

async function fetchHash(runId) {
  const res = await fetch(
    `http://localhost:53122/opportunities/rank_v2?provider=mock&limit=3&run_id=${runId}`
  );
  const data = await res.json();
  return createHash('md5')
    .update(JSON.stringify(data))
    .digest('hex');
}

// Use the run_id that was manually verified to work with curl
const runId = 'det_test_1';

async function fetchData(runId) {
  const res = await fetch(
    `http://localhost:53122/opportunities/rank_v2?provider=mock&limit=3&run_id=${runId}`
  );
  return await res.json();
}

const data1 = await fetchData(runId);
const data2 = await fetchData(runId);
const data3 = await fetchData(runId);

const h1 = createHash('md5').update(JSON.stringify(data1)).digest('hex');
const h2 = createHash('md5').update(JSON.stringify(data2)).digest('hex');
const h3 = createHash('md5').update(JSON.stringify(data3)).digest('hex');

if (h1 !== h2 || h2 !== h3) {
    console.error(`Hash mismatch:
    H1: ${h1}
    H2: ${h2}
    H3: ${h3}
    `);
    console.error('Data 1:', JSON.stringify(data1));
    console.error('Data 2:', JSON.stringify(data2));
}

assert(h1 === h2 && h2 === h3, `结果不一致: ${h1} ${h2} ${h3}`);
console.log('[PASS] mock_determinism, hash:', h1);
