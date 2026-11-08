# loglytics

Cookieless web analytics with **no server and no database**: a 1 KB script (gzipped), your
web server's access log and a static HTML report.

- **Nothing to run.** Your web server (Caddy, nginx…) already writes logs. The script sends
  a tiny request to `/e`, the server answers `204` and logs it. A command turns the log into
  one HTML page.
- **Private by design.** No cookies, no `localStorage`, no fingerprinting. IPs are truncated
  (IPv4 /24, IPv6 /48) and only used, together with the user agent and a random salt that
  is never stored, to count daily visitors. No consent banner needed for that.
- **Events without JavaScript.** `<button data-track="signup_clicked" data-track-plan="pro">`,
  or `track('signup_clicked', { plan: 'pro' })` from code. Counts per prop value and funnels.
- **An events catalog** in the config gives events readable names, and `loglytics check`
  compares your code with it: no typos, no forgotten events.
- **Made for AI agents too.** [AGENTS.md](AGENTS.md) and [llms.txt](llms.txt) tell coding
  agents exactly how to install it and add events.
- **Works with single-page apps.** Page views are tracked on `history.pushState` and back/forward.
- **Zero dependencies.** Node 18+.

> Not published on npm yet. Until it is, run it straight from GitHub with
> `npx github:DemboNauta/simple-analytics …` wherever this README says `npx loglytics …`.

## Quickstart

**1. Get your setup:**

```bash
npx loglytics init --site example.com
```

It detects Caddy or nginx and prints the exact server block, script tag and cron line, and
writes a starter `analytics.config.json`.

