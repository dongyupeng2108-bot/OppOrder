import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixtureFile = path.resolve(__dirname, '../data/replay_fixtures.json');
const fixtures = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));

let passed = 0;
let failed = 0;
const failures = [];

for (const fixture of fixtures) {
  const { scan_id, replay_events } = fixture;

  // 检查顶层结构
  if (!scan_id || !Array.isArray(replay_events)) {
    failed++;
    failures.push({ scan_id, reason: 'missing scan_id or replay_events' });
    continue;
  }

  // 检查每个 replay_event
  for (const event of replay_events) {
    const issues = [];
    if (typeof event.opp_id !== 'string') issues.push('opp_id must be string');
    if (typeof event.score !== 'number') issues.push('score must be number');
    if (typeof event.title !== 'string') issues.push('title must be string');

    if (issues.length > 0) {
      failed++;
      failures.push({ scan_id, opp_id: event.opp_id, issues });
    } else {
      passed++;
    }
  }
}

const report = {
  total: passed + failed,
  passed,
  failed,
  pass_rate: `${((passed / (passed + failed)) * 100).toFixed(1)}%`,
  failures: failures.slice(0, 10), // 最多显示前 10 条失败
  gate: 'SOFT', // Soft Gate：不阻断，只记录
  conclusion: failed === 0 ? 'PASS' : 'WARN'
};

const reportDir = path.resolve(__dirname, '../rules/task-reports/2026-02');
if (!fs.existsSync(reportDir)) {
  fs.mkdirSync(reportDir, { recursive: true });
}

const reportPath = path.resolve(reportDir, 'promptfoo_report_260228_010.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

// Soft Gate：无论结果如何，exit 0
process.exit(0);
