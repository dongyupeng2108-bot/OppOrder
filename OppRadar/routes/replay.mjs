import DB from '../db.mjs';

/**
 * GET /replay?scan_id=<id>
 * Returns the replay event set for a given scan run.
 *
 * @param {object} query - parsed query string params
 * @param {object} [db]  - DB instance (injectable for testing, defaults to real DB)
 * @returns {{ status: number, body: object }}
 */
export async function handleReplay(query, db = DB) {
    const { scan_id } = query;

    if (!scan_id) {
        return {
            status: 400,
            body: { error: 'Missing scan_id parameter' }
        };
    }

    try {
        const opps = await db.getOpportunitiesByRun(scan_id, 200);

        if (opps.length === 0) {
            return {
                status: 404,
                body: { error: `scan_id not found: ${scan_id}` }
            };
        }

        // Use the first non-null snapshot_ref as the fingerprint
        const snapshot_fingerprint = opps.find(o => o.snapshot_ref)?.snapshot_ref || '';

        const replay_events = opps.map(o => ({
            opp_id: o.id,
            score:  o.score,
            title:  o.topic_key || ''
        }));

        return {
            status: 200,
            body: {
                scan_id,
                snapshot_fingerprint,
                replay_events
            }
        };
    } catch (err) {
        console.error('[replay] Error:', err.message);
        return { status: 500, body: { error: 'Internal Server Error' } };
    }
}
