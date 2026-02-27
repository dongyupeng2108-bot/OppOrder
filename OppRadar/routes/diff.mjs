import DB from '../db.mjs';

/**
 * GET /diff?from_scan=<id>&to_scan=<id>
 * Compares two scan runs and returns added/removed/changed opportunity sets.
 *
 * @param {object} query - parsed query string params
 * @param {object} [db]  - DB instance (injectable for testing, defaults to real DB)
 * @returns {{ status: number, body: object }}
 */
export async function handleDiff(query, db = DB) {
    const { from_scan, to_scan } = query;

    if (!from_scan || !to_scan) {
        return {
            status: 400,
            body: { error: 'Missing from_scan or to_scan parameter' }
        };
    }

    try {
        const [fromOpps, toOpps] = await Promise.all([
            db.getOpportunitiesByRun(from_scan, 200),
            db.getOpportunitiesByRun(to_scan, 200)
        ]);

        if (fromOpps.length === 0 && toOpps.length === 0) {
            return {
                status: 404,
                body: { error: `Scan IDs not found: ${from_scan}, ${to_scan}` }
            };
        }

        const fromIds = new Set(fromOpps.map(o => o.id));
        const toIds = new Set(toOpps.map(o => o.id));
        const fromMap = new Map(fromOpps.map(o => [o.id, o]));
        const toMap = new Map(toOpps.map(o => [o.id, o]));

        const added_opp_ids = [...toIds].filter(id => !fromIds.has(id));
        const removed_opp_ids = [...fromIds].filter(id => !toIds.has(id));

        const changed = [];
        for (const id of fromIds) {
            if (!toIds.has(id)) continue;
            const f = fromMap.get(id);
            const t = toMap.get(id);
            if (f.score !== t.score || f.topic_key !== t.topic_key) {
                changed.push({
                    opp_id: id,
                    from: { score: f.score, topic_key: f.topic_key },
                    to:   { score: t.score, topic_key: t.topic_key }
                });
            }
        }

        return {
            status: 200,
            body: {
                from_scan,
                to_scan,
                added_opp_ids,
                removed_opp_ids,
                changed
            }
        };
    } catch (err) {
        console.error('[diff] Error:', err.message);
        return { status: 500, body: { error: 'Internal Server Error' } };
    }
}
