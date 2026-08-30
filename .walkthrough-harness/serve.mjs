import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.argv[2] || process.cwd();
const PORT = Number(process.argv[3] || 8899);
const API_UPSTREAM = process.env.DANDAN_TEST_API_UPSTREAM || 'http://127.0.0.1:3310';
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8','.md':'text/markdown; charset=utf-8','.webp':'image/webp','.woff2':'font/woff2'};
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/dd/api/')) {
      const upstream = new URL(API_UPSTREAM);
      const headers = { ...req.headers, host: upstream.host };
      delete headers.origin;
      const proxy = http.request({
        hostname: upstream.hostname,
        port: upstream.port || 80,
        path: url.pathname.slice(3) + url.search,
        method: req.method,
        headers
      }, (upstreamResponse) => {
        const responseHeaders = { ...upstreamResponse.headers };
        if (responseHeaders['set-cookie']) {
          responseHeaders['set-cookie'] = responseHeaders['set-cookie'].map((cookie) => cookie.replace(/Path=\/api\/auth/gi, 'Path=/dd/api/auth'));
        }
        res.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
        upstreamResponse.pipe(res);
      });
      proxy.on('error', () => { res.writeHead(502); res.end('test api unavailable'); });
      req.pipe(proxy);
      return;
    }
    let rel = decodeURIComponent(url.pathname).replace(/\\/g, '/').replace(/^\/+/, '');
    let file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, {'Access-Control-Allow-Origin':'*'}); res.end('not found: ' + rel); return; }
      if (path.extname(file).toLowerCase() === '.html') {
        data = Buffer.from(data.toString('utf8').replace('<head>', '<head><script>window.DANDAN_API_ORIGIN=\'/dd\';</script>'));
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(data);
    });
  } catch (e) { res.writeHead(500); res.end('error'); }
});
server.listen(PORT, '127.0.0.1', () => console.log('serving ' + ROOT + ' on http://127.0.0.1:' + PORT));

server.on('upgrade', (req, clientSocket, head) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/dd/api/')) { clientSocket.destroy(); return; }

  const upstream = new URL(API_UPSTREAM);
  const upstreamSocket = net.connect(Number(upstream.port || 80), upstream.hostname);
  upstreamSocket.on('error', () => clientSocket.destroy());
  upstreamSocket.on('connect', () => {
    const headers = Object.entries(req.headers)
      .filter(([key]) => key.toLowerCase() !== 'host')
      .map(([key, value]) => `${key}: ${value}`);
    headers.push(`host: ${upstream.host}`);
    upstreamSocket.write(`${req.method} ${url.pathname.slice(3)}${url.search} HTTP/${req.httpVersion}\r\n${headers.join('\r\n')}\r\n\r\n`);
    if (head.length) upstreamSocket.write(head);
    clientSocket.pipe(upstreamSocket).pipe(clientSocket);
  });
});
