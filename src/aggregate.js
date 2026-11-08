// Turn parsed log records into report data.
import crypto from 'node:crypto';

export const BOT_RE =
  /bot|crawl|spider|slurp|scrap|fetch|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|curl|wget|python|httpie|axios|node-fetch|go-http|java\/|okhttp|libwww|ruby|perl|php|^$/i;

export function isBot(ua) {
  return BOT_RE.test(ua || '');
}

/** Rough device class from the (already rounded) viewport width. */
export function screenClass(w) {
  w = Number(w);
  if (!w) return 'unknown';
  if (w < 576) return 'phone';
  if (w < 992) return 'tablet';
  if (w < 1440) return 'laptop';
  return 'desktop';
}

export function dayFormatter(tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (ts) => f.format(new Date(ts));
}

/** Parse a beacon URI (/e?p=..&r=..&w=..&n=..&d=..). Returns null if it is not the beacon path. */
export function parseBeacon(uri, beaconPath = '/e') {
  const q = uri.indexOf('?');
  const p = q === -1 ? uri : uri.slice(0, q);
  if (p !== beaconPath) return null;
  const params = new URLSearchParams(q === -1 ? '' : uri.slice(q + 1));
  const page = params.get('p');
  if (!page) return null;
  let props = null;
  const d = params.get('d');
  if (d) {
    try {
      const o = JSON.parse(d);
      if (o && typeof o === 'object' && !Array.isArray(o)) props = o;
    } catch { /* ignore malformed props */ }
  }
  return {
    page: page.slice(0, 300),
    ref: (params.get('r') || '').toLowerCase().slice(0, 100),
    width: Number(params.get('w')) || 0,
    name: (params.get('n') || '').slice(0, 100),
    props,
  };
}

/**
 * Funnel step: "/path", "/path/*", "event_name", or
 * { page: "/path*" } / { event: "name", props: { key: "value" } }, with optional "label".
 */
export function compileStep(step) {
  if (typeof step === 'string') step = step.startsWith('/') ? { page: step } : { event: step };
  const label = step.label || step.page || step.event + (step.props ? ' ' + JSON.stringify(step.props) : '');
  if (step.page) {
    const re = new RegExp('^' + step.page.split('*').map(escapeRe).join('.*') + '$');
    return { label, test: (h) => !h.name && re.test(h.page) };
  }
  const props = step.props || {};
  return {
    label,
    test: (h) => h.name === step.event && Object.entries(props).every(([k, v]) => h.props && String(h.props[k]) === String(v)),
  };
}

