// Pure, dependency-free helpers for the site server — kept separate from the
// server wiring so verification harnesses execute exactly what ships.
import { createHash, createHmac } from 'node:crypto';
import { extname, normalize, resolve, sep } from 'node:path';

/**
 * Sign one request to the booking engine. The format is the contract shared
 * with the engine's ServiceAuthGuard AND Lodge Ops' BookingEngineService:
 *   payload = `${ts}.${METHOD}.${path}.${sha256hex(rawBody)}`
 * `path` includes /api and the query string. Change nothing here without
 * changing all three sides.
 */
export function signHeaders(keyId, secret, method, path, rawBody = '', tsOverride) {
  const ts = tsOverride ?? Math.floor(Date.now() / 1000);
  const bodyHash = createHash('sha256').update(rawBody).digest('hex');
  const sign = createHmac('sha256', secret)
    .update(`${ts}.${method}.${path}.${bodyHash}`)
    .digest('hex');
  return {
    'X-Engine-Key': keyId,
    'X-Engine-Ts': String(ts),
    'X-Engine-Sign': sign,
  };
}

/** Per-IP fixed-window rate limiter (spec §24). In-memory: one process
 *  serves the site; the limiter protects the engine behind it. */
export function createRateLimiter(limit, windowMs) {
  const buckets = new Map();
  return function allow(ip, now = Date.now()) {
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    let b = buckets.get(ip);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, b);
    }
    b.count += 1;
    return b.count <= limit;
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function mimeFor(filePath) {
  return MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolve a request path to a file INSIDE the site root, or null. Refuses
 * traversal ('..', absolute tricks, encoded slashes arrive already decoded).
 * '/' and directory-ish paths land on index.html.
 */
export function safeSitePath(siteRoot, urlPath) {
  let p = urlPath.split('?')[0];
  try {
    p = decodeURIComponent(p);
  } catch {
    return null;
  }
  if (p.includes('\0')) return null;
  if (p === '/' || p === '') p = '/index.html';
  if (p.endsWith('/')) p += 'index.html';
  const root = resolve(siteRoot);
  const full = resolve(root, '.' + normalize('/' + p));
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

/** The guest routes the server forwards, mapped onto the engine's private
 *  booking API. Anything not listed does not exist publicly. `rates` marks
 *  the answers whose PRICE figures are replaced by the Rate Engine's before
 *  they reach a browser (0.1.26) — the provider contributes availability
 *  and content only. */
export const FORWARD_ROUTES = {
  'GET /api/public/status': { method: 'GET', path: '/api/booking/status' },
  'GET /api/public/availability': { method: 'GET', path: '/api/booking/availability', rates: 'stay' },
  'GET /api/public/rate-calendar': { method: 'GET', path: '/api/booking/rate-calendar', rates: 'calendar' },
  'POST /api/public/sessions': { method: 'POST', path: '/api/booking/sessions' },
  'POST /api/public/events': { method: 'POST', path: '/api/booking/events' },
  // Hold-fee payments (Dave, 2026-09-02): the card details or the hosted-page
  // request go THROUGH this server to the engine, signed — never to Lodge
  // Ops, never logged here (the forwarder records method, path, status and
  // time; the body is passed as bytes).
  'GET /api/public/payments/gateways': { method: 'GET', path: '/api/booking/payments/gateways' },
  'GET /api/public/payments/fee': { method: 'GET', path: '/api/booking/payments/fee' },
  'POST /api/public/payments/intent': { method: 'POST', path: '/api/booking/payments/intent' },
  'POST /api/public/payments/checkout': { method: 'POST', path: '/api/booking/payments/checkout' },
  'POST /api/public/payments/status': { method: 'POST', path: '/api/booking/payments/status' },
  // A simulated payment (Dave, 2026-09-03) — the engine refuses it unless the
  // site config's payments.simulate is on; testing only.
  'POST /api/public/payments/simulate': { method: 'POST', path: '/api/booking/payments/simulate' },
  // The DEEP CHECK before the payment cards (Dave, 2026-09-05): the engine
  // pulls the lodge's inventory afresh and answers whether every suite in
  // the stay is still there for every night, and refuses outright in
  // MAINTENANCE — no cache, no RAM answer.
  'POST /api/public/recheck': { method: 'POST', path: '/api/booking/recheck' },
};

export function forwardTargetFor(method, urlPath) {
  const clean = urlPath.split('?')[0];
  const route = FORWARD_ROUTES[`${method} ${clean}`];
  if (!route) return null;
  const qIdx = urlPath.indexOf('?');
  let query = qIdx >= 0 ? urlPath.slice(qIdx) : '';
  // The discount code (0.1.34) is the RATE ENGINE's business, not the
  // booking provider's: it is read out of the original URL by the rates
  // fold-in and must NOT travel to the provider endpoint, whose validation
  // rejects query params it does not know (whitelist + forbidNonWhitelisted
  // on the engine) — one stray param would 400 the whole availability call.
  if (query) {
    const params = new URLSearchParams(query.slice(1));
    let dirty = false;
    if (params.has('code')) {
      params.delete('code');
      dirty = true;
    }
    // The PARTY on a calendar request (2026-08-31) is likewise the rates
    // fold-in's business: the engine's rate-calendar DTO does not know
    // adults/children and forbidNonWhitelisted would 400 the whole call.
    // The availability route KEEPS them — its DTO declares both and the
    // provider fallback prices with them.
    if (route.path === '/api/booking/rate-calendar') {
      for (const k of ['adults', 'children', 'infants']) {
        if (params.has(k)) {
          params.delete(k);
          dirty = true;
        }
      }
    }
    if (dirty) {
      const rest = params.toString();
      query = rest ? '?' + rest : '';
    }
  }
  return { method: route.method, path: route.path + query, rates: route.rates ?? null };
}

/* ---- the Rate Engine connection (0.1.26) --------------------------------
   Prices on the public site come from the Rate Engine's site quote
   (POST /api/engine/rates/quote — the plans OFFERED to visitors, chosen in
   Lodge Ops) and from nowhere else. The provider's (Cloudbeds) rate figures
   are stripped at this boundary, deliberately without a fallback: when the
   engine cannot price a stay, the site says so instead of quoting numbers
   the lodge no longer controls. */

/** A stable per-visitor key for the engine's session-consistent rate cache.
 *  A hash, never the address itself — the engine sees no PII. */
export function siteSessionKey(ip) {
  return 'site-' + createHash('sha256').update(String(ip ?? '')).digest('hex').slice(0, 24);
}

/** Remove every provider rate figure from an availability answer. */
export function stripProviderRates(availability) {
  if (!availability || !Array.isArray(availability.results)) return availability;
  for (const room of availability.results) {
    if (!room || typeof room !== 'object') continue;
    delete room.totalPrice;
    delete room.taxesTotal;
    delete room.feesTotal;
    delete room.nightlyPrices;
    delete room.currency;
  }
  return availability;
}

/**
 * Fold the Rate Engine's site quote into an availability answer: provider
 * figures out, `ratePlans` (the offered plans, each with per-suite nights
 * and totals) in. A failed or empty quote still strips — the answer then
 * carries no prices at all, visibly.
 */
export function attachEngineRates(availability, quote, planInclusions) {
  stripProviderRates(availability);
  const plans = quote && Array.isArray(quote.plans) ? quote.plans : [];
  // Each plan carries what it includes and excludes (engine 0.1.36,
  // replicated words from Lodge Ops) so the pills can say what "Half Board"
  // actually means without another request. Absent data attaches nothing —
  // the pill then simply has no hover, never an empty one.
  const inc = planInclusions && typeof planInclusions === 'object' ? planInclusions.plans : null;
  availability.ratePlans = plans.map((p) => {
    const forPlan = inc && p && p.id != null ? inc[String(p.id)] : null;
    return forPlan && typeof forPlan === 'object' ? { ...p, inclusions: forPlan } : p;
  });
  availability.rateSource = 'rate-engine';
  return availability;
}

/**
 * Replace the calendar's per-day cheapest figures with the Rate Engine's:
 * min across the offered plans and quoted suites of that night's
 * VAT-inclusive price. Days the engine does not price lose their figure
 * (the picker renders them without a rate); availability flags are the
 * provider's and stay untouched.
 */
export function calendarWithEngineRates(calendar, quote) {
  if (!calendar || typeof calendar.days !== 'object' || calendar.days === null) return calendar;
  const best = {};
  // Restrictions (engine 2026-09-02): a day is closed to arrivals for the
  // picker only when EVERY plan on EVERY suite closes it — one suite still
  // taking arrivals keeps the day open, and the search then says which
  // suites are closed. Same for departures.
  const seen = {};
  for (const plan of quote && Array.isArray(quote.plans) ? quote.plans : []) {
    for (const suite of Object.values(plan?.suites ?? {})) {
      const nights = suite && Array.isArray(suite.nights) ? suite.nights : [];
      for (const n of nights) {
        if (!n || !n.date) continue;
        const rec = (seen[n.date] ??= { n: 0, cta: 0, ctd: 0 });
        rec.n += 1;
        if (n.closedToArrival === true) rec.cta += 1;
        if (n.closedToDeparture === true) rec.ctd += 1;
        const v = n.totalInclVat != null ? Number(n.totalInclVat) : NaN;
        if (!Number.isFinite(v)) continue;
        if (best[n.date] == null || v < best[n.date]) best[n.date] = v;
      }
    }
  }
  for (const day of Object.values(calendar.days)) {
    if (day && typeof day === 'object') {
      day.minRate = null;
      delete day.closedToArrival;
      delete day.closedToDeparture;
    }
  }
  for (const [iso, v] of Object.entries(best)) {
    const day = calendar.days[iso];
    if (day && typeof day === 'object') day.minRate = v;
  }
  for (const [iso, rec] of Object.entries(seen)) {
    const day = calendar.days[iso];
    if (!day || typeof day !== 'object' || !rec.n) continue;
    if (rec.cta === rec.n) day.closedToArrival = true;
    if (rec.ctd === rec.n) day.closedToDeparture = true;
  }
  return calendar;
}

/**
 * Performance counters for the site service, reported to the engine with the
 * heartbeat and passed through to the Lodge Ops Performance page. Pure factory
 * (injectable clock) so harnesses can drive it deterministically. Everything
 * is in memory and describes this process since start.
 */
export function createStatsRecorder(nowFn = Date.now) {
  const RING = 300;
  const WINDOW = 60; // per-second buckets for the one-minute rates
  const startedAt = nowFn();

  const makeRate = () => ({ counts: new Array(WINDOW).fill(0), stamps: new Array(WINDOW).fill(0) });
  const bumpRate = (r) => {
    const sec = Math.floor(nowFn() / 1000);
    const idx = sec % WINDOW;
    if (r.stamps[idx] !== sec) {
      r.stamps[idx] = sec;
      r.counts[idx] = 0;
    }
    r.counts[idx] += 1;
  };
  const readRate = (r) => {
    const sec = Math.floor(nowFn() / 1000);
    let n = 0;
    for (let i = 0; i < WINDOW; i++) if (sec - r.stamps[i] < WINDOW) n += r.counts[i];
    return n;
  };

  const state = {
    static: { hits: 0, bytes: 0, misses: 0, rate: makeRate() },
    health: { hits: 0 },
    api: {
      requests: 0,
      rateLimited429: 0,
      tooLarge413: 0,
      notAllowlisted404: 0,
      engineDown: 0,
      rate: makeRate(),
      byRoute: new Map(), // key -> {count, ok, err, durations[], durSum, durMax}
    },
  };

  const routeBucket = (key) => {
    let b = state.api.byRoute.get(key);
    if (!b) {
      b = { count: 0, ok: 0, err: 0, durations: [], ringIdx: 0, durSum: 0, durMax: 0 };
      state.api.byRoute.set(key, b);
    }
    return b;
  };

  return {
    recordStatic(bytes) {
      state.static.hits += 1;
      state.static.bytes += bytes;
      bumpRate(state.static.rate);
    },
    recordStaticMiss() {
      state.static.misses += 1;
    },
    recordHealth() {
      state.health.hits += 1;
    },
    apiNotFound() {
      state.api.requests += 1;
      state.api.notAllowlisted404 += 1;
      bumpRate(state.api.rate);
    },
    apiRateLimited() {
      state.api.requests += 1;
      state.api.rateLimited429 += 1;
      bumpRate(state.api.rate);
    },
    apiTooLarge() {
      state.api.requests += 1;
      state.api.tooLarge413 += 1;
      bumpRate(state.api.rate);
    },
    /** One forwarded guest call. status 0 = the engine did not answer. */
    forward(routeKey, status, durationMs, engineDown) {
      state.api.requests += 1;
      bumpRate(state.api.rate);
      if (engineDown) state.api.engineDown += 1;
      const b = routeBucket(routeKey);
      b.count += 1;
      if (status >= 200 && status < 400) b.ok += 1;
      else b.err += 1;
      if (b.durations.length < RING) b.durations.push(durationMs);
      else {
        b.durations[b.ringIdx] = durationMs;
        b.ringIdx = (b.ringIdx + 1) % RING;
      }
      b.durSum += durationMs;
      if (durationMs > b.durMax) b.durMax = durationMs;
    },
    snapshot() {
      const byRoute = {};
      for (const [key, b] of [...state.api.byRoute.entries()].sort((a, z) => a[0].localeCompare(z[0]))) {
        let p50 = null;
        let p95 = null;
        if (b.durations.length) {
          const sorted = [...b.durations].sort((a, z) => a - z);
          p50 = sorted[Math.floor(sorted.length * 0.5)];
          p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
        }
        byRoute[key] = {
          count: b.count,
          ok: b.ok,
          err: b.err,
          avgMs: b.count ? Math.round((b.durSum / b.count) * 10) / 10 : null,
          p50Ms: p50,
          p95Ms: p95,
          maxMs: b.count ? b.durMax : null,
        };
      }
      return {
        sinceSec: Math.round((nowFn() - startedAt) / 1000),
        static: {
          hits: state.static.hits,
          bytes: state.static.bytes,
          misses: state.static.misses,
          perMin: readRate(state.static.rate),
        },
        health: { hits: state.health.hits },
        api: {
          requests: state.api.requests,
          perMin: readRate(state.api.rate),
          rateLimited429: state.api.rateLimited429,
          tooLarge413: state.api.tooLarge413,
          notAllowlisted404: state.api.notAllowlisted404,
          engineDown: state.api.engineDown,
          byRoute,
        },
      };
    },
  };
}
