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
  {
    key: '0.1.10',
    version: '0.1.10',
    date: '2026-08-23T17:20:00+02:00',
    changes: [
      {
        headline:
          'The calendar is instant, and its arrows work everywhere. The next 30 days of rates are prefetched the moment the page loads - opening the calendar paints them straight from memory and fetches only whatever the visible months still miss. The month arrows are fixed: on a short page the FOOTER was silently sitting on top of the calendar and eating the clicks (equal z-index, later in the document - the earlier stacking fix raised the bar inside main, but main itself was still level with the footer); main now stacks above the footer and every click lands. And today\u0027s date wears a dashed gold ring so the eye finds it at a glance.',
        detail:
          'PREFETCH: the rate cache went DAY-level (a month-keyed cache could not hold a partial 30-day span without blocking the rest of the month) - fetchSpan() merges any range into dayCache with in-flight de-dupe by range, ensureMonth() fetches only the missing stretch of a visible month, and fillRates paints twice: instantly from whatever the prefetch brought, again when the gap-fill lands. attach() takes prefetchDays (both builds pass 30) and warms [today, today+30) at attach time, before any open. VERIFIED by request interception: page load fires exactly one span (today..+30), opening on the current month adds only the remainder (day 31 to month end), and the prefetched span is never re-asked. NAV: reproduced the dead arrows exactly as reported - Playwright named the interceptor (footer intercepts pointer events) - fixed with main { z-index: 3 } over the footer\u0027s 2; the mobile build was already safe (its footer lives inside main, below the raised panel). Re-verified: one month per click both directions, arrows still working mid-range-selection, and all three existing suites re-run green (the older suite updated for the range flow: a first click now deliberately leaves the calendar open). TODAY: a .today class on the current date, dashed gold outline distinct from the solid picked ring.',
      },
    ],
  },
  {
    key: '0.1.11',
    version: '0.1.11',
    date: '2026-08-23T18:10:00+02:00',
    changes: [
      {
        headline:
          'Two additions to how prices explain themselves. Under itemised rates, the \u0027+ R2,125 taxes & fees\u0027 note now carries a hover card breaking the stay down BY DAY - each night\u0027s base rate plus its share of taxes & fees, with the stay total under a rule - dotted-underlined so guests know to look, tap-driven on phones, and the tap can never accidentally pick the suite. And the calendar now sells the promotion at the moment of choice: clicking a check-in date instantly shades the suggested 5-night stay and pins a gold \u00275th night free\u0027 marker on the fifth night; hovering another checkout previews that stay instead, and mousing away brings the suggestion back.',
        detail:
          'BREAKDOWN: core stayBreakdown(room, from, nights) (__bk-exposed) - one row per night, per-day BASE from the provider\u0027s real nightly prices when sent (rate-or-number element shapes both read) falling back to an even split of the displayed total, taxes & fees allocated evenly because the provider itemises them as STAY totals, grand = base + extras; null when nothing is itemised - no breakdown is ever invented. UI in both builds: glass card anchored in the price block (inside the card\u0027s overflow, max-height + gold thin scrollbar for long stays), mouseenter/leave on desktop, tap to open on touch with outside-tap dismissal; the tip swallows its own clicks - a REAL bug the harness caught: the card opens under the finger mid-tap, the synthesised click lands on it and would have bubbled into the room pick. SUGGESTION: on the check-in click the calendar shades check-in+1..+4 and badges check-in+4 (.cal-free5, pointer-events none); hover preview takes precedence and falling back restores it; survives month navigation; cleared on restart, checkout and close. Past days remain rateless and unfetched (asserted again). VERIFIED: 16 Chromium checks across both builds - row count = nights, R3,125 + R531 rows summing to the R14,626 total against the live chain, headline still the base rate, marker text and hover dance, and the tap-safety on desktop and mobile.',
      },
    ],
  },
  {
    key: '0.1.12',
    version: '0.1.12',
    date: '2026-08-23T18:40:00+02:00',
    changes: [
      {
        headline:
          'A search is now a shareable link. Running one writes the stay into the query string - arrive, nights, adults, children, suites - so copying the address bar hands the exact same results to the next person: opening a shared link restores every control and runs the search by itself. The link crosses devices: a phone opening a desktop link is redirected to the mobile build WITH its query (the redirect used to drop it), and the same stay renders there. A stale link with a past arrival date quietly falls back to the default page instead of erroring.',
        detail:
          'BOTH BUILDS: updateUrl() on every validated search via history.replaceState (no back-button spam; existing params - full=1, utm_* - survive because the params are merged into location.search, and the session\u0027s attribution capture reads the ORIGINAL search string at boot, before any rewrite). restoreFromUrl() at the end of boot: validates the date shape, 2-30 nights, clamps adults/children/suites to their control ranges, refuses past arrivals, then drives the real form submit so every existing rule (validation, promo re-pricing, suite ordering, analytics) applies to a restored search exactly as to a typed one. SERVER: the mobile 302 now appends the original query to its relative Location. VERIFIED: 8 Chromium checks - the written URL, a second desktop visitor landing on identical results with controls restored, the phone redirect carrying the query into the same rendered search on the mobile build, and the stale-link fallback.',
      },
    ],
  },
  {
    key: '0.1.13',
    version: '0.1.13',
    date: '2026-08-23T19:30:00+02:00',
    changes: [
      {
        headline:
          'Four corrections from live use. The 5-night suggestion now counts the way a hotelier does - each shaded day after check-in is one night, so five days shade and the \u00275th night free\u0027 marker sits on the fifth, where clicking it books exactly 5 nights. A suite card click now opens a LIGHTBOX - full photo gallery with arrows and dots, the complete description, occupancy and amenity chips, pricing - and the Add-to-stay action lives inside it (the full build\u0027s card button still adds directly); selection never happens by accident again. Itemised rates now render on the LIVE provider: real Cloudbeds does not itemise taxes on its availability endpoint, so when the provider sends nothing the site derives the VAT portion from the lodge\u0027s own replicated vatPct - cards read base + \u0027+ R1,631 VAT\u0027 instead of silently showing one number. And fully booked suites now actually appear: real Cloudbeds OMITS sold-out room types entirely, so the site synthesises their cards from the replicated Guest Suites list (which now carries each suite\u0027s name), greyed out, listed AFTER the available suites, reading \u0027Unavailable for your dates\u0027.',
        detail:
          'CALENDAR: shadeStay end-inclusive; the marker moved to check-in+5. LIGHTBOX: new shared lightbox.js (BKLight, self-styled, both builds) - gallery with keyboard arrows, glass panel, Add/Remove that reports the real pick state back, sold-out variant with no Add and the unavailable line; card click/Enter opens it, the tap inside never bubbles into a pick. DOCUMENTED ASSUMPTION (VAT): rates are VAT-inclusive, base = total x 100/(100+vatPct); provider itemisation always wins when present, and the derivation only runs under the itemised setting - the note reads \u0027VAT\u0027, not \u0027taxes & fees\u0027, so it never claims more than it knows. SOLD-OUT: suites in /suites.json missing from results are appended with available:0 when show-unavailable is on (nameless entries skipped - honesty over coverage); ordering is available-first then the Guest Suites order. VERIFIED: 26 Chromium checks against the live chain with the mock in noTax mode and a suite the provider omits entirely - counting, marker click booking 5, derived R10,870 + R1,631 VAT summing to the provider\u0027s R12,500.50, the omitted Garden Cottage rendering third with the new wording, every lightbox interaction on both builds, and the direct card-button path. Counterpart: Lodge Ops 1.2.125 replicates the suite name.',
      },
    ],
  },
  {
    key: '0.1.14',
    version: '0.1.14',
    date: '2026-08-23T20:10:00+02:00',
    changes: [
      {
        headline:
          'The itemised extras now tell the whole truth: alongside the derived VAT they carry the CONSERVATION LEVY for the whole stay - computed per its Lodge Ops basis (per person / per room, per night / per stay; adults + children, never infants) - with VAT applied to the levy itself. Cards read \u0027+ R3,241 VAT & levy\u0027 and the day-by-day hover, the lightbox and the selection summary all sum to the same figure. The 5th-night promotion was reconciled with it: under itemised rates the promo no longer charges the 5th night\u0027s levy inside the room total (the levy line already covers every night) - which also means the promotion now actually APPLIES to suites where the levy used to eat the saving. And the calendar\u0027s first open now lands on TODAY\u0027s month with today ringed, instead of jumping to the prefilled date weeks out; once a guest picks a date, reopening returns to their month.',
        detail:
          'CORE: levyForStay(lodge, party, nights) - all five bases (__bk-exposed); fifthNightAdjust gained includeLevy (false under the itemised display, unchanged otherwise). BOTH BUILDS: one processing pass per search - promo first (levy-free when itemised), then the extras build: derived VAT into taxesTotal when the provider sent none, the stay levy x (1 + vatPct/100) into feesTotal always under the itemised setting; extrasLabel() names exactly what the note contains (\u0027VAT & levy\u0027 / \u0027taxes, fees & levy\u0027 / \u0027VAT\u0027 / \u0027taxes & fees\u0027). CALENDAR: everPicked flag - first open anchors to TODAY, later opens to the picked date. VERIFIED: unit maths on every levy basis plus 9 live Chromium checks - 4-night R10,870 + R3,241 VAT & levy with the hover total R14,111 summing base + VAT + levy, the 5-night promo applying at R10,606 + R3,603 with the levy counted exactly once, the lightbox matching the card, and the first-open month = today\u0027s - plus the full 26-check lightbox suite re-run green on the new numbers.',
      },
    ],
  },
  {
    key: '0.1.15',
    version: '0.1.15',
    date: '2026-08-23T20:40:00+02:00',
    changes: [
      {
        headline:
          'The day-by-day breakdown now prices the 5th night correctly. On a promotion stay the hover card no longer splits the total evenly across the nights: the ordinary nights carry the REAL nightly rate, the 5th night shows its reduced charge with a gold \u00275th night free\u0027 tag beside its date, and the rows still sum exactly to the displayed total.',
        detail:
          'fifthNightAdjust() now returns its components (nightly, charge); both builds stash them on the room (promoNightly / promoCharge5) at adjustment time rather than reconstructing later. stayBreakdown() detects a promo stay and prices row 5 at charge x k and every other row at nightly x k, where k rescales the pair onto the displayed total - so the later VAT split, which scales every night by the same factor, is carried through exactly; the even split remains for ordinary stays and provider nightly prices still win when sent on a non-promo stay. Row objects gained free5, rendered as a small gold em beside the date in both builds. VERIFIED live: 6 Chromium checks - five rows, nights 1-4 at R2,174, the 5th at R1,910 with its tag (and only it), and the rows summing to the R14,209 total within rounding.',
      },
    ],
  },
  {
    key: '0.1.16',
    version: '0.1.16',
    date: '2026-08-23T21:00:00+02:00',
    changes: [
      {
        headline:
          'The 5th-night discount corrected to 72.3% (Dave): the guest pays 27.7% of the nightly rate for the 5th night - not the 76.4% first specified - plus VAT on the charged portion, with the conservation levy handled as before (its own line under itemised rates, inside the night under inclusive). One constant changed; every display follows: card totals, the extras note, the day-by-day breakdown row and the lightbox.',
        detail:
          'FIFTH_NIGHT_BOARD_SHARE 0.764 -> 0.277 in core.js - the single source both builds price from. A welcome side effect: the saving is now large enough that the never-a-markup guard stops suppressing the promotion even under the inclusive display with a per-person levy. VERIFIED live: a 5-night R12,500.50 stay re-prices to R9,389 base + R3,421 VAT & levy, the breakdown showing full nights at R2,174 and the 5th at R693 (27.7% of R2,500 nightly), rows summing to the R12,809 total.',
      },
    ],
  },
  {
    key: '0.1.17',
    version: '0.1.17',
    date: '2026-08-23T22:20:00+02:00',
    changes: [
      {
        headline:
          'The suite lightbox now answers the two questions the card cannot: who fits, and when. A guest-occupancy table shows Included and Maximum counts for adults, children and infants, the extra cost per additional guest per night (0 reads as free), and the suite\u0027s total maximum - fed from the replicated Guest Suites settings, rows appearing only when the lodge has filled them in. And every unavailable suite gains a Show availability button that opens a second lightbox, Suite Availability, with the suite\u0027s name at the top and the rate calendar filtered to THAT suite alone: its own rate on each bookable day, a dash on days it is sold out.',
        detail:
          'Lightbox grows subtitle, occupancy table, a customNode slot, a noPhoto mode and a second call-to-action, with a module-level stack so Escape peels only the top lightbox. Calendar grows BKCal.inline - a read-only variant that rides the panel\u0027s own glass (no popup chrome, no selection, same month navigation and clamps). The per-suite data is the engine\u0027s rate-calendar with the new roomTypeId parameter (engine 0.1.15) - served from the same per-day cache as the lodge view, so the filtered calendar costs no extra Cloudbeds calls. VERIFIED by real Chromium on both builds: table read Adults 2/2/R350 per night, Children 0/1/R200 per night, Infants 0/1/free, Total maximum 4; the sold-out villa\u0027s Suite Availability opened with its name as subtitle, every request carried roomTypeId, all 39 loaded days showed the dash while the unfiltered calendar still priced them, month navigation advanced, and Escape closed the availability lightbox while leaving the suite lightbox open. NEEDS engine 0.1.15 deployed for the filtered calendar; the occupancy table fills after the next content sync.',
      },
    ],
  },
  {
    key: '0.1.18',
    version: '0.1.18',
    date: '2026-08-23T23:05:00+02:00',
    changes: [
      {
        headline:
          'Show availability now lives on the result cards themselves. Every unavailable suite card carries the button directly - one tap from the results straight into that suite\u0027s own filtered calendar, without opening the suite details first. On desktop the card\u0027s Add to stay slot becomes the Show availability button (gold at rest so it reads on the greyed card); on mobile, where sold-out cards had no button at all, one is added. The same calendar is still reachable from inside the suite lightbox as before.',
        detail:
          'Both builds extract the Suite Availability opener into one openAvailability(room) shared by the card button and the lightbox\u0027s cta, so the two doors stay identical. The card button stops the click from bubbling into the card (which would have opened the suite lightbox underneath), and the desktop card\u0027s refresh() is stubbed on sold-out cards so pick changes elsewhere can no longer rewrite the button back to Add to stay. VERIFIED by real Chromium on both builds: sold-out cards each carried the button while the available card kept Add to stay; clicking it opened exactly ONE lightbox - Suite Availability, subtitled with the suite\u0027s name, its requests filtered by roomTypeId - picked nothing, and Escape returned to the results; the plain card click still opens the full suite lightbox with its own button. Rides the engine 0.1.15 per-suite calendar already required by 0.1.17.',
      },
    ],
  },
  {
    key: '0.1.19',
    version: '0.1.19',
    date: '2026-08-23T23:55:00+02:00',
    changes: [
      {
        headline:
          'The levy and VAT amounts are now worked out from the replicated Lodge Ops settings under BOTH price displays. The itemised display already did (0.1.13); the inclusive display, which trusted the provider to say what a rate contains, silently omitted the conservation levy from the guest\u0027s total because Cloudbeds knows nothing of it. Now the inclusive headline is the rate (VAT inside, per the lodge\u0027s declared percentage) PLUS the whole stay\u0027s conservation levy with VAT on it, noted honestly as VAT & levy included. The two displays finally agree on the grand total - itemised base plus extras equals the inclusive headline, to the rand.',
        detail:
          'The extras pass runs for every search, not only the itemised display: VAT is derived out of the rate only when itemised, the stay levy (from the replicated amount, basis and party) is added either way, and the 5th-night promotion never charges the levy inside the promo night any more since the stay levy is always collected in full - previously the inclusive display charged night five\u0027s levy in the promo while omitting the other nights\u0027 entirely. The included-note wording follows the same honesty rules as the itemised one (VAT & levy included when worked out from the settings; taxes, fees & levy included when the provider itemised its own extras too). The basket total rides the same shared pricing, so it folds the levy in automatically. VERIFIED by real Chromium against the replicated fixture (R175 per person per night levy, 15% VAT, 2 adults, R2,500.10 nightly): itemised numbers unchanged to the rand (R10,870 + R3,241 at 4 nights; R9,389 + R3,421 with the 5-night promo), inclusive now R14,111 and R12,809 - exactly the itemised base plus extras - on desktop and mobile, with the live display setting restored after the run.',
      },
    ],
  },
  {
    key: '0.1.20',
    version: '0.1.20',
    date: '2026-08-24T00:45:00+02:00',
    changes: [
      {
        headline:
          'The itemised display now shows all the numbers AND the arithmetic. The breakdown behind the price note grew from day rows plus a total into the full statement: each night\u0027s rate, the Accommodation subtotal, the VAT amount with its percentage, the conservation levy line carrying its own multiplication (R175 \u00d7 2 guests \u00d7 5 nights), VAT on the levy, and the Total - every figure to the cent, and the column genuinely sums to the printed total because the last night absorbs the sub-cent remainder and the total is computed from the printed lines. Also in this build: a spinner over each month of the Suite Availability calendar while its rates are still being fetched, and the mobile entry card\u0027s Adults / Children / Suites steppers no longer overlap on an iPhone.',
        detail:
          'core.js gains moneyC (cents formatting), levyMathLabel (the multiplication per levy basis) and stayMath (the extras as labelled lines: derived VAT reads as VAT n% on accommodation, provider figures read as the provider\u0027s, the levy carries its math); both builds\u0027 breakdown tips render nights, subtotal, lines, total in integer cents, and the tip\u0027s height cap rose from 260px (which cut the fuller statement mid-scroll) to min(60vh, 480px). BKCal.inline shows a .cal-loading veil per month while its fetch is in flight - a cache hit paints instantly with no flicker. The stepper overlap was real arithmetic: three tiles of 38px-circle steppers need 102px each where a 390pt iPhone gives 95 - media queries at 430px and 350px size the circles to the tile. VERIFIED by real Chromium on both builds: the 5-night promo statement reads 4 \u00d7 R2,174.00 + R692.53 = R9,388.53, + R1,408.28 + R1,750.00 + R262.50 = R12,809.31 exactly, on desktop hover and mobile tap; the spinner shows under a throttled network and clears into populated days; stepper tiles at 430/390/375/320pt neither overlap nor spill, and still tap at 320.',
      },
    ],
  },
  {
    key: '0.1.21',
    version: '0.1.21',
    date: '2026-08-24T01:30:00+02:00',
    changes: [
      {
        headline:
          'The selected-suites bar no longer falls apart on an iPhone. Two live defects compounded (Dave\u0027s screenshot): the bar\u0027s amount was one long line - R56,592 + R9,903 taxes & fees - in a span that refused to shrink, crushing the left side to a word per line, and iOS Safari\u0027s font boosting then inflated that long line to display size. The bar now leads with the grand total the guest will actually pay, with the base-plus-extras split as a small line underneath, and both builds pin text-size-adjust to 100% so iOS renders text at its designed size. Also: the conservation levy / VAT line above the result cards is removed (the itemised statement on each card carries those facts now), and Copyright 2026 Lodge IT Pty Ltd sits at the bottom left of both builds.',
        detail:
          'updateSummary on both builds fills the bar total through one fillBarTotal: the grand (sum + extras) as the gold figure, then a .sum-split sub-line reading base + extras with the same honest label as the cards (VAT & levy when worked out from the replicated settings), falling back to taxes & fees only if picked rooms ever carried differing labels. Mobile CSS gives the left text flex priority and caps the total column at 58% so neither side crushes the other. The levy/VAT header applyStayNote is deleted outright - the #stayNote element stays hidden. VERIFIED by real Chromium: at 390pt the bar reads R14,111 over R10,870 + R3,241 VAT & levy at 11px, the left text holds 169px and two tidy lines, nothing overflows the viewport; the desktop bar matches; the header line is gone and the copyright sits bottom-left on both builds.',
      },
    ],
  },
  {
    key: '0.1.22',
    version: '0.1.22',
    date: '2026-08-24T02:05:00+02:00',
    changes: [
      {
        headline:
          'The full-site hero fits the screen again. With both headline lines at the display size, a two-line-each headline swallowed the whole viewport and pushed the booking bar below the fold. The SECOND headline line now renders at roughly 60% of the first - the supporting thought under the statement - and the hero subtitle paragraph widened from 46 to 68 characters per line so it breathes in three lines instead of six narrow ones. Desktop build only; the mobile hero was already scaled to its screen.',
        detail:
          'booking.css: .hero-title .hero-line gets its own clamp(28px, 4.4vw, 60px) with line-height 1.18 and a 12px seam under line one, where it previously inherited the full clamp(44px, 7.5vw, 104px); .hero-sub max-width 46ch -> 68ch. VERIFIED by real Chromium at 1900px with the live site\u0027s actual wording: line one 104px, line two 60px, subtitle 681px wide, and the whole hero plus the booking bar inside one 995px viewport. Also confirmed while in there: the replicated logo DOES render top-left on this build (it replaces the gold star the moment config.json carries a logoId) - the live site not showing one is the pending deploy, not a code gap: the logo shipped in 0.1.11 and the site still serving 0.1.6 predates it.',
      },
    ],
  },
  {
    key: '0.1.23',
    version: '0.1.23',
    date: '2026-08-24T04:10:00+02:00',
    changes: [
      {
        headline:
          'The logo takes its proper place. On the full site the masthead becomes a centred lockup - the mark large (up to 120px) in the centre of the page with the brand name beneath it - while a lodge without a logo keeps the star-and-name row unchanged. The same image now doubles as the browser-tab icon on both builds. And the site pulls media from the engine every MINUTE instead of every ten, so a logo or photo change made in Lodge Ops shows here about as fast as a text change - the ten-minute lag is what made a fresh upload look like the manual sync had not sent it.',
        detail:
          'applyLogo (both builds) also points the head\u0027s favicon link at the served /media/<id> - content-addressed, so the tab icon can never go stale - and on the full site adds the masthead\u0027s logo-mode class: brand column centred, Mobile site link pinned to its corner. Media pull default MEDIA_SYNC_MS 600000 -> 60000; each pull is one metadata list call, bytes fetched only for images the site does not already hold, so the faster cadence costs one light call a minute. VERIFIED by real Chromium with a stored logo: the masthead centred the 120px mark with the name below it, the favicon href carried the logo\u0027s media id on desktop and mobile, and a logo-less config left the classic masthead untouched.',
      },
    ],
  },
  {
    key: '0.1.24',
    version: '0.1.24',
    date: '2026-08-24T04:45:00+02:00',
    changes: [
      {
        headline:
          'The logo stands alone and the fold is guaranteed. With a logo the brand name under it goes - the mark IS the brand - and the dead space around the lockup tightens: slimmer masthead, the hero pulled up under it. On short screens the mark itself steps down from 120px to 84px so the page still fits. Checked at three real desktop sizes: the whole first screen - logo, kicker, both headline lines, subtitle and the booking bar - sits above the fold at 1900x995, 1440x900 and 1366x768, with nothing below it but the footer.',
        detail:
          'CSS only plus one body-level has-logo hook from applyLogo (the hero cannot be reached from a masthead class alone). logo-mode hides .brand-name and drops the lockup gap; has-logo slims the masthead padding and the hero top; a max-height 840px media query shrinks the mark to 84px and tightens the subtitle and bar margins further - written at the right specificity, since the first draft of that rule silently lost to the lockup\u0027s own selector and the E2E caught the mark still measuring 120px. The logo-less masthead is untouched. VERIFIED by real Chromium at all three viewports: name display none, booking-bar bottom 778/995, 775/900 and 701/768.',
      },
    ],
  },
  {
    key: '0.1.25',
    version: '0.1.25',
    date: '2026-08-24T05:05:00+02:00',
    changes: [
      {
        headline:
          'The build-swap links are gone: no Mobile site in the full build\u0027s masthead or footer, no View the full site on the mobile build. Guests land on the right build automatically - a phone is 302d to the mobile build by its user agent - and that routing is untouched; only the visible escape hatches went. The ?full=1 override still works for anyone who genuinely needs the desktop build on a phone.',
        detail:
          'Markup-only on both builds plus retiring the masthead-link styles; the copyright line keeps the footers. VERIFIED by real Chromium: zero anchor tags on either page beyond content, the lockup and copyright intact, a phone user agent still 302d to /m/ with its query preserved, and ?full=1 still answering the desktop build directly.',
      },
    ],
  },
  {
    key: '0.1.26',
    version: '0.1.26',
    date: '2026-08-25T06:00:00+02:00',
    changes: [
      {
        headline:
          'PRICES NOW COME FROM THE RATE ENGINE - the Cloudbeds rate feed is disconnected (needs engine 0.1.23). Every figure a guest sees - the card totals, the itemised breakdown, the date picker\u0027s per-day rates - is quoted by the Rate Engine for the plans OFFERED to visitors (chosen in Lodge Ops under Settings > Booking Website). When more than one offered plan prices a suite, the card grows plan pills - Flexible, Saver, whatever Dave names them - and switching re-prices the card, the breakdown and the summary in place; the chosen plan travels through room_selected and checkout_started analytics. A suite the engine does not price says Rates on request, and no offered plans means no prices anywhere: there is deliberately NO fallback to provider figures. The site-side 5th-night promotion is retired with this - pricing rules live in the Rate Engine now.',
        detail:
          'The disconnection is enforced at the server boundary, not by the pages: the two rate-bearing guest answers (availability, rate-calendar) are rewritten before they leave - provider totalPrice/taxes/fees/nightlyPrices stripped wholesale, the engine\u0027s POST /api/engine/rates/quote (HMAC, offered-plans authority server-side, source pinned direct_web, session key a per-visitor IP HASH so the engine sees no PII) folded in as ratePlans with per-suite nights and totals. Availability itself still comes from Cloudbeds - the engine holds no inventory; only the money changed hands. The calendar\u0027s per-day figure is the cheapest VAT-inclusive engine price across offered plans and replicated suites. On the pages, core.js maps a plan onto the old display model (rate EX VAT + the engine\u0027s own VAT, per-night rate AND per-night VAT arrays feeding the day-by-day statement exactly), with the conservation levy still added from the replicated lodge settings - the engine knows nothing of it. PROVEN against the real chain mock Cloudbeds -> engine 0.1.23 -> site: 24 API/page-code assertions (figures stripped, offered-only, math to the cent, empty-offered visibly empty) plus 11 in real Chromium on BOTH builds (R11,385 inclusive card, pill switch to R9,315, plan name in the summary, zero Cloudbeds digits in the DOM).',
      },
    ],
  },
  {
    key: '0.1.27',
    version: '0.1.27',
    date: '2026-08-25T09:00:00+02:00',
    changes: [
      {
        headline:
          'AVAILABILITY NOW COMES FROM THE RATE ENGINE TOO (needs engine 0.1.24), and the site holds ONE engine session open for its whole life. Searches and the date-picker calendar are answered from the engine\u0027s own inventory instead of Cloudbeds - a 30-night search dropped to 22ms and a 30-day calendar to 14ms, from hundreds of milliseconds against a fast mock and many seconds against the real provider. A suite the engine has no availability for (dates beyond its synced window) now reads \u0022Availability on request\u0022 on both builds instead of being drawn as sold out, which was a guess.',
        detail:
          'The session is opened at boot with a label, kept alive at a THIRD of whatever TTL the engine answers (so two keepalives may be lost before it lapses, and changing the engine\u0027s TTL is enough - the site derives, never guesses), re-opened automatically if the engine restarts, and closed on SIGTERM/SIGINT so its cached answers go with it rather than timing out. Every guest rate call now rides that held session: the per-visitor cache key hangs off it as sessionKey|visitor-hash, which the engine rolls up into the session\u0027s own query counts and average response time. VERIFIED against the real chain (mock Cloudbeds -> engine 0.1.24 -> site): the session shows open on the engine with its label and accumulating counts, availability answers carry availabilitySource rate-engine with zero provider rate figures, a genuinely sold-out stay reports 0 with availabilityKnown true while a stay beyond the window reports availabilityKnown false, and both builds still price entirely from the Rate Engine.',
      },
    ],
  },
  {
    key: '0.1.28',
    version: '0.1.28',
    date: '2026-08-25T17:00:00+02:00',
    changes: [
      {
        headline:
          'THE DATE PICKER NOW DECLARES ITSELF A SCAN (needs engine 0.1.29). Painting the calendar sweeps up to 45 nights across every suite, and the engine was counting each of those nights as a guest considering that date - which quietly ruined the demand heat map. The calendar now sends scan: true; a guest searching a stay still does not, because that one IS demand.',
        detail:
          'One flag, on one of the two rate-bearing paths, chosen deliberately: the picker calendar is a survey of what the lodge could sell, the availability search is a person looking at a stay. Declaring it buys the site three things from the engine - the sweep stays off the demand counter, it reads the session rate cache but never writes to it (so painting a calendar can never evict the rates a guest is being shown mid-visit), and it is exempt from the throttle that progressively slows undeclared sweepers. VERIFIED through the real chain against a live engine: a 30-night picker calendar added 90 nights to the all-requests counter and ZERO to the quotes-only counter, while a 3-night guest search added to both. Counterpart: engine 0.1.29.',
      },
    ],
  },
  {
    key: '0.1.29',
    version: '0.1.29',
    date: '2026-08-25T18:00:00+02:00',
    changes: [
      {
        headline:
          'A SEARCH NOW LANDS ON THE CHEAPEST RATE PLAN, AND THAT PLAN WEARS A LOWEST RATE TAG. Until now a search opened on whichever plan was first in the offered list, so a guest only found the better price if they thought to try the other pills. Both builds, desktop and mobile.',
        detail:
          'The comparison is the engine\u0027s own all-in grandTotal for the stay, not a derivation - the conservation levy sits identically on top of every plan, so it cannot change which one is cheapest and is deliberately left out. Deliberate edges: a TIE keeps the first plan in Dave\u0027s offered order, because when the money is the same his ordering should win; a suite priced by only ONE plan is never tagged, since \u0022cheapest of one\u0022 tells a guest nothing; and switching pills by hand still works exactly as before, the tag simply stays on the cheapest. The tag reads \u0022Lowest rate\u0022 rather than \u0022Best rate\u0022 so it cannot be confused with the lodge\u0027s own \u0022Book direct - best rate\u0022 tag sitting a row below it on the same card. VERIFIED in real Chromium on both builds against a live Rate Engine quoting two plans 20% apart: 26 assertions - exactly one tag, on the cheapest plan, and that pill selected the moment the results render.',
      },
    ],
  },
  {
    key: '0.1.30',
    version: '0.1.30',
    date: '2026-08-25T20:00:00+02:00',
    changes: [
      {
        headline:
          'A HIDDEN RATE ENGINE LOAD HARNESS (internal testing only). Type \u0022load\u0022 anywhere on the desktop booking page and a lightbox asks how many concurrent sessions to run; Go fires them at the engine and shows every working connection, its response times, the totals, and - the point of the exercise - the engine\u0027s own heap on the same time axis, so a latency spike can be lined up against the collection that caused it.',
        detail:
          'Two decisions make it a real measurement rather than a toy. Each virtual session gets its OWN engine session key (loadtest|wN), so a run genuinely fills the rate cache - workers sharing one key would keep hitting the same cached nights and stress nothing; a 25-session run reached 41,000 cached nights. And latency is timed in the BROWSER, end to end, exactly as a guest would feel it, while the heap is read from the engine itself, because either number alone says nothing about garbage collection. Three panels, one measure each and never two scales on one plot: throughput, response time (average and p95), and engine heap. Bounded because it is ON: the server caps concurrency (LOAD_MAX, 200) and run length (LOAD_MAX_SEC, 120s), holds a global in-flight ceiling, and the page obeys what the server says rather than what was typed. The run stops itself at the deadline whether or not the tab is watching. LOAD_TEST=0 switches the whole thing off - the routes 404 and the lightbox says so instead of pretending. The trigger never fires while a field has focus, so a guest typing dates is unaffected; nothing is booked and NOTHING goes near Cloudbeds. VERIFIED in real Chromium against a live engine, 15 assertions: the trigger opens it (and does NOT open from inside an input), 25 rows for 25 sessions with all 25 shown in flight, 638 requests at 129/s with real average and p95 figures, the engine heap and cache both reported and rising, the run stopping itself and NO requests continuing afterwards. Chart hues are the data-viz reference palette\u0027s dark steps, validated against this site\u0027s surface. Desktop only: the trigger needs a keyboard.',
      },
    ],
  },
  {
    key: '0.1.31',
    version: '0.1.31',
    date: '2026-08-25T20:40:00+02:00',
    changes: [
      {
        headline:
          'FIX: the load harness reported itself \u0022switched off on this server\u0022 everywhere behind nginx. Its routes sat at /api/loadtest/, and the edge proxies exactly two paths to this server - /api/public/ and /book/ - so nothing at /api/loadtest/ ever reached it. They now live under /api/public/loadtest/, which is already routed, so the harness works on webbox with NO nginx change.',
        detail:
          'Reproduced before fixing, against a stand-in edge forwarding only the locations the real conf actually has: the old path 404s through it, the new one answers, and a full 25-session run drives cleanly from the page at /book/ - 735 requests at 181/s with the engine heap and cache both reported. The MESSAGE was the second half of the fault and is fixed too. It said \u0022switched off\u0022 for a missing route as well as for a genuine LOAD_TEST=0, which are opposite problems wearing one sentence, and it sent the hunt in the wrong direction. Status now answers whether or not the harness is enabled, so the page distinguishes three states in its own words: running (with the caps and the site version), \u0022switched off here (LOAD_TEST=0)\u0022, and \u0022no harness at this address (HTTP 404)\u0022 - the last naming both of ITS causes, an out-of-date build or an edge not passing the path. Only status answers when disabled; every route that generates traffic stays closed behind the switch. VERIFIED in real Chromium across all three states, plus the full run behind the edge.',
      },
    ],
  },
  {
    key: '0.1.32',
    version: '0.1.32',
    date: '2026-08-25T21:45:00+02:00',
    changes: [
      {
        headline:
          'THE LOAD HARNESS CAN NOW SOAK OVERNIGHT AND CHURNS SESSIONS. Run-for accepts 0 = until you hit Stop (LOAD_MAX_SEC now defaults to no limit), and every virtual session runs for a RANDOM life between two bounds, then closes - dropping its cached rates on the engine - and a fresh one opens. So the cache constantly grows and shrinks and garbage collection has real work to watch, which is the point of the soak.',
        detail:
          'Each worker carries a session key with an epoch (loadtest|w3e4); when its random life ends it fires a close for the old key, bumps the epoch and rolls a new life. A new /api/public/loadtest/close route drops that session on the engine via the existing DELETE, so the churn is real cache allocation and release, not just growth. New readouts for a long run: Sessions opened, a per-worker Cycles count, and a running clock in the caps line; the Slowest figure is now the ALL-TIME worst response, not a rolling-window max, so a GC pause an hour into the soak is still there to see. PROVEN end to end through a stand-in nginx edge: 30 distinct sessions each cache their own nights, one close drops exactly that session\u0027s entries and no others, recycling oscillates the cache rather than growing it without bound, and closing everything returns the cache to baseline. VERIFIED in real Chromium: an unlimited run reports \u0022until Stop\u0022, 12 workers with 2-4s lives recycled to 42 sessions in ~10s with per-worker cycle counts climbing, and Stop restores the ready line. Needs engine >= 0.1.24 for the close; pairs with engine 0.1.31 (shared cache budget). Nothing here books anything or touches Cloudbeds.',
      },
    ],
  },
  {
    key: '0.1.33',
    version: '0.1.33',
    date: '2026-08-25T22:35:00+02:00',
    changes: [
      {
        headline:
          'THE LOAD HARNESS NOW NAMES ITS ERRORS, SHOWS GC LOAD, AND LISTS THE TEST SESSIONS. The errors were unexplained; they are client-side TIMEOUTS - the site gives up on the engine after ENGINE_TIMEOUT_MS (default 10s) when it is saturated, and a run\u0027s p95 pinned near 10s and slowest at ~10s were that ceiling, not the engine failing. The harness breaks the errors down by cause, so \u002225 timeout (10s)\u0022 replaces a bare count.',
        detail:
          'Three things, needing engine 0.1.32. (1) ERRORS ARE LEGIBLE: every failed quote is classified - timeout (with the timeout value), no response (engine down/refused), engine <status>, or network - and totalled under the KPIs, commonest first. The timeout is configurable with ENGINE_TIMEOUT_MS (floored at 1s) for a soak. (2) GC IS QUANTIFIED: two readouts from the engine\u0027s new perf_hooks counters - GC load, the fraction of wall time spent paused in the last interval, and GC worst pause - so the \u0022is GC hurting throughput?\u0022 question is answered from data. On the engine here a churn soak read ~5% GC load and a ~20ms worst pause: real but nowhere near the seconds a saturated event loop adds. (3) TEST SESSIONS ARE VISIBLE: each worker now opens a real engine session (labelled \u0022load test\u0022) for its random life and closes it on recycle or Stop, so the Open Sessions card fills and empties with the run instead of showing only the site\u0027s own held session. PROVEN end to end: a timeout returns reason:timeout and the page shows \u002225 timeout (1s)\u0022; 15 worker sessions appear in Open Sessions and clear when closed; GC load and worst pause render live. Nothing here books anything or touches Cloudbeds.',
      },
    ],
  },
  {
    key: '0.1.34',
    version: '0.1.34',
    date: '2026-08-26T01:40:00+02:00',
    changes: [
      {
        headline:
          'THE AVAILABILITY CARD TAKES A DISCOUNT CODE (Dave, 2026-08-25), on both builds. It upper-cases as typed, rides the search into the Rate Engine, and a rule gated on that code prices the stay for this guest and nobody else. Needs engine 0.1.34.',
        detail:
          'The field sits in the search bar beside Suites on desktop and above the button on mobile, monospace with tracking because a voucher code is read character by character. The code travels as ?code= on /api/public/availability and is OMITTED when blank, never sent empty - the engine\u0027s discount_code qualifier fails closed on \u0022no code\u0022, and that distinction is the feature. At the site server the param is split two ways: folded into the ENGINE rate quote as discountCode (the engine trims, upper-cases, matches exactly, and keys its session cache on it, so a coded search and a plain one never share an answer), and STRIPPED from the provider availability call - the engine\u0027s validation rejects query params it does not know, so one stray param would 400 the whole availability answer. VERIFIED with the real site server against a stub engine (the provider call carries no code param, the quote carries discountCode, blank and whitespace codes are omitted) and in real Chromium on both builds (the field renders, shows upper-case, the search URL carries code=WINTER24, and clearing it removes the param). Nothing here books anything or touches Cloudbeds.',
      },
    ],
  },
  {
    key: '0.1.35',
    version: '0.1.35',
    date: '2026-08-26T02:20:00+02:00',
    changes: [
      {
        headline:
          'The DISCOUNT CODE label no longer wraps onto two lines in the search bar (Dave, 2026-08-25).',
        detail:
          'The field had a fixed flex basis narrower than its own label - \u0022DISCOUNT CODE\u0022 with the bar\u0027s 0.22em letter-spacing needs more room than the 130px the other slim fields get - so the label broke after \u0022DISCOUNT\u0022. The field now sizes to its label (flex-basis auto, label nowrap) and the flexible fields either side give up the few pixels. VERIFIED in real Chromium at 1440, 1200 and 1024px: the label measures one line tall at all three widths and the bar does not overflow.',
      },
    ],
  },
  {
    key: '0.1.36',
    version: '0.1.36',
    date: '2026-08-26T03:15:00+02:00',
    changes: [
      {
        headline:
          'HOVERING A RATE PLAN PILL NOW SAYS WHAT THE PLAN INCLUDES - and what it explicitly leaves out (Dave, 2026-08-25). Needs engine 0.1.36 with its migration 017, fed by Lodge Ops.',
        detail:
          'The inclusion words are written in Lodge Ops (its Rate Plan Support page), replicated to the engine, and pulled by this server WHEN IT OPENS ITS ENGINE SESSION - plus every heartbeat, and kept on disk like suite content so a restart serves the last good copy at once. Each availability answer then carries the words per plan, and the pills grow a glass tooltip on hover/focus: the group name, \u0022Includes Breakfast, Dinner\u0022, and \u0022Not included: Lunch, Spa treatment\u0022 struck through - the exclusions are what a guest complains about later if nobody wrote them down. A plan Lodge Ops has not linked gets NO tip, never an empty box. On mobile the same tip shows while the pill is pressed or focused, since touch has no hover.',
      },
      {
        headline:
          'The Adults, Children and Suites dropdowns wear the same glass dressing as Nights (Dave, 2026-08-25).',
        detail:
          'Nights was the only select dressed by BKCal.glassSelect - the other three were naked native selects with the browser\u0027s own popup, which is why they looked different and had no chevron. All four now share the one dressing; the native selects stay in the DOM as the value holders, so every existing listener and the form submit read exactly what they always did. VERIFIED in real Chromium: four glass triggers with chevrons, picking Adults=3 through the popover drives the real select and the trigger label follows; and for the inclusions, a full stack test - real site server against a stub engine - proved the availability answer carries inclusions only for linked plans, the pill holds a tip only when there are words for it, and the hover shows them. Nothing here books anything or touches Cloudbeds.',
      },
    ],
  },
  {
    key: '0.1.37',
    version: '0.1.37',
    date: '2026-08-26T06:50:00+02:00',
    changes: [
      {
        headline:
          'THE CARD NOW DEFAULTS TO THE ALL INCLUSIVE RATE (Dave, 2026-08-26) - the fullest presentation of the stay whenever a plan by that name prices it, matched on the name case-insensitively. The \u0022Lowest rate\u0022 tag still marks the cheapest pill, so defaulting high never hides the low; only when no All Inclusive plan prices the stay does the old cheapest-first default apply.',
        detail:
          'One deliberate consequence: the headline price on a card is now usually the HIGHEST of the offered plans, with the cheaper plans one pill-tap away and clearly tagged. The guest sees the lodge at its best first and the saving second.',
      },
      {
        headline:
          'THE INCLUSIONS HOVER IS GONE; in its place, a \u0022Compare these rates\u0022 button under the price opens a glass lightbox - each rate a COLUMN, the inclusions as ROWS grouped under their sub-group names, every cell a verdict (Dave, 2026-08-26). Needs Lodge Ops 1.2.183, whose push carries the sub-group structure.',
        detail:
          'The lightbox shows each plan with its stay total, the Lowest-rate tag and its inclusion group name; below, the sections exactly as arranged on the Rate Plan Support page - MEALS, ACTIVITIES, NOT INCLUDED - with \u2713 included, \u2717 not included, and \u2014 not specified per plan, and a legend saying so. Each item appears ONCE, under the first section that mentions it, because the same item can sit in different sections on different plans (Lunch in Meals on Full Board, in Not included on Half Board) and one honest row beats two half-truthful ones; the verdicts come from the flat rollup so the included-beats-excluded resolution made in Lodge Ops holds here. Exclusion sections sink to the bottom whatever plan donated them - \u0022what you don\u0027t get\u0022 read mid-list as if it were another perk. Plans replicated before sections existed fall back to two synthetic sections; a stay with no inclusion data at all says so in a sentence instead of an empty grid. The button renders only when more than one plan prices the suite - comparing one thing with itself is noise. Shared by both builds (the BKLight pattern: self-contained module, own styles, closes on X, backdrop or Escape). VERIFIED end to end on the real site server with a stub engine in real Chromium, 11 assertions per build \u00d7 both builds: All Inclusive selected while Room Only wears the Lowest-rate tag, the R3,910 headline, no hover tip left anywhere, three columns, sections in order with exclusions last, the Lunch row reading \u2014 \u2717 \u2713 across the three plans, and Escape closing. Nothing here books anything or touches Cloudbeds.',
      },
    ],
  },
  {
    key: '0.1.38',
    version: '0.1.38',
    date: '2026-08-26T07:50:00+02:00',
    changes: [
      {
        headline:
          'THE COMPARE BUTTON MOVED INTO THE PILL ROW and pulses when the guest switches plans (Dave, 2026-08-26, with a marked-up screenshot) - under the price it read as part of the price, disjointed from the pills it actually compares.',
        detail:
          'It sits after the last rate pill, dashed gold so it never reads as another plan, and gives one soft scale-and-glow pulse each time a different plan is picked - the moment a guest is weighing plans is the moment the comparison is useful. The pulse runs once, cleans itself up, and respects prefers-reduced-motion.',
      },
      {
        headline:
          'IN THE COMPARE LIGHTBOX the plan header now stays put while the rows scroll, and every verdict cell carries a plain-words tooltip naming the plan\u0027s own sub-group (Dave, 2026-08-26).',
        detail:
          'The header - plan names, stay totals, Lowest-rate tag, group names - is sticky over the scrolling rows: a comparison whose column names have scrolled away compares nothing. Each \u2713/\u2717/\u2014 cell explains itself on hover: \u0022Lunch is included in All Inclusive (Meals)\u0022, \u0022Lunch is NOT included in Half Board (Not included)\u0022, \u0022Room Only does not mention Lunch\u0022 - the parenthesised name is that PLAN\u0027s own sub-group for the item, which matters because a row sits under the first section that mentioned it and plans may file the same item differently. The sub-group names already head the row groups (0.1.37); the tooltips now carry them per plan as well. VERIFIED end to end in real Chromium on both builds, 17 assertions per build: the button is the pill row\u0027s last child, the pulse appears on a plan switch and cleans itself up, the rows scroll while the header\u0027s offset inside the scroll container holds to the pixel, and all three tooltip wordings render exactly. Nothing here books anything or touches Cloudbeds.',
      },
    ],
  },
  {
    key: '0.1.43',
    version: '0.1.43',
    date: '2026-08-31T18:40:00+02:00',
    changes: [
      {
        headline:
          'The guest\u0027s party now rides every rate quote, and each suite says how it was priced (Dave, 2026-08-31): a lodge on per-guest-per-night rates prices 3 adults at three times the per-guest nightly, and the card, hover statement and lightbox all say \u0022Per-guest rate \u00b7 priced for 3 adults\u0022 - a per-suite lodge\u0027s cards say \u0022Per-suite rate\u0022.',
        detail:
          'THE OTHER HALF of engine 0.1.51, which taught the Rate Engine to multiply a per-guest root by the adults being priced. THIS SERVER now forwards the adults and children from the guest\u0027s own search URL into the engine quote (engineRatesQuote gains a party; the stay path reads the same URLSearchParams the discount code already rode) - omitted when the URL carries none, and the engine then prices its own default of 2 adults and says so. Children are forwarded but never multiplied - child pricing arrives later as rate rules, Dave\u0027s call. The calendar sweep stays partyless on purpose: its per-day cheapest figures price the engine default, the same 2 adults the search form opens with. THE DISPLAY, both builds: core.js carries the engine\u0027s new rateBasis + adultsPriced through planOptionsFor and applyPlanToRoom onto the room, and a shared rateBasisLabel says it to the guest plainly - a .room-basis line under the card\u0027s price (\u0022Per-guest rate \u00b7 priced for 3 adults\u0022 / \u0022Per-suite rate\u0022), the same words appended to the lightbox\u0027s price note, and the itemised hover\u0027s Accommodation line carrying its own multiplication (\u0022Accommodation \u00b7 per-guest rate \u00d7 3 adults\u0022) exactly as the levy line has always shown its math. An older engine sends no annotation and the site shows nothing rather than guessing - deploy order free in both directions. VERIFIED end to end with the REAL engine 0.1.51 (built dist on a real PostgreSQL 16) behind this real server and real Chromium on the served site, 11 assertions: the forward chain pricing 3 adults x R1000 x 2 nights = R6,000 + R900 VAT beside an untouched R8,000 per-room suite in one answer, both annotated; the same visitor repricing to R4,000 on a 2-adult re-search; the card\u0027s basis line, per-room wording, hover statement math (nights at R3,000.00 to a R6,900.00 total) and the lightbox note all rendering word for word. Nothing here books anything or touches Cloudbeds.',
      },
    ],
  },
  {
    key: '0.1.44',
    version: '0.1.44',
    date: '2026-08-31T21:00:00+02:00',
    changes: [
      {
        headline:
          'Everything the rate rules can say now SHOWS (Dave, 2026-08-31): client messages, the discount a code earned, inclusion changes and the refund policy \u2014 with its new partial percentage \u2014 appear on every suite card without a hover, in BOTH display modes, and ride the lightbox as chips. The itemised hover statement now attaches under the inclusive display too.',
        detail:
          'Dave: \u0022fix the booking site to show client messages, discounts and anything else that we can set in the rules.\u0022 THE GAP WAS THE DISPLAY MODE: stay messages, night message tags, the discount line and the refund policy all lived inside the itemised hover statement \u2014 and that statement only attached when rateDisplay was separate, so under the DEFAULT inclusive display none of it existed anywhere on the page, and inclusion changes rendered nowhere on the card at all. NOW: a shared ruleCallouts() (core.js, one implementation for both builds and the lightbox) lists what the rules said about the stay \u2014 every stay-scoped message (gold, the lodge speaking), \u0022Discount applied \u2014 you save R800.00\u0022 when a code earned one, \u0022+ Sunset Cruise included\u0022 / \u0022\u2212 X not included\u0022 for rule-made inclusion changes, and the refund policy \u2014 rendered as a .room-callouts block on the card under the plan pills, re-rendered with the plan the guest picks, and pushed into the lightbox chips. REFUND PERCENTAGE (engine 0.1.54): refundLabel now reads \u0022Partially refundable (60%% refunded) up to 7 nights before check-in\u0022; a rule saved before the field existed stays bare rather than gaining an invented figure. THE HOVER STATEMENT attaches in both display modes now \u2014 under an inclusive headline it explains what was folded in, and the discount line, per-night message tags and refund footer are reachable again. applyPlanToRoom also carries inclusionsAdded/Removed onto the room (they previously reached only the compare lightbox). VERIFIED end to end with the REAL engine 0.1.54 (built dist on a real PostgreSQL 16) behind this real server and real Chromium, 8 assertions under the INCLUSIVE display deliberately: a set+append combined message showing with no hover, the R800.00 code discount, the added inclusion, the (60%% refunded) policy line, the inclusive note proving the mode, the hover statement opening with the SAVE10 line and refund footer, and the lightbox chips. Nothing here books anything or touches Cloudbeds.',
      },
    ],
  },
  {
    key: '0.1.45',
    version: '0.1.45',
    date: '2026-08-31T23:00:00+02:00',
    changes: [
      {
        headline:
          'The guest\u0027s party rides the CALENDAR sweep (Dave, 2026-08-31): a party-gated rule \u2014 a couples-only plan, a per-guest rate \u2014 now shapes the date picker\u0027s cheapest-per-day figures exactly as it shapes the search results.',
        detail:
          'Dave: \u0022yes pass the party into the calendar scan too.\u0022 Both builds\u0027 calendar fetches (the search bar\u0027s arrival picker and the per-suite availability calendar in the lightbox) now carry the CURRENT adults and children \u2014 the desktop selects by value, the mobile steppers by their output text \u2014 through /api/public/rate-calendar into the engine\u0027s scan quote. Without it the calendar priced the engine\u0027s default party, so a couples-only Honeymoon discount could paint a per-day figure a 3-guest search then could not have. THE FORWARD IS STRIPPED: the engine\u0027s own rate-calendar DTO does not know adults/children (whitelist + forbidNonWhitelisted \u2014 one stray param 400s the whole call), so forwardTargetFor removes both from the provider-bound path exactly as it already removed the discount code; the availability route keeps them, its DTO declares both. Omitted when the site sends none \u2014 the engine then prices its default party, deploy order free. VERIFIED against the real engine 0.1.57 dist on a real PostgreSQL 16 through this real server, in the same run that proved the engine\u0027s party cache-key fix: a 2-guest calendar day at R3,680 (the discounted couples-only Honeymoon incl. VAT), the 3-guest day falling back to Standard\u0027s R4,600, and a partyless request pricing the default with no 400 from the stripped forward \u2014 beside the search sequence 2+1 blocked \u2192 2+0 priced \u2192 2+1 still blocked. Nothing here books anything or touches Cloudbeds.',
      },
    ],
  },
  {
    key: '0.1.46',
    version: '0.1.46',
    date: '2026-09-01T00:20:00+02:00',
    changes: [
      {
        headline:
          'A changed GUEST COUNT is a changed cache identity, on ANY engine: the declared party is folded into the per-visitor session key, so a couple\u0027s search can never be served the answer a 3-guest search cached — whichever engine version sits behind this site.',
        detail:
          'Dave, 2026-08-31: \u0022If the booking site query changes in person counts, it should invalidate the cache for the date range. Retrieving from cache for fundamentally different guest counts will always be problematic.\u0022 Agreed — and the guarantee now lives on BOTH sides of the wire. Engine 0.1.57 already keys its per-night cache on the declared party, but that protection depends on which engine is deployed: this site holds ONE engine session open for its whole life, shared by every visitor, and against a pre-0.1.57 engine (whose key ignored children and folded an undeclared party into 2 adults) one family search could poison the couple\u0027s answer for everyone until an engine restart — exactly the live-box symptom. engineRatesQuote now appends p<adults>-<children> AS DECLARED (\u0027x\u0027 for an undeclared component, which never collides with a real 0) to the per-visitor half of the session key, so different guest counts are different cache identities to the engine no matter how it builds its own key. Separation rather than invalidation, deliberately: alternating family and couple searches would thrash an invalidating cache, while separated entries stay warm and each stays correct. Both guest-facing paths ride the same function — the availability search and the calendar sweep — and the loadtest path keeps its own key. The site-held session\u0027s prefix still matches the engine\u0027s dropSession sweep, so closing the session still drops every visitor\u0027s entries. VERIFIED two ways against real dists on a real PostgreSQL 16 with real Chromium: Dave\u0027s honeymoon stack through the CURRENT engine (the 3-guest search first, then 1 person offered the plan with its message, then 2 people offered and defaulted, 8/8); and the poisoning sequence through a REBUILT PRE-FIX engine 0.1.56 dist, where this key change alone keeps 2 adults + 1 child blocked and 2 adults alone priced, in both orders. Deploy: restart the site node; no engine change required — though engine 0.1.58 remains the recommended pair.',
      },
    ],
  },
  {
    key: '0.1.47',
    version: '0.1.47',
    date: '2026-09-01T01:10:00+02:00',
    changes: [
      {
        headline:
          'DEBUGGING FROM THE PAGE ITSELF: the footer now shows the build numbers actually running (site AND engine), and every rate card wears a flashlight — click it and the search\u0027s full raw response opens in a lightbox as an expandable tree.',
        detail:
          'Dave, 2026-08-31, still hunting the missing Honeymoon plan on the live box: \u0022We need a way to debug this. Add to the bottom of the page the current build number and add to the bottom right of each rate card a flashlight icon. When clicked, open a light box and show the full query response as an expandable tree.\u0022 THE FOOTER: a new GET /api/public/version answers { site, engine } — this server\u0027s own version plus the version the engine\u0027s /api/health reports (cached a minute; null with \u0022engine unreachable\u0022 shown when it does not answer) — and both builds append \u0022Build x.y.z · engine a.b.c\u0022 to the footer. That pair is the first question of every rate hunt this week, now readable off the page. THE FLASHLIGHT: core.js keeps the last availability search verbatim — the exact URL, HTTP status, timestamp and JSON — and a 🔦 button on the bottom right of EVERY suite card (sold-out cards included, desktop and mobile) opens it as a native details/summary tree, first two levels unfolded, keys gold, strings green, numbers blue: ratePlans → plan → suites → suiteId shows available/rateTotal/messages exactly as the engine said them, so \u0022why is the plan not offered\u0022 is answered by looking. Built with textContent throughout — the response draws itself and never executes — and it only ever shows the visitor their own answer, which the network tab already shows; nothing new is exposed. VERIFIED in real Chromium against the real engine dist through this real server with the honeymoon fixture: the footer naming both builds, the flashlight on every card, the tree opening with the request line and HTTP status, the Honeymoon plan\u0027s suites node readable inside it at 2 guests, and at 3 guests the tree showing available false with rateTotal null — the exact evidence the live hunt needs. Deploy: restart the site node; works against any engine version.',
      },
    ],
  },
  {
    key: '0.1.48',
    version: '0.1.48',
    date: '2026-09-01T01:55:00+02:00',
    changes: [
      {
        headline:
          'ROOT CAUSE OF THE VANISHING HONEYMOON PLAN, found by Dave with the new flashlight: the search bar LIED about the party. A deep-linked or restored guest count reached the select — and every query — without ever updating the glass dropdown’s visible label, so the bar said \u00220 children\u0022 while the query said 2 and the 4-guest rule rightly blocked the plan. Fixed both ways.',
        detail:
          'Dave, 2026-08-31: \u0022found the problem... totally in the wrong place. The search bar shows 0 children in the search, but when you click on the drop down it shows 2 and the query is showing 2. So the UI for the search controls is the root cause.\u0022 THE MECHANISM: the bar\u0027s dropdowns are native selects dressed in a glass trigger (Dave, 2026-08-25), and the trigger mirrors the select only on a REAL change event. Restoring a search from the URL (restoreFromUrl — and updateUrl writes every search\u0027s party INTO the URL, so any reload replays the last search) set select.value bare, which fires nothing: the select and every quote it fed carried the URL\u0027s children count while the trigger kept showing the default 0. The engine then did exactly as told — 2 adults + 2 children is 4 guests, the more-than-2 rule blocked the plan — and no amount of engine-side hunting could find a bug that lived in a label. Every earlier harness drove the API or the URL directly, so no test ever LOOKED at the closed trigger; the flashlight (0.1.47) put the real query next to the bar and made the lie visible in one glance. THE FIX, both ends: restoreFromUrl now dispatches a real bubbling change after each restored value — the dressing syncs, and anything else listening (the rate calendar\u0027s party-priced prefetch) sees the truth too — and glassSelect additionally re-syncs its label every time the trigger opens, so any future bare .value write self-heals at the latest on interaction. Mobile is untouched: its steppers\u0027 textContent IS the display, so it could never desync. VERIFIED in real Chromium against the real engine dist with the honeymoon fixture: a deep link with children=2 now SHOWS 2 in the bar (label, popup and query all agreeing, the plan rightly absent at 4 guests); picking 0 children in the glass popup and re-searching shows the Honeymoon pill; and the flashlight\u0027s request line matches the bar throughout. Deploy: static site files only — rsync them; guests may hold the old cached JS until a refresh, so bump the cache-busting query if the edge caches aggressively.',
      },
    ],
  },
  {
    key: '0.1.49',
    version: '0.1.49',
    date: '2026-09-01T02:40:00+02:00',
    changes: [
      {
        headline:
          'PER-GUEST SUITES stop advertising extra-guest tariffs — the rate already charges per adult — and the suite lightbox now shows the FULL COST BREAKDOWN inline: every night, the per-guest arithmetic, discounts, VAT and levy, the total.',
        detail:
          'Dave, 2026-08-31: \u0022If the rate is per person, then on the rate card do not show the cost of extra guests and on the rate card light box do not show the additional guests grid. On the rate card light box, show the full break down of costs.\u0022 TWO CHANGES, both builds. FIRST: on a suite whose engine annotation says per_guest_per_night, the card\u0027s \u0022Extra guests per night: ...\u0022 line and the lightbox\u0027s occupancy/extra-cost grid (Guests / Included / Maximum / Extra guest) no longer render — the per-guest rate already prices every adult, so an extra-guest tariff on top reads as a double charge, and Included-guest counts stopped being configured for per-guest suites in Lodge Ops 1.2.297 anyway. The Sleeps chip keeps stating the capacity; per-ROOM suites keep the grid and the line untouched. SECOND: the itemised statement that until now existed only as the card\u0027s hover tip is embedded in the suite lightbox under a \u0022Cost breakdown\u0022 heading — the SAME builder (attachBreakdown\u0027s guts extracted as buildBreakdown, hover wiring left behind) produces a detached element, and the lightbox re-seats it as a flowing block (its popover positioning and size caps neutralised by .blb-bd overrides in the lightbox\u0027s own injected styles). Nightly rows with their rule-message tags, the Accommodation subtotal carrying its per-guest multiplication, the discount a code earned, VAT and levy lines, the total, stay messages and the refund policy — all now one scroll down from the photos, on desktop and mobile alike. An unpriced room embeds nothing: the builder still returns null rather than inventing figures. VERIFIED in real Chromium against the real engine dist with a two-suite fixture (one per-guest, one per-room, extra-guest tariffs configured on both): the per-guest card and lightbox clean of extra-guest costs with the breakdown present and multiplying honestly; the per-room suite keeping grid, line AND gaining the same breakdown; mobile matching. Deploy: static site files only — rsync; guests may hold cached JS until a refresh.',
      },
    ],
  },
  {
    key: '0.1.50',
    version: '0.1.50',
    date: '2026-09-01T03:10:00+02:00',
    changes: [
      {
        headline:
          'Per-guest rates SPEAK PER PERSON: the card shows the average per person per night under the headline, and the lightbox breakdown prices each night per person — with the Accommodation line still carrying the × adults multiplication back to the full figure.',
        detail:
          'Dave, 2026-08-31: \u0022if the rate is per person then under the headline rate show the average per person per night\u0022 and \u0022In the light box cost breakdown show the night rate as per person per night.\u0022 BOTH BUILDS. THE CARD: on a suite the engine annotates per_guest_per_night, a gold line joins the price block right under the existing a-night line — headline ÷ nights ÷ the adults the engine priced, e.g. \u0022R1,000.00 per person a night\u0022 — on the SAME VAT basis as the headline above it, so the two figures never describe different money. Per-room suites gain nothing. THE BREAKDOWN (card hover tip and the lightbox\u0027s embedded statement alike — one builder): each nightly row on a per-guest stay now shows ONE guest\u0027s night, tagged \u0022per person\u0022 in quiet small type, and the Accommodation line below keeps its \u0022per-guest rate × N adults\u0022 label — so the column still explains itself: nightly per-person rows × adults = Accommodation, then discount, VAT and levy to the total, to the cent. Per-cent rounding on the division lands on the per-person figure only; the subtotal and total remain the exact engine figures, never re-derived. Per-room stays render exactly as before. VERIFIED in real Chromium against the real engine dist, two-suite fixture: the per-guest card showing \u0022R1,000.00 per person a night\u0022 under an R4,000 two-night headline for 2 adults with the per-room card clean of it; the lightbox breakdown\u0027s night rows at R1,000.00 tagged per person with Accommodation × 2 adults at R4,000.00 and the R4,600.00 total intact; the per-room suite\u0027s rows untouched at R4,000.00 nightly; mobile matching. Deploy: static site files only — rsync.',
      },
    ],
  },
  {
    key: '0.1.51',
    version: '0.1.51',
    date: '2026-09-01T05:50:00+02:00',
    changes: [
      {
        headline:
          'The suite lightbox stops mumbling: \u0022VAT & levy included · Per-guest rate · priced for 2 adults\u0022 was three ideas in one italic line. The note now carries only the tax statement, and the per-guest story is its own gold line — the same \u0022R… per person a night\u0022 the card already shows.',
        detail:
          'Dave, 2026-08-31: \u0022this working in the lightbox is confusing: VAT & levy included · Per-guest rate · priced for 2 adults\u0022. The 0.1.43 basis annotation was APPENDED to the tax note with a dot separator, and once the per-person language landed elsewhere (0.1.50) the mashup read as one broken sentence. THE FIX, both builds: openLightbox no longer concatenates rateBasisLabel into the note — the note is purely the tax statement (\u0022VAT & levy included\u0022 / \u0022+ R… VAT & levy\u0022) — and the price block gains a perPerson line (headline ÷ nights ÷ adultsPriced, per-guest suites only) rendered gold under the a-night figure, matching the card\u0027s 0.1.50 line exactly. The priced-for-N-adults arithmetic still reads explicitly in the embedded Cost breakdown (\u0022per-guest rate × 2 adults\u0022), so nothing is lost — it just stopped being squeezed into a sentence. The CARD\u0027s own basis line is untouched. Per-room suites see no change. VERIFIED in real Chromium against the real engine dist under the INCLUSIVE rate display (the mode of Dave\u0027s quote): the per-guest lightbox note reads exactly \u0022VAT & levy included\u0022 with no dot-appended basis, the gold per-person line beneath the nightly figure, the breakdown still carrying the × 2 adults line; the per-room lightbox carries no per-person line. Deploy: static site files only — rsync booking.js, m/booking.js, lightbox.js.',
      },
    ],
  },
  {
    key: '0.1.52',
    version: '0.1.52',
    date: '2026-09-02T04:20:00+02:00',
    changes: [
      {
        headline:
          'The stay summary: pressing Continue with suites in the basket now opens a page in the site\u0027s own glass language that says everything before any money moves \u2014 every suite chosen (with its quantity), the rate plan and what it includes, the rules\u0027 own words, the night-by-night statement per suite, every charge and the totals per suite, the grand total, and the guest\u0027s tick that it is all correct before \u0022Continue to payment\u0022 wakes. Both builds. Static files only.',
        detail:
          'Dave, 2026-09-02: after adding guest suites to their booking list and clicking Continue, show a summary page in the same style as the main page \u2014 all the selected rooms, the rate information including inclusions, full breakdowns of all the rooms, charges and totals; at the bottom a grand total and \u0022I agree all of the information above is correct and satisfactory\u0022, that text coming from the website settings in Lodge Ops; when checked, enable the continue-to-payment button. NEW FILES: site/review.js (window.BKReview \u2014 ONE renderer both builds call, so the two summaries can never drift) and site/review.css (the glass skin for both, with the mobile breakpoint). Every figure on the page comes from the same BKCore helpers the cards and the bar use \u2014 priceParts, stayBreakdown, stayMath, ruleCallouts, rateBasisLabel \u2014 and the per-suite statement IS the card\u0027s own bk-breakdown element (buildBreakdown), shown open; so the page cannot disagree with the number the guest was just shown, and it is proven: the grand total on the page equals the summary bar\u0027s figure to the cent in the harness. PER SUITE: photo (own imagery, then the generative treatment), name and \u00d7 quantity, the suite total (\u00d7 quantity) with the a-night and per-person lines and the tax note in the display mode Lodge Ops chose; RATE: the plan\u0027s name, its basis (per-suite / per-guest \u00b7 priced for N adults), its description, the rules\u0027 callouts (messages gold, inclusions added, removed struck, discount, refund policy), then the inclusions FOR THIS QUOTE as sections (deltas already applied by planOptionsFor; exclusions sink to the bottom and are struck through; plans without sections fall back to Included / Not included exactly as the compare table does); COST BREAKDOWN: the nightly rows with their night messages, accommodation (with the \u00d7 adults arithmetic on a per-guest rate), discount, VAT, levy with its multiplication, total, stay messages, refund line \u2014 and a \u0022N suites \u00d7 R\u2026\u0022 line when the guest takes more than one of a suite. CHARGES & TOTALS: accommodation across every suite (\u00d7 quantities), discount, every tax and levy line summed BY LABEL over the suites, then the GRAND TOTAL in gold; suites on request are named as not in the totals. AGREEMENT: the tick-box sentence is config.text.agreementText (Lodge Ops Settings \u2192 Booking Website, new in Lodge Ops 1.2.349), built-in fallback \u0022I agree that all of the information above is correct and satisfactory.\u0022; Continue to payment is disabled until ticked and disables again if unticked. The payment step itself ships in its own certified batch: the button records payment_started (suites, quantities, plans, the agreed grand total) and shows the Lodge Ops continueNote, the same honest state Continue used to show. \u0022\u2190 Change your suites\u0022 brings the results and the bar straight back with every pick intact; the summary also closes on a new search and on the browser Back (a history entry is pushed when it opens). Events: summary_viewed, summary_agreed / summary_unagreed, payment_started. BOOKING.JS (both builds): Continue calls openReview(), which hides the results and the bar and hands BKReview the picks, dates, party, lodge, config and the card helpers; closeReview() reverses it; applySiteText applies agreementText and continueNote to the new page. VERIFIED in headless Chromium against a stub of the public API shaped like the real availability answer (two suites, two plans with inclusion sections, a rule message, an added inclusion, a refund policy, per-suite and per-guest bases, the levy from the lodge block), 39 assertions across the desktop and mobile builds: two suites picked (one \u00d7 2 on desktop), Continue shows the summary and hides results and bar, one card per suite, All Inclusive by house default, 13 inclusion chips with 2 struck, the three callouts, 18 statement rows, the four charge lines, grand total = bar total (R66,700 desktop / R46,000 mobile), the agreement text from config, the button disabled until ticked and re-disabled on untick, payment click shows the Lodge Ops note, Back restores results with both picks and the same bar total, no script errors, no horizontal overflow at 1280 and at a true 390px phone. DEPLOY: static site files only \u2014 rsync index.html, booking.js, review.js, review.css, m/index.html, m/booking.js.',
      },
    ],
  },
  {
    key: '0.1.53',
    version: '0.1.53',
    date: '2026-09-02T06:00:00+02:00',
    changes: [
      {
        headline:
          'Closed to arrivals / closed to departures (engine 0.1.60): a suite the rate rules will not sell for the searched stay now says exactly why on its card \u2014 \u0022Closed to arrivals on 15 September 2026\u0022 \u2014 and cannot be picked; the date picker marks closed days with a gold edge and refuses the click they are closed to. Both builds; site server + static files.',
        detail:
          'Dave, 2026-09-02: the Rate Engine gained a Restrictions modifier and Closed to Arrivals / Closed to Departures qualifiers (engine 0.1.60, Lodge Ops 1.2.350). WHAT REACHES THE SITE: the engine\u0027s per-suite stay summary carries available: false with restricted (the sentence) and closedToArrival / closedToDeparture; each night carries the flags it was given. CORE.JS: planRestriction(roomTypeId, ratePlans) \u2014 the first restriction any offered plan carries for the suite, empty when the suite is merely unpriced (never invented). BOOKING.JS (both builds): after the plans are mapped, room.restricted is set when no plan sells the stay and the engine said why; renderRoom and the suite lightbox treat a restricted suite exactly like a sold-out one \u2014 the badge and the lightbox banner carry the engine\u0027s words instead of \u0022Unavailable for your dates\u0022, no price, no Add \u2014 and suiteOrdered sinks it below the bookable suites (the availability calendar button stays, as on any unavailable suite). SERVER (lib.mjs calendarWithEngineRates): a picker day is closedToArrival / closedToDeparture only when EVERY plan on EVERY suite closes it \u2014 one suite still taking arrivals keeps the day open and the search then names the closed suites; stale flags are cleared before the fold. CALENDAR.JS (both paint paths and the picker): a closed-to-arrivals day wears a gold bar on its left edge, closed-to-departures on its right, with a title saying which (the rate stays \u2014 a stay may still pass through the night); clicking a closed-to-arrivals day as check-in, or a closed-to-departures day as checkout, is refused where it is clicked with a one-shake animation (none under reduced motion) and the picker stays open. VERIFIED in headless Chromium against a stub shaped like the new engine answer, 13 assertions across both builds: the closed suite carries the exact sentence, is unpriced and unpickable, and sits after the open suite; 15 Sep wears the arrivals mark with its rate, 25 Sep the departures mark; check-in on 15 Sep refused with no pick and the arrival field untouched; a 22 Sep check-in then 25 Sep checkout refused with the picker open; 26 Sep completes the range as 4 nights; no script errors. lib.mjs fold executed from shipped source (a day closed by only one of two suites stays open). DEPLOY: restart the site server (lib.mjs) and rsync core.js, booking.js, m/booking.js, calendar.js, calendar.css.',
      },
    ],
  },
  {
    key: '0.1.54',
    version: '0.1.54',
    date: '2026-09-02T07:40:00+02:00',
    changes: [
      {
        headline:
          'Stay summary: inclusions fold to two rows with a \u0022Show all\u0022 button; a \u0022Hold my booking\u0022 button beside \u0022Continue to payment\u0022, both waking on the agreement tick; Hold opens a modal that asks for a valid email address, sends a code to it (Lodge Ops mails it from the template chosen in Settings \u2192 Booking Website), and the right code opens the Hold page. Both builds. Static files only.',
        detail:
          'Dave, 2026-09-02: make the inclusions an expandable section showing 2 rows by default; add \u0022Hold my booking\u0022 to the left of Continue to payment, also disabled until the agree flag; on click open a modal explaining a valid email address is required, with an email field and Send; use a template from the booking site settings to email a unique ID; then show a verification ID field; the correct ID opens the Hold page and does nothing else. REVIEW.JS: inclusion sections render in full but only the first two rows show; the rest sit behind \u0022Show all inclusions \u00b7 N more\u0022 / \u0022Show fewer\u0022 (aria-expanded, events inclusions_expanded / inclusions_collapsed); no button when there are two rows or fewer. HOLD: #holdBtn (ghost gold CTA) sits left of #payBtn in .rv-actions-right, both disabled until #agreeBox is ticked and disabled again on untick; on a phone the pair stacks with Hold ABOVE payment (DOM order \u2014 the desktop left-to-right turned on its side). The modal (#holdModal, glass, Escape / backdrop / \u00d7 close, body scroll locked): the explanation is config.text.holdIntro (Lodge Ops) with a built-in fallback; the address is checked on the page first (pattern, \u2264254) and nothing is sent for a bad one; Send POSTs {email, stay} to HOLD_API/start (window.BK_HOLD_API or /api/web/booking-hold \u2014 the Lodge Ops API on the same origin, as the chat widget already uses) with the stay snapshot (dates, nights, currency, grand total, suites \u00d7 qty with plan and total); ok moves to the code step (holdSent text + the address, a one-time-code input, Verify, \u0022Use a different email address\u0022); Verify POSTs {id, code} (upper-cased); a refusal shows the server\u0027s words and, at zero attempts left, returns to the email step; ok closes the modal and opens the HOLD PAGE (#hold): holdPageTitle / holdPageBody from Lodge Ops (fallbacks built in), the reference (the first 8 characters of the hold id, upper-case), the verified address, the stay line, one row per suite with its total, the grand total \u2014 and nothing else: no reservation, no payment, no further buttons. Events: hold_started, hold_code_sent, hold_send_failed, hold_code_rejected, hold_verified, hold_page_opened. BKReview.close() also closes the modal and the hold page, so a new search clears everything. Both index.html files carry the modal and the hold section; review.css the skins (modal, code input, ghost CTA, hold card, phone breakpoint). VERIFIED in headless Chromium against the stub (hold routes stubbed: any start ok, verify ok only for K7H2QD), 20 assertions across both builds: three inclusion rows fold to two with the button reading \u00221 more\u0022, the toggle reveals all and offers to fold; Hold sits beside (desktop) / above (phone) payment, both disabled until agreed and enabled on the tick; the modal opens with the Lodge Ops explanation on the email step; a bad address is refused with nothing posted; a good one posts the snapshot (1 suite, 4 nights, a numeric total) and moves to the code step naming the address; a wrong code is refused with the modal kept; the right code in lower case closes the modal, hides the summary and opens the Hold page with the Lodge Ops title, reference 2F2D5E1A, the address, the grand total and the stay line; no overflow, no script errors. PAIRS WITH Lodge Ops 1.2.351 (migration 372, the endpoints, the template picker and texts). DEPLOY: rsync index.html, m/index.html, review.js, review.css \u2014 and Lodge Ops 1.2.351 must be live on the same host, or Send answers that the code could not be sent.',
      },
    ],
  },
  {
    key: '0.1.55',
    version: '0.1.55',
    date: '2026-09-02T12:40:00+02:00',
    changes: [
      {
        headline:
          'Holds, governed from Lodge Ops: \u201cHold my booking\u201d only exists when holds are on and check-in is more than two weeks away; the Hold page then asks how long \u2014 24 hours free, 36 hours for R150 + VAT (only when check-in is more than six weeks away), 72 hours for R989 + VAT (only past three months) \u2014 and, for a paid hold, shows a square button per payment provider enabled in Lodge Ops (Stripe, Yoco, PayPal, TurnStay). The choice is recorded on the hold and the reservations team is told.',
        detail:
          'Dave, 2026-09-02. CONFIG (/config.json, from Settings \u2192 Booking Engine): `holds` {enabled, buttonMinDays, options[{hours, price, minDays}]} and `payments` {stripe, yoco, paypal, turnstay}; missing keys read as the Lodge Ops defaults (on, 14 days, 24h free / 36h R150 past 42 days / 72h R989 past 91 days, no providers). review.js: holdOffered() hides #holdBtn on the stay summary unless holds are on and daysUntil(check-in) > buttonMinDays \u2014 whole days in UTC, so exactly 14 days is not enough and 15 is; renderHoldChoices() on the Hold page lists the options the distance allows as pressable cards (hours large, \u201cFree\u201d or \u201cR150 + VAT\u201d beneath), a paid option reveals the provider squares (118px, brand-coloured CSS wordmarks \u2014 no image files to fetch), the free one (or a paid one when no provider is enabled) a single confirm button; pressing a square or Confirm posts {id, hours, provider} to /api/web/booking-hold/choose and the page answers with the hold-until time and what happens next (\u201cThe reservations team has been told and will send you a secure PayPal link for R150 + VAT\u201d / \u201cYour booking is held for 24 hours, until \u2026\u201d); a refusal from Lodge Ops shows as its message with the options still live. Both builds share the renderer; the markup is one #holdChoice host in each index.html; review.css carries the cards, squares and the phone layout (two columns). VERIFIED in real Chromium against a config stub, 29 assertions across desktop (check-in 135 days out: three options, three squares for the enabled providers, 36 hours \u2192 PayPal \u2192 the noted-until line), mobile (90 days out: two options, the free 24-hour confirm) and a check-in 8 days out (no Hold button at all, Continue to payment alone; the flag and the 14/15-day edge checked directly); no overflow, no script errors. PAIRS WITH Lodge Ops 1.2.354 (migration 375 and the choose endpoint) \u2014 without it a choice answers that it could not be saved. DEPLOY: rsync index.html, m/index.html, review.js, review.css.',
      },
    ],
  },
  {
    key: '0.1.56',
    version: '0.1.56',
    date: '2026-09-02T13:20:00+02:00',
    changes: [
      {
        headline:
          'Continue and Hold no longer swap pages: the stay summary renders as a section BELOW the results, above the footer, and the page scrolls down to it; the Hold section renders below that. An email address this browser already verified is offered back in the Hold modal with Send reading Continue, and goes straight to the Hold section with no code.',
        detail:
          'Dave, 2026-09-02: instead of opening a new page when clicking Continue and Hold, add a new section at the bottom of the page above the footer, render the content and controls there and scroll down to it; if the email address has already been verified, do not verify it again. SECTIONS: openReview (both builds) keeps #results visible and only steps the bar aside; BKReview.open shows #review beneath the results and scrolls to it; openHoldPage shows #hold beneath the summary (no longer hiding it) and scrolls; a changed selection while the summary is open retires it (updateSummary closes it; Continue renders it afresh) and a fresh summary retires an earlier hold section; \u201cChange your suites\u201d hides both and brings the bar back. Both sections carry a top rule so they read as new sections. REMEMBERED ADDRESS: on a verified code (or a verified-on-the-spot start) review.js stores {email, holdId} under localStorage bk-hold-verified; the Hold modal opens with that address filled in, Send reads Continue with \u201cThis address was verified earlier \u2014 no code needed\u201d beneath, and Continue posts priorHoldId with the new stay; a verified: true reply skips the code step and opens the Hold section with the new reference; any other address (typed over it, or \u201cUse a different email address\u201d) is a plain Send with a code as before, and Lodge Ops refusing the prior id also falls back to the code step. VERIFIED in real Chromium against the config stub, 37 assertions: on desktop, mobile and the 8-days-out case the results stay, the summary sits below them and above the footer with the page scrolled; the Hold section sits below the summary; on desktop a second hold offers the address back, reads Continue, posts the prior id, makes no verify call and opens the Hold section with reference 3A3A3A3A and three options, and a different address turns Continue back into Send; no script errors. PAIRS WITH Lodge Ops 1.2.355 (priorHoldId). DEPLOY: rsync index.html, m/index.html, booking.js, m/booking.js, review.js, review.css.',
      },
    ],
  },
  {
    key: '0.1.57',
    version: '0.1.57',
    date: '2026-09-02T13:50:00+02:00',
    changes: [
      {
        headline:
          'Hold my booking with an address this browser already verified opens no modal at all: the earlier hold is cited to Lodge Ops and the Hold section opens straight away. The reference number is no longer shown on the hold card (kept in the markup for later).',
        detail:
          'Dave, 2026-09-02: if the email address has already been verified then do not send a new verification, just close the modal and continue; do not show the reference number on the hold card, we will add it back later. review.js: the Hold button checks localStorage bk-hold-verified first \u2014 with a remembered address, holdWithPrior posts {email, stay, priorHoldId} while the button reads \u201cOne moment\u2026\u201d, and a verified: true reply opens the Hold section with the new id remembered; the 0.1.56 modal path (address offered back, Send reading Continue) remains only as the fallback: if Lodge Ops will not take the earlier hold (older than 90 days, another address) it has sent a code, so the modal opens straight at the code step for that address with the code field focused; a network failure or a refusal opens the modal at the email step with the reason. The Reference row in .hold-meta is hidden in both builds; #holdRef is still filled so it can return with one attribute. VERIFIED in real Chromium against the config stub, 37 assertions: a verified address presses Hold and gets the Hold section with no modal, one start post carrying the prior id, no verify call, the button restored; a stale remembered id lands in the modal at the code step and the code verifies as usual; the reference is not visible on the hold card in either build; no script errors. PAIRS WITH Lodge Ops 1.2.355. DEPLOY: rsync index.html, m/index.html, review.js.',
      },
    ],
  },
];
