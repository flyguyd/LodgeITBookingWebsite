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
  {
    key: '0.1.4',
    version: '0.1.4',
    date: '2026-08-23T16:50:00+02:00',
    changes: [
      {
        headline:
          'Rates render the way Lodge Ops says they should. The new Booking Website settings page in Lodge Ops decides whether guests see one price with taxes and fees folded in (\u0027R 14,626, taxes & fees included\u0027) or the rate leading with \u0027+ R 2,125 taxes & fees\u0027 beneath it - and this service now carries that choice to the pages: it pulls site_config from the engine on the heartbeat cadence (a change in Lodge Ops reaches guests within about a minute), serves it publicly at /config.json, and both builds - full and mobile - render every price and every multi-suite summary through one shared rule. The rule never lies: a stay Cloudbeds does not itemise shows its plain rate in either mode, and nothing is ever invented.',
        detail:
          'SERVER: syncConfig() alongside the media sync - GET /api/booking/site-config over the service client, kept on parse failure (last good config wins), re-pulled every HEARTBEAT_MS; GET /config.json (public, no-store) hands it to the pages. CORE: priceParts(room, config) is the one pure pricing rule (shipped in core.js, window.__bk-exposed for the harness): separate \u2192 {headline: rate, note: {extras, kind: plus}}; inclusive (the default, config absent included) \u2192 {headline: rate+taxes+fees, kind: included}; no breakdown \u2192 plain headline, note null; unpriced \u2192 null. BOTH BUILDS: card prices, per-night derivation and the selection summary all flow through priceParts - in separate mode the summary total carries its own \u0027+ R x taxes & fees\u0027 for the combined party. VERIFIED: 12 checks - the compiled Lodge Ops bridge saving/round-tripping the config, the site serving it within its cadence, itemised figures through the full guest chain with honest nulls beside them, and the shipped priceParts under all five states - plus a real Chromium screenshot of the itemised card (R12,501 \u00b7 R4,167 a night \u00b7 + R2,125 taxes & fees).',
      },
    ],
  },
  {
    key: '0.1.5',
    version: '0.1.5',
    date: '2026-08-23T17:50:00+02:00',
    changes: [
      {
        headline:
          'Every word on the site, the logo, and whether sold-out suites appear are now Lodge Ops decisions. The Booking Website settings page can override every guest-facing string - brand, hero kicker and both headline lines (the last word of the second still renders gold-italic), subtitle, all three state messages, and the after-Continue note - with the site\u0027s own copy as the default wherever a field is left blank. A logo uploaded there replaces the masthead\u0027s star mark on both builds, travelling the same content-addressed media pipeline as the suite photography. And with Show Fully-Booked Suites on, sold-out suites appear in results dimmed and unselectable under a \u0027Fully booked for these dates\u0027 tag - price still shown, honesty intact - instead of vanishing.',
        detail:
          'CONFIG: site_config.text applied over the HTML defaults at boot (setText no-ops on blank, so defaults survive); the heroLine2 override rebuilds the gold-italic em on its last word. LOGO: rides the suite-media store under the reserved room id __site_logo__ - roomsView() skips __-prefixed ids so it can never appear as a suite, /config.json carries logoId, and the pages swap the star mark for MEDIA_BASE+logoId (mount-safe relative). UNAVAILABLE: results filter on available>0 unless config.showUnavailable, the empty state judges what is actually SHOWN, and a sold-out card renders with grayscale photography, the fully-booked tag, no add control and no interactions - in both builds. VERIFIED: 15-check live E2E (system-actor auto sync staying out of the audit log on no-ops, the self-explaining 404, logo upload/re-upload idempotence, logoId in config, the logo never listed as a suite, bytes served from the cache, text + showUnavailable round-tripping to the pages, a sold-out suite flowing through availability) plus Chromium screenshots: the custom-branded hero with uploaded logo and the sold-out card beside a bookable one. Counterpart: Lodge Ops 1.2.122 (the controls + the 15-minute automatic imagery sync).',
      },
    ],
  },
  {
    key: '0.1.6',
    version: '0.1.6',
    date: '2026-08-23T13:45:00+02:00',
    changes: [
      {
        headline:
          'The suite cards now speak with the lodge\u0027s own voice, end to end. Every Guest Suites setting made in Lodge Ops - the staff-written description, occupancy (maximum total guests preferred over the provider figure), pool arrangement, build style, the full amenity list, and the new additional guest costs per adult, child and infant - is replicated through the engine, cached in this service\u0027s own datastore, and rendered on both builds: descriptions win over the provider\u0027s copy, amenities appear as a quiet chip row, and extra-guest pricing reads plainly (\u0027Extra guests per night: adult R350 \u00b7 child R200 \u00b7 infant free\u0027 - a configured zero honestly means free, an unset field says nothing). The lodge-wide conservation levy and VAT from the same settings page appear as one italic line under the results heading on both builds, and never render when unset.',
        detail:
          'SERVER: syncSuiteContent() beside syncConfig() on the heartbeat cadence - GET /api/booking/suite-content over the service client, persisted to DATA_DIR/suite-content.json so a restart (or unreachable engine) never blanks the pages, served publicly at /suites.json. CORE: three new pure helpers, __bk-exposed - levyLine() (maps all five conservation bases to words, null when not levied), vatLine() (null when absent), extraGuestsLine() (only fields the lodge set; 0 renders as free). BOTH BUILDS: suites.json fetched at boot (mount-safe relative, ../suites.json from /m/); per-card merge prefers replicated description/maxTotalGuests, adds pool/style chips, an amenity chip row and the extra-guests line; the mobile build gained a 2-line-clamped description it never had; stayNote element under the results heading carries levy + VAT. VERIFIED: 14-check live E2E through the compiled Lodge Ops bridge (first push, diff-aware no-op re-run surviving JSONB key reordering, levy change flowing to /suites.json within the cadence, unset fields omitted, disk cache present) plus Chromium screenshots of both builds: amenity chips, extra-guest line, the levy/VAT note, and a sold-out card carrying its replicated content untouched. Counterparts: engine 0.1.12 (migration 008), Lodge Ops 1.2.123 (the fields + the sync).',
      },
    ],
  },
  {
    key: '0.1.7',
    version: '0.1.7',
    date: '2026-08-23T15:15:00+02:00',
    changes: [
      {
        headline:
          'Three changes to how a stay is chosen. The Arrive field now opens a custom glass calendar instead of the native picker - and every day shows the cheapest available suite for that night (\u0027R12.5k\u0027 under the date, sold-out nights dimmed with a dash, past days disabled), fed by the engine\u0027s new cached rate-calendar route so the figures cost the provider almost nothing. The Depart date is gone: guests choose NIGHTS from a dropdown of 2 to 14, and picking More\u2026 swaps the dropdown for a free text box (up to the 30-night limit; emptying it steps back to the dropdown) - departure is derived as arrival plus nights. And search results now list suites in the display order set on the Lodge Ops Guest Suites page, which travels with the replicated suite content as sortOrder.',
        detail:
          'CALENDAR: shared calendar.js + calendar.css used by BOTH builds (mount-safe relative loads); month cache with in-flight de-dupe, rates filled in after an instant skeleton render, Monday-first grid, compact rate format (fmtShort, __bkcal-exposed), Escape/outside-click close, scrollIntoView so the month is never below the fold; the input flips to readonly text and keeps ISO in .value so the form code is untouched. Rates ride the new GET /api/public/rate-calendar forward route (allow-listed in FORWARD_ROUTES, guest rate limiting applies). NIGHTS: 2-14 + More\u2026 in both builds, custom box min 2 max 30 with honest inline messages (over 30 answers with the lodge-direct line before the engine is even asked), departure computed via the new core addDays(). ORDER: suiteOrdered() sorts visible results by suites[id].sortOrder from /suites.json, unknown ids keep their place at the end. VERIFIED: 14-check Chromium E2E on the live chain - rates in the cells, pick sets the field and closes, dropdown swap and restore, 16-night custom search, Family Villa listed first on both builds per the replicated order - plus fresh screenshots of the calendar on desktop and mobile. Counterparts: engine 0.1.14 (the rate-calendar route), Lodge Ops 1.2.124 (sortOrder in the replication).',
      },
    ],
  },
  {
    key: '0.1.8',
    version: '0.1.8',
    date: '2026-08-23T15:55:00+02:00',
    changes: [
      {
        headline:
          'Five changes in one sweep. The reception-desk chat widget from 7starlodges.com now rides both builds (served by the Lodge Ops API, same origin through the edge nginx; where that API is absent the script 404s silently and the site runs without chat) - and it knows to lift clear of the conversion bar the moment a suite is picked. The rate calendar grew up: two months side by side on wider screens, one larger month on phones, bigger type throughout, and a hard bookable window - nothing in the past, nothing more than three years out, with the month arrows stopping at the edges. The Nights dropdown is dressed in the site\u0027s own glass (the native popup cannot be styled; the real select stays hidden underneath as the value holder, so the form logic never changed). The default stay is now 4 nights. And the 5th-night promotion: option 5 reads \u00275 - 5th night\u2019s accommodation free\u0027 right in the list, and on stays of 5+ nights each suite\u0027s total is re-priced - the 5th night charged at the full one-night conservation levy plus 76.4% of the nightly rate (the board share) plus VAT on that charged portion, instead of the full rate - with a gold pill on every re-priced card.',
        detail:
          'CHAT: /api/web/embed.js (absolute, async) on both pages; #oa-web-chat gets transition + lift rules - above the centred summary under 1100px on the full build, above the sticky bar (calc(158px + safe-area)) on mobile whenever #summary is visible, both via sibling selectors and !important over the widget\u0027s inline styles. CALENDAR: cal-double layout via matchMedia at 720px, per-month titles, absolute nav arrows that disable at the minIso/maxIso month horizon (site passes today and +1095 days), out-of-window days disabled like past ones. GLASS SELECT: BKCal.glassSelect() - trigger + popover in calendar.css, real change events dispatched, [hidden] mirrored by MutationObserver so the More\u2026 swap logic stayed untouched, data-short keeps the closed trigger to \u00275\u0027. PROMO: core fifthNightAdjust() + levyForNight() (night-based levy bases only; per-stay bases honestly add nothing; party = adults + children, infants never levied). DOCUMENTED ASSUMPTION: VAT applies to the charged board portion - one line to change if it should be the full nightly rate. Exactly ONE night adjusted per stay, and a guard refuses the promo when the \u0027free\u0027 night would cost MORE than the rate (low nightly rates vs a per-person levy) - a promo may never be a markup. VERIFIED: 26 Chromium checks across two E2E suites with the REAL compiled embed.js fulfilled at its live path, plus unit maths (villa 18900/5 nights re-priced to 18791 with the pill; lux 12500 correctly guarded; 7 nights still adjusts exactly one night) and fresh screenshots of the double calendar, glass dropdown, promo list and lifted launcher.',
      },
    ],
  },
  {
    key: '0.1.9',
    version: '0.1.9',
    date: '2026-08-23T16:40:00+02:00',
    changes: [
      {
        headline:
          'The calendar now books a whole stay in two clicks. The first click picks check-in and the calendar STAYS OPEN; hovering a later day shades the stay in between, and clicking it picks checkout - the nights are computed and the Nights control follows by itself (2-14 lands on the dropdown, longer stays fill the More box). A click at or before check-in - including the next-day tap, since the stay floor is two nights - simply restarts the range. Past days are no longer asked for at all (their cells were already disabled; now the rate request itself starts at today). Four polish fixes ride along: the search bar holds ONE row with the button beside the fields; the open calendar now stacks ABOVE the state cards and results below it (the glass bar\u0027s backdrop-filter creates a stacking context, so the whole bar is raised, not the calendar inside it); the Nights list scrollbar wears the site\u0027s gold-on-glass; and the replicated Lodge Ops logo sits top-left on the mobile build too, matching the full build\u0027s masthead.',
        detail:
          'CALENDAR: rangeStart state per open (reset on open AND close), data-iso on every cell, cellIndex across the visible months, mouseover delegation for the in-range preview, onRange(from, nights) callback; loadMonth clamps its fetch window to minIso and answers an all-past month locally. BOTH BUILDS: setNights(n) drives the dropdown/More-box split and dispatches a real change event so the glass trigger, lastNights and every listener follow. Z-ORDER: .bar-wrap (full) and .panel (mobile) get position:relative + z-index:30 - the calendar could NEVER out-stack a later .glass sibling from inside the form\u0027s own stacking context, whatever its z-index. ONE ROW: .bar flex-wrap nowrap (wrapping again under 860px), tighter field bases, min-width:0, the CTA flex none beside the fields. VERIFIED: 16 Chromium checks - range picks on both builds, the hover preview counting exactly the nights between, the earlier-click restart, a 20-night range landing in the More box, request interception proving no past-day fetch, elementFromPoint proving the calendar paints over the results, the one-row bar, and the mobile logo 6px off the hero\u0027s left edge.',
      },
    ],
  },
];
