import http from 'http';

const PORT = 53122;

const server = http.createServer((req, res) => {
    console.log(req.method + ' ' + req.url);
    if (req.url === '/' || req.url === '/pairs') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

server.listen(PORT, () => {
    console.log('Mock server running on port ' + PORT);
});
