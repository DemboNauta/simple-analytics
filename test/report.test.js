import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRecords, parseLine, maskIp } from '../src/logs.js';
import { aggregate, isBot, parseBeacon, screenClass } from '../src/aggregate.js';
import { renderHtml } from '../src/report.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => path.join(dir, 'fixtures', n);
const config = JSON.parse(fs.readFileSync(fx('analytics.config.json'), 'utf8'));

async function run(file, extra = {}) {
  const { records } = await readRecords([file]);
  return aggregate(records, { tz: 'UTC', config, ...extra });
}

function checkExpected(data) {
  assert.deepEqual(data.totals, { visitors: 3, pageviews: 4, events: 4, bots: 1 });
  assert.deepEqual(data.range, { from: '2026-11-01', to: '2026-11-02' });
  assert.deepEqual(data.days.map((d) => [d.date, d.visitors, d.pageviews, d.events]), [
    ['2026-11-01', 2, 3, 4],
    ['2026-11-02', 1, 1, 0],
  ]);
  assert.deepEqual(data.pages, [
    { path: '/', pageviews: 2, visitors: 2 },
    { path: '/curso/frenos', pageviews: 1, visitors: 1 },
    { path: '/curso/motor', pageviews: 1, visitors: 1 },
  ]);
  assert.deepEqual(data.sources, [
    { source: '', visitors: 1 },
    { source: 'duckduckgo.com', visitors: 1 },
    { source: 'google.com', visitors: 1 },
  ]);
  assert.deepEqual(data.screens, [{ screen: 'laptop', visitors: 2 }, { screen: 'phone', visitors: 1 }]);
  const test = data.events.find((e) => e.name === 'test_done');
  assert.equal(test.count, 2);
  assert.equal(test.visitors, 2);
  assert.deepEqual(test.props.find((p) => p.key === 'result').values, [{ value: 'fail', count: 1 }, { value: 'pass', count: 1 }]);
  assert.deepEqual(data.events.find((e) => e.name === 'question_wrong').props, [{ key: 'question', values: [{ value: 'q7', count: 1 }] }]);
  assert.deepEqual(data.funnels, [{
    name: 'Lesson to passed test',
    steps: [{ label: '/', visitors: 2 }, { label: '/curso/*', visitors: 1 }, { label: 'Test passed', visitors: 1 }],
  }]);
}

test('Caddy JSON log', async () => checkExpected(await run(fx('caddy.log'))));
test('nginx JSON log', async () => checkExpected(await run(fx('nginx.log'))));
test('combined log', async () => checkExpected(await run(fx('combined.log'))));

test('gzipped and rotated logs are read together', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loglytics-'));
  const lines = fs.readFileSync(fx('caddy.log'), 'utf8').trim().split('\n');
  fs.writeFileSync(path.join(tmp, 'analytics.log.1.gz'), zlib.gzipSync(lines.slice(0, 5).join('\n') + '\n'));
  fs.writeFileSync(path.join(tmp, 'analytics.log'), lines.slice(5).join('\n') + '\n');
  const { records } = await readRecords([tmp]);
  checkExpected(aggregate(records, { tz: 'UTC', config }));
});

test('date range filter', async () => {
  const data = await run(fx('caddy.log'), { since: Date.parse('2026-11-02T00:00:00Z') });
  assert.equal(data.totals.pageviews, 1);
  assert.deepEqual(data.days.map((d) => d.date), ['2026-11-02']);
});

test('time zone shifts days', async () => {
  // UTC+14: 2026-11-01 10:00Z is already 11-02 there, and 11-02 09:00Z is still 11-02
  const data = await run(fx('caddy.log'), { tz: 'Pacific/Kiritimati' });
  assert.deepEqual(data.days.map((d) => [d.date, d.pageviews]), [['2026-11-02', 4]]);
});

test('visitor ids change with the salt and are not stored', async () => {
  const { records } = await readRecords([fx('caddy.log')]);
  const data = aggregate(records, { tz: 'UTC', config });
  const json = JSON.stringify(data);
  assert.ok(!json.includes('83.45.12'));
  assert.ok(!json.includes('Mozilla'));
});

test('IP masking', () => {
  assert.equal(maskIp('83.45.12.200'), '83.45.12.0');
  assert.equal(maskIp('83.45.12.0'), '83.45.12.0');
  assert.equal(maskIp('::ffff:10.1.2.3'), '10.1.2.0');
  assert.equal(maskIp('2001:db8:abcd:12:1:2:3:4'), '2001:db8:abcd::');
  assert.equal(maskIp('2001:db8::1'), '2001:db8:0::');
  assert.equal(maskIp('203.0.113.9, 10.0.0.1'), '203.0.113.0');
});

test('report masks IPs even when the log has full IPs', () => {
  const r = parseLine('{"ts":"2026-11-01T10:00:00Z","ip":"1.2.3.4","uri":"/e?p=%2F","status":204,"ua":"x"}');
  assert.equal(r.ip, '1.2.3.0');
});

test('Caddy: falls back to client_ip without Cf-Connecting-Ip', () => {
  const r = parseLine(JSON.stringify({ ts: 1, request: { client_ip: '9.8.7.6', uri: '/e?p=%2F', headers: {} }, status: 204 }));
  assert.equal(r.ip, '9.8.7.0');
});

test('bot filter', () => {
  assert.ok(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)'));
  assert.ok(isBot('curl/8.4.0'));
  assert.ok(isBot('Mozilla/5.0 HeadlessChrome/120'));
  assert.ok(isBot(''));
  assert.ok(!isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Safari/604.1'));
});

test('beacon parsing', () => {
  assert.equal(parseBeacon('/index.html'), null);
  assert.equal(parseBeacon('/e'), null);
  assert.equal(parseBeacon('/ev?p=%2F'), null);
  assert.deepEqual(parseBeacon('/e?p=%2Fa&n=x&d=not-json'), { page: '/a', ref: '', width: 0, name: 'x', props: null });
  assert.equal(parseBeacon('/stats/e?p=%2F', '/stats/e').page, '/');
  assert.equal(screenClass(400), 'phone');
  assert.equal(screenClass(1600), 'desktop');
});

test('HTML report is self-contained and escaped', async () => {
  const data = await run(fx('caddy.log'));
  data.pages.push({ path: '/<script>alert(1)</script>', pageviews: 1, visitors: 1 });
  const html = renderHtml(data, { lang: 'es', title: 'Mi web' });
  assert.match(html, /<title>Mi web<\/title>/);
  assert.match(html, /Páginas más vistas/);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!/<script|<link|src="http|href="http/.test(html));
  assert.match(html, /Lesson to passed test/);
  assert.match(html, /question_wrong/);
});

test('empty input renders a "no data" page', () => {
  const html = renderHtml(aggregate([], {}), {});
  assert.match(html, /No data in this range/);
});

