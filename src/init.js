// `loglytics init`: prints everything needed to set a site up, for the detected (or given)
// web server, and writes a starter analytics.config.json if there is none.
import fs from 'node:fs';
import path from 'node:path';

function onPath(bin) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  return dirs.some((d) => exts.some((x) => fs.existsSync(path.join(d, bin + x))));
}

export function detectServer() {
  if (fs.existsSync('/etc/caddy/Caddyfile') || onPath('caddy')) return 'caddy';
  if (fs.existsSync('/etc/nginx/nginx.conf') || onPath('nginx')) return 'nginx';
  return null;
}

export function caddyBlock(site, log) {
  return `${site} {
	# loglytics: answer the beacon and log it, with truncated IPs
	@loglytics path /e
	respond @loglytics 204
	log {
		output file ${log} {
			roll_size 50MiB
			roll_keep 10
		}
		format filter {
			request>remote_ip ip_mask {
				ipv4 24
				ipv6 48
			}
			request>client_ip ip_mask {
				ipv4 24
				ipv6 48
			}
			request>headers>Cf-Connecting-Ip ip_mask {
				ipv4 24
				ipv6 48
			}
			request>headers>Cookie delete
			request>headers>Authorization delete
		}
	}

	# ...the rest of your site
}`;
}

export function nginxBlock(log) {
  return `# In the http { } block:
map $remote_addr $loglytics_ip {
    ~^(?P<a>\\d+\\.\\d+\\.\\d+)\\.\\d+$                 $a.0;
    ~^(?P<a>[0-9a-fA-F]*:[0-9a-fA-F]*:[0-9a-fA-F]*):  $a::;
    default                                        0.0.0.0;
}
map $http_cf_connecting_ip $loglytics_cf {
    ~^(?P<a>\\d+\\.\\d+\\.\\d+)\\.\\d+$                 $a.0;
    ~^(?P<a>[0-9a-fA-F]*:[0-9a-fA-F]*:[0-9a-fA-F]*):  $a::;
    default                                        "";
}
log_format loglytics escape=json
    '{"ts":"$time_iso8601","ip":"$loglytics_ip","cf_ip":"$loglytics_cf","method":"$request_method",'
    '"uri":"$request_uri","status":$status,"ua":"$http_user_agent"}';

# In your server { } block:
location = /e {
    access_log ${log} loglytics;
    return 204;
}`;
}

export function starterConfig({ site }) {
  return {
    title: site,
    lang: 'en',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    exclude: [],
    events: {},
    funnels: [],
  };
}

export function init({ server, site = 'example.com', log, name = 'loglytics', write = true }) {
  server = server || detectServer() || 'caddy';
  if (!['caddy', 'nginx'].includes(server)) throw new Error(`Unknown server "${server}" (use caddy or nginx)`);
  log = log || (server === 'caddy' ? `/var/log/caddy/${site}.log` : '/var/log/nginx/loglytics.log');
  const lines = [];
  lines.push(`# loglytics setup for ${site} (${server})`, '');
  lines.push('## 1. The script: save it next to your pages and load it on every page', '');
  lines.push(`npx ${name} snippet > public/m.js`, '', '<script src="/m.js" defer></script>', '');
  lines.push(`## 2. ${server === 'caddy' ? 'Caddyfile' : 'nginx'}`, '');
  lines.push(server === 'caddy' ? caddyBlock(site, log) : nginxBlock(log), '');
  lines.push(server === 'caddy' ? 'Then: caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy' : 'Then: nginx -t && systemctl reload nginx', '');
  lines.push('## 3. The report, every hour (crontab -e)', '');
  lines.push(`0 * * * * cd /path/with/analytics.config.json && npx ${name} report ${log}* -o /var/www/stats/index.html`, '');
  lines.push('## 4. Events', '');
  lines.push('Declare each event in "events" in analytics.config.json, then send it:');
  lines.push("  track('signup_clicked', { plan: 'pro' })");
  lines.push('  <button data-track="signup_clicked" data-track-plan="pro">');
  lines.push(`Run "npx ${name} check <src dir>" to compare the code with the catalog.`);
  let wrote = false;
  if (write && !fs.existsSync('analytics.config.json')) {
    fs.writeFileSync('analytics.config.json', JSON.stringify(starterConfig({ site }), null, 2) + '\n');
    wrote = true;
  }
  return { text: lines.join('\n') + '\n', wrote, server };
}
