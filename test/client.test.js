import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { minify } from '../scripts/build.js';

const src = fs.readFileSync(new URL('../client/m.src.js', import.meta.url), 'utf8');
const built = fs.readFileSync(new URL('../client/m.js', import.meta.url), 'utf8');

test('client/m.js is up to date (run npm run build)', () => {
  assert.equal(built.replace(/\r\n/g, '\n'), minify(src.replace(/\r\n/g, '\n')));
});

// Runs the script against a tiny fake browser and returns the beacon URLs it sends.
function browser({ path = '/', referrer = '', stub = null } = {}) {
  const sent = [];
  const listeners = {};
  const loc = { pathname: path, hostname: 'example.com', search: '' };
  const win = {
    innerWidth: 1280,
    addEventListener: (t, f) => { listeners['w:' + t] = f; },
  };
  const doc = {
    referrer,
    currentScript: { src: 'https://example.com/m.js', dataset: {} },
    addEventListener: (t, f) => { listeners['d:' + t] = f; },
  };
  if (stub) win.track = stub;
  const ctx = {
    window: win, document: doc, location: loc, URL, URLSearchParams, JSON, Math,
    navigator: { sendBeacon: (u) => { sent.push(u); return true; } },
    history: { pushState(_, __, url) { loc.pathname = url; } },
    fetch: () => Promise.resolve(),
  };
  vm.runInNewContext(built, ctx);
  const click = (el) => listeners['d:click']({ target: { closest: (sel) => (sel === '[data-track]' ? el : null) } });
  return { sent, win, ctx, click };
}
const params = (u) => Object.fromEntries(new URL(u).searchParams);

test('page view on load, with the referring domain', () => {
  const b = browser({ path: '/docs', referrer: 'https://www.google.com/search?q=x' });
  assert.equal(b.sent.length, 1);
  assert.ok(b.sent[0].startsWith('https://example.com/e?'));
  assert.deepEqual(params(b.sent[0]), { p: '/docs', w: '1300', r: 'google.com' });
});

test('SPA navigation sends one page view per new path', () => {
  const b = browser();
  b.ctx.history.pushState(null, '', '/a');
  b.ctx.history.pushState(null, '', '/a');
  b.ctx.history.pushState(null, '', '/b');
  assert.deepEqual(b.sent.map((u) => params(u).p), ['/', '/a', '/b']);
  assert.equal(params(b.sent[1]).r, undefined);
});

test('track() and its m() alias send events with props', () => {
  const b = browser();
  b.win.track('test_passed', { topic: 'brakes' });
  b.win.m('signup_clicked');
  assert.deepEqual(params(b.sent[1]), { p: '/', w: '1300', n: 'test_passed', d: '{"topic":"brakes"}' });
  assert.deepEqual(params(b.sent[2]), { p: '/', w: '1300', n: 'signup_clicked' });
});

test('data-track attributes become an event on click', () => {
  const b = browser();
  b.click({ dataset: { track: 'start_clicked', trackPlace: 'home', trackSomeKey: 'x', other: 'no' } });
  assert.deepEqual(params(b.sent[1]), { p: '/', w: '1300', n: 'start_clicked', d: '{"place":"home","someKey":"x"}' });
  b.click(null);
  assert.equal(b.sent.length, 2);
});

test('calls queued before the script loaded are sent', () => {
  const stub = function () {};
  stub.q = [['early_event', { a: 1 }]];
  const b = browser({ stub });
  assert.equal(params(b.sent[1]).n, 'early_event');
});
