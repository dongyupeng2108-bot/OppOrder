import { pathToFileURL } from 'url';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const tests = [
  'schema_contract.test.mjs',
  'mock_determinism.test.mjs',
  'pipeline_e2e_mock.test.mjs',
];

let passed = 0;

console.log('Starting Behavior Tests...');

for (const t of tests) {
  try {
    const testPath = resolve(__dirname, t);
    // Use dynamic import with cache busting to ensure fresh run if needed (though not needed for single run)
    await import(pathToFileURL(testPath).href);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${t}:`, err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

console.log(`[ALL PASS] ${passed}/${tests.length} tests passed`);
