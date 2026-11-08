import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findUsages, checkUsages, suggestCatalog } from '../src/check.js';
import { init } from '../src/init.js';

function site(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loglytics-check-'));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

test('finds track() calls and data-track attributes with their props', () => {
  const dir = site({
    'index.html': '<button class="b" data-track="start_clicked" data-track-place="home" data-track-some-key="x">Go</button>',
    'src/app.js': "track('test_passed', { topic: t, score });\ntrack(dynamicName);\nfoo.track('x_y')",
    'node_modules/lib/index.js': "track('ignored_event')",
  });
  const found = findUsages([dir]).map((u) => [u.name, u.props, path.basename(u.file), u.line]).sort();
  assert.deepEqual(found, [
    ['start_clicked', ['place', 'someKey'], 'index.html', 1],
    ['test_passed', ['topic', 'score'], 'app.js', 1],
    ['x_y', [], 'app.js', 3],
  ]);
});

test('compares with the catalog', () => {
  const dir = site({ 'a.js': "track('test_passed', { topic: 1, extra: 2 }); track('typo_evnt'); track('Bad Name')" });
  const catalog = { test_passed: { props: { topic: '' } }, never_sent: {} };
  const r = checkUsages(findUsages([dir]), catalog);
  assert.equal(r.errors.length, 2);
  assert.match(r.errors.join('\n'), /typo_evnt/);
  assert.match(r.warnings.join('\n'), /"extra"/);
  assert.match(r.warnings.join('\n'), /never_sent/);
  assert.match(r.warnings.join('\n'), /snake_case/);
  assert.deepEqual(Object.keys(suggestCatalog(r.events, catalog)).sort(), ['Bad Name', 'typo_evnt']);
});

test('without a catalog nothing is an error', () => {
  const dir = site({ 'a.js': "track('a_b')" });
  assert.deepEqual(checkUsages(findUsages([dir]), null).errors, []);
});

test('init prints the server setup and writes a starter config once', () => {
  const dir = site({});
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const caddy = init({ server: 'caddy', site: 'example.org' });
    assert.ok(caddy.wrote);
    assert.match(caddy.text, /example\.org \{/);
    assert.match(caddy.text, /respond @loglytics 204/);
    assert.match(caddy.text, /<script src="\/m.js" defer><\/script>/);
    assert.deepEqual(JSON.parse(fs.readFileSync('analytics.config.json', 'utf8')).events, {});
    const nginx = init({ server: 'nginx' });
    assert.equal(nginx.wrote, false);
    assert.match(nginx.text, /location = \/e/);
    assert.throws(() => init({ server: 'apache' }), /Unknown server/);
  } finally {
    process.chdir(cwd);
  }
});