**2. Add the script** to every page and **the block** to your web server (also below:
[Caddy](#caddy), [nginx](#nginx)):

```bash
npx loglytics snippet > public/m.js
```

```html
<script src="/m.js" defer></script>
```

**3. Build the report**, by hand or from cron:

```bash
npx loglytics report /var/log/caddy/example.log -o /var/www/stats/index.html --tz Europe/Madrid
```

Open `stats.html`. Protect it with your web server's basic auth if it is public.

Try it without a site: `npm run demo` writes `demo/stats.html` from 30 days of fake traffic.

## The script

`m.js` (2 KB, 1 KB gzipped; readable source in [client/m.src.js](client/m.src.js)) sends one
request per page view:

| Param | Meaning |
|---|---|
| `p` | path, without query string |
| `r` | referring domain on the first page of a visit, or `utm_source` / `ref` |
| `w` | viewport width rounded to 50 px |
| `n`, `d` | event name and JSON props, for custom events |

## Events

**1. Declare them** in `analytics.config.json`. The report shows the labels and
descriptions, and warns about events that are not declared or never arrive:

```json
"events": {
  "signup_clicked": {
    "label": "Signup button",
    "props": { "plan": "free or pro", "place": "header, pricing…" }
  },
  "test_passed": { "label": "Test passed", "props": { "topic": "", "score": "out of 10" } }
}
```

**2. Send them.** Clicks, straight from the HTML:

```html
<button data-track="signup_clicked" data-track-plan="pro" data-track-place="pricing">Sign up</button>
```

`data-track-some-key` becomes the prop `someKey`. It works on elements added later too. From code:

```js
track('test_passed', { topic: 'brakes', score: 9 });
```

**3. Check** that code and catalog agree. It lists every event it finds, with file and line,
and prints the missing catalog entries ready to paste:

```bash
npx loglytics check src/
```

Name events `object_action` in the past tense (`signup_clicked`, `test_passed`) and put the
variants in props. No personal data in props. `m()` is a short alias of `track()`.

Calls made before the script loads are queued if you define the stub first:

```html
<script>window.track = window.track || function () { (track.q = track.q || []).push(arguments) }</script>
```

Options, as `data-` attributes on the script tag:

- `data-api="https://stats.example.com/e"`: send beacons somewhere else (e.g. to `loglytics serve`).
- `data-localhost`: also track on `localhost` (off by default).

Visitors with Do Not Track or Global Privacy Control enabled, and automated browsers
(`navigator.webdriver`), are not tracked.

## Caddy

Inside your site block:

```caddy
example.com {
	# Answer the beacon without touching the disk
	@beacon path /e
	respond @beacon 204

	log {
		output file /var/log/caddy/example.log {
			roll_size 50MiB
			roll_keep 10
		}
		# Never write full IPs or credentials
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
}
```

The log can hold all requests: `report` only reads the `/e` lines.

**Create the log file as the `caddy` user before validating.** `caddy validate` run as root
creates it owned by root, and then the running Caddy cannot open it and refuses the new config:

```bash
sudo install -o caddy -g caddy -m 640 /dev/null /var/log/caddy/example.log
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
``` Even if a log has full IPs, `report` truncates them before using them.

## nginx

```nginx
http {
    # Truncate IPs before they reach the log
    map $remote_addr $ip_anon {
        ~^(?P<a>\d+\.\d+\.\d+)\.\d+$              $a.0;
        ~^(?P<a>[0-9a-fA-F]*:[0-9a-fA-F]*:[0-9a-fA-F]*):  $a::;
        default                                    0.0.0.0;
    }
    map $http_cf_connecting_ip $cf_anon {
        ~^(?P<a>\d+\.\d+\.\d+)\.\d+$              $a.0;
        ~^(?P<a>[0-9a-fA-F]*:[0-9a-fA-F]*:[0-9a-fA-F]*):  $a::;
        default                                    "";
    }
    log_format loglytics escape=json
        '{"ts":"$time_iso8601","ip":"$ip_anon","cf_ip":"$cf_anon","method":"$request_method",'
        '"uri":"$request_uri","status":$status,"ua":"$http_user_agent"}';

    server {
        location = /e {
            access_log /var/log/nginx/loglytics.log loglytics;
            return 204;
        }
    }
}
```

The default `combined` log format also works, but it stores full IPs.

## Behind Cloudflare or another proxy

`report` takes the client IP from the `Cf-Connecting-Ip` header when the log has it, and
falls back to the connection address. Use `--ip-header X-Forwarded-For` (or `ipHeader` in the
config) for other proxies.

## No access to the logs?

On static hosts (Netlify, GitHub Pages…) run the collector somewhere and point the script at it:

```bash
npx loglytics serve --port 8787 --out events.log --ip-header X-Forwarded-For
```

```html
<script src="https://stats.example.com/m.js" data-api="https://stats.example.com/e" defer></script>
```

It writes one JSON line per beacon (IP already truncated), which `report` reads.

## Report options

```
loglytics report <log|dir|-> [...] [options]
  -o, --out <file>      stats.html by default; a .json file gets the raw data
  -c, --config <file>   ./analytics.config.json if present
  --days <n>            only the last n days
  --since / --until     YYYY-MM-DD
  --tz <zone>           e.g. Europe/Madrid (default: system time zone)
  --lang <en|es>        report language
  --title <text>
  --path <path>         beacon path (default /e)
  --ip-header <name>    default Cf-Connecting-Ip
```

Pass several files or a directory: rotated and `.gz` logs are read together.

`analytics.config.json` (all optional):

```json
{
  "title": "example.com",
  "lang": "en",
  "timezone": "Europe/Madrid",
  "exclude": ["/admin*"],
  "events": { "signup": { "label": "Signup", "props": { "plan": "free or pro" } } },
  "funnels": [
    {
      "name": "Docs to signup",
      "steps": ["/docs*", "/pricing", { "event": "signup", "props": { "plan": "pro" }, "label": "Pro signup" }]
    }
  ]
}
```

A funnel step is a path (`*` is a wildcard), an event name, or an object with `page` or
`event` + `props`. A visitor reaches a step when they did all the previous ones in order on
the same day.

## What is stored, and what is not

| Stored in the log | Never stored |
|---|---|
| time, path, referring domain, viewport width rounded to 50 px | cookies or any id on the device |
| event name and the props you send | full IP addresses (when configured as above) |
| user agent, truncated IP | the visitor id: it is a hash with a random salt that only lives during one `report` run |

Visitors are counted per day: someone who comes back on two days counts twice. That is
the price of not identifying anybody.

Don't send personal data (emails, names) in event props.

## For AI coding agents

Point your agent at [AGENTS.md](AGENTS.md): it says how to install loglytics, how to name and
declare events, and to finish with `loglytics check`. A prompt like "add loglytics to this
site and track how many people pass the test" is enough.

## Development

`npm test` runs the tests. Edit `client/m.src.js` and run `npm run build` to regenerate
`client/m.js` (a test fails if you forget).

## License

MIT
