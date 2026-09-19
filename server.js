/**
 * Servidor de desenvolvimento LOCAL (não é usado em produção).
 * Em produção o site é servido como estático pelo Vercel, a partir de public/.
 * Uso: node server.js  →  http://localhost:8000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.json': 'application/json'
};

const server = http.createServer((req, res) => {
    // Prevent directory traversal
    let safeUrl = req.url.split('?')[0];
    if (safeUrl === '/' || safeUrl === '/home') {
        safeUrl = '/landing.html';
    } else if (safeUrl === '/app' || safeUrl === '/painel' || safeUrl === '/login' || safeUrl === '/sistema') {
        safeUrl = '/index.html';
    }

    const filePath = path.join(PUBLIC_DIR, safeUrl);
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        // Fallback SPA: /app e /painel servem index.html, rotas públicas servem landing.html
        let fallback = 'landing.html';
        if (safeUrl.startsWith('/app') || safeUrl.startsWith('/painel')) {
            fallback = 'index.html';
        }
        const finalPath = (err || !stats.isFile()) ? path.join(PUBLIC_DIR, fallback) : filePath;

        const ext = path.extname(finalPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });

        const stream = fs.createReadStream(finalPath);
        stream.on('error', (streamErr) => {
            console.error('Stream error:', streamErr);
            // Headers already sent, so just end
            res.end();
        });
        stream.pipe(res);
    });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}/`);
});
