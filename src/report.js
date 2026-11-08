// Render report data as one self-contained HTML page (no JS, no external assets).

const I18N = {
  en: {
    title: 'Analytics', visitors: 'Visitors', pageviews: 'Pageviews', perVisitor: 'Views per visitor', events: 'Events',
    daily: 'Visitors per day', pages: 'Top pages', page: 'Page', sources: 'Sources', source: 'Source', direct: 'Direct / none',
    screens: 'Screens', screen: 'Screen', count: 'Count', funnels: 'Funnels', step: 'Step', conv: 'Conversion',
    noData: 'No data in this range.', generated: 'Generated', bots: 'bot hits ignored', date: 'Date',
    visitorsNote: 'Visitors are counted per day (no cookies), so a person who comes back on two days counts twice.',
    tableView: 'Show as table', value: 'Value', unknown: 'unknown', phone: 'phone', tablet: 'tablet', laptop: 'laptop', desktop: 'desktop',
    noEvents: 'No custom events yet. Call m("name", { key: "value" }) on your site.',
  },
  es: {
    title: 'Analítica', visitors: 'Visitantes', pageviews: 'Páginas vistas', perVisitor: 'Páginas por visitante', events: 'Eventos',
    daily: 'Visitantes por día', pages: 'Páginas más vistas', page: 'Página', sources: 'Procedencia', source: 'Origen', direct: 'Directo / ninguno',
    screens: 'Pantallas', screen: 'Pantalla', count: 'Veces', funnels: 'Embudos', step: 'Paso', conv: 'Conversión',
    noData: 'No hay datos en este periodo.', generated: 'Generado', bots: 'visitas de bots ignoradas', date: 'Fecha',
    visitorsNote: 'Los visitantes se cuentan por día (sin cookies): quien vuelve dos días distintos cuenta dos veces.',
    tableView: 'Ver como tabla', value: 'Valor', unknown: 'desconocida', phone: 'móvil', tablet: 'tableta', laptop: 'portátil', desktop: 'escritorio',
    noEvents: 'Aún no hay eventos propios. Llama a m("nombre", { clave: "valor" }) en tu web.',
  },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmt(n, lang) {
  return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-US', { maximumFractionDigits: 1 }).format(n);
}

function barTable(rows, { head, label, value, lang, limit = 50 }) {
  if (!rows.length) return '';
  const max = Math.max(...rows.map(value), 1);
  const body = rows.slice(0, limit).map((r) => {
    const v = value(r);
    return `<tr><td class="lbl"><span class="bar" style="width:${((v / max) * 100).toFixed(1)}%"></span><span class="txt">${label(r)}</span></td><td class="num">${fmt(v, lang)}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>${esc(head[0])}</th><th class="num">${esc(head[1])}</th></tr></thead><tbody>${body}</tbody></table>`;
}

function dailyChart(days, t, lang) {
  if (!days.length) return '';
  const W = 800, H = 220, top = 16, bottom = 28, left = 36;
  const plotW = W - left, plotH = H - top - bottom;
  const max = Math.max(...days.map((d) => d.visitors), 1);
  const step = plotW / days.length;
  const bw = Math.max(1, step - 2);
  const r = Math.min(4, bw / 2);
  const y0 = top + plotH;
  const bars = days.map((d, i) => {
    const x = left + i * step + (step - bw) / 2;
    const h = (d.visitors / max) * plotH;
    const tip = `${d.date}: ${fmt(d.visitors, lang)} ${t.visitors.toLowerCase()}, ${fmt(d.pageviews, lang)} ${t.pageviews.toLowerCase()}`;
    const shape = h <= 0
      ? `<rect x="${x.toFixed(1)}" y="${y0 - 1}" width="${bw.toFixed(1)}" height="1" class="zero"/>`
      : h < r
        ? `<rect x="${x.toFixed(1)}" y="${(y0 - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"/>`
        : `<path d="M${x.toFixed(1)},${y0}V${(y0 - h + r).toFixed(1)}q0,-${r} ${r},-${r}h${(bw - 2 * r).toFixed(1)}q${r},0 ${r},${r}V${y0}Z"/>`;
    // Full-height transparent hit target so the tooltip works on small bars too.
    return `<g class="b"><title>${esc(tip)}</title><rect class="hit" x="${(left + i * step).toFixed(1)}" y="${top}" width="${step.toFixed(1)}" height="${plotH}"/>${shape}</g>`;
  }).join('');
  const grid = [0.5, 1].map((f) => {
    const y = (y0 - f * plotH).toFixed(1);
    return `<line x1="${left}" x2="${W}" y1="${y}" y2="${y}" class="grid"/><text x="${left - 6}" y="${y}" dy="4" text-anchor="end">${fmt(Math.round(max * f), lang)}</text>`;
  }).join('');
  const ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((i) => {
      const anchor = days.length === 1 ? 'middle' : i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle';
      const x = anchor === 'start' ? left : anchor === 'end' ? W : left + i * step + step / 2;
      return `<text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${esc(days[i].date)}</text>`;
    }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t.daily)}">${grid}<line x1="${left}" x2="${W}" y1="${y0}" y2="${y0}" class="axis"/>${bars}${ticks}</svg>`;
}

export function renderHtml(data, { lang = 'en', title } = {}) {
  const t = I18N[lang] || I18N.en;
  const pageTitle = title || t.title;
  const { totals } = data;
  const n = (v) => fmt(v, lang);
  const range = data.range.from ? (data.range.from === data.range.to ? data.range.from : `${data.range.from} → ${data.range.to}`) : '';

  const tiles = [
    [t.visitors, n(totals.visitors)],
    [t.pageviews, n(totals.pageviews)],
    [t.perVisitor, totals.visitors ? n(totals.pageviews / totals.visitors) : '–'],
    [t.events, n(totals.events)],
  ].map(([k, v]) => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`).join('');

  const dailyTable = `<details><summary>${esc(t.tableView)}</summary>${`<table><thead><tr><th>${t.date}</th><th class="num">${t.visitors}</th><th class="num">${t.pageviews}</th><th class="num">${t.events}</th></tr></thead><tbody>${data.days.map((d) => `<tr><td>${esc(d.date)}</td><td class="num">${n(d.visitors)}</td><td class="num">${n(d.pageviews)}</td><td class="num">${n(d.events)}</td></tr>`).join('')}</tbody></table>`}</details>`;

  const pages = barTable(data.pages, { head: [t.page, t.pageviews], label: (r) => esc(r.path), value: (r) => r.pageviews, lang });
  const sources = barTable(data.sources, { head: [t.source, t.visitors], label: (r) => (r.source ? esc(r.source) : `<em>${esc(t.direct)}</em>`), value: (r) => r.visitors, lang });
  const screens = barTable(data.screens, { head: [t.screen, t.visitors], label: (r) => esc(t[r.screen] || r.screen), value: (r) => r.visitors, lang });

  const events = data.events.length
    ? data.events.map((e) => {
      const props = e.props.map((p) => `<h4>${esc(p.key)}</h4>${barTable(p.values, { head: [t.value, t.count], label: (r) => esc(r.value), value: (r) => r.count, lang, limit: 20 })}`).join('');
      return `<div class="event"><h3><code>${esc(e.name)}</code> <span class="muted">${n(e.count)} · ${n(e.visitors)} ${esc(t.visitors.toLowerCase())}</span></h3>${props}</div>`;
    }).join('')
    : `<p class="muted">${esc(t.noEvents)}</p>`;

  const funnels = data.funnels.map((f) => {
    const first = f.steps[0]?.visitors || 0;
    const rows = f.steps.map((s, i) => {
      const pct = first ? (s.visitors / first) * 100 : 0;
      const prev = i > 0 && f.steps[i - 1].visitors ? ` <span class="muted">(${n((s.visitors / f.steps[i - 1].visitors) * 100)}% ${lang === 'es' ? 'del anterior' : 'of previous'})</span>` : '';
      return `<tr><td class="lbl"><span class="bar" style="width:${pct.toFixed(1)}%"></span><span class="txt">${i + 1}. ${esc(s.label)}</span></td><td class="num">${n(s.visitors)}</td><td class="num">${n(pct)}%${prev}</td></tr>`;
    }).join('');
    return `<h3>${esc(f.name)}</h3><table><thead><tr><th>${t.step}</th><th class="num">${t.visitors}</th><th class="num">${t.conv}</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join('');

  const empty = !data.days.length;
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(pageTitle)}</title>
<style>
:root{color-scheme:light;--bg:#fcfcfb;--card:#ffffff;--line:#e6e5e1;--ink:#0b0b0b;--ink2:#52514e;--muted:#7a7974;--accent:#2a78d6;--accent-soft:#2a78d61f}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#121211;--card:#1a1a19;--line:#2e2d2b;--ink:#f0efec;--ink2:#c3c2b7;--muted:#8f8e86;--accent:#3987e5;--accent-soft:#3987e533}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 48px}
header h1{margin:0;font-size:24px}
header p{margin:4px 0 0;color:var(--ink2)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0}
.tile,.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.tile .k{color:var(--ink2);font-size:13px}
.tile .v{font-size:28px;font-weight:650;font-variant-numeric:tabular-nums}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:12px;margin-top:12px}
.card{margin-top:12px;min-width:0}
h2{font-size:16px;margin:0 0 10px}
h3{font-size:15px;margin:16px 0 6px}
h4{font-size:13px;margin:10px 0 4px;color:var(--ink2);font-weight:600}
.event+.event{border-top:1px solid var(--line);margin-top:12px}
.muted{color:var(--muted);font-weight:400;font-size:13px}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th{font-size:12px;color:var(--muted);font-weight:500;text-align:left;padding:4px 0;border-bottom:1px solid var(--line)}
td{padding:3px 0;font-variant-numeric:tabular-nums}
th.num,td.num{text-align:right;width:7.5em;padding-left:8px}
td.lbl{position:relative}
td.lbl .bar{position:absolute;left:0;top:2px;bottom:2px;background:var(--accent-soft);border-radius:0 4px 4px 0}
td.lbl .txt{position:relative;display:block;padding:0 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chart{width:100%;height:auto;display:block}
.chart text{fill:var(--muted);font-size:12px}
.chart .grid{stroke:var(--line);stroke-dasharray:3 3}
.chart .axis{stroke:var(--line)}
.chart .b path,.chart .b rect:not(.hit){fill:var(--accent)}
.chart .b rect.zero{fill:var(--line)}
.chart .hit{fill:transparent}
.chart .b:hover path,.chart .b:hover rect:not(.hit){opacity:.75}
details{margin-top:8px}
summary{cursor:pointer;color:var(--ink2);font-size:13px}
code{font:13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
footer{margin-top:24px;color:var(--muted);font-size:12px}
</style>
</head>
<body>
<main>
<header><h1>${esc(pageTitle)}</h1><p>${esc(range)}</p></header>
${empty ? `<div class="card"><p>${esc(t.noData)}</p></div>` : `
<section class="tiles">${tiles}</section>
<section class="card"><h2>${esc(t.daily)}</h2>${dailyChart(data.days, t, lang)}${dailyTable}<p class="muted">${esc(t.visitorsNote)}</p></section>
<div class="grid2">
<section class="card"><h2>${esc(t.pages)}</h2>${pages}</section>
<section class="card"><h2>${esc(t.sources)}</h2>${sources}<h2 style="margin-top:20px">${esc(t.screens)}</h2>${screens}</section>
</div>
<section class="card"><h2>${esc(t.events)}</h2>${events}</section>
${funnels ? `<section class="card"><h2>${esc(t.funnels)}</h2>${funnels}</section>` : ''}`}
<footer>${esc(t.generated)} ${esc(data.generatedAt.slice(0, 16).replace('T', ' '))} UTC · ${n(totals.bots)} ${esc(t.bots)}</footer>
</main>
</body>
</html>
`;
}
