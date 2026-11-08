// `loglytics check`: finds the events a site sends (track('name', {...}) in code and
// data-track="name" in markup) and compares them with the "events" catalog in the config.
import fs from 'node:fs';
import path from 'node:path';

const EXT = /\.(html?|js|mjs|cjs|jsx|ts|tsx|vue|svelte|astro|php|erb|njk|hbs|liquid|twig|md|mdx)$/i;
const SKIP = new Set(['node_modules', '.git', '.next', '.nuxt', '.svelte-kit', '.cache', 'coverage', 'vendor']);
const NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.test(e.name) && !/\.min\.js$/.test(e.name) && e.name !== 'm.js') out.push(p);
  }
  return out;
}

const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const lineAt = (text, i) => text.slice(0, i).split('\n').length;

/** Returns [{ name, props: [keys], file, line }] for every event call found. */
export function findUsages(roots) {
  const found = [];
  for (const root of roots) {
    const files = fs.statSync(root).isDirectory() ? walk(root) : [root];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      // track('name') / track("name", { a: 1, b }) — only literal names can be checked
      const call = /\btrack\(\s*(['"`])([^'"`]+)\1\s*(?:,\s*\{([^}]*)\})?/g;
      for (let m; (m = call.exec(text));) {
        const props = m[3] ? [...m[3].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?=[:,]|$)/g)].map((x) => x[1]) : [];
        found.push({ name: m[2], props, file, line: lineAt(text, m.index) });
      }
      // <tag data-track="name" data-track-some-key="...">
      const tag = /<[^<>]*\bdata-track\s*=\s*(['"])([^'"]+)\1[^<>]*>/g;
      for (let m; (m = tag.exec(text));) {
        const props = [...m[0].matchAll(/\bdata-track-([a-z0-9-]+)\s*=/g)].map((x) => camel(x[1]));
        found.push({ name: m[2], props, file, line: lineAt(text, m.index) });
      }
    }
  }
  return found;
}

/** Compares usages with the catalog. Returns { errors, warnings, events }. */
export function checkUsages(usages, catalog) {
  const errors = [];
  const warnings = [];
  const where = (u) => `${u.file.replace(/\\/g, '/')}:${u.line}`;
  const byName = new Map();
  for (const u of usages) {
    if (!byName.has(u.name)) byName.set(u.name, []);
    byName.get(u.name).push(u);
  }
  for (const [name, list] of byName) {
    if (!NAME.test(name)) warnings.push(`"${name}" (${where(list[0])}): use snake_case object_action names, e.g. signup_clicked`);
    if (!catalog) continue;
    const entry = catalog[name];
    if (!entry) {
      errors.push(`"${name}" is not in the events catalog (${list.map(where).join(', ')})`);
      continue;
    }
    if (entry.props) {
      for (const u of list) for (const p of u.props) {
        if (!(p in entry.props)) warnings.push(`"${name}" sends prop "${p}", not declared in the catalog (${where(u)})`);
      }
    }
  }
  if (catalog) {
    for (const name of Object.keys(catalog)) {
      if (!byName.has(name)) warnings.push(`"${name}" is in the catalog but no track('${name}') or data-track="${name}" was found (it may be sent with a dynamic name)`);
    }
  }
  return { errors, warnings, events: byName };
}

/** A catalog skeleton for the events found, to paste into analytics.config.json. */
export function suggestCatalog(events, catalog = {}) {
  const out = {};
  for (const [name, list] of events) {
    if (catalog[name]) continue;
    const props = {};
    for (const u of list) for (const p of u.props) props[p] = '';
    out[name] = { label: '', description: '', ...(Object.keys(props).length ? { props } : {}) };
  }
  return out;
}
