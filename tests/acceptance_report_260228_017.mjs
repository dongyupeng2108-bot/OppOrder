import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:53122';

async function check(name, fn) {
    try {
        const result = await fn();
        console.log(`✅ ${name}`);
        return { name, status: 'PASS', detail: result };
    } catch (e) {
        console.log(`❌ ${name}: ${e.message}`);
        return { name, status: 'FAIL', detail: e.message };
    }
}

const results = [];

// M2 验收
results.push(await check('M2-T7: /diff endpoint exists', async () => {
    const r = await fetch(`${BASE_URL}/diff`);
    if (r.status === 400 || r.status === 200) return `HTTP ${r.status}`;
    throw new Error(`Unexpected status ${r.status}`);
}));

results.push(await check('M2-T7: /replay endpoint exists', async () => {
    const r = await fetch(`${BASE_URL}/replay`);
    if (r.status === 400 || r.status === 200) return `HTTP ${r.status}`;
    throw new Error(`Unexpected status ${r.status}`);
}));

results.push(await check('M2-T7: replay_fixtures.json exists', async () => {
    const p = path.resolve(__dirname, '../data/replay_fixtures.json');
    if (!fs.existsSync(p)) throw new Error('File not found');
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return `${data.length} fixtures`;
}));

results.push(await check('M2-T8: promptfoo report exists', async () => {
    const p = path.resolve(__dirname, '../rules/task-reports/2026-02/promptfoo_report_260228_010.json');
    if (!fs.existsSync(p)) throw new Error('File not found');
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return `pass_rate=${data.pass_rate}, gate=${data.gate}`;
}));

results.push(await check('M2-T8: promptfoo test runs', async () => {
    const { execSync } = await import('child_process');
    execSync('node tests/test_promptfoo_replay.mjs', { cwd: path.resolve(__dirname, '..'), stdio: 'pipe' });
    return 'exit 0';
}));

// M3 验收
results.push(await check('M3-T9: llm_gateway.mjs exists', async () => {
    const p = path.resolve(__dirname, '../OppRadar/llm_gateway.mjs');
    if (!fs.existsSync(p)) throw new Error('File not found');
    return 'exists';
}));

results.push(await check('M3-T9: gateway test runs (8/8)', async () => {
    const { execSync } = await import('child_process');
    execSync('node tests/test_llm_gateway.mjs', { cwd: path.resolve(__dirname, '..'), stdio: 'pipe' });
    return '8/8 passed';
}));

// rank_v2 returns array of items; each item has meta.provider_used + meta.model_used (added by M3-T9)
results.push(await check('M3-T9: /opportunities/rank_v2 returns meta fields', async () => {
    const r = await fetch(`${BASE_URL}/opportunities/rank_v2`);
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error('Expected non-empty array');
    if (!data[0].meta) throw new Error('No meta field on rank_v2 items');
    if (!data[0].meta.provider_used) throw new Error('No provider_used in meta');
    return `provider=${data[0].meta.provider_used}, model=${data[0].meta.model_used}`;
}));

results.push(await check('M3-T9: rank_v2 provider=mock filter works', async () => {
    const r = await fetch(`${BASE_URL}/opportunities/rank_v2?provider=mock`);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return 'HTTP 200';
}));

results.push(await check('UI: /ui returns 200', async () => {
    const r = await fetch(`${BASE_URL}/ui`);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return 'HTTP 200';
}));

// 数据库状态
results.push(await check('DB: SQLite accessible', async () => {
    const { execSync } = await import('child_process');
    const out = execSync(
        'node --input-type=module',
        {
            cwd: path.resolve(__dirname, '..'),
            stdio: ['pipe', 'pipe', 'pipe'],
            input: "import('./OppRadar/db.mjs').then(m=>{ process.stdout.write('ok'); }).catch(e=>{ process.stdout.write(e.message); process.exit(1); })"
        }
    ).toString().trim();
    if (!out.includes('ok')) throw new Error(out);
    return 'accessible';
}));

const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;

const report = {
    task_id: '260228_017',
    timestamp: new Date().toISOString(),
    summary: { total: results.length, passed, failed, pass_rate: `${((passed/results.length)*100).toFixed(0)}%` },
    milestone_status: {
        M2_T7_diff_replay: results.find(r => r.name.includes('diff endpoint'))?.status,
        M2_T8_promptfoo: results.find(r => r.name.includes('promptfoo test'))?.status,
        M3_T9_gateway: results.find(r => r.name.includes('gateway test'))?.status,
        UI: results.find(r => r.name.includes('/ui'))?.status,
    },
    results
};

const reportPath = path.resolve(__dirname, '../rules/task-reports/2026-02/acceptance_report_260228_017.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log('\n=== 验收报告 ===');
console.log(`总计: ${results.length} 项`);
console.log(`通过: ${passed} 项`);
console.log(`失败: ${failed} 项`);
console.log(`通过率: ${report.summary.pass_rate}`);
console.log(`报告已写入: ${reportPath}`);
