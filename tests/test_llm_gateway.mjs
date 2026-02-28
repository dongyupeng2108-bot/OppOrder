/**
 * test_llm_gateway.mjs
 * M3-T9: Tests for LLM Provider Gateway (cache + record + schema + fallback)
 *
 * Run: node tests/test_llm_gateway.mjs
 */
import { strict as assert } from 'assert';
import fs from 'fs';
import { callLLM } from '../OppRadar/llm_gateway.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (e) {
        console.error(`  ✗ ${name}: ${e.message}`);
        failed++;
    }
}

console.log('[test_llm_gateway] Starting...\n');

// ─── Test 1: mock mode returns correct structure ───────────────────────────
await test('mock mode returns correct structure', async () => {
    const { result, meta } = await callLLM({ prompt: 'test prompt for mock', mode: 'mock' });

    assert(result.id, 'result.id must exist');
    assert(result.title, 'result.title must exist');
    assert(typeof result.score === 'number', 'result.score must be number');
    assert(result.score >= 0 && result.score <= 1, 'result.score must be in [0,1]');
    assert(result.run_id, 'result.run_id must exist');
    assert(result.created_at, 'result.created_at must exist');

    assert.equal(meta.provider_used, 'mock', 'meta.provider_used must be mock');
    assert(meta.model_used, 'meta.model_used must exist');
    assert(meta.prompt_hash, 'meta.prompt_hash must exist');
    assert.equal(meta.fallback, false, 'meta.fallback must be false');
    assert.equal(meta.cached, false, 'meta.cached must be false');
});

// ─── Test 2: mock mode is deterministic ────────────────────────────────────
await test('mock mode is deterministic (same input → same output)', async () => {
    const prompt = 'determinism check prompt';
    const { result: r1 } = await callLLM({ prompt, mode: 'mock' });
    const { result: r2 } = await callLLM({ prompt, mode: 'mock' });

    assert.equal(r1.id, r2.id, 'id must be identical');
    assert.equal(r1.score, r2.score, 'score must be identical');
});

// ─── Test 3: cache mode - hit after live write ─────────────────────────────
await test('cache mode - hit after live write', async () => {
    const prompt = `cache_test_${Date.now()}`;

    // First call via live: writes to cache
    await callLLM({ prompt, mode: 'live' });

    // Second call via cache: should be a cache hit
    const { result, meta } = await callLLM({ prompt, mode: 'cache' });

    assert.equal(meta.cached, true, 'meta.cached must be true on hit');
    assert(result.id, 'result.id must exist in cached result');
});

// ─── Test 4: cache mode - miss fallbacks to mock ───────────────────────────
await test('cache mode - miss falls back to mock', async () => {
    // Use a unique prompt that has never been cached
    const uniquePrompt = `cache_miss_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const { result, meta } = await callLLM({ prompt: uniquePrompt, mode: 'cache' });

    assert.equal(meta.fallback, true, 'meta.fallback must be true for cache miss');
    assert.equal(meta.provider_used, 'mock', 'meta.provider_used must be mock on cache miss fallback');
    assert(result.id, 'result.id must exist in fallback result');
});

// ─── Test 5: live mode schema validation passes ────────────────────────────
await test('live mode schema validation passes', async () => {
    const { result, meta } = await callLLM({ prompt: 'live schema pass test', mode: 'live' });

    assert.equal(meta.provider_used, 'live', 'meta.provider_used must be live');
    assert.equal(meta.fallback, false, 'meta.fallback must be false for valid schema');
    assert(result.id, 'result.id must exist');
    assert(result.score >= 0 && result.score <= 1, 'score must be in [0,1]');
});

// ─── Test 6: live mode schema fail → fallback + evidence ──────────────────
await test('live mode schema validation fail - fallback + evidence recorded', async () => {
    // Schema that requires a field the live provider does not return
    const badSchema = {
        required: ['id', 'title', 'score', 'run_id', 'created_at', 'nonexistent_field_xyz_abc'],
        properties: {
            score: { type: 'number', minimum: 0, maximum: 1 }
        }
    };

    const recordsDir = 'data/llm_records';
    const filesBefore = fs.existsSync(recordsDir)
        ? fs.readdirSync(recordsDir).filter(f => f.startsWith('schema_fail_'))
        : [];

    const { result, meta } = await callLLM({
        prompt: 'schema fail test unique',
        mode: 'live',
        _schema: badSchema
    });

    assert.equal(meta.fallback, true, 'meta.fallback must be true on schema fail');
    assert.equal(meta.provider_used, 'mock', 'meta.provider_used must be mock on schema fail fallback');

    // Verify evidence file was written
    const filesAfter = fs.readdirSync(recordsDir).filter(f => f.startsWith('schema_fail_'));
    assert(filesAfter.length > filesBefore.length, 'Schema fail evidence file must be written');

    // Verify evidence content
    const newFile = filesAfter.filter(f => !filesBefore.includes(f))[0];
    const evidence = JSON.parse(fs.readFileSync(`${recordsDir}/${newFile}`, 'utf8'));
    assert(evidence.errors && evidence.errors.length > 0, 'Evidence must contain errors');
    assert(evidence.prompt_hash, 'Evidence must contain prompt_hash');
});

// ─── Test 7: meta includes all required fields ─────────────────────────────
await test('meta includes provider_used/model_used/prompt_hash/fallback', async () => {
    const { meta } = await callLLM({ prompt: 'meta fields test', mode: 'mock' });

    assert('provider_used' in meta, 'meta must have provider_used');
    assert('model_used' in meta, 'meta must have model_used');
    assert('prompt_hash' in meta, 'meta must have prompt_hash');
    assert('fallback' in meta, 'meta must have fallback');
    assert('cached' in meta, 'meta must have cached');
});

// ─── Test 8: prompt_hash is consistent ────────────────────────────────────
await test('prompt_hash is consistent for same prompt', async () => {
    const prompt = 'hash consistency test';
    const { meta: m1 } = await callLLM({ prompt, mode: 'mock' });
    const { meta: m2 } = await callLLM({ prompt, mode: 'mock' });

    assert.equal(m1.prompt_hash, m2.prompt_hash, 'prompt_hash must be identical for same prompt');
});

// ─── Summary ───────────────────────────────────────────────────────────────
console.log(`\n[test_llm_gateway] Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
