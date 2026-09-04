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
  {
    key: '0.1.58',
    version: '0.1.58',
    date: '2026-09-02T15:10:00+02:00',
    changes: [
      {
        headline:
          '\u201cHold it\u201d opens a hold section below the options: the reference number, the address, the stay and its suites, the grand total, the hold length and fee, a clock counting down to the end, the end time in the guest\u2019s own time zone, how to come back, and two buttons \u2014 Cancel the hold and search again, Make the reservation. \u201cRetrieve booking\u201d under Check availability takes the reference and rebuilds the whole page from the hold\u2019s snapshot, then opens that section with its clock.',
        detail:
          'Dave, 2026-09-02. HOLD IT: the choice now posts the page snapshot with it \u2014 the form (arrival, nights, party, suites, code), the raw availability + rate answer the rates came from, and the picks with their plans (booking.js snapshotState; both builds) \u2014 and the stay snapshot carries each suite\u2019s roomTypeId so Lodge Ops can hold its nights on the rate engine. The reply (reference, hours, price, provider, holdUntil, stay) renders #held (review.js showHeld): the reference large in gold, email / stay / hold rows, the suite lines and grand total, a 1-second countdown (\u201c1 day 11:59:58\u201d, then hh:mm:ss) that turns into \u201cThis hold has run out\u201d at zero, \u201cRuns out on Thu, Sep 3, 2026, 08:20 PM SAST (your local time)\u201d from toLocaleString in the browser\u2019s zone, the dashed note telling the guest to click \u201cRetrieve booking\u201d under the Check availability button and enter the reference, and the two buttons. Cancel posts /cancel {reference}, closes every section, clears the picks and scrolls back to the form; Make the reservation records the intent (the payment step is its own batch) and shows the Lodge Ops continue note. RETRIEVE BOOKING: a link below Check availability in both builds opens a modal (reference field, Retrieve); /retrieve answers the hold with its snapshot and booking.js restoreHold puts the form back, replays the stored search answer through the same applySearchResult the live search uses (the plan each pick was on is honoured), re-picks the suites, opens the summary and then the hold section, scrolled to; an unknown reference is refused in the modal; an expired or cancelled hold still rebuilds, titled so, with Search again only. A fresh summary or Change your suites retires the hold section and stops its clock. VERIFIED in real Chromium against the config stub, 46 assertions: Hold it posts the snapshot (form, results, the pick); the hold section sits below the options and above the footer, scrolled to, with reference K7H2QDX2, a ticking clock (\u201c1 day hh:mm:ss\u201d for 36 hours, hh:mm:ss for 24), the local end time, the how-to note, both buttons, the options frozen; on a fresh page \u201cRetrieve booking\u201d sits below Check availability, a wrong reference is refused, the right one rebuilds the form (15 Jan 2027, 4 nights), both suites, the picked one, the summary and the hold section with its clock, scrolled to, and the URL; Make the reservation shows the note; Cancel posts the reference, closes everything, clears the picks and returns to the form; both builds, no script errors. PAIRS WITH Lodge Ops 1.2.356 (migration 376, the choose/retrieve/cancel endpoints, the emails and the reminder) and engine 0.1.61. DEPLOY: rsync index.html, m/index.html, booking.js, m/booking.js, review.js, review.css.',
      },
    ],
  },
  {
    key: '0.1.59',
    version: '0.1.59',
    date: '2026-09-02T15:40:00+02:00',
    changes: [
      {
        headline:
          '\u201cRetrieve booking\u201d now sits inside the search bar, directly under the Check availability button, on the full site.',
        detail:
          'Dave, 2026-09-02 (screenshot): move Retrieve booking to the space under Check availability. index.html wraps the button and the link in .bar-go, a centred column inside the bar; review.css sizes the link at 12px with no padding. The phone build keeps its own row under the full-width button. VERIFIED in real Chromium at 1440px: the link is 5px under the button, centred on it to the pixel and inside the bar; the 46-assertion hold flow still passes, including the fresh-page Retrieve booking step. DEPLOY: rsync index.html, review.css.',
      },
    ],
  },
  {
    key: '0.1.60',
    version: '0.1.60',
    date: '2026-09-02T16:00:00+02:00',
    changes: [
      {
        headline:
          'Your stay: the inclusions now sit under an \u201cIncluded in this rate\u201d heading and fold to the first two ROWS of chips as laid out on the screen (not the first two sections), with \u201cShow all inclusions \u00b7 N more\u201d for the rest; the plan\u2019s description line (\u201cThis is the Oase Standard Rack Rate.\u201d) is gone from the summary.',
        detail:
          'Dave, 2026-09-02 (screenshot): show less inclusions in the Your stay section and add a heading Included in this rate; remove the text This is the Oase Standard Rack Rate. review.js: renderPick builds every section unfolded under the new rv-kicker heading; open() shows the section first (so it has a width) and then foldInclusions measures each chip\u2019s top, keeps the chips on the first INCLUSION_ROWS (2) distinct rows, hides the rest chip by chip (a section left with nothing showing hides too) and adds the toggle with the hidden COUNT \u2014 a wide screen simply shows more per row. The plan description paragraph is no longer rendered on the summary; the suite cards keep it. VERIFIED in real Chromium against the config stub, 48 assertions: on desktop and phone the heading is first, exactly two chip rows show, the toggle names the hidden count, the toggle reveals every chip and offers to fold again, and the description text is absent; the hold flow is unchanged. DEPLOY: rsync review.js, review.css.',
      },
    ],
  },
  {
    key: '0.1.61',
    version: '0.1.61',
    date: '2026-09-02T16:40:00+02:00',
    changes: [
      {
        headline:
          'Your stay: a \u201cWhat\u2019s this?\u201d link under Hold my booking opens a modal explaining a hold (text from Lodge Ops); a disabled Hold or Continue button says \u201cYou must agree first\u201d when hovered; each suite card carries a Refunds line under its rate.',
        detail:
          'Dave, 2026-09-02, three asks. WHAT\u2019S THIS: #holdWhat sits centred under Hold my booking in .rv-hold-col (both builds) and lives and dies with the button (hidden when the hold is not offered); it opens #whatModal, \u201cWhat is a booking hold?\u201d, with text.holdWhatsThis from Settings \u2192 Booking Website or the built-in wording (\u201cA booking hold is a way for you to hold this booking, without obligation\u2026\u201d); \u00d7, a click outside or Escape closes it. YOU MUST AGREE FIRST: each of the two buttons is wrapped in .rv-tip with the words in data-tip; the wrapper\u2019s ::after shows on hover only while the button inside is disabled (:has(> .cta:disabled):hover), the disabled button lets the pointer through to the wrapper, and the buttons also carry the words as a title while disabled; agreeing removes both. REFUNDS: renderPick adds a labelled \u201cRefunds\u201d line under the rate head with C.refundLabel (Fully / Partially refundable up to N nights before check-in, Nonrefundable) or, when the rate carries no policy, \u201cRefund terms for this rate are available from the lodge on request.\u201d in muted italics; the refund callout chip is no longer repeated on the summary. VERIFIED in real Chromium against the config stub, 61 assertions: the link sits directly under the button and opens the modal with the Lodge Ops text, Escape closes it, no link when the hold is not offered; hovering the disabled Continue button shows the tooltip with both titles set and agreeing clears them (an instant scroll before the hover \u2014 smooth scrolling had moved the button under the pointer mid-measure); the Refunds line reads \u201cFully refundable up to 7 nights before check-in\u201d under the rate with no duplicate chip; both builds, no script errors. PAIRS WITH Lodge Ops 1.2.357 (the holdWhatsThis text field). DEPLOY: rsync index.html, m/index.html, review.js, review.css.',
      },
    ],
  },
  {
    key: '0.1.62',
    version: '0.1.62',
    date: '2026-09-02T18:15:00+02:00',
    changes: [
      {
        headline:
          'Refund terms now say the processing fee and whether dates may change after the refundable date, and for what fee; each suite on the hold cards carries its refund terms and they travel with the hold to Lodge Ops for the emails. Hold my booking and Continue to payment are top-aligned. A retrieved hold remembers the agreement (ticked and locked) until the hold is cancelled.',
        detail:
          'Dave, 2026-09-02, four asks. REFUND WORDING (engine 0.1.62): BKCore.refundLabel appends \u201c, less a R250 processing fee\u201d when the quote carries processingFee and \u201c. Date changes allowed after that for a R100 change fee\u201d (or \u201cat no charge\u201d) when allowDateChanges is set \u2014 nonrefundable reads \u201cNonrefundable. Date changes allowed \u2026\u201d; used everywhere the label is (suite cards, the compare lightbox, the Your stay Refunds line, the hold cards). HOLD CARDS: the stay snapshot\u2019s suites carry refund (the same sentence), the Hold section and the hold page list it under each suite in a thin gold-ruled line, and Lodge Ops lists it per suite in the confirmation and reminder emails. TOP ALIGN: .rv-actions-right aligns to the top so \u201cWhat\u2019s this?\u201d under Hold no longer pushes Continue to payment down. AGREEMENT: showHeld ticks and locks \u201cI agree\u201d while a hold is active and wakes both buttons (a retrieved hold arrives agreed); Cancel the hold and search again unlocks and clears it; a fresh summary always starts unlocked. VERIFIED in real Chromium against the config stub, 68 assertions: the Refunds line reads the full sentence with fee and change fee; nonrefundable-with-changes, partial-with-free-changes and a plain policy each read right; the two buttons share a top edge; the hold cards say the refund terms and the stay posted to Lodge Ops carries them; the retrieved hold has the box ticked and locked with both buttons awake, and cancelling unlocks and clears it; no script errors. PAIRS WITH Lodge Ops 1.2.359 and engine 0.1.62. DEPLOY: rsync core.js, review.js, review.css.',
      },
    ],
  },
  {
    key: '0.1.63',
    version: '0.1.63',
    date: '2026-09-02T19:30:00+02:00',
    changes: [
      {
        headline:
          'The hold section says when the hold was taken, in the guest\u2019s own time.',
        detail:
          'Dave, 2026-09-02: make sure the date and time the hold was created is recorded with the hold information. Lodge Ops 1.2.360 now sends chosenAt (Hold it pressed) and createdAt (the code went out) with every hold; showHeld renders \u201cHold taken on Thu, Sep 3, 2026, 08:20 PM SAST (your local time)\u201d above the clock, on a fresh hold and on a retrieved one alike. VERIFIED in real Chromium against the config stub, 70 assertions, both builds. PAIRS WITH Lodge Ops 1.2.360. DEPLOY: rsync review.js, review.css.',
      },
    ],
  },
  {
    key: '0.1.64',
    version: '0.1.64',
    date: '2026-09-02T20:35:00+02:00',
    changes: [
      {
        headline:
          'Your stay: each suite card carries a bin that removes that suite from the stay. With suites left the summary re-renders in place; when the last one goes the summary closes and the page scrolls back to the availability widget.',
        detail:
          'Dave, 2026-09-02: on the your stay section add to each card a bin icon that removes the selection; if there are no more selected rooms scroll back to the availability widget at the top. review.js renderPick adds .rv-bin (a stroked bin glyph, top right of the card) calling ctx.onRemove(roomTypeId); booking.js (both builds) removePick drops the pick, refreshes the cards and either re-opens the summary in place (openReview(true), no extra history entry) or, with nothing left, closes the summary, hides the bar and scrolls to #searchForm. VERIFIED in real Chromium against the config stub, 73 assertions: two suites picked give two cards with two bins, the first bin leaves one card and the summary open with \u201c1 suite\u201d in the meta line, the second closes the summary, hides the bar and lands near the widget; the hold flow is unchanged. DEPLOY: rsync booking.js, m/booking.js, review.js, review.css.',
      },
    ],
  },
  {
    key: '0.1.65',
    version: '0.1.65',
    date: '2026-09-02T15:37:54+02:00',
    changes: [
      {
        headline:
          'Paying the hold fee. On the \u201cYour booking is on hold\u201d card, pressing a payment square SELECTS it \u2014 highlighted, the others greyed \u2014 and opens the way to pay beneath it: a card form on our own page (name, number, expiry, CVC, the secure-payment icons and \u201cPay R172.50 incl. VAT and hold it\u201d) for a gateway that takes the card here, or \u201cClick here to make payment\u201d for one that takes it on its own page. Pressing the same square again puts everything back. The card details go to the rate engine, never to Lodge Ops, and are wiped from the form the moment the request is built; the held section then shows the fee paid, with the card\u2019s last four.',
        detail:
          'Dave, 2026-09-02: if there is a fee and a gateway is selected \u2014 a card form below the gateway selection with the standard secure icons for a gateway that can take the card on our site, highlighting the selected gateway and greying the others; the same click removes it; a click-here-to-make-payment button for a gateway that needs its own surface; card information sent to the rate engine; payment processing never in Lodge Ops; full card details never stored. review.js renderHoldChoices: squares are toggles (.on / .dim, aria-pressed); GET /api/public/payments/gateways (the engine\u2019s list with mode card|redirect; a square the engine does not list is hidden; the usual modes stand if it cannot be asked) and GET /api/public/payments/fee?hours for the Pay label; the card panel checks the number (grouped in fours, Luhn), the expiry (MM/YY, not past) and the CVC before anything leaves; commit places the hold FIRST (Lodge Ops /choose, so the payment has a reference), then POST /api/public/payments/charge {gateway, reference, hours, email, card} to the engine through this server, then Lodge Ops /booking-hold/paid {id, reference, paymentId} \u2014 Lodge Ops checks with the engine before it believes it; the fields are cleared as the request is built and a refusal (declined, expired, wrong CVC, 3-D Secure) is shown under the form with the hold kept so another card or gateway can be tried. A redirect gateway: a tab is opened synchronously on the click and pointed at the engine\u2019s checkout URL (POST /api/public/payments/checkout with returnUrl = this page); the held section shows \u201cWaiting for your payment on PayPal\u2026 Open the payment page again\u201d and asks POST /api/public/payments/status every 4 s (up to 30 min) until it is paid, then tells Lodge Ops and re-renders; localStorage bk-hold-pay remembers the hold for the return trip. Back from the gateway with ?pay=<id>&r=success the page checks the payment, records it and opens Retrieve booking with the reference filled in (openRetrieve(prefill)); r=cancel|failure just reopens Retrieve. showHeld gains a Fee row \u2014 \u201cPaid R172.50 incl. VAT via Stripe \u00b7 visa \u2022\u2022\u2022\u2022 4242\u201d or \u201cR172.50 incl. VAT \u2014 not yet paid\u201d \u2014 on a fresh hold and a retrieved one. server/src/lib.mjs FORWARD_ROUTES adds the five payments routes (gateways, fee, charge, checkout, status) onto /api/booking/payments/*; the forwarder passes the body as bytes and logs method, path, status and time only. review.css: .hold-payer.on/.dim, .hold-paypanel, the card form, .hold-secure (padlock and shield glyphs, VISA / Mastercard / AMEX chips), .hold-paywait. Both builds share review.js/review.css. VERIFIED in real Chromium against the REAL Lodge Ops 1.3.2 API, engine 0.1.65 and a mock of the four gateways (the config stub proxying holds to Lodge Ops and payments signed to the engine), 18 assertions: the squares and their toggle, the card form below the squares with the icons and the R172.50 label, PayPal\u2019s button, a Luhn failure refused on the page, a declined card refused in the gateway\u2019s words with the fields wiped and the card number seen only on the charge route, a good card paid and shown on the held card and in Lodge Ops\u2019 row, Retrieve showing it paid, the PayPal tab, the wait line, the poll noticing the approval within seconds and the card reading AMEX \u2022\u2022\u2022\u2022 0005, the return path opening Retrieve prefilled; no console errors. PCI NOTE: the card number crosses our page and the engine \u2014 SAQ D scope; Stripe accepts raw card data only on accounts enabled for it. PAIRS WITH Lodge Ops 1.3.2 and engine 0.1.65. DEPLOY: rsync review.js, review.css and server/src/lib.mjs; restart the site service.',
      },
    ],
  },
  {
    key: '0.1.66',
    version: '0.1.66',
    date: '2026-09-02T16:11:32+02:00',
    changes: [
      {
        headline:
          'Stripe on the hold card now uses Stripe\u2019s own card fields (Stripe Elements). The number, expiry and CVC live in an iframe from js.stripe.com and go from the guest\u2019s browser straight to Stripe; this site keeps only the name on the card. The rate engine creates the payment, Stripe.js confirms it on the page, and the engine checks with Stripe before the hold is marked paid.',
        detail:
          'Stripe, 2026-09-02: \u201cwe don\u2019t process charges that include full card numbers \u2014 use one of our official client integrations\u201d. Dave: do it. review.js: the raw-card form (number/expiry/CVC inputs, Luhn, the charge call) is GONE. A Stripe square now renders a panel with our Name-on-card field, a #holdCardElement mount and the secure row led by \u201cCard fields by Stripe \u2014 never seen by this site\u201d; loadStripe() injects https://js.stripe.com/v3/ once, on first need only (a rig may set window.Stripe), and creates a Card Element (hidePostalCode, our ivory/gold styling) with the publishable key the engine sends on GET /api/public/payments/gateways (mode element); the Pay button enables when Stripe says the card is complete and Stripe\u2019s own validation messages show under the panel. Pay: the hold first (/choose), then POST /api/public/payments/intent {gateway, reference, hours, email} for the client secret, then stripe.confirmCardPayment(secret, {card: the element, billing_details: name/email}) IN THE BROWSER (3-D Secure handled by Stripe.js), then POST /api/public/payments/status until the engine \u2014 asking Stripe \u2014 says paid, then Lodge Ops /booking-hold/paid. A decline is shown under the panel in Stripe\u2019s words with the hold kept; paying again reuses the same intent. Pressing the square again unmounts the element. The form is novalidate so our own messages show. review.css: .hold-stripe-el (the mount, focus/bad states), .hold-secure-stripe. server/src/lib.mjs: POST /api/public/payments/intent forwarded; the charge route removed. No CSP on this server, so js.stripe.com loads \u2014 if an nginx edge adds one, allow script-src js.stripe.com and frame-src js.stripe.com hooks.stripe.com. VERIFIED in real Chromium against the REAL Lodge Ops 1.3.4 API, engine 0.1.66 and the mock gateways with a stand-in for Stripe.js (same surface: elements().create(\u2018card\u2019).mount/on/unmount, confirmCardPayment), 17 assertions: the squares and their toggle, the panel holding ONLY the name field with Stripe\u2019s element mounted using the engine\u2019s publishable key, the secure row and the R172.50 label; the element unmounted on the second press; PayPal\u2019s button; no name refused on the page; a decline from Stripe.js shown with the hold kept, the intent request carrying no card data and Stripe.js handed the secret, the element and the name; no request from the page ever carrying a card number; paying again confirms the same intent and the held card reads \u201cPaid R172.50 incl. VAT via Stripe \u00b7 visa \u2022\u2022\u2022\u2022 4242\u201d with Lodge Ops\u2019 row matching; Retrieve, the PayPal hosted page, the poll and the return path unchanged. PAIRS WITH engine 0.1.66 and Lodge Ops 1.3.4. DEPLOY: rsync review.js, review.css and server/src/lib.mjs; restart the site service.',
      },
    ],
  },
  {
    key: '0.1.67',
    version: '0.1.67',
    date: '2026-09-02T16:48:51+02:00',
    changes: [
      {
        headline:
          'When Stripe\u2019s card fields cannot load, the hold card now says exactly why \u2014 the publishable key not set in Lodge Ops, Stripe\u2019s script blocked, or Stripe.js refusing to start in its own words (a live key on a non-HTTPS page) \u2014 and a Stripe square is not shown at all while the engine has no publishable key for it.',
        detail:
          'Dave, 2026-09-02: \u201cThe secure card fields could not be loaded \u2014 check your connection, or choose another payment method.\u201d That line was a catch-all. review.js loadStripe(): no publishable key \u2192 \u201cStripe\u2019s publishable key has not reached this site \u2014 in Lodge Ops, Settings \u2192 Stripe, fill in the publishable key and save\u201d; the script failing \u2192 \u201cStripe\u2019s script (js.stripe.com) could not be loaded \u2014 a content blocker, a firewall or a Content-Security-Policy on the site may be in the way\u201d; window.Stripe(pk) throwing \u2192 \u201cStripe would not start: \u2026\u201d with Stripe\u2019s message (\u201cLive Stripe.js integrations must use HTTPS.\u201d is the one to expect on an http test page); the reason is also console.warn\u2019d. The engine (0.1.67) no longer lists Stripe without a publishable key, so the square is simply absent until Lodge Ops has shared both keys. VERIFIED in real Chromium against the real Lodge Ops 1.3.5 API and engine 0.1.67: 3 assertions (no Stripe square without the key; Stripe.js refusing to start named in its words; no console errors) and the 17-assertion Elements run unchanged. DEPLOY: rsync review.js; restart not needed.',
      },
    ],
  },
  {
    key: '0.1.68',
    version: '0.1.68',
    date: '2026-09-02T16:57:16+02:00',
    changes: [
      {
        headline:
          'If the key passed for Stripe is not a publishable key, the hold card says so before Stripe.js is even asked \u2014 and points to the right field in Lodge Ops.',
        detail:
          'Dave, 2026-09-02: \u201cStripe would not start: You should not use your secret key with Stripe.js.\u201d review.js loadStripe(): a key not starting pk_ \u2192 \u201cthe key Lodge Ops passed for Stripe is not a publishable key (they start with pk_) \u2014 in Lodge Ops, Settings \u2192 Stripe, put the publishable key in its own field\u201d. Belt and braces: engine 0.1.68 no longer lists Stripe with a key of the wrong kind, and Lodge Ops 1.3.6 refuses one on the Stripe page, so this line should not be seen again. DEPLOY: rsync review.js.',
      },
    ],
  },
  {
    key: '0.1.69',
    version: '0.1.69',
    date: '2026-09-03T20:16:08+02:00',
    changes: [
      {
        headline:
          'On the hold page, the payment squares no longer flash on and vanish. When a paid hold length is chosen the page now asks the engine which gateways it will take BEFORE showing any square (\u201cChecking payment options\u2026\u201d holds the space), and if the engine lists none of the gateways switched on in Lodge Ops \u2014 or cannot be reached \u2014 the enabled squares stay, with a note that the payment side is still being set up, instead of an empty section.',
        detail:
          'Dave, 2026-09-03: \u201cwhen selecting how long the hold is wanted, we should show the enabled payment gateways, but they flicker on and then off and don\u2019t come back.\u201d Cause: renderHoldChoices() showed the squares from Lodge Ops\u2019 payments flags the moment a paid option was chosen, then GET /api/public/payments/gateways answered and every square the engine did not list was hidden \u2014 the engine (0.1.67+) lists only gateways whose credentials are ready on it (Stripe needs both a secret and a publishable key of the right kind; PayPal a client id and secret; Yoco a secret; TurnStay an API key and base URL), so with nothing ready yet the answer was an empty list and every square went. review.js: the .hold-pay row starts hidden and a #holdPayChecking line shows while loadModes() runs; the row is revealed once the engine has answered (or failed); an unlisted square is hidden ONLY when the engine lists at least one of the enabled gateways; an empty list, a list with none of them, or no answer keeps every enabled square on the usual modes and shows #holdPayMissing (\u201cOur payment provider is still being set up for these options\u2026\u201d / \u201c\u2026could not be reached just now\u2026\u201d, both ending \u201cYou can try one, or contact us to secure the hold\u201d) with a hold_gateways_unavailable tracking event; the answer is asked once per page and shared between clicks. review.css: .hold-pay[hidden] { display: none } \u2014 the row is display:flex, which beats the hidden attribute on its own. Nothing else about paying changed. VERIFIED in real Chromium against the real Lodge Ops 1.3.23 API and engine 0.1.68 with a MutationObserver recording every hidden-attribute change from the click on: with no gateway ready on the engine, all three enabled squares stay with the set-up note, the checking line shown while asking and gone after, and no square was ever shown and then hidden; with PayPal alone ready, only its square shows and nothing flickers; with the gateways call failing, all three squares with the could-not-be-reached note, and switching to another hold length keeps them without asking again; no console errors. Also worth checking on the live site: if the squares were vanishing there, the engine is answering with no ready gateway \u2014 in Lodge Ops, Settings \u203a Booking Engine, share the payment gateways (and check the Stripe page holds both keys). DEPLOY: rsync review.js and review.css; no restart.',
      },
    ],
  },
  {
    key: '0.1.70',
    version: '0.1.70',
    date: '2026-09-03T20:24:17+02:00',
    changes: [
      {
        headline:
          'When the Stripe square is pressed while the booking engine is not offering Stripe at all, the hold card now says exactly that and where to fix it \u2014 Settings \u2192 Booking Engine in Lodge Ops: Stripe ticked under Payment providers, its \u201cmissing: \u2026\u201d chip, and Share keys with the engine now \u2014 instead of only pointing at the Stripe page\u2019s publishable key.',
        detail:
          'Dave, 2026-09-03, pasted from the hold card: \u201cStripe\u2019s publishable key has not reached this site \u2014 in Lodge Ops, Settings \u2192 Stripe, fill in the publishable key\u2026\u201d. Since 0.1.69 a Stripe square stays on the page when the engine lists no gateway at all (the set-up note), and pressing it reached loadStripe() with no key \u2014 the same words as the narrower case where the engine offers Stripe but sent no key. Those are different gaps: the engine lists Stripe only when it holds an sk_/rk_ secret AND a pk_ publishable key AND Lodge Ops shared them with enabled=true (Stripe ticked under Payment providers on the Booking Engine page). review.js loadStripe(publishableKey, offered): offered = the engine\u2019s gateway list named Stripe; not offered and no key \u2192 \u201cthe booking engine is not offering Stripe right now \u2014 it holds no usable Stripe keys, or Lodge Ops has not shared them. In Lodge Ops open Settings \u2192 Booking Engine: check Stripe is ticked under Payment providers, read Stripe\u2019s chip (\u2018missing: \u2026\u2019 names the key it lacks), then press \u2018Share keys with the engine now\u2019; the Stripe page must hold both the secret key and the publishable key.\u201d; offered but no key \u2192 the previous publishable-key line. Lodge Ops\u2019 Booking Engine page already shows per gateway keys configured / missing: <which key> / switched off / engine offers it, the last share time and result, and the Share button \u2014 that page is the place to read the live state. VERIFIED in real Chromium against the real Lodge Ops 1.3.23 API and engine 0.1.68: with no gateway ready on the engine, pressing the Stripe square shows the not-offering message naming the Booking Engine page and the Share button; the 0.1.69 no-flicker run and the no-pk run unchanged; no console errors. DEPLOY: rsync review.js.',
      },
    ],
  },
  {
    key: '0.1.71',
    version: '0.1.71',
    date: '2026-09-03T22:33:24+02:00',
    changes: [
      {
        headline:
          'When you open a held booking again \u2014 by Retrieve booking or by coming back to the page \u2014 the site now checks with the rate engine whether the price for your suites has moved since the hold was taken. If a suite costs more now, a line appears under the grand total: \u201cWhile your booking was held, the rate for {suite} changed by R\u2026, but your rate is locked in until {time}.\u201d A rate that held steady or dropped says nothing, and the price you see never changes \u2014 the held rate stands until the clock runs out.',
        detail:
          'Dave, 2026-09-03: \u201cwhen a user opens a held booking, rerun the rate query and bypass the availability hold and cache to see if the rate would have changed. If it has changed, the new rate would be greater than the held rate, below the grand total say something like \u2018while your booking was held, the rate for this suite changed by {amount}, but your rate is locked in until the expiry time\u2019.\u201d The check is done in Lodge Ops (1.3.26), not on the site: at \u201cHold it\u201d the hold service asks the rate engine for a FRESH quote of the stay \u2014 BookingEngineService.siteQuote() posts /api/engine/rates/quote with NO sessionKey (so the engine\u2019s per-session cache is bypassed) and the engine prices without regard to the availability the hold itself took (availability there only flags bookability, never the money) \u2014 and keeps the per-suite grand total on the hold (rate_quote, migration 381). On retrieve of an ACTIVE hold, the same fresh quote runs again and any suite whose grand total ROSE on the same plan is returned as hold.rateCheck { checkedAt, currency, increased[{ roomTypeId, name, qty, heldTotal, nowTotal, delta }], delta }; a suite that stayed or fell is not listed. SITE: review.js showHeld() renders #heldRateNote under the .rv-grand block, one line per increased suite \u2014 \u201cWhile your booking was held, the rate for {name}{ (each) when qty>1 } changed by {C.moneyC(delta)}, but your rate is locked in until {localUntil(holdUntil)}.\u201d \u2014 shown only for an active hold with increases; review.css .held-ratenote (gold left border, faint gold wash). The grand total and every suite figure are untouched: the message is reassurance, not a re-price. VERIFIED in real Chromium (desktop + mobile) against the real Lodge Ops 1.3.26 API and rate engine: a hold taken at a nightly of 4000 shows the held card with no note; after the engine root rises to 4500 (grand total 13800 \u2192 15525), Retrieve booking shows the note reading \u201cchanged by R1,725.00\u2026 locked in until \u2026\u201d positioned below the grand total; a lower rate shows no note; no console errors. DEPLOY: rsync review.js + review.css.',
      },
    ],
  },
  {
    key: '0.1.72',
    version: '0.1.72',
    date: '2026-09-04T00:06:47+02:00',
    changes: [
      {
        headline:
          'Make the reservation, start to finish. The Your stay button now reads \u201cMake the reservation\u201d; pressing it (or the same button on a held booking) opens a Booking summary above the footer: the suites, dates and grand total, a countdown while the rate engine holds the availability and the rates for the minutes set in Lodge Ops (pinned top-right whenever the clock scrolls off the screen), your email for the receipt, and \u201cI agree to the terms and conditions\u201d whose link opens the terms from Lodge Ops. Continue to payment then opens the Payment section: what is due now \u2014 a deposit, with the balance date, when check-in is far enough away, otherwise the whole stay \u2014 the same payment squares as the hold fee, and, while Lodge Ops allows it, a red \u201cSimulate successful payment\u201d button above the card fields. A completed payment brings up Congratulations over ten seconds of fireworks.',
        detail:
          'Dave, 2026-09-03. Both builds. HTML: #payBtn label; new sections #bookingSummary and #payment (both .hold-page, after #held, before the footer), #pinnedTimer, #termsModal, #successModal with a #fireworks canvas. review.js: startCheckout(totals, fromHold) POSTs /api/web/booking-checkout/start {stay, snapshot, email?, holdReference?} to Lodge Ops (1.3.29), which takes the nights on the rate engine under checkout:<reference> for the configured minutes (or rides the hold\u2019s take, at the HELD rate, when the guest came from the held card), keeps the engine quote, applies the deposit rule and registers the amount on the engine as the reference\u2019s payable; showCheckout() renders the card \u2014 reference, stay, guests, suites with refund terms, grand total, the \u201cheld for you for N minutes\u201d line with a MM:SS countdown (an IntersectionObserver shows #pinnedTimer while #bsHeld is off screen), the email field, the agree box whose link opens #termsModal (config.terms split on blank lines; a friendly line when none are published), Cancel and search again, and Continue to payment gated on BOTH a valid email and the tick. Continue POSTs /continue {id, email}; showPayment() renders booking, suites, check-in/out, stay total, \u201cDeposit due now\u201d or \u201cAmount due now\u201d, and for a deposit the two sentences \u201cDeposit amount required to secure your booking R\u2026\u201d and \u201cYour balance payment will not be due until {date}\u201d, then the gateway squares from GET /api/public/payments/gateways; picking one renders the Stripe card fields (intent WITHOUT hours \u2014 the engine charges the payable) or the hosted-page button (checkout without hours, remembered as kind checkout for the ?pay= return), with the .pay-simulate button first when config.payments.simulate is true \u2014 POST /api/public/payments/simulate {reference} (new forward route to the engine\u2019s /api/booking/payments/simulate) then /paid. Every paid path ends in recordPaid() \u2192 POST /api/web/booking-checkout/paid {id, paymentId} (Lodge Ops verifies with the engine) \u2192 the summary re-rendered as paid, the payment section hidden, the pinned clock gone, and openSuccess(): the modal with the exact words, the reference and amount, and runFireworks() on the canvas for 10 s (skipped under prefers-reduced-motion). Expiry: the countdown reaching zero disables the card, says the suites were released and hides the payment section. CSS: .bs-*, .pinned-timer, .terms-*, .pay-amount, .pay-deposit, .pay-simulate (#c0392b), .success-*, .fireworks. VERIFIED in real Chromium on BOTH builds against the real Lodge Ops 1.3.29 API and engine 0.1.69 (30 assertions): the button label; the summary scrolled into view with reference, 7-minute message, 06:5x countdown and grand total; the pinned clock top-right when scrolled off and gone when back; the terms modal with two paragraphs from config; Continue disabled until email + tick; the Payment section with R13,800 total, R4,140 deposit, the balance date 17 Nov 2026, the Stripe square and no simulate button before a gateway; the red simulate button above the card form; the Congratulations modal with painting fireworks, the summary reading paid, Lodge Ops recording it paid with the receipt sent, Admin and Reservations notified at both steps; from the held card the checkout carries the hold\u2019s email, names the hold and keeps the held R13,800 after the rate rose; no console errors. DEPLOY: rsync index.html, m/index.html, review.js, review.css, server/src/lib.mjs; restart the site node.',
      },
    ],
  },
  {
    key: '0.1.73',
    version: '0.1.73',
    date: '2026-09-04T00:41:13+02:00',
    changes: [
      {
        headline:
          'Checkout, three fixes from the first live look (Dave, 2026-09-04). The Booking summary now scrolls all the way up: it used to scroll while the card was still a one-line placeholder near the foot of the page, stop where the page ended, and never scroll again once the card had rendered. Choosing a gateway now brings the rendered gateway panel fully onto the screen, and again when Stripe\u2019s card fields finish loading. Simulated payment is a selectable gateway of its own \u2014 a red TEST square beside Stripe, PayPal and TurnStay (only while the Lodge Ops switch is on) \u2014 and choosing it renders a card form already filled with test details and the red \u201cSimulate successful payment\u201d button. And the summary shows \u201cDeposit amount to secure your booking R\u2026\u201d under the grand total when check-in is outside the full-payment window.',
        detail:
          'Both builds (review.js is shared). SCROLL: scrollToSection(host) scrolls now and again on the frame after layout; startCheckout scrolls the placeholder, showCheckout scrolls once the card is built, showPayment the same, and nudgeToSection() re-scrolls only when the section top is still below the window once the gateway squares land \u2014 a guest who has scrolled on is never yanked back. revealPanel(panel): after a gateway is chosen, scrolls the panel into view (block end, or start when it is taller than the window) on the next frame and again at 450 and 1100 ms, and on Stripe mount / ready / load-failure \u2014 no-op when already in view; wired into both the hold-fee panel and the checkout panel; .hold-paypanel gains scroll-margin. SIMULATE GATEWAY: a .hold-payer-sim square (data-provider simulate) appended to #paySquares when config.payments.simulate is true, never hidden by the gateways fetch, dimmed/selected like the others; renderPanel mode simulate \u2192 .hold-cardform.hold-simform with #paySimForm (pay-simName Test Guest, pay-simCard 4242 4242 4242 4242, pay-simExp 12/34, pay-simCvc 123, a note that nothing is charged) ending in #paySimulate (submit \u2192 POST /api/public/payments/simulate \u2192 /api/web/booking-checkout/paid \u2192 Congratulations). The earlier in-panel and section-level red buttons are gone. DEPOSIT LINE: #bsDeposit (.pay-deposit.bs-deposit) under #bsGrand when the checkout\u2019s amountKind is deposit and it is not yet paid, from the amountDue Lodge Ops worked out. VERIFIED: 40 Chromium assertions on desktop and mobile against the live rig (engine 0.1.69, Lodge Ops 1.3.29): summary top at 0 px after render, payment section as high as the page allows, the simulate panel wholly on screen with its button, the prefilled form, the paid flow end to end. WHY THE SIMULATE OPTION MAY NOT SHOW: the switch is saved with the Save providers button on Settings \u203a Booking Engine; the site pulls the config once a minute and the page reads it on load \u2014 so save, wait a minute, reload. NOTE: when the engine returns no quote for a stay (no rate plan offered), Lodge Ops\u2019 checkout currently falls back to the page\u2019s own total \u2014 flagged to Dave, not changed here.',
      },
    ],
  },
  {
    key: '0.1.74',
    version: '0.1.74',
    date: '2026-09-04T01:38:08+02:00',
    changes: [
      {
        headline:
          'Booking summary asks who is booking (Dave, 2026-09-04): Your details \u2014 full name, phone number and e-mail, all required; Postal address \u2014 house number and road/street, apartment number, city, with post code, state and country required; and for a party of N, the other N\u22121 guests, each with a name (required), phone number and country. Continue to payment wakes only when every starred field and the I-agree tick are given. Once a payment is received, Available suites, Your stay, Your booking and Your hold are removed from the page and the paid Booking summary stays. Your stay\u2019s Charges & totals card now shows the deposit under the grand total, louder than anywhere else \u2014 \u201cDeposit to secure your booking R\u2026\u201d, with the balance and the date it is due \u2014 or \u201cDue when you book\u201d with the whole amount inside the full-payment window. And a card payment that fails is reported to Lodge Ops so Admin and Reservations hear of it.',
        detail:
          'Both builds (review.js shared). SUMMARY FORM: #bsGuest replaces the email field \u2014 sub-kickers Your details / Postal address / Your other guest(s); inputs bsName, bsPhone, bsEmail, bsStreet, bsApartment, bsCity, bsPostCode, bsState, bsCountry and per other guest bsGuestName{n}, bsGuestPhone{n}, bsGuestCountry{n} (n from 2; count = adults + children \u2212 1 from the search, prefilled from the checkout when it already has them); starred labels via .bs-req, a \u201c* required\u201d note; the Country fields take a datalist (#bsCountries) of names built in the browser from the ISO-3166 code list with Intl.DisplayNames, plain text where that API is missing. gate() checks name \u2265 2, phone (6+ digits with the usual punctuation), e-mail, post code, state, country, every other guest\u2019s name (and phone when typed), then the agreement, and the disabled button\u2019s title says which is missing. Continue posts {id, email, name, phone, address:{street, apartment, city, postCode, state, country}, guests:[{name, phone, country}]} to /api/web/booking-checkout/continue \u2014 needs Lodge Ops 1.3.32 (migration 383), which refuses the step without the required fields. PAID: openSuccess() hides #results, #review, #hold, #held and #payment, stops the timers and the pinned countdown. DEPOSIT ON YOUR STAY: renderTotals() appends #rvDeposit (.rv-deposit: gold gradient panel, 40px serif amount, label \u201cDeposit to secure your booking\u201d, note with the balance and its date) from depositFor(), the same rule Lodge Ops applies \u2014 config.deposit {mode fixed|percent|nights, amount, fullPaymentDays}: outside the window a deposit and the balance due fullPaymentDays before check-in; inside it, or with no rule, the whole stay \u201cDue when you book\u201d (.rv-deposit-full, quieter). Note the figure is computed from the page\u2019s own grand total, which on the live site is the engine\u2019s quote \u2014 the same figure Lodge Ops uses. FAILED PAYMENT: reportFailure(gateway, message) posts {id, gateway, message} to /api/web/booking-checkout/payment-failed from the Stripe card path (a declined or refused card, an intent the engine would not start) and the redirect path (the gateway reporting anything but paid); a connection problem on this side is not reported. VERIFIED: 44 Chromium assertions on desktop and mobile against the live rig (Lodge Ops 1.3.32, engine 0.1.69): field order and labels, the starred set, one other-guest row for 2 adults, the datalist, the gate at each step, the details stored on the checkout, the sections removed once paid, the deposit panel under the grand total and larger than it, the balance note, the held-card path at the held rate.',
      },
    ],
  },
  {
    key: '0.1.75',
    version: '0.1.75',
    date: '2026-09-04T01:51:28+02:00',
    changes: [
      {
        headline:
          'The Booking summary form validates as the guest goes (Dave, 2026-09-04). Once a field has been left, it is checked on every keystroke: a wrong one is highlighted with the reason under it \u2014 \u201cThat doesn\u2019t look like a valid e-mail address\u201d, \u201cEnter a phone number with at least 6 digits, e.g. +27 82 123 4567\u201d, \u201cEnter the full name\u201d, \u201cEnter your post code\u201d \u2014 and clears the moment it is right; a good one gets a quiet gold edge. Nothing shouts before the guest has touched a field, and blank optional fields are never flagged.',
        detail:
          'review.js showCheckout: field() now takes a check(value) \u2192 message|null and renders a .bs-err line under the input (aria-describedby / aria-invalid); each field is \u201ctouched\u201d on blur (or blur after typing) and re-checked on input thereafter, toggling .bad / .ok on its .bs-field. Checks: needName (blank \u2192 \u201cEnter your full name\u201d / \u201cEnter this guest\u2019s name\u201d, one character \u2192 \u201cEnter the full name\u201d), needPhone(optional) (the same 6-digit rule as Lodge Ops; blank allowed on the other guests), needEmail, needText for post code / state / country. The Continue gate reads the same checks, so the button and the highlights can never disagree. CSS: .bs-err, .bs-field.bad .hold-input (coral edge + glow), .bs-field.ok .hold-input (gold edge). VERIFIED: 46 Chromium assertions on desktop and mobile \u2014 bad e-mail / phone / short name flagged with the exact reason on leaving the field and cleared on correction, a blank optional field never flagged, the gate still opening only when everything is right.',
      },
    ],
  },
  {
    key: '0.1.76',
    version: '0.1.76',
    date: '2026-09-04T01:58:45+02:00',
    changes: [
      {
        headline:
          'Payment fireworks: a giraffe walks across in front of them, and the show runs fifteen seconds (Dave, 2026-09-04). The silhouette crosses the foot of the screen right to left for the whole show \u2014 the long neck, the head with its ossicones and an ear, the tail, and four legs swinging in a walking gait with a gentle bob \u2014 rim-lit in gold against a low horizon glow so it reads between bursts, behind the Congratulations box and in front of the fireworks.',
        detail:
          'review.js runFireworks(canvas, ms): ms 10000 \u2192 15000 from openSuccess. The giraffe is drawn on a SECOND canvas (#giraffe, class .fireworks, inserted right after #fireworks so it sits above the bursts and below .success-box) that is cleared every frame \u2014 the fireworks canvas keeps a fading trail of everything drawn on it, which smeared a moving silhouette and let a horizon glow pile up frame over frame into a solid band (both seen and fixed on the rig). drawGiraffe(t): x from just off the right edge to just off the left over ms; scale (H \u00d7 0.36) / 130 so it is 36% of the screen tall; body ellipse tilted shoulders-up, tapered neck polygon, head + snout ellipses, ear, two ossicones, tail with a swinging tuft, legs as hip\u2192knee\u2192hoof with diagonal pairs in phase and the knee folding on the forward swing; canvas shadow (gold, blur 16) as the rim light; a linear gold gradient over the bottom 40% as the horizon. data-giraffe (x) and data-running on #fireworks each frame for the test. Reduced-motion users get neither fireworks nor giraffe, as before. VERIFIED: 48 Chromium assertions on desktop and mobile \u2014 still running 11 s in, the giraffe well left of its start by then, off the left edge with the show over by 17 s; screenshots at 7 s.',
      },
    ],
  },
  {
    key: '0.1.77',
    version: '0.1.77',
    date: '2026-09-04T02:08:10+02:00',
    changes: [
      {
        headline:
          'A more realistic giraffe, and the Congratulations modal returns the guest to the top of the page (Dave, 2026-09-04). The silhouette is now drawn from the animal\u2019s proportions \u2014 legs nearly a third of its height, a hump at the withers and a back sloping to the rump, a neck thick at the base and thin at the poll with a short mane along the crest, a long muzzle with a rounded nose, an ear and two knobbed ossicones, a tail to the hocks with a tuft \u2014 and it PACES the way a giraffe does, both legs on one side swinging together, the far side half a stride behind and a touch translucent for depth. Closing the modal scrolls smoothly to the top, where the paid Booking summary is what remains.',
        detail:
          'review.js drawGiraffe(): 195-unit figure (H \u00d7 0.36 tall), body\u2013neck\u2013head as one bezier silhouette, tapered limb segments with rounded joints (seg), hooves, front leg shoulder\u2192knee\u2192fetlock with the knee folding and the hoof lifting on the forward swing, hind leg hip\u2192stifle (forward)\u2192hock (back)\u2192fetlock, stride 0.8 Hz, far side at phase + \u03c0 in rgba(5,6,10,0.72). The animal is composed on an OFFSCREEN canvas and stamped onto the #giraffe layer with a single gold glow \u2014 a glow per shape showed inside the silhouette at every joint (seen on the rig). closeSuccess(): window.scrollTo({top: 0, behavior: \'smooth\'}). VERIFIED: 50 Chromium assertions on desktop and mobile, including the modal\u2019s close landing at scrollY 0 from several thousand pixels down with the paid summary still shown; screenshot at 7 s.',
      },
    ],
  },
  {
    key: '0.1.78',
    version: '0.1.78',
    date: '2026-09-04T18:02:00+02:00',
    changes: [
      {
        headline:
          'Ready for ratebox. The site can now bind a single address (LISTEN_HOST) so that on ratebox only the DMZ Caddy can reach it, and it can carry the guest\u2019s calls to Lodge Ops itself: with LODGEOPS_WEB_URL set, the hold and checkout pages, the embed script and its tracking posts (/api/web/*) are passed through to Lodge Ops over the tunnel, so the DMZ host needs no road to Lodge Ops at all. The systemd unit the deploy script always asked for is now in the repo, with a filled-in .env for ratebox.',
        detail:
          'server.mjs: LISTEN_HOST (env, optional) \u2014 server.listen(PORT, host) when set, every interface when not; the boot line names what it bound. LODGEOPS_WEB_URL (env, optional): requests under /api/web/* go through passThrough() \u2014 the guest\u2019s rate limit first (429 like every other guest call), then a streamed node:http/https request to LODGEOPS_WEB_URL + the original path and query with method, content-type, accept, accept-encoding, accept-language, user-agent, referer and the conditional headers carried, Host set to the target, X-Forwarded-For = the guest\u2019s IP (Lodge Ops\u2019 hold-code throttle keeps working; its TRUSTED_PROXY_HOPS counts this hop), X-Forwarded-Proto https, X-Forwarded-Host = SITE_PUBLIC_URL\u2019s host; the answer\u2019s status, Content-Type, Content-Length, Content-Encoding (gzip survives end to end), ETag, Last-Modified, Vary, Location and Cache-Control (no-store when absent) come back; POST bodies capped at 64 KB with a real 413 (the request is paused and the connection closed with the answer, not destroyed); upstream unreachable \u2192 503 BOOKING_UNAVAILABLE, 30 s timeout. Unset = 404 as before. No signing: these Lodge Ops routes are public by design. NEW deploy/lodgeit-site.service (oase, EnvironmentFile /opt/lodgeit-site/.env, SITE_DATA_DIR=/opt/lodgeit-site/data as the ONE writable path, ProtectSystem=strict, SIGTERM so the engine session closes first, MemoryMax 512M) and deploy/site.env.example (ratebox values: LISTEN_HOST = the DMZ-facing address, ENGINE_URL 127.0.0.1:3100 while the engine shares the box, SITE_PUBLIC_URL = the public name, LODGEOPS_WEB_URL over the tunnel). deploy.sh: probes /health where the site listens, names the unit file to copy, creates the data folder. VERIFIED live against the Lodge Ops e2e rig: embed.js 200 through the pass-through (97 KB, and gzip when asked), a POST answered by Lodge Ops\u2019 own router, a 70 KB body refused with 413, unset LODGEOPS_WEB_URL still 404, the engine forwards untouched; then the rig\u2019s edge switched to the DMZ layout (everything to the site) and the hold, checkout and guest-journey cases run through the pass-through.',
      },
    ],
  },
  {
    key: '0.1.79',
    version: '0.1.79',
    date: '2026-09-04T19:42:00+02:00',
    changes: [
      {
        headline:
          'Additional guests, everywhere a price shows. The search bar gains Infants beside Adults and Children (a stepper on the phone). When a party brings more guests than a suite includes, the Rate Engine now charges them per night, and the site shows it wherever it shows the rate: the card says \u201cIncludes 1 additional adult \u00b7 R900.00 a night\u201d under its price, the statement (hover, lightbox and Your stay) itemises Accommodation for the room alone, then \u201cAdditional guests \u00b7 1 additional adult \u00d7 R900.00 \u00d7 3 nights\u201d, then VAT on both, then the total; the Your stay party line names the infants; and a hold carries the additional guests to Lodge Ops for the hold cards and the hold e-mail.',
        detail:
          'Engine 0.1.74 (migration 027) is the source: each suite summary may now carry extraGuests {adults/children/infants: {count, each, total}, total} and baseRateTotal, and each night baseRate + extraGuests. HTML: #fInfants select (desktop, 0\u20136) and a #fInfants stepper (mobile). core.js: searchAvailability() sends infants when above 0 (the site server keeps it off the provider call \u2014 lib.mjs strips it from the rate-calendar route, the availability DTO accepts it); rateCalendar() sends it too; planOptionsFor() carries extraGuests and baseRateTotal; applyPlanToRoom() sets room.extraGuests, room.baseTotal and keeps each night\u2019s baseRate; stayBreakdown() prices the day rows and the Accommodation line from the ROOM rate (baseRate / baseTotal) and returns guestsTotal, grand unchanged; stayMath() adds the line \u201cAdditional guests \u00b7 <arithmetic>\u201d first (VAT\u2019s label then reads \u201con accommodation & additional guests\u201d); NEW extraGuestsMath(room, nights) and extraGuestsLabel(room); ruleCallouts() adds {kind: \'extras\'} \u201cIncludes \u2026\u201d for the cards and the lightbox chips; rateBasisLabel() says \u201cPer-suite rate \u00b7 incl. N additional guests\u201d. booking.js / m/booking.js: infants in every party object (search, breakdown, review, tracking), the page snapshot form, the shareable URL (?infants=) and the Retrieve-booking restore. review.js: partyLabel() names infants; the hold\u2019s stay.suites[] carries extras (the label) for Lodge Ops. server.mjs: engineRatesQuote() relays infants and folds it into the per-visitor session key so a changed count is a different cache identity. CSS: .room-callout-extras on both builds. VERIFIED on the Lodge Ops e2e rig \u2014 case 20 (the API figures: 3 adults on the Lagoon 4,900 a night, 16,905 the stay; inside the counts 12,000; an Additional-adults rule discounting the room rate only) and case 70 in Chromium (a 3-adult + 1-infant deep link: the card reads R16,905 and \u201cIncludes 1 additional adult \u00b7 R900.00 a night\u201d, the Infants field is filled, Your stay itemises Accommodation R12,000.00, Additional guests R2,700.00, VAT, total R16,905.00 and names \u201c3 adults, 1 infant\u201d; no console errors).',
      },
    ],
  },
  {
    key: '0.1.80',
    version: '0.1.80',
    date: '2026-09-04T21:40:00+02:00',
    changes: [
      {
        headline:
          'The ADVANCED SEARCH: a suite for every room. Behind a small handle on the right of Check availability (hover says \u201cAdvanced search\u201d) the checker scrolls to the top and opens room by room \u2014 Room 1 with its adults, children and infants, + Add another room up to the number of suites the lodge has. Check availability searches every room at once; as each answer lands, the suites that take that room\u2019s party are listed with a radio button and their price for that party; choosing a suite for one room takes it out of every other room\u2019s list; Continue with these suites opens Your stay with the lot. A suite card refused for too many guests now offers \u201cTry advanced search\u201d instead of the calendar. Cards carry ONE ribbon: \u201cSorry no availability\u201d when there is none, the engine\u2019s reason when it refused, scarcity only otherwise \u2014 no more \u201cLast suite\u201d drawn over a refusal. The Arrive date no longer clips.',
        detail:
          'NEW site/advanced.js (BKAdv, shared by both builds): attach(adapter) / open(prefill) / close() / isOn() / search(from, to, nights, code) / party() / snapshotGroups() / groups(). State: groups [{adults, children, infants}], results[i] {status loading|error|done, rooms, json}, picks {i: roomTypeId}, a sequence number so a stale answer never lands. search() fires api.search() per room in parallel (rooms=1 each) and hydrates each answer through the build\u2019s hydrateRooms for that room\u2019s party; the list shows rooms with available > 0 and no restriction, minus the suites picked by other rooms; pick() clears the same suite from any other room; Continue enables only when every room holds a listed pick; onContinue(picks, partyTotals, {from, to, nights, json}). Both builds: hydrateRooms(json, party, planFor, nights) extracted from applySearchResult (plans, restricted, overCapacity via C.planOverCapacity, party and sleeps on each room); partyNow() = the advanced totals when on, else the bar; the submit handler branches to BKAdv.search when on; stayMath/plan switches use room.party; snapshotState().form gains groups [{adults, children, infants, roomTypeId}] and totals; closeReview returns to the panel; the sold-out CTA reads \u201cTry advanced search\u201d when room.overCapacity. Ribbons: soldOut \u2192 the engine\u2019s restriction when it explained one (available > 0) else \u201cSorry no availability\u201d; availability unknown \u2192 \u201cAvailability on request\u201d; else scarcity; never two. Desktop: #advBtn (.cta-adv, data-tip hover) beside the CTA in .bar-go-row, #advPanel (.adv-*) under the bar, .bar-field.date min-width 158px, body.adv-on hides the .party fields. Mobile: an Advanced search link beside Retrieve booking, the same panel, steppers hidden while on. core.js: planOverCapacity(); review.js prices each suite\u2019s statement for room.party. VERIFIED in Chromium on the rig (case 70.29\u201370.36): one ribbon on a refused card, Try advanced search, the panel at the top with Room 1 = the 4 adults, two rooms searched together with their own prices, the Lagoon leaving Room 2\u2019s list when Room 1 takes it, Continue disabled until both rooms choose, Your stay with both suites and R25,875; the mobile build driven the same way by hand.',
      },
    ],
  },
  {
    key: '0.1.81',
    version: '0.1.81',
    date: '2026-09-04T23:14:00+02:00',
    changes: [
      {
        headline:
          'Three fixes to the search bar and the advanced search from Dave\u2019s screenshots (2026-09-04). The bar\u2019s ADULTS / CHILDREN / INFANTS / SUITES labels were printing over each other: the fields had no floor and shrank to nothing once the date field and the advanced-search handle took their room. Every field now keeps at least its own label\u2019s width, the bar is allowed a little more of the page, and below about 1140px it wraps onto a second row instead of squeezing. With the advanced search open, the Nights dropdown was drawn UNDER the panel \u2014 the bar now stacks above the panel that follows it, so every dropdown in the bar opens on top. And the advanced search was listing only one suite: it dropped any suite whose availability the lodge could not confirm, which the ordinary cards show as \u201cAvailability on request\u201d; the advanced list now uses exactly the cards\u2019 rule \u2014 a suite is listed unless it is sold out, refused for that party, or over capacity \u2014 and marks the unconfirmed ones \u201cAvailability on request\u201d.',
        detail:
          'booking.css: .bar-wrap max-width 1060 \u2192 1240px; .bar position: relative; z-index: 2 and .adv-panel position: relative; z-index: 1 (both are glass \u2014 backdrop-filter \u2014 so each is its own stacking context, and the later sibling painted over the .gsel-pop, whose z-index 41 only counts inside the bar); .bar-field flex 1 1 auto, padding 8px 10px, label white-space: nowrap; .bar-field.slim flex 0 0 auto (was 0 1 96px \u2014 the shrink that squeezed the labels); .bar-field.date flex 0 0 auto with the input at width 142px (the min-width: 158px field had been taking 235px because the date input\u2019s intrinsic width won); the wrap breakpoint moves from 860px to 1140px. advanced.js: the per-room list keeps a room when !restricted && !overCapacity && (available > 0 || availabilityKnown === false) \u2014 the cards\u2019 own soldOut rule inverted \u2014 and shows \u201cAvailability on request\u201d where the cards would. MEASURED in Chromium on the rig: at 1280 every label fits its field with no overflow and the bar stays on one row; at 1024 it wraps cleanly; with the panel open the Nights popover is the element under its own centre point (elementFromPoint), i.e. on top. e2e 70.31 now asserts no label overflows its field; 70.32 asserts the Nights popover opens above the panel. DEPLOY: static files only \u2014 rsync booking.css and advanced.js.',
      },
    ],
  },
  {
    key: '0.1.82',
    version: '0.1.82',
    date: '2026-09-04T23:33:00+02:00',
    changes: [
      {
        headline:
          'Advanced search: the rooms can share one suite, and Your stay keeps the rooms\u2019 order. Dave, 2026-09-04: \u201cIf the user for example asks for 2 rooms of 2 adults and 1 child, also look at family rooms that have the capacity to accommodate both groups in 1 room.\u201d Every advanced search now also asks the lodge for the rooms TOGETHER: a \u201cRooms 1 + 2 together\u201d block under the room lists shows the suites with room for everyone in those rooms, priced for the whole party (with three rooms, each pair as well as all three; four or more, everyone together). Choosing one of those marks the rooms it covers as \u201cSharing the \u2026 with Room 2\u201d, takes that suite out of every other list, and Continue carries ONE suite for those rooms with their parties added up \u2014 so Your stay, the hold and the checkout all price it for everyone in it. Choosing a suite for a room on its own gives that room back its own suite. And the second thing Dave saw: Your stay was listing the chosen suites in the order of their ids, so Room 2\u2019s suite came first and the price beside the first card did not match Room 1\u2019s pick \u2014 the cards now follow the rooms.',
        detail:
          'advanced.js: combos() builds the room combinations (pairs when there are exactly 3 rooms, plus all rooms; 2 rooms \u2192 the one pair; 4+ \u2192 all only); search() fires runOne() per room AND per combination (the same api.search with rooms: 1 and the combined party, hydrated for that party), listing a suite when fitsAll() (not restricted / over capacity, and sleeps \u2265 everyone when the suite states a sleeps figure) and it is available or its availability is unknown. State gains combos, comboResults, comboPicks; coveredBy(i) / takenElsewhere(ownerKey, id) drive the exclusivity across rooms and combinations (owner keys r<i> / c<i>); pick() clears any combination containing the room, pickCombo() clears the rooms\u2019 own picks and any overlapping combination; a covered room\u2019s block shows the gold share note and keeps its list so the guest can split again. assignments() returns the chosen suites in ROOM order (a shared suite where its first room appears, with the combined party and the rooms it covers); continueClicked() sends picks keyed by suite plus stay.order; snapshotGroups() is one entry per SUITE with the party it sleeps and the rooms it covers (Lodge Ops\u2019 quoteSuites and the paid-checkout booking read adults/children/infants/roomTypeId as before, so a shared suite is quoted and booked for everyone). booking.js and m/booking.js: current.results follows stay.order. CSS (both builds): .adv-block.shared, .adv-share-note, .adv-block-shared (dashed), .adv-share-lead. VERIFIED on the Lodge Ops rig in Chromium (case 70.33\u201370.40): 2 adults + 1 child and 2 adults \u2192 the together block reports no suite for 5 (the rig\u2019s suites sleep 4); Room 1 = Treetop and Room 2 = Lagoon \u2192 Your stay lists the Treetop FIRST; back to the panel, 2 adults + 1 adult \u2192 the together block prices the Lagoon for 3 adults at R16,905 (the additional adult included); choosing it marks both rooms as sharing, removes it from both room lists, and Continue gives Your stay one Lagoon for 3 adults at R16,905.',
      },
    ],
  },
  {
    key: '0.1.83',
    version: '0.1.83',
    date: '2026-09-04T23:46:00+02:00',
    changes: [
      {
        headline:
          'The advanced search\u2019s Adults, Children and Infants now wear the same dressing as the search bar\u2019s own counts: the glass trigger with its chevron and the glass list that opens under it, instead of the browser\u2019s plain drop-downs (Dave, 2026-09-04: \u201cthe person counts in advanced need to be styled the same as the main search panel\u201d). The lists open over the result blocks below them rather than behind them.',
        detail:
          'advanced.js renderGroups(): after each room\u2019s select is placed in its label, BKCal.glassSelect(select) dresses it (the native select stays as the value holder, so the change listeners, the room\u2019s party and the e2e reads of select.value are untouched). booking.css: .adv-field carries the bar field\u2019s font (500 16px var(--sans)), padding 8px 10px, radius 14px, min-width 88px and a nowrap label; .adv-rooms sits at z-index 2 above .adv-results at 1, so a room\u2019s open list paints over the glass result blocks (the same stacking fix the bar got over the panel in 0.1.81). m/booking.css: the same font (600 18px) and stacking. VERIFIED in Chromium on the Lodge Ops rig (case 70.32c): every advanced count has its .gsel trigger, and an open Adults list\u2019s centre hits the list itself, not a result block. Static files only.',
      },
      {
        headline:
          'A running total under the advanced search\u2019s result blocks (Dave, 2026-09-04: \u201cOn the advanced search results, add a row below the cards with a total as selections are made\u201d). As each room chooses its suite the row says how many rooms have one, how many suites and nights that is, and the total so far \u2014 the same figures the options show, added up \u2014 until every room has its suite and the row carries the total Your stay will confirm.',
        detail:
          'advanced.js renderResults() appends .adv-total (full grid row) after the blocks: chosenTotal() sums priceParts().headline (+ the per-guest extras note) over assignments() \u2014 a shared suite counts once for the rooms it covers; \u201cEvery room has its suite\u201d / \u201ck of N rooms have a suite so far\u201d / \u201cNo suite chosen yet\u201d, the note \u201cN suites \u00b7 N nights \u00b7 taxes included\u201d (or \u201csuites on request are not in the total\u201d when a chosen suite has no price), the amount in the site\u2019s money format. CSS both builds: .adv-total / -text / -note / -amount. VERIFIED on the rig (70.34b/c): R13,800 with one room chosen, R25,875 with both \u2014 the figure 70.35 then reads on Your stay.',
      },
    ],
  },
  {
    key: '0.1.84',
    version: '0.1.84',
    date: '2026-09-05T00:05:00+02:00',
    changes: [
      {
        headline:
          'Each suite in the advanced search\u2019s room blocks now has two click zones (Dave, 2026-09-04): the pad around the radio button chooses the suite for that room, and the suite\u2019s name, details and rate open its lightbox \u2014 the same lightbox the standard search\u2019s cards open, with the photos, the description, the occupancy, the rate breakdown and the Add to stay button \u2014 and that button chooses (or un-chooses) the suite for the room that opened it.',
        detail:
          'advanced.js optionFor(): the option is a div.adv-opt holding label.adv-opt-pick (the radio, full-height pad) and button.adv-opt-main (name, meta, price); the button calls api.openSuite(room, nights, chosenNow, onToggle) where onToggle picks (pick / pickCombo) or un-picks (new unpick(ownerKey)) for the owning room or combination and returns the new state for the lightbox\u2019s button; isChosen(ownerKey, id) reads it. booking.js and m/booking.js: openLightbox(room, nights, opts) takes { picked, onToggle } that replace the single search\u2019s current.picks / togglePick when given, and the adapter exposes openSuite(). CSS both builds: .adv-opt with no padding and hidden overflow, .adv-opt-pick (stretch, gold hover, a hairline to its right), .adv-opt-main as an unstyled button with the row\u2019s padding and a gold name on hover, .adv-opt-text. VERIFIED on the rig in Chromium (70.34d\u2013f): clicking the Treetop\u2019s name in Room 2 opens the lightbox titled Treetop Suite with Add to stay and chooses nothing; Add to stay ticks the Treetop\u2019s radio for Room 2 and the button reads Remove from stay; Escape closes it and the choice stays; the radio pad and the running total behave as before.',
      },
    ],
  },
  {
    key: '0.1.85',
    version: '0.1.85',
    date: '2026-09-05T01:07:00+02:00',
    changes: [
      {
        headline:
          'The live chat knows what you are booking (Dave, 2026-09-05). Whenever the chat is open, the page hands the chat widget your current booking picture \u2014 the dates and party you searched, the suites you have chosen with their prices, and any hold or checkout with its reference and where it stands \u2014 so the person answering at the lodge sees it, with links to the right places on their side, the moment the chat opens, and as it changes.',
        detail:
          'booking.js and m/booking.js: bookingContext() = { page, stage (browsing | searching | choosing | your stay | hold | checkout | paid), search {from, to, nights, adults, children, infants, rooms, code}, picks [{roomTypeId, name, qty, planName, total = priceParts headline + extras \u00d7 qty}], total, currency, hold, checkout }; publishChatContext() hands it to window.OaseWeb.setBookingContext (the Lodge Ops embed, 1.3.48) every 3 s when it changed (JSON-compared). review.js keeps bookingState {hold: {reference, status, until, hours} from showHeld(); checkout: {reference, status, amountDue, amountKind, paid} from showCheckout() / showPayment() / the paid answers} and exposes BKReview.bookingState(). Without the embed on the page nothing runs. Static files only \u2014 rsync booking.js, m/booking.js, review.js.',
      },
    ],
  },
];
