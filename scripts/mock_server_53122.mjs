import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// scripts/mock_server.mjs is inside E:\OppRadar\scripts (after move back)
// data/fixtures is in E:\OppRadar\data\fixtures
// So PROJECT_ROOT is ..
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(PROJECT_ROOT, 'data', 'fixtures');

const PORT = 53122;

const ROUTES = {
    '/strategies': 'strategies.json',
    '/snapshots': 'snapshots.json',
    '/tags': 'tags.json',
    '/opportunities': 'opportunities.json',
    '/scans': 'scans.json'
};

const server = http.createServer((req, res) => {
    console.log(req.method + ' ' + req.url);
    
    if (req.url === '/' || req.url === '/pairs') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
    }

    if (ROUTES[req.url] && req.method === 'GET') {
        const filePath = path.join(FIXTURES_DIR, ROUTES[req.url]);
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                console.error(`Error reading ${filePath}:`, err);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error reading fixture file: ' + err.message);
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(data);
        });
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log('Mock server running on port ' + PORT);
});
