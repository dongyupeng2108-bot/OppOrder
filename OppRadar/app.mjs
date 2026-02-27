import http from 'http';
import url from 'url';
import { fileURLToPath } from 'url';
import { handleDiff } from './routes/diff.mjs';
import { handleReplay } from './routes/replay.mjs';

const __filename = fileURLToPath(import.meta.url);

/**
 * Create an HTTP server that serves /diff and /replay.
 *
 * @param {object} [overrideHandlers] - Optional handler overrides for testing.
 *   { diff: (query) => Promise<{status, body}>, replay: (query) => Promise<{status, body}> }
 * @returns {http.Server}
 */
export function createServer(overrideHandlers = {}) {
    const diffHandler   = overrideHandlers.diff   || ((query) => handleDiff(query));
    const replayHandler = overrideHandlers.replay || ((query) => handleReplay(query));

    return http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url, true);
        const pathname  = parsedUrl.pathname;
        const query     = parsedUrl.query;

        let result;
        try {
            if (pathname === '/diff') {
                result = await diffHandler(query);
            } else if (pathname === '/replay') {
                result = await replayHandler(query);
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not Found' }));
                return;
            }
        } catch (err) {
            console.error('[app] Unhandled error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
            return;
        }

        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body));
    });
}

// Start server when run directly: node OppRadar/app.mjs
if (process.argv[1] === __filename) {
    const PORT = parseInt(process.env.PORT || '53122', 10);
    createServer().listen(PORT, () => {
        console.log(`[app.mjs] /diff and /replay server running on port ${PORT}`);
    });
}
