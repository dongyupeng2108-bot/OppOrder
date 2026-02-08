
import { DB } from '../OppRadar/db.mjs';
import assert from 'assert';

async function main() {
    console.log('[Smoke] Starting News Stub DB Smoke Test (Task 260208_022)...');

    const T = 'test_topic_' + Date.now();
    const H = 'test_hash_' + Date.now();
    const ts = Date.now();

    // 1. Insert (T, H, gdelt) => Should succeed
    console.log('[Smoke] 1. Inserting (gdelt)...');
    const res1 = await DB.appendNews({
        topic_key: T,
        content_hash: H,
        provider: 'gdelt',
        title: 'Test Title',
        url: 'http://example.com',
        ts: ts,
        published_at: new Date().toISOString()
    });
    console.log('Result 1:', res1);
    assert.strictEqual(res1.inserted, true, 'First insert (gdelt) should succeed');

    // 2. Insert (T, H, gdelt) => Should be deduped (inserted=false)
    console.log('[Smoke] 2. Inserting duplicate (gdelt)...');
    const res2 = await DB.appendNews({
        topic_key: T,
        content_hash: H,
        provider: 'gdelt',
        title: 'Test Title',
        url: 'http://example.com',
        ts: ts,
        published_at: new Date().toISOString()
    });
    console.log('Result 2:', res2);
    assert.strictEqual(res2.inserted, false, 'Duplicate insert (gdelt) should be ignored');

    // 3. Insert (T, H, local) => Should succeed (different provider)
    console.log('[Smoke] 3. Inserting same hash but different provider (local)...');
    const res3 = await DB.appendNews({
        topic_key: T,
        content_hash: H, // Same hash
        provider: 'local', // Different provider
        title: 'Test Title',
        url: 'http://example.com',
        ts: ts,
        published_at: new Date().toISOString()
    });
    console.log('Result 3:', res3);
    assert.strictEqual(res3.inserted, true, 'Insert with different provider (local) should succeed');

    // Verify DB Content
    console.log('[Smoke] Verifying DB content...');
    const rows = await DB.getRecentNews(T, 10);
    console.log('Rows found:', rows.length);
    console.log(JSON.stringify(rows, null, 2));

    assert.strictEqual(rows.length, 2, 'Should have exactly 2 rows');
    const providers = rows.map(r => r.provider).sort();
    assert.deepStrictEqual(providers, ['gdelt', 'local'], 'Should have both gdelt and local records');

    console.log('[Smoke] PASS: All checks passed.');
}

main().catch(err => {
    console.error('[Smoke] FAIL:', err);
    process.exit(1);
});
