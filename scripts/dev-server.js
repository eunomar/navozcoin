'use strict';

/**
 * Servidor local de desenvolvimento do NavozCoin.
 *
 * IMPORTANTE: este arquivo NÃO é usado em produção. Na Vercel a aplicação roda
 * como estático (index.html) + função serverless (api/index.js). Este harness
 * existe apenas para você abrir http://localhost:3000 com `npm run dev`, sem
 * precisar de Vercel CLI, login ou configuração de projeto.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./load-env');

loadEnv();

const handler = require('../server/api');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.join(__dirname, '..');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      // Reproduz o cabeçalho que o front-end envia para a Vercel.
      req.query = {
        ...Object.fromEntries(url.searchParams.entries()),
        path: url.pathname.replace(/^\/api\/?/, ''),
      };
      await handler(req, res);
      return;
    }

    const requested = decodeURIComponent(url.pathname);
    let filePath = path.join(ROOT, requested === '/' ? 'index.html' : requested);
    if (!filePath.startsWith(ROOT)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(ROOT, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error('[dev-server]', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: { message: 'Erro no servidor local de desenvolvimento.' } }));
    }
  }
});

server.listen(PORT, HOST, () => {
  const configured = Boolean((process.env.MONGODB_URI || '').trim());
  console.log('');
  console.log('  NAVOZCOIN — ambiente local');
  console.log(`  http://${HOST}:${PORT}`);
  console.log(`  MongoDB: ${configured ? 'variável carregada de .env.local' : 'MONGODB_URI AUSENTE'}`);
  console.log('  Este servidor é apenas para desenvolvimento local.');
  console.log('');
});

module.exports = server;
