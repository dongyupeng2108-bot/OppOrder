import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const taskId = '260225_003';
const latchRoot = path.join(REPO_ROOT, '.tmp', 'hardstop_latch_regress');
const latchFile = path.join(latchRoot, '2026-02', `.hardstop_latch_${taskId}.json`);

// Ensure cleanup
if (fs.existsSync(latchRoot)) {
  fs.rmSync(latchRoot, { recursive: true, force: true });
}

console.log('>>> [Regression] Starting Static Analysis...');

const filesToCheck = [
  'scripts/run_task.ps1',
  'scripts/safe_commit.ps1',
  'scripts/safe_push.ps1'
];

let staticPass = true;
for (const file of filesToCheck) {
  const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  if (!content.includes('ops_hardstop_latch.mjs') || !content.includes('--action check')) {
    console.error(`[FAIL] Static Check: ${file} missing ops_hardstop_latch.mjs check call.`);
    staticPass = false;
  } else {
    console.log(`[PASS] Static Check: ${file} contains latch check.`);
  }
}

if (!staticPass) {
  console.error('>>> [Regression] Static Analysis FAILED.');
  process.exit(1);
}

console.log('>>> [Regression] Starting Behavioral Analysis (Dev Mode)...');

// Setup Latch
fs.mkdirSync(path.dirname(latchFile), { recursive: true });
fs.writeFileSync(latchFile, JSON.stringify({
  hard_stop: 1,
  reason: 'REGRESSION_TEST_SIMULATION',
  timestamp: new Date().toISOString()
}, null, 2));

console.log(`[Setup] Created latch file at: ${latchFile}`);

const env = { ...process.env, HARDSTOP_LATCH_ROOT: latchRoot };
let behaviorPass = true;

const commands = [
  {
    name: 'run_task',
    cmd: `powershell -ExecutionPolicy Bypass -File scripts/run_task.ps1 -TaskId ${taskId} -Mode Dev -Header "Regression Test" -NonInteractive`,
    expectExit: 33
  },
  {
    name: 'safe_commit',
    cmd: `powershell -ExecutionPolicy Bypass -File scripts/safe_commit.ps1 -Message "Regression Test" -Mode Dev`,
    expectExit: 33
  },
  {
    name: 'safe_push',
    cmd: `powershell -ExecutionPolicy Bypass -File scripts/safe_push.ps1 -Mode Dev`,
    expectExit: 33
  }
];

for (const { name, cmd, expectExit } of commands) {
  console.log(`[Test] Running ${name}...`);
  try {
    execSync(cmd, { cwd: REPO_ROOT, env, stdio: 'pipe' });
    console.error(`[FAIL] ${name} did not exit with code ${expectExit} (it succeeded/exited 0).`);
    behaviorPass = false;
  } catch (error) {
    if (error.status === expectExit) {
      console.log(`[PASS] ${name} exited with code ${expectExit} as expected.`);
      const output = error.stdout.toString() + error.stderr.toString();
      if (output.includes('HARD_STOP=1') && output.includes('NEXT_ACTION=STOP_AND_REPORT')) {
        console.log(`[PASS] ${name} output contained 3-line block.`);
      } else {
        console.error(`[FAIL] ${name} output missing 3-line block.`);
        console.log('Output was:', output);
        behaviorPass = false;
      }
    } else {
      console.error(`[FAIL] ${name} exited with code ${error.status}, expected ${expectExit}.`);
      console.log('Output was:', error.stdout.toString() + error.stderr.toString());
      behaviorPass = false;
    }
  }
}

// Cleanup
fs.rmSync(latchRoot, { recursive: true, force: true });

if (behaviorPass) {
  console.log('>>> [Regression] All tests PASSED.');
  process.exit(0);
} else {
  console.error('>>> [Regression] Behavioral Analysis FAILED.');
  process.exit(1);
}
