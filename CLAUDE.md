# LodgeIT Booking Website

The public guest booking site for 7 Star Lodges and the service that serves
it — **the only public-facing piece of the booking stack**. A separate product
from the LodgeIT Booking Engine (`flyguyd/LodgeITBookingEngine`), operated
with the same build discipline.

```
site/     the static site — one HTML, one CSS, one vanilla JS file, no build
server/   zero-dependency Node service: serves site/, rate-limits guests,
          forwards 4 allow-listed calls to the engine over HMAC service auth
scripts/  bump-version.mjs
```

## Architecture rules

- **Guests only ever touch this service.** The engine is fully private; this
  server forwards exactly the routes in `FORWARD_ROUTES` (lib.mjs) — status,
  availability, sessions, events — signed with this service's own client.
  Anything not allow-listed does not exist publicly.
- **No admin surface here.** Control lives in Lodge Ops, via the engine. This
  service reports itself with a heartbeat (version, uptime, siteUrl) to the
  engine every minute; `/health` is its only non-guest route.
- **The HMAC format is a three-way contract** (`ts.METHOD.path.sha256(rawBody)`)
  shared with the engine's ServiceAuthGuard and Lodge Ops'
  BookingEngineService. Never change one side alone.
- **Only wiring in the environment**: PORT, ENGINE_URL, CLIENT_KEY,
  CLIENT_SECRET, SITE_PUBLIC_URL, rate-limit tunables. No business config.
- **site/ stays framework-free** (spec §23): no build step, no external
  requests, honest states, factual-only scarcity. Analytics fire-and-forget.

## Definition of done — EVERY delivery batch (same as Lodge Ops)

1. **Version bump**: `node scripts/bump-version.mjs` (no argument — patch
   only). Syncs VERSION and both package.json files. Re-read VERSION first.
2. **Build note**: append ONE entry to the END of `server/src/build-notes.mjs`,
   keyed to the new version; diff shows 0 removed lines; then
   `node -e "import('./server/src/build-notes.mjs').then(m=>console.log(m.BUILD_NOTES.length))"`
   must parse.
3. **Verification**: pure logic (lib.mjs, site/booking.js helpers) executed
   from shipped source; the server exercised LIVE against a running engine
   for anything touching the forward chain.
4. **Self-check** this list before saying "done".

## Running it

```bash
PORT=3200 ENGINE_URL=http://127.0.0.1:3100 CLIENT_KEY=site \
CLIENT_SECRET=... node server/src/server.mjs
```

The `site` client must exist in the engine's `api_clients` — created from the
Lodge Ops Booking Engine page (Service clients card), never by hand-editing
the engine database.
