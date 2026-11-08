#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readRecords } from '../src/logs.js';
import { aggregate, parseBeacon } from '../src/aggregate.js';
import { renderHtml } from '../src/report.js';
import { createCollector, SNIPPET } from '../src/serve.js';
import { findUsages, checkUsages, suggestCatalog } from '../src/check.js';
import { init } from '../src/init.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const NAME = pkg.name;

const HELP = `${NAME} ${pkg.version} - cookieless analytics from your web server log

Usage:
  ${NAME} init [options]                       Print the setup for your server, write analytics.config.json
  ${NAME} snippet                              Print m.js (e.g. > public/m.js)
  ${NAME} check [dir|file] [...]               Compare track()/data-track in your code with the events catalog
  ${NAME} report <log|dir|-> [...] [options]   Build a static HTML report
  ${NAME} serve [options]                      Run a tiny collector (no access log needed)

init options:
  --server <caddy|nginx>  Default: detected, else caddy
  --site <domain>         Default example.com
  --log <file>            Access log path

report options:
  -o, --out <file>      Output file (default stats.html; .json writes raw data)
  -c, --config <file>   Config file (default ./analytics.config.json if present)
  --days <n>            Only the last n days
  --since <date>        From this date (YYYY-MM-DD)
  --until <date>        Up to and including this date (YYYY-MM-DD)
  --tz <zone>           Time zone for days, e.g. Europe/Madrid (default: system)
  --lang <en|es>        Report language (default en)
  --title <text>        Report title
  --path <path>         Beacon path (default /e)
  --ip-header <name>    Header with the real client IP (default Cf-Connecting-Ip)

serve options:
  --port <n>            Port (default 8787)
  --host <addr>         Address to bind (default 0.0.0.0)
  --out <file>          Log file to append to (default events.log)
  --path <path>         Beacon path (default /e)
  --ip-header <name>    Trust this header for the client IP (e.g. X-Forwarded-For
                        or Cf-Connecting-Ip) when behind a proxy

Logs can be Caddy JSON, the nginx JSON format from the README, combined
(Apache/nginx default) or the output of "serve". Rotated and .gz files work.
`;

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  const alias = { o: 'out', c: 'config', h: 'help', v: 'version' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') || (a.startsWith('-') && a.length === 2 && a !== '-')) {
      let key = a.replace(/^--?/, '');
      let val;
      if (key.includes('=')) [key, val] = [key.slice(0, key.indexOf('=')), key.slice(key.indexOf('=') + 1)];
      key = alias[key] || key;
      if (val === undefined) {
        if (['help', 'version'].includes(key)) val = true;
        else if (i + 1 >= argv.length) fail(`Missing value for ${a}`);
        else val = argv[++i];
      }
      opts[key] = val;
    } else {
      pos.push(a);
    }
  }
  return { pos, opts };
}

function fail(msg) {
  console.error(`${NAME}: ${msg}\nRun "${NAME} --help" for usage.`);
  process.exit(1);
}

function parseDay(s, endOfDay) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(`Invalid date "${s}" (use YYYY-MM-DD)`);
  return Date.parse(s + (endOfDay ? 'T23:59:59.999Z' : 'T00:00:00Z'));
}

async function report(inputs, opts) {
  if (!inputs.length) fail('report needs at least one log file');
  const { config } = readConfig(opts);
  const beaconPath = opts.path || config.path || '/e';
  const ipHeader = opts['ip-header'] || config.ipHeader || 'cf-connecting-ip';
  let since = opts.since ? parseDay(opts.since) : undefined;
  const until = opts.until ? parseDay(opts.until, true) : undefined;
  if (opts.days) {
    const n = Number(opts.days);
    if (!(n > 0)) fail('--days must be a positive number');
    since = Date.now() - n * 86400000;
  }
  for (const f of inputs) if (f !== '-' && !fs.existsSync(f)) fail(`File not found: ${f}`);

  const { records, lines } = await readRecords(inputs, { ipHeader, keep: (r) => parseBeacon(r.uri, beaconPath) !== null });
  const data = aggregate(records, { beaconPath, tz: opts.tz || config.timezone, since, until, config });
  const out = opts.out || 'stats.html';
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  if (out.endsWith('.json')) fs.writeFileSync(out, JSON.stringify(data, null, 2));
  else fs.writeFileSync(out, renderHtml(data, { lang: opts.lang || config.lang || 'en', title: opts.title || config.title }));
  console.error(`${out}: ${data.totals.pageviews} pageviews, ${data.totals.visitors} visitors, ${data.totals.events} events (${lines} log lines read, ${data.totals.bots} bot hits ignored)`);
}

function readConfig(opts) {
  const configPath = opts.config || (fs.existsSync('analytics.config.json') ? 'analytics.config.json' : null);
  if (!configPath) return { config: {}, configPath: null };
  try { return { config: JSON.parse(fs.readFileSync(configPath, 'utf8')), configPath }; } catch (e) { fail(`Cannot read config ${configPath}: ${e.message}`); }
}

function check(roots, opts) {
  if (!roots.length) roots = ['.'];
  for (const r of roots) if (!fs.existsSync(r)) fail(`Not found: ${r}`);
  const { config, configPath } = readConfig(opts);
  const catalog = config.events || null;
  const { errors, warnings, events } = checkUsages(findUsages(roots), catalog);
  console.log(`${events.size} event name(s) found in ${roots.join(', ')}${configPath ? ` · catalog: ${configPath}` : ' · no events catalog'}`);
  for (const [name, list] of [...events].sort()) console.log(`  ${name}  (${list.length}x)`);
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors) console.log(`error: ${e}`);
  const missing = suggestCatalog(events, catalog || {});
  if (Object.keys(missing).length) {
    console.log(`
Add to "events" in analytics.config.json (fill in label and description):
${JSON.stringify(missing, null, 2)}`);
  }
  if (errors.length) process.exit(1);
}

function serve(opts) {
  const port = Number(opts.port || 8787);
  const host = opts.host || '0.0.0.0';
  const out = opts.out || 'events.log';
  const server = createCollector({ out, beaconPath: opts.path || '/e', ipHeader: opts['ip-header'] || '' });
  server.listen(port, host, () => console.error(`${NAME} collecting on http://${host}:${port}${opts.path || '/e'} -> ${out}`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

const { pos, opts } = parseArgs(process.argv.slice(2));
const cmd = pos.shift();
if (opts.version) console.log(pkg.version);
else if (opts.help || !cmd || cmd === 'help') console.log(HELP);
else if (cmd === 'report') await report(pos, opts);
else if (cmd === 'serve') serve(opts);
else if (cmd === 'snippet') process.stdout.write(SNIPPET);
else if (cmd === 'check') check(pos, opts);
else if (cmd === 'init') {
  try {
    const r = init({ server: opts.server, site: opts.site, log: opts.log, name: NAME });
    process.stdout.write(r.text);
    console.error(r.wrote ? 'Wrote analytics.config.json' : 'analytics.config.json already exists: left as is');
  } catch (e) { fail(e.message); }
}
else fail(`Unknown command "${cmd}"`);
