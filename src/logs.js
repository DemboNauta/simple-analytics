// Reading and parsing access logs (Caddy JSON, flat JSON from nginx/`serve`, combined text).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';

/** Expand CLI inputs: files, directories (their files, sorted) or "-" for stdin. */
export function expandInputs(inputs) {
  const out = [];
  for (const input of inputs) {
    if (input === '-') { out.push('-'); continue; }
    const st = fs.statSync(input);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(input).sort()) {
        const p = path.join(input, name);
        if (fs.statSync(p).isFile()) out.push(p);
      }
    } else {
      out.push(input);
    }
  }
  return out;
}

/** Async iterator over the lines of a file (transparently gunzips .gz). */
export async function* readLines(file) {
  let stream = file === '-' ? process.stdin : fs.createReadStream(file);
  if (file !== '-' && file.endsWith('.gz')) stream = stream.pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

/** Truncate an IP before it is used anywhere: IPv4 -> /24, IPv6 -> /48. */
export function maskIp(ip) {
  if (!ip) return '';
  ip = String(ip).split(',')[0].trim();
  if (ip.startsWith('::ffff:') && ip.includes('.')) ip = ip.slice(7);
  if (ip.startsWith('[')) ip = ip.slice(1, ip.indexOf(']'));
  const v4 = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}(:\d+)?$/);
  if (v4) return v4[1] + '.0';
  if (ip.includes(':')) {
    const groups = expandV6(ip);
    return groups ? groups.slice(0, 3).join(':') + '::' : '';
  }
  return ip;
}

function expandV6(ip) {
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail !== '' ? tail.split(':') : [];
  if (tail === undefined && h.length !== 8) return null;
  const fill = new Array(Math.max(0, 8 - h.length - t.length)).fill('0');
  return [...h, ...fill, ...t].map((g) => (g || '0').toLowerCase().replace(/^0+(?=.)/, ''));
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function parseClfDate(s) {
  // 10/Oct/2000:13:55:36 -0700
  const m = s.match(/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/);
  if (!m) return NaN;
  const utc = Date.UTC(+m[3], MONTHS[m[2]], +m[1], +m[4], +m[5], +m[6]);
  const off = (+m[8] * 60 + +m[9]) * 60000 * (m[7] === '+' ? 1 : -1);
  return utc - off;
}

function parseTs(v) {
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000; // seconds (Caddy) or ms
  if (typeof v === 'string') {
    if (/^\d+(\.\d+)?$/.test(v)) return parseTs(Number(v));
    const t = Date.parse(v);
    return Number.isNaN(t) ? parseClfDate(v) : t;
  }
  return NaN;
}

function header(headers, name) {
  if (!headers) return '';
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) {
      const v = headers[k];
      return Array.isArray(v) ? v[0] || '' : String(v || '');
    }
  }
  return '';
}

const COMBINED = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) \S+(?: "([^"]*)" "([^"]*)")?/;

/**
 * Parse one log line into { ts, ip, ua, method, uri, status } or null.
 * `ipHeader` is the request header that carries the real client IP
 * (default Cf-Connecting-Ip); it wins over the socket address when present.
 */
export function parseLine(line, { ipHeader = 'cf-connecting-ip' } = {}) {
  line = line.trim();
  if (!line) return null;
  if (line[0] === '{') {
    let o;
    try { o = JSON.parse(line); } catch { return null; }
    if (o.request && typeof o.request === 'object') {
      // Caddy
      const r = o.request;
      const ip = (ipHeader && header(r.headers, ipHeader)) || r.client_ip || r.remote_ip || '';
      return {
        ts: parseTs(o.ts),
        ip: maskIp(ip),
        ua: header(r.headers, 'user-agent'),
        method: r.method || '',
        uri: r.uri || '',
        status: Number(o.status) || 0,
      };
    }
    // Flat JSON (nginx log_format below, or `serve`)
    const hdrKey = ipHeader ? ipHeader.toLowerCase().replace(/-/g, '_') : '';
    const fromHeader = o.cf_ip || (hdrKey && o[hdrKey]) || '';
    return {
      ts: parseTs(o.ts ?? o.time ?? o.time_iso8601),
      ip: maskIp(fromHeader && fromHeader !== '-' ? fromHeader : o.ip || o.remote_addr || ''),
      ua: o.ua || o.user_agent || o.http_user_agent || '',
      method: o.method || o.request_method || '',
      uri: o.uri || o.request_uri || '',
      status: Number(o.status) || 0,
    };
  }
  const m = line.match(COMBINED);
  if (!m) return null;
  return {
    ts: parseClfDate(m[2]),
    ip: maskIp(m[1]),
    ua: m[7] || '',
    method: m[3],
    uri: m[4],
    status: Number(m[5]),
  };
}

/** Read all inputs and return parsed records (only well-formed lines). */
export async function readRecords(inputs, opts = {}) {
  const records = [];
  let lines = 0;
  for (const file of expandInputs(inputs)) {
    for await (const line of readLines(file)) {
      lines++;
      const r = parseLine(line, opts);
      if (r && !Number.isNaN(r.ts) && (!opts.keep || opts.keep(r))) records.push(r);
    }
  }
  return { records, lines };
}
