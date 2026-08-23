/**
 * Build notes — one entry per shipped version, newest LAST, the Lodge Ops
 * convention carried over: never extend an already-shipped key, the appending
 * diff must show zero removed lines, and `node -e "import('./server/src/build-notes.mjs')
 * .then(m => console.log(m.BUILD_NOTES.length))"` must parse after every append.
 */

export const BUILD_NOTES = [
  {
    key: '0.1.0',
    version: '0.1.0',
    date: '2026-08-23T00:40:00+02:00',
    changes: [
      {
        headline:
          'The booking website becomes its own product. Split out of the engine repo (Dave, 2026-08-22): this repo carries the guest-facing site (site/ - one HTML, one CSS, one vanilla JS file, framework-free per spec §23) AND the only public-facing service in the booking stack (server/ - a zero-dependency Node server). The engine is now fully private; guests only ever touch this service, which serves the static site, rate-limits per IP, and forwards exactly FOUR allow-listed guest calls (status, availability, sessions, events) to the engine\u0027s private booking API over its own HMAC service client. Anything not on the allow-list does not exist publicly.',
        detail:
          'CONFIGURATION IS WIRING ONLY: PORT, ENGINE_URL, CLIENT_KEY, CLIENT_SECRET, optional SITE_PUBLIC_URL and rate-limit tunables - no business configuration lives here; everything operational is driven from Lodge Ops through the engine. THE SERVER: node:http, zero deps; static serving with traversal-proof path resolution (decode, null-byte refusal, resolved-prefix check) and directory-ish paths landing on index.html; guest API calls rate-limited (default 120/60s per IP, X-Forwarded-For last-hop aware) then signed with the shared three-way HMAC format (ts.METHOD.path.sha256(rawBody) - identical strings in the engine\u0027s ServiceAuthGuard and Lodge Ops\u0027 BookingEngineService; change one side and everything 401s); engine-down maps to a calm 503 BOOKING_UNAVAILABLE; POST bodies capped at 64KB. HEARTBEAT: on boot and every minute the server reports {version, uptimeSec, siteUrl} to the engine\u0027s site-heartbeat endpoint, so Lodge Ops sees this service\u0027s health on the Booking Engine page without this service exposing ANY admin surface - /health (version + engine reachability) is its only non-guest route. Pure logic lives in server/src/lib.mjs so harnesses execute shipped code: signHeaders, createRateLimiter, safeSitePath, mimeFor, forwardTargetFor.',
      },
    ],
  },
  {
    key: '0.1.1',
    version: '0.1.1',
    date: '2026-08-23T12:30:00+02:00',
    changes: [
      {
        headline:
          'The website has a deploy script, the same shape as the engine\u0027s. deploy/deploy.sh, run as root from the deploy checkout (/root/BookingEngine/LodgeITBookingWebsite), does the whole cycle in one command: pull main showing exactly what changed (new commits + files-changed summary, pager-free so nothing can capture the console), sync the files into /opt/lodgeit-site, restart the lodgeit-site service, and verify /health. Simpler than the engine\u0027s on purpose - this service is zero-dependency node with no build step and no database, so there is no npm install and no schema guard. The sync never touches /opt/lodgeit-site/.env, and an unreachable engine after deploy is a loud WARNING, not a failure: the site is designed to stay up and serve its calm unavailable state while the engine is down.',
        detail:
          'THE SEQUENCE: (1) git pull --ff-only --quiet with old/new HEAD captured - up to date prints the current commit, otherwise git --no-pager log --oneline and diff --stat between the heads; a refused fast-forward aborts with the deploy-only-checkout warning; (2) rsync -a --delete --exclude .git --exclude .env checkout/ \u2192 /opt/lodgeit-site/ then chown oase:oase - the exclude is what keeps the wiring alive under --delete; (3) FIRST-RUN GATES: missing .env prints the full wiring template (PORT, ENGINE_URL, CLIENT_KEY, CLIENT_SECRET from the Lodge Ops Service clients card, SITE_PUBLIC_URL) and exits without restarting; missing systemd unit points at the runbook and exits - files stay installed either way; (4) systemctl restart + up to 15s polling /health, then assertions: ok=true and running version equals the repo VERSION (deploy landed) are failures; engineReachable=false is a WARNING naming the three usual causes (ENGINE_URL, engine service, inactive or mismatched site client). Caller\u0027s directory never changed. VERIFIED end to end in a sandbox with a substituted install root: real install ran, both first-run gates fired with their messages, the verify tail ran against a LIVE installed copy (ok/version green, the engine-down warning branch rendered), and REAL rsync was proven to preserve an existing .env under --delete while removing stray files and never syncing .git.',
      },
    ],
  },
  {
    key: '0.1.2',
    version: '0.1.2',
    date: '2026-08-23T12:58:00+02:00',
    changes: [
      {
        headline:
          'The site reports its own performance. A zero-cost in-process recorder counts everything a guest does to this service - pages and assets served (with bytes), the four forwarded API calls timed per route at the site edge (so the figures include the engine round trip), rate-limited 429s, oversize 413s, guessed-URL 404s, and every call answered 503 because the engine did not respond - plus the process itself (memory, event-loop lag). The whole snapshot rides the existing minute heartbeat to the engine, comes back out of the engine\u0027s GET /api/engine/stats, and lands on the Lodge Ops Performance page over its websocket. Still no admin surface here: the site talks, Lodge Ops listens.',
        detail:
          'lib.mjs gains createStatsRecorder(nowFn) - a PURE factory (injectable clock) so harnesses drive it deterministically: per-route 300-sample duration rings for honest p50/p95/max, a 60-bucket per-second window for the rolling one-minute rates, and counters that survive the window (totals never reset while the process lives; sinceSec says how long that is). server.mjs records at every exit point: static hit (with bytes) / static miss / allow-list 404 / 429 / 413 / forward (route key, status, duration, engine-down flag) / health hit; event-loop lag sampled every 5s unref\u0027d; RSS and heap read at heartbeat time. The heartbeat body simply gains stats: {...} - the engine caps it at 16KB and strips it back out of status so only the stats endpoint carries it. VERIFIED twice over: the pure recorder from the SHIPPED lib.mjs under an injected clock (8 checks: rate-window emptying while totals persist, ring wrap at 400 samples, percentile honesty) and the LIVE chain (site \u2192 engine \u2192 signed stats read: static hits/bytes/misses, 429 counts matching the driven burst, per-route counts and percentiles, the 501 forward counted as an error on its route, zero engine-down in a healthy chain). Counterparts: engine 0.1.7 relays; Lodge Ops 1.2.118 displays.',
      },
    ],
  },
  {
    key: '0.1.3',
    version: '0.1.3',
    date: '2026-08-23T15:50:00+02:00',
    changes: [
      {
        headline:
          'The site becomes what it should look like: a high-end travel magazine behind liquid glass (Dave, 2026-08-23), in TWO complete builds - the full site for web and tablet, and a separate mobile build tuned for one thumb and maximum conversion. Both share one visual language: a slow aurora of lagoon-and-gold light drifting behind frosted glass panels, film grain, oversized editorial serif headlines, and immediate feedback on everything a guest touches - cards lift and their photography scales on hover, buttons carry a light sweep and compress on press, the selection bar springs up from the bottom. Guests can now take MORE THAN ONE suite: cards toggle into the stay, a quantity stepper appears when a type has spare units, and the glass summary carries the combined party and total. Phones landing on the site are routed to the mobile build automatically (with a View-the-full-site escape); the mobile build swaps selects for thumb-sized steppers, keeps inputs at 16px so iOS never zooms, and pins total + Continue in a sticky glass bar. Suite photography is the lodge\u0027s own, synced from Lodge Ops through the engine into this service\u0027s OWN datastore - guests are served from local disk, with Cloudbeds photos then a generative dusk-gradient treatment as the graceful fallbacks.',
        detail:
          'STRUCTURE: site/core.js is the shared brain (API contract, session + \u00a716/\u00a717 analytics with a surface marker, pure helpers incl. hueFor - still window.__bk for the harness); site/index.html+css+js is the desktop build, site/m/* the mobile build; both are presentation-only over the core. All states preserved and restyled: shimmer skeletons while loading, calm maintenance / being-prepared / fully-booked cards, factual-only scarcity pills. MULTI-SELECT: picks keyed by roomTypeId with per-type qty capped at roomsAvailable; removals tracked as room_selected {action:removed} to stay inside the engine\u0027s CHECKed event taxonomy; checkout_started carries every {roomTypeId, qty} and the combined total; the session state checkpoint carries the full selection for abandoned-booking follow-up. SERVER: GET / sniffs Mobi|iPhone|Windows Phone and 302s to a RELATIVE m/ (survives the /book/ path-mount; ?full=1 opts out, Vary: User-Agent); the media cache syncs from the engine every MEDIA_SYNC_MS (10 min default) into SITE_DATA_DIR (default ./data, EXCLUDED from the deploy rsync) - content-addressed ids, prune on removal, served at /media/:id with immutable year-long cache headers and a public /media/rooms.json manifest; media URLs in the pages are RELATIVE so the path-mount resolves them. TWO TRAPS HIT AND FIXED DURING VISUAL VERIFICATION, both found on real screenshots: the [hidden]-vs-display:flex rule (steppers showed on unselected cards - a global [hidden]{display:none!important} now guards both builds) and flex min-content overflow clipping the mobile panel at 390px. VERIFIED: 18-check pipeline E2E (media sync, prune, immutable serving, byte-hash integrity, UA routing incl. relative redirect + opt-out) and REAL Chromium screenshots of both builds against the live chain - hero, results with synced photography, and the multi-suite selection state on each. prefers-reduced-motion honoured throughout; no external requests except the suites\u0027 own photographs.',
      },
    ],
  },
];
