// Builds demo/stats.html from 30 days of made-up traffic, so you can see the report
// without a real site. Usage: npm run demo
import fs from 'node:fs';
import { aggregate } from '../src/aggregate.js';
import { renderHtml } from '../src/report.js';

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (list) => list[Math.floor(rand() * list.length)];

const pages = ['/', '/', '/', '/pricing', '/docs', '/docs/install', '/docs/events', '/blog/cookieless-analytics', '/blog/caddy-logs'];
const sources = ['', '', '', 'google.com', 'google.com', 'duckduckgo.com', 'news.ycombinator.com', 'github.com', 'newsletter'];
const widths = [400, 400, 800, 1300, 1300, 1900];
const uas = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
];
const beacon = (q) => '/e?' + new URLSearchParams(q).toString();

const records = [];
const start = Date.UTC(2026, 9, 10);
for (let day = 0; day < 30; day++) {
  const weekend = [0, 6].includes(new Date(start + day * 864e5).getUTCDay());
  const people = Math.round((weekend ? 25 : 45) + day * 1.5 + rand() * 20);
  for (let n = 0; n < people; n++) {
    const ip = `81.${day}.${n % 250}.0`, ua = pick(uas), w = pick(widths);
    let ts = start + day * 864e5 + Math.floor(rand() * 864e5);
    const push = (q) => { records.push({ ts, ip, ua, method: 'POST', uri: beacon(q), status: 204 }); ts += 20000 + rand() * 90000; };
    push({ p: pick(pages), w, r: pick(sources) });
    const more = Math.floor(rand() * 4);
    for (let k = 0; k < more; k++) push({ p: pick(pages), w });
    if (rand() < 0.3) push({ p: '/pricing', w, n: 'signup_click', d: JSON.stringify({ plan: pick(['free', 'free', 'pro']) }) });
    if (rand() < 0.15) push({ p: '/docs/install', w, n: 'copy_snippet', d: JSON.stringify({ server: pick(['caddy', 'caddy', 'nginx']) }) });
  }
  records.push({ ts: start + day * 864e5 + 3600e3, ip: '66.249.66.0', ua: 'Googlebot/2.1', method: 'GET', uri: beacon({ p: '/' }), status: 204 });
}

const data = aggregate(records, {
  tz: 'UTC',
  config: { funnels: [{ name: 'Docs to signup', steps: ['/docs*', '/pricing', { event: 'signup_click', label: 'Signup click' }] }] },
});
fs.mkdirSync('demo', { recursive: true });
fs.writeFileSync('demo/stats.html', renderHtml(data, { title: 'example.com · demo' }));
console.log(`demo/stats.html: ${data.totals.visitors} visitors, ${data.totals.pageviews} pageviews, ${data.totals.events} events`);
