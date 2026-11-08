# Using loglytics (instructions for coding agents)

loglytics is cookieless analytics: a small script sends beacons to `/e`, the web server
answers `204` and logs them, and `loglytics report` turns the log into a static HTML page.
There is no server, database, account or API key to set up.

Until it is on npm, replace `npx loglytics` with `npx github:DemboNauta/simple-analytics`.

## Add it to a site

1. Run `npx loglytics init --site <domain>` (add `--server nginx` if the site uses nginx).
   It prints the exact web server block, the script tag and a cron line, and writes
   `analytics.config.json`. Copy what it prints; do not write the server config by hand.
2. Save the script with `npx loglytics snippet > <public dir>/m.js` and add
   `<script src="/m.js" defer></script>` to every page, in the shared layout if there is one.
   Keep the file name `m.js`: names like `track.js` or `analytics.js` are blocked by ad blockers.
3. Page views, including single-page app navigation, are tracked automatically. Do not
   add page view calls.

## Add an event

Always in this order:

1. **Declare it** in `"events"` in `analytics.config.json`:

   ```json
   "events": {
     "signup_clicked": {
       "label": "Signup button",
       "description": "Click on any signup button",
       "props": { "plan": "free or pro", "place": "where the button is: header, pricing" }
     }
   }
   ```

2. **Send it.** For a plain click on an element, prefer attributes (no JavaScript):

   ```html
   <button data-track="signup_clicked" data-track-plan="pro" data-track-place="pricing">Sign up</button>
   ```

   `data-track-some-key` becomes the prop `someKey`. For anything with logic (a result, a
   score, a choice), call `track` from code:

   ```js
   track('test_passed', { topic: 'brakes', score: 9 });
   ```

   `track` is a global. In TypeScript, declare it once:
   `declare function track(name: string, props?: Record<string, string | number | boolean>): void;`

3. **Run `npx loglytics check <source dir>`.** It lists every `track('…')` and `data-track`
   found and compares them with the catalog. Fix every `error:` line; read the warnings.
   It exits with code 1 while there are errors.

## Rules

- Event names: English, snake_case, `object_action` with the action in the past tense:
  `signup_clicked`, `test_passed`, `video_played`, `question_answered`. One name per kind
  of action; put the variants in props (`place`, `plan`), not in the name. Use `start_clicked` +
  `{ place: 'header' }`, not `header_start_clicked`.
- Pass the name as a string literal. `check` cannot see `track(name)` with a variable.
- Props are short strings, numbers or booleans: ids, categories, small numbers. Never personal
  data (emails, names, user ids, free text typed by the user) and no URLs with query strings.
- Track decisions and outcomes (a test passed, a plan chosen), not every click. A good site
  has 5 to 20 event names.
- To measure a sequence (landing → pricing → signup), add a funnel instead of more events:

  ```json
  "funnels": [{ "name": "Signup", "steps": ["/", "/pricing", "signup_clicked"] }]
  ```

  A step is a path (`*` wildcard), an event name, or `{ "event": "...", "props": { ... } }`.

## Reading the report

`npx loglytics report <access log> -o stats.html` (add `--lang es` for Spanish). Use
`-o stats.json` to get the same data as JSON when you need to analyse it.
Under Events, the report flags events that are not in the catalog and catalog entries
that never arrived.
