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
];
