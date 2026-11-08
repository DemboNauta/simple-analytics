!function (w, d) {
var nav = navigator, loc = location, hist = history, enc = encodeURIComponent;
var script = d.currentScript, opts = (script && script.dataset) || {};
var api = opts.api || (script && script.src ? new URL(script.src).origin : '') + '/e';
var queued = [].concat((w.track && w.track.q) || [], (w.m && w.m.q) || []);
var firstView = 1, lastPath, pushState = hist.pushState;
function bare(host) { return host.replace(/^www\./, ''); }
function send(name, props) {
if (nav.doNotTrack == '1' || nav.globalPrivacyControl || nav.webdriver) return;
if (opts.localhost == null && /^(localhost|127\.|\[::1\]$)/.test(loc.hostname)) return;
var ref = '', url;
if (!name && firstView) {
firstView = 0;
try { ref = bare(new URL(d.referrer).hostname); if (ref == bare(loc.hostname)) ref = ''; } catch (_) {}
var q = new URLSearchParams(loc.search);
ref = q.get('utm_source') || q.get('ref') || ref;
}
url = api + '?p=' + enc(loc.pathname) + '&w=' + Math.round(w.innerWidth / 50) * 50 +
(ref ? '&r=' + enc(ref) : '') +
(name ? '&n=' + enc(name) + (props ? '&d=' + enc(JSON.stringify(props)) : '') : '');
try { if (nav.sendBeacon(url)) return; } catch (_) {}
fetch(url, { method: 'POST', keepalive: true }).catch(function () {});
}
function pageview() {
if (loc.pathname != lastPath) { lastPath = loc.pathname; send(); }
}
d.addEventListener('click', function (e) {
var el = e.target.closest && e.target.closest('[data-track]');
if (!el) return;
var props = {}, any = 0;
for (var k in el.dataset) {
if (k.length > 5 && k.indexOf('track') == 0) {
props[k.charAt(5).toLowerCase() + k.slice(6)] = el.dataset[k];
any = 1;
}
}
send(el.dataset.track, any ? props : 0);
}, true);
hist.pushState = function () { pushState.apply(hist, arguments); pageview(); };
w.addEventListener('popstate', pageview);
w.track = w.m = function (name, props) { if (name) send(name, props); };
pageview();
queued.forEach(function (args) { w.track(args[0], args[1]); });
}(window, document);