function escapeRe(s) {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function bump(map, key, n = 1) {
  map.set(key, (map.get(key) || 0) + n);
}

function sortedEntries(map, by = (v) => v) {
  return [...map.entries()].sort((a, b) => by(b[1]) - by(a[1]) || String(a[0]).localeCompare(String(b[0])));
}

/**
 * records: [{ ts, ip, ua, uri, status }]
 * options: { beaconPath, tz, salt, since, until, config: { funnels, exclude } }
 */
export function aggregate(records, options = {}) {
  const { beaconPath = '/e', tz, since, until, config = {} } = options;
  const salt = options.salt || crypto.randomBytes(16).toString('hex'); // per run, never stored
  const dayOf = dayFormatter(tz);
  const exclude = (config.exclude || []).map((p) => compileStep({ page: p }));
  let bots = 0;

  const hits = [];
  for (const r of records) {
    if (since && r.ts < since) continue;
    if (until && r.ts > until) continue;
    if (r.status && (r.status < 200 || r.status >= 400)) continue;
    const b = parseBeacon(r.uri, beaconPath);
    if (!b) continue;
    if (isBot(r.ua)) { bots++; continue; }
    if (exclude.some((s) => s.test({ page: b.page }))) continue;
    const day = dayOf(r.ts);
    const vid = crypto.createHash('sha256').update(`${salt}|${day}|${r.ip}|${r.ua}`).digest('hex').slice(0, 16);
    hits.push({ ...b, ts: r.ts, day, vid: day + ':' + vid });
  }
  hits.sort((a, b) => a.ts - b.ts);

  const days = new Map();
  const pages = new Map();
  const events = new Map();
  const visits = new Map(); // vid -> { source, width, hits[] }
  let pageviews = 0;
  let eventCount = 0;

  for (const h of hits) {
    if (!days.has(h.day)) days.set(h.day, { pageviews: 0, events: 0, visitors: new Set() });
    const d = days.get(h.day);
    d.visitors.add(h.vid);
    let v = visits.get(h.vid);
    if (!v) visits.set(h.vid, (v = { source: '', width: 0, hits: [] }));
    v.hits.push(h);
    if (h.width) v.width = h.width;
    if (h.ref && !v.source) v.source = h.ref;

    if (!h.name) {
      pageviews++;
      d.pageviews++;
      if (!pages.has(h.page)) pages.set(h.page, { pageviews: 0, visitors: new Set() });
      const p = pages.get(h.page);
      p.pageviews++;
      p.visitors.add(h.vid);
    } else {
      eventCount++;
      d.events++;
      if (!events.has(h.name)) events.set(h.name, { count: 0, visitors: new Set(), props: new Map() });
      const e = events.get(h.name);
      e.count++;
      e.visitors.add(h.vid);
      for (const [k, val] of Object.entries(h.props || {})) {
        if (!e.props.has(k)) e.props.set(k, new Map());
        bump(e.props.get(k), String(typeof val === 'object' ? JSON.stringify(val) : val).slice(0, 120));
      }
    }
  }

  const sources = new Map();
  const screens = new Map();
  for (const v of visits.values()) {
    bump(sources, v.source || '');
    bump(screens, screenClass(v.width));
  }

  // Fill the day range so gaps show as zero.
  const dayList = [];
  if (days.size) {
    const keys = [...days.keys()].sort();
    const fromKey = since ? dayOf(since) : keys[0];
    const toKey = until ? dayOf(until) : keys[keys.length - 1];
    for (let t = Date.parse(fromKey + 'T12:00:00Z'); ; t += 86400000) {
      const k = new Date(t).toISOString().slice(0, 10);
      if (k > toKey) break;
      const d = days.get(k);
      dayList.push({ date: k, pageviews: d ? d.pageviews : 0, visitors: d ? d.visitors.size : 0, events: d ? d.events : 0 });
    }
  }

  const funnels = (config.funnels || []).map((f) => {
    const steps = (f.steps || []).map((st) => {
      const c = compileStep(st);
      const ev = typeof st === 'string' ? (st.startsWith('/') ? null : st) : st.event;
      if (ev && !st.label && config.events && config.events[ev] && config.events[ev].label) c.label = config.events[ev].label;
      return c;
    });
    const reached = new Array(steps.length).fill(0);
    for (const v of visits.values()) {
      let i = 0;
      for (const h of v.hits) {
        if (i < steps.length && steps[i].test(h)) i++;
      }
      for (let j = 0; j < i; j++) reached[j]++;
    }
    return { name: f.name || 'Funnel', steps: steps.map((s, i) => ({ label: s.label, visitors: reached[i] })) };
  });

  const visitors = dayList.reduce((n, d) => n + d.visitors, 0);
  const catalog = config.events || null;
  const described = (name) => (catalog && catalog[name]) || {};
  return {
    generatedAt: new Date().toISOString(),
    range: { from: dayList[0]?.date || null, to: dayList[dayList.length - 1]?.date || null },
    totals: { visitors, pageviews, events: eventCount, bots },
    days: dayList,
    pages: sortedEntries(pages, (p) => p.pageviews).map(([path, p]) => ({ path, pageviews: p.pageviews, visitors: p.visitors.size })),
    sources: sortedEntries(sources).map(([source, n]) => ({ source, visitors: n })),
    screens: sortedEntries(screens).map(([screen, n]) => ({ screen, visitors: n })),
    events: sortedEntries(events, (e) => e.count).map(([name, e]) => ({
      name,
      label: described(name).label || '',
      description: described(name).description || '',
      declared: !catalog || !!catalog[name],
      count: e.count,
      visitors: e.visitors.size,
      props: [...e.props.entries()].map(([key, vals]) => ({
        key,
        description: (described(name).props || {})[key] || '',
        values: sortedEntries(vals).map(([value, count]) => ({ value, count })),
      })),
    })),
    // Only with an "events" catalog in the config: names that arrived without being declared
    // (typos, forgotten entries) and declared ones that never arrived (broken or unused code).
    catalog: catalog ? {
      undeclared: [...events.keys()].filter((k) => !catalog[k]).sort(),
      unused: Object.keys(catalog).filter((k) => !events.has(k)).sort(),
    } : null,
    funnels,
  };
}
