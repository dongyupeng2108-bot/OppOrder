/**
 * generate_replay_fixtures.mjs
 * Reads up to 50 scan runs from DB and writes replay fixtures to data/replay_fixtures.json.
 *
 * Usage: node scripts/generate_replay_fixtures.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DB } from '../OppRadar/db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '../data/replay_fixtures.json');
const MAX_RUNS = 50;

async function main() {
    // Fetch up to MAX_RUNS recent runs from opportunity_run table
    const runs = await DB.getRuns(MAX_RUNS);

    if (runs.length === 0) {
        console.warn('[generate_replay_fixtures] No runs found in DB. Output will be empty.');
    }

    const fixtures = [];

    for (const run of runs) {
        const opps = await DB.getOpportunitiesByRun(run.run_id, 200);
        fixtures.push({
            scan_id: run.run_id,
            replay_events: opps.map(o => ({
                opp_id: o.id,
                score:  o.score,
                title:  o.topic_key || ''
            }))
        });
    }

    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(fixtures, null, 2), 'utf8');

    console.log(`[generate_replay_fixtures] Written ${fixtures.length} fixtures to ${OUT_PATH}`);
}

main().catch(err => {
    console.error('[generate_replay_fixtures] Fatal error:', err.message);
    process.exit(1);
});
