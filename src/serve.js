// Optional tiny collector for hosts without access logs. Writes the same
// flat JSON lines that `report` reads (one per beacon), with the IP truncated.
import fs from 'node:fs';
import http from 'node:http';
import { maskIp } from './logs.js';

export const SNIPPET = fs.readFileSync(new URL('../client/m.js', import.meta.url), 'utf8');

export function createCollector({ out = 'events.log', beaconPath = '/e', ipHeader = '' } = {}) {
  const stream = fs.createWriteStream(out, { flags: 'a' });
  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    const path = url.split('?')[0];
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      res.writeHead(204).end();
      return;
    }
    if (path === beaconPath && (req.method === 'POST' || req.method === 'GET')) {
      req.resume(); // ignore any body
      const raw = (ipHeader && req.headers[ipHeader.toLowerCase()]) || req.socket.remoteAddress || '';
      const line = {
        ts: new Date().toISOString(),
        ip: maskIp(Array.isArray(raw) ? raw[0] : raw),
        method: req.method,
        uri: url.slice(0, 4096),
        status: 204,
        ua: String(req.headers['user-agent'] || '').slice(0, 512),
      };
      stream.write(JSON.stringify(line) + '\n');
      res.writeHead(204, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    if (path === '/m.js' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }).end(SNIPPET);
      return;
    }
    res.writeHead(404).end();
  });
  server.on('close', () => stream.end());
  return server;
}
