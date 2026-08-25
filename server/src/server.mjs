// LodgeIT Booking Website server — the ONLY public-facing service in the
// booking stack. Serves the static site from ../../site, rate-limits guests,
// and forwards the four guest API calls to the (fully private) booking
// engine over its own HMAC service client. Zero dependencies on purpose.
//
// Essential configuration ONLY lives in .env / the environment (Dave,
// 2026-08-22) — this service holds no business configuration at all:
//   PORT             listen port (default 3200)
//   ENGINE_URL       the booking engine base URL (e.g. http://127.0.0.1:3100)
//   CLIENT_KEY       this service's api_clients key id on the engine ('site')
//   CLIENT_SECRET    the matching shared secret
//   SITE_PUBLIC_URL  optional; reported in the heartbeat so Lodge Ops can
//                    link straight to the live site
//   RATE_LIMIT / RATE_WINDOW_MS   guest rate limiting (default 120 per 60s)
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  attachEngineRates,
  calendarWithEngineRates,
  createRateLimiter,
  createStatsRecorder,
  forwardTargetFor,
  mimeFor,
  safeSitePath,
  signHeaders,
  siteSessionKey,
} from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = join(here, '..', '..', 'site');
const VERSION = JSON.parse(
  await readFile(join(here, '..', 'package.json'), 'utf8'),
).version;

const PORT = Number(process.env.PORT) || 3200;
const ENGINE_URL = (process.env.ENGINE_URL ?? '').replace(/\/+$/, '');
const CLIENT_KEY = process.env.CLIENT_KEY ?? '';
const CLIENT_SECRET = process.env.CLIENT_SECRET ?? '';
const SITE_PUBLIC_URL = process.env.SITE_PUBLIC_URL ?? `http://127.0.0.1:${PORT}`;
const RATE_LIMIT = Number(process.env.RATE_LIMIT) || 120;
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS) || 60_000;
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS) || 60_000;
// One light metadata list per pull; only missing images are fetched. The
// minute cadence means a logo or photo change in Lodge Ops shows on the
// site within about a minute, same as the text config (Dave, 2026-08-24).
const MEDIA_SYNC_MS = Number(process.env.MEDIA_SYNC_MS) || 60_000;
/* The site's OWN datastore (Dave, 2026-08-23): suite photography synced from
   Lodge Ops through the engine is cached here and guests are served from
   this disk, never from the engine. Excluded from the deploy rsync. */
const DATA_DIR = process.env.SITE_DATA_DIR || join(here, '..', '..', 'data');
const MEDIA_DIR = join(DATA_DIR, 'media');

/* ---- the hidden load harness (0.1.30) ----------------------------------
   Dave, 2026-08-25: a hidden page feature that fires N concurrent sessions
   at the Rate Engine so he can watch garbage collection bite. It is a
   DELIBERATE traffic generator against his own engine, so it is gated and
   bounded rather than simply present:

     LOAD_TEST=0     turns the whole thing off — the routes 404 and the
                     page never learns the trigger exists.
     LOAD_MAX        the most concurrent virtual sessions one run may use.
     LOAD_MAX_SEC    the LONGEST a single run may last, in seconds. 0 (the
                     default) means NO limit - the run lasts until someone
                     hits Stop, which is what an overnight soak needs. Set a
                     positive number to cap runs on a shared box.

   ON by default at Dave's instruction. The caps matter BECAUSE it is on:
   they are what keeps a stranger who discovers it from turning the booking
   site into a weapon aimed at the engine. Nothing here writes anything —
   it only asks for quotes — and NOTHING here goes anywhere near Cloudbeds. */
const LOAD_TEST = (process.env.LOAD_TEST ?? '1') !== '0';
const LOAD_MAX = Math.max(1, Math.min(500, Number(process.env.LOAD_MAX) || 200));
// 0 = unlimited (until Stop), which is the soak-test default. A positive
// value caps a run's length; the ceiling is 24h so a typo cannot pin a run
// open forever.
const LOAD_MAX_SEC = Math.max(0, Math.min(86400, Number(process.env.LOAD_MAX_SEC) || 0));
/* A global ceiling on load requests in flight, so even a browser ignoring
   its own caps cannot open unbounded sockets to the engine. */
const LOAD_INFLIGHT_MAX = LOAD_MAX * 2;
let loadInflight = 0;

const STARTED_AT = Date.now();
const allow = createRateLimiter(RATE_LIMIT, RATE_WINDOW_MS);
let lastEngineOk = null;

// Performance counters, reported to the engine with every heartbeat and
// passed through to the Lodge Ops Performance page. In-memory; a restart
// resets them and sinceSec says so.
const stats = createStatsRecorder();
let eventLoopLagMs = null;
setInterval(() => {
  const t0 = Date.now();
  setTimeout(() => {
    eventLoopLagMs = Math.max(0, Date.now() - t0);
  }, 0).unref?.();
}, 5000).unref();

function json(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(raw);
}

// How long the site waits on the engine before giving up. A rate quote is
// milliseconds when the engine is healthy; this only bites when it is
// saturated - which is exactly what a load test is trying to find - so the
// harness NAMES a timeout rather than hiding it in a bare error count. Tune
// it for a soak with ENGINE_TIMEOUT_MS.
const ENGINE_TIMEOUT_MS = Math.max(1000, Number(process.env.ENGINE_TIMEOUT_MS) || 10_000);

async function engineCall(method, path, rawBody = '') {
  if (!ENGINE_URL || !CLIENT_KEY || !CLIENT_SECRET) {
    return { status: 0, body: null, error: 'not_configured', timedOut: false };
  }
  try {
    const res = await fetch(ENGINE_URL + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...signHeaders(CLIENT_KEY, CLIENT_SECRET, method, path, rawBody),
      },
      body: rawBody || undefined,
      signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
    });
    const body = await res.text();
    lastEngineOk = res.status < 500;
    return { status: res.status, body, timedOut: false };
  } catch (e) {
    lastEngineOk = false;
    // AbortSignal.timeout raises a TimeoutError; anything else is the engine
    // refusing the connection or dropping it - a different failure to report.
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { status: 0, body: null, error: String(e), timedOut };
  }
}

function readBody(req, cap = 64 * 1024) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > cap) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---- display config (managed in Lodge Ops, pulled through the engine) ----
let siteConfig = {};
async function syncConfig() {
  const r = await engineCall('GET', '/api/booking/site-config');
  if (r.status !== 200 || !r.body) return;
  try {
    const parsed = JSON.parse(r.body);
    if (parsed && typeof parsed === 'object') siteConfig = parsed;
  } catch {
    /* keep the last good config */
  }
}

// ---- replicated suite content (settings, amenities, levy + VAT) ----
// Pushed from Lodge Ops to the engine on its 15-minute cadence; cached here
// on disk so a restart (or an unreachable engine) never blanks the pages.
let suiteContent = {};

async function loadSuiteContent() {
  try {
    const parsed = JSON.parse(await readFile(join(DATA_DIR, 'suite-content.json'), 'utf8'));
    if (parsed && typeof parsed === 'object') suiteContent = parsed;
  } catch {
    suiteContent = {};
  }
}

async function syncSuiteContent() {
  const r = await engineCall('GET', '/api/booking/suite-content');
  if (r.status !== 200 || !r.body) return;
  try {
    const parsed = JSON.parse(r.body);
    if (!parsed || typeof parsed !== 'object') return;
    if (JSON.stringify(parsed) !== JSON.stringify(suiteContent)) {
      suiteContent = parsed;
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(join(DATA_DIR, 'suite-content.json'), JSON.stringify(suiteContent));
      console.log(
        `[site] suite content synced: ${Object.keys(suiteContent.suites ?? {}).length} suite types`,
      );
    }
  } catch {
    /* keep the last good copy */
  }
}

// ---- rate plan inclusions (engine 0.1.36) ----
// Pulled when the engine session opens and on the heartbeat cadence, kept on
// disk like suite content so a restart serves the last good copy at once.
let planInclusions = {};

async function loadPlanInclusions() {
  try {
    const parsed = JSON.parse(await readFile(join(DATA_DIR, 'plan-inclusions.json'), 'utf8'));
    if (parsed && typeof parsed === 'object') planInclusions = parsed;
  } catch {
    planInclusions = {};
  }
}

async function syncPlanInclusions() {
  const r = await engineCall('GET', '/api/booking/plan-inclusions');
  if (r.status !== 200 || !r.body) return;
  try {
    const parsed = JSON.parse(r.body);
    if (!parsed || typeof parsed !== 'object') return;
    if (JSON.stringify(parsed) !== JSON.stringify(planInclusions)) {
      planInclusions = parsed;
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(join(DATA_DIR, 'plan-inclusions.json'), JSON.stringify(planInclusions));
      console.log(
        `[site] plan inclusions synced: ${Object.keys(planInclusions.plans ?? {}).length} plans`,
      );
    }
  } catch {
    /* keep the last good copy */
  }
}

// ---- the suite-media cache ----
// manifest: id -> { roomTypeId, contentType, sortOrder }; rooms.json is the
// public view the booking pages read (roomTypeId -> [ids, best first]).
let mediaManifest = {};

function roomsView() {
  const byRoom = {};
  for (const [id, m] of Object.entries(mediaManifest)) {
    // '__'-prefixed room ids are reserved site assets (the logo), not suites.
    if (String(m.roomTypeId).startsWith('__')) continue;
    (byRoom[m.roomTypeId] = byRoom[m.roomTypeId] || []).push({ id, sort: m.sortOrder ?? 0 });
  }
  const out = {};
  for (const [room, list] of Object.entries(byRoom)) {
    out[room] = list.sort((a, b) => a.sort - b.sort).map((x) => x.id);
  }
  return out;
}

/** The site logo's media id, when Lodge Ops has uploaded one. */
function logoId() {
  for (const [id, m] of Object.entries(mediaManifest)) {
    if (m.roomTypeId === '__site_logo__') return id;
  }
  return null;
}

async function loadMediaManifest() {
  try {
    mediaManifest = JSON.parse(await readFile(join(DATA_DIR, 'manifest.json'), 'utf8'));
  } catch {
    mediaManifest = {};
  }
}

async function syncMedia() {
  const r = await engineCall('GET', '/api/booking/media');
  if (r.status !== 200 || !r.body) return;
  let list;
  try {
    list = JSON.parse(r.body);
  } catch {
    return;
  }
  if (!Array.isArray(list)) return;
  await mkdir(MEDIA_DIR, { recursive: true });
  const want = new Map(list.map((m) => [String(m.id), m]));
  let changed = false;
  // fetch what we do not have — content-addressed ids never change meaning
  for (const [id, m] of want) {
    if (mediaManifest[id] || !/^[0-9a-f]{64}$/.test(id)) continue;
    const bytes = await engineCallRaw('GET', `/api/booking/media/${id}`);
    if (!bytes) continue;
    await writeFile(join(MEDIA_DIR, id), bytes);
    mediaManifest[id] = { roomTypeId: String(m.roomTypeId), contentType: String(m.contentType), sortOrder: Number(m.sortOrder) || 0 };
    changed = true;
  }
  // prune what Lodge Ops removed
  for (const id of Object.keys(mediaManifest)) {
    if (!want.has(id)) {
      delete mediaManifest[id];
      await unlink(join(MEDIA_DIR, id)).catch(() => {});
      changed = true;
    }
  }
  // metadata (sort order / room) can move without the bytes changing
  for (const [id, m] of want) {
    const have = mediaManifest[id];
    if (have && (have.sortOrder !== (Number(m.sortOrder) || 0) || have.roomTypeId !== String(m.roomTypeId))) {
      have.sortOrder = Number(m.sortOrder) || 0;
      have.roomTypeId = String(m.roomTypeId);
      changed = true;
    }
  }
  if (changed) {
    await writeFile(join(DATA_DIR, 'manifest.json'), JSON.stringify(mediaManifest));
    console.log(`[site] media cache synced: ${Object.keys(mediaManifest).length} photos`);
  }
}

/* ---- the site's own engine session (0.1.27) ----
   The site opens ONE session on the engine when it starts and holds it
   open for its whole life: the engine's per-night rate cache is keyed by
   session, so a held session is what makes repeat quotes cheap. The engine
   answers its own TTL when the session opens — the keepalive cadence is
   derived from that (a third of the TTL), never guessed here, so changing
   RATE_SESSION_TTL_MS on the engine is enough. A lapsed or dropped session
   is simply re-opened on the next keepalive; guests never see it. */
const SITE_SESSION_KEY = 'site-' + Math.random().toString(36).slice(2, 10) + '-' + process.pid;
let sessionTtlMs = null;
let sessionOpenedAt = null;
let sessionTimer = null;

async function openEngineSession() {
  const body = JSON.stringify({ sessionKey: SITE_SESSION_KEY, label: 'booking website' });
  const r = await engineCall('POST', '/api/engine/rate-engine/sessions', body);
  if (r.status !== 200 && r.status !== 201) {
    console.warn(`[site] engine session not opened (status ${r.status}) — rates still answer, uncached`);
    return false;
  }
  try {
    const parsed = JSON.parse(r.body ?? '{}');
    const ttl = Number(parsed.ttlMs);
    if (Number.isFinite(ttl) && ttl > 0) sessionTtlMs = ttl;
  } catch {
    /* the session is open even if the body surprised us */
  }
  sessionOpenedAt = Date.now();
  // The session is the natural moment to learn what the plans include
  // (Dave, 2026-08-25) — the answer changes about as often as the plans do.
  void syncPlanInclusions().catch(() => {});
  // A third of the TTL: two keepalives may be lost before a session lapses.
  const every = Math.max(15_000, Math.floor((sessionTtlMs ?? 300_000) / 3));
  if (sessionTimer) clearInterval(sessionTimer);
  sessionTimer = setInterval(() => void keepEngineSession(), every);
  sessionTimer.unref?.();
  console.log(
    `[site] engine session ${SITE_SESSION_KEY} open (ttl ${Math.round((sessionTtlMs ?? 0) / 1000)}s, keepalive ${Math.round(every / 1000)}s)`,
  );
  return true;
}

async function keepEngineSession() {
  // The label rides the keepalive so an engine restart re-registers this
  // session under its own name rather than as an anonymous key.
  const r = await engineCall(
    'PUT',
    `/api/engine/rate-engine/sessions/${encodeURIComponent(SITE_SESSION_KEY)}`,
    JSON.stringify({ label: 'booking website' }),
  );
  // The engine re-opens an unknown key itself; anything else means the
  // engine is unreachable and the next tick tries again.
  if (r.status === 0) return;
  if (r.status !== 200) void openEngineSession();
}

async function closeEngineSession() {
  if (sessionTimer) clearInterval(sessionTimer);
  await engineCall(
    'DELETE',
    `/api/engine/rate-engine/sessions/${encodeURIComponent(SITE_SESSION_KEY)}`,
    '',
  ).catch(() => {});
}

/* ---- rates from the Rate Engine (0.1.26) ----
   The two rate-bearing guest answers are rewritten before they leave this
   server: provider (Cloudbeds) rate figures stripped, the Rate Engine's
   quote for the OFFERED plans folded in. No fallback by design — an
   unpriced stay is presented as unpriced, never as a provider figure the
   lodge no longer controls. */
async function engineRatesQuote(roomTypeIds, from, to, ip, scan = false, discountCode = '') {
  const ids = [...new Set(roomTypeIds.map(String))].slice(0, 20);
  if (!ids.length || !from || !to || to <= from) return null;
  // The per-visitor key hangs off the site's own held session (0.1.27), so
  // the engine sees one open session for the site and still keeps each
  // visitor's answers consistent within it.
  // `scan` declares a sweep rather than a guest quote (0.1.28): the engine
  // then counts the nights as traffic only, keeps them out of the demand
  // heat map, does not let the sweep evict a guest's held rates, and does
  // not throttle us. Undeclared sweeps get slowed down on purpose.
  // The code the visitor typed (0.1.34), passed as typed — the engine trims
  // and upper-cases before any rule sees it, and keys its session cache on
  // it, so a coded search and a plain one never share an answer. OMITTED
  // when blank: a rule gated on a code fails closed on "no code".
  const code = String(discountCode ?? '').trim().slice(0, 40);
  const raw = JSON.stringify({
    roomTypeIds: ids,
    from,
    to,
    sessionKey: `${SITE_SESSION_KEY}|${siteSessionKey(ip)}`,
    scan,
    ...(code ? { discountCode: code } : {}),
  });
  const r = await engineCall('POST', '/api/engine/rates/quote', raw);
  if (r.status !== 200 || !r.body) return null;
  try {
    const parsed = JSON.parse(r.body);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Rewrite one forwarded 200 answer with engine rates; returns the new body
 *  string, or the original when the answer is not parseable. */
async function withEngineRates(kind, urlPath, body, ip) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (!parsed || typeof parsed !== 'object') return body;
  const params = new URLSearchParams(urlPath.includes('?') ? urlPath.slice(urlPath.indexOf('?') + 1) : '');
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  if (kind === 'stay') {
    const ids = (Array.isArray(parsed.results) ? parsed.results : [])
      .map((room) => room?.roomTypeId)
      .filter((id) => id != null);
    // Read from the ORIGINAL guest URL — forwardTargetFor has already
    // stripped it from what the provider endpoint saw.
    const quote = await engineRatesQuote(ids, from, to, ip, false, params.get('code') ?? '');
    return JSON.stringify(attachEngineRates(parsed, quote, planInclusions));
  }
  if (kind === 'calendar') {
    // One suite when the picker is filtered, otherwise every replicated one.
    const one = params.get('roomTypeId');
    const ids = one ? [one] : Object.keys(suiteContent.suites ?? {}).filter((id) => id.charAt(0) !== '_');
    // The picker paints up to 45 nights across every suite — a scan, not a
    // guest pricing one stay. Flagged so it never reads as guest demand.
    const quote = await engineRatesQuote(ids, from, to, ip, true);
    return JSON.stringify(calendarWithEngineRates(parsed, quote));
  }
  return body;
}

/** A signed engine GET returning raw bytes (the media pull). */
async function engineCallRaw(method, path) {
  if (!ENGINE_URL || !CLIENT_KEY || !CLIENT_SECRET) return null;
  try {
    const res = await fetch(ENGINE_URL + path, {
      method,
      headers: signHeaders(CLIENT_KEY, CLIENT_SECRET, method, path, ''),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';
  // Behind nginx the client address is X-Forwarded-For's FIRST untrusted hop;
  // we take the last entry our proxy appended, falling back to the socket.
  const fwd = String(req.headers['x-forwarded-for'] ?? '');
  const ip = fwd ? fwd.split(',').pop().trim() : (req.socket.remoteAddress ?? 'unknown');

  // ---- health (open, minimal) ----
  if (method === 'GET' && url.split('?')[0] === '/health') {
    stats.recordHealth();
    json(res, 200, {
      ok: true,
      version: VERSION,
      engineReachable: lastEngineOk,
      uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
    });
    return;
  }

  // ---- device routing: phones land on the mobile build ----
  // Relative Location so the /book/ path-mount resolves to /book/m/.
  if (method === 'GET' && url.split('?')[0] === '/' && !url.includes('full=')) {
    const ua = String(req.headers['user-agent'] ?? '');
    if (/Mobi|iPhone|Windows Phone/i.test(ua)) {
      // The query travels with the redirect: a shared desktop URL opened on
      // a phone must restore the same search on the mobile build.
      const qIdx = url.indexOf('?');
      const q = qIdx >= 0 ? url.slice(qIdx) : '';
      res.writeHead(302, { Location: 'm/' + q, 'Cache-Control': 'no-store', Vary: 'User-Agent' });
      res.end();
      return;
    }
  }

  // ---- display config for the pages ----
  if (method === 'GET' && url.split('?')[0] === '/config.json') {
    stats.recordStatic(2);
    json(res, 200, { ...siteConfig, logoId: logoId() });
    return;
  }

  // ---- replicated suite settings for the pages ----
  if (method === 'GET' && url.split('?')[0] === '/suites.json') {
    stats.recordStatic(2);
    json(res, 200, suiteContent);
    return;
  }

  // ---- the suite-media cache: the lodge's own photography ----
  if (method === 'GET' && url.split('?')[0] === '/media/rooms.json') {
    stats.recordStatic(2);
    json(res, 200, roomsView());
    return;
  }
  const mediaMatch = method === 'GET' && url.split('?')[0].match(/^\/media\/([0-9a-f]{64})$/);
  if (mediaMatch) {
    const m = mediaManifest[mediaMatch[1]];
    if (!m) {
      stats.recordStaticMiss();
      json(res, 404, { code: 'NOT_FOUND', message: 'No such image.' });
      return;
    }
    try {
      const bytes = await readFile(join(MEDIA_DIR, mediaMatch[1]));
      stats.recordStatic(bytes.length);
      res.writeHead(200, {
        'Content-Type': m.contentType,
        // Content-addressed: the id IS the content, so cache hard forever.
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      res.end(bytes);
    } catch {
      stats.recordStaticMiss();
      json(res, 404, { code: 'NOT_FOUND', message: 'No such image.' });
    }
    return;
  }

  // ---- the hidden load harness (0.1.30) ----
  // Deliberately BEFORE the guest API block: these calls must skip the
  // per-IP guest limiter, which exists to protect the engine from a
  // stranger and would throttle a load run to 120/min — useless. The
  // limiter is replaced here by explicit caps, not simply dropped.
  // Under /api/public/ ON PURPOSE (0.1.31): the nginx edge proxies exactly
  // /api/public/ and /book/ to this server. Routes at /api/loadtest/ match
  // no location there, so behind the edge they never arrived at all and the
  // lightbox reported the harness "switched off" — which was true of what
  // it could see and useless as a diagnosis. This prefix is already routed,
  // so the harness needs no nginx change to work on webbox.
  if (url.startsWith('/api/public/loadtest/')) {
    const path = url.split('?')[0];

    // Status answers WHETHER OR NOT the harness is enabled, so the page can
    // tell three different situations apart: running, deliberately switched
    // off here, and no harness at this address at all (an old build, or an
    // edge not passing the path). Only the third is a 404. Saying "switched
    // off" for all three is what sent Dave hunting the wrong fault.
    if (method === 'GET' && path === '/api/public/loadtest/status') {
      json(res, 200, {
        enabled: LOAD_TEST,
        maxSessions: LOAD_MAX,
        maxSeconds: LOAD_MAX_SEC,
        inflight: loadInflight,
        version: VERSION,
      });
      return;
    }

    // Everything that generates traffic stays behind the switch.
    if (!LOAD_TEST) {
      json(res, 404, { code: 'NOT_FOUND', message: 'The load harness is switched off.' });
      return;
    }

    // The engine's own vital signs during a run: heap, cache, sessions.
    // This is the half that shows GC — the browser can only see latency.
    if (method === 'GET' && path === '/api/public/loadtest/engine') {
      const r = await engineCall('GET', '/api/engine/rate-engine/state');
      if (r.status !== 200 || !r.body) {
        json(res, 503, { code: 'ENGINE_UNAVAILABLE', message: 'The engine did not answer.' });
        return;
      }
      let parsed = null;
      try { parsed = JSON.parse(r.body); } catch { parsed = null; }
      json(res, 200, {
        at: Date.now(),
        memory: parsed?.memory ?? null,
        cache: parsed?.cache ?? null,
        sessions: parsed?.sessionStats
          ? { open: parsed.sessionStats.open, queries: parsed.sessionStats.queries, avgUs: parsed.sessionStats.avgUs }
          : null,
      });
      return;
    }

    // One virtual guest pricing one stay. The worker's id becomes its own
    // engine session key, so N workers are N DISTINCT sessions filling the
    // cache — which is the whole point, since a shared key would just hit
    // the same cached nights and stress nothing.
    if (method === 'POST' && path === '/api/public/loadtest/quote') {
      if (loadInflight >= LOAD_INFLIGHT_MAX) {
        json(res, 429, { code: 'LOAD_BUSY', message: 'Too many load requests in flight.' });
        return;
      }
      let body = {};
      try { body = JSON.parse(await readBody(req)) || {}; } catch { body = {}; }
      const worker = String(body.worker ?? '0').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || '0';
      const from = String(body.from ?? '');
      const to = String(body.to ?? '');
      const ids = Array.isArray(body.roomTypeIds)
        ? body.roomTypeIds.map(String).slice(0, 20)
        : Object.keys(suiteContent.suites ?? {}).filter((id) => id.charAt(0) !== '_');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        json(res, 400, { code: 'BAD_DATES', message: 'from and to are YYYY-MM-DD.' });
        return;
      }
      loadInflight += 1;
      const started = Date.now();
      try {
        const raw = JSON.stringify({
          roomTypeIds: ids,
          from,
          to,
          // NOT the visitor's session: each worker is its own guest.
          sessionKey: `loadtest|${worker}`,
        });
        const r = await engineCall('POST', '/api/engine/rates/quote', raw);
        const ms = Date.now() - started;
        let q = null;
        try { q = JSON.parse(r.body ?? '{}'); } catch { q = null; }
        const okQuote = r.status === 200;
        // When it fails, say WHY in one word the harness can total up, so a
        // run's errors are legible instead of a bare count: a timeout (the
        // engine did not answer within ENGINE_TIMEOUT_MS - the saturation
        // signal a load test is after), no response at all (engine down or
        // connection refused), or a non-200 the engine itself returned.
        let reason = null;
        if (!okQuote) {
          if (r.timedOut) reason = 'timeout';
          else if (r.status === 0) reason = 'no response';
          else reason = 'engine ' + r.status;
        }
        // Only the measurements come back — a load run has no use for the
        // rates themselves, and shipping them would measure JSON size as
        // much as engine time. A body we cannot read reports zero rather
        // than a guess.
        json(res, okQuote ? 200 : 502, {
          ok: okQuote,
          status: r.status,
          reason,
          timeoutMs: ENGINE_TIMEOUT_MS,
          ms,
          nights: Number(q?.stayNights) || 0,
          plans: Array.isArray(q?.plans) ? q.plans.length : 0,
          engineUs: Number(q?.durationUs) || null,
        });
      } finally {
        loadInflight -= 1;
      }
      return;
    }

    // Open (register) one virtual session on the engine so it appears in the
    // Open Sessions card for the length of its life (0.1.33). The load-test
    // quote path keys its cache by loadtest|worker but never registered a
    // session, so a run's sessions were invisible there - only the site's own
    // held session showed. The harness now opens on a worker's (re)start and
    // closes on recycle/stop, so the card fills and empties with the run.
    if (method === 'POST' && path === '/api/public/loadtest/open') {
      let body = {};
      try { body = JSON.parse(await readBody(req)) || {}; } catch { body = {}; }
      const worker = String(body.worker ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
      if (!worker) {
        json(res, 400, { code: 'BAD_WORKER', message: 'worker is required.' });
        return;
      }
      const key = encodeURIComponent(`loadtest|${worker}`);
      const r = await engineCall('PUT', `/api/engine/rate-engine/sessions/${key}`, JSON.stringify({ label: 'load test' }));
      json(res, r.status === 200 ? 200 : 502, { ok: r.status === 200 });
      return;
    }

    // Close one virtual session and drop its cached rates on the engine
    // (0.1.32). The harness calls this when a worker's random session life
    // ends, so a soak churns sessions - opening and CLOSING them - rather
    // than only ever growing the cache. That churn is what exercises garbage
    // collection, which is the whole point of the soak.
    if (method === 'POST' && path === '/api/public/loadtest/close') {
      let body = {};
      try { body = JSON.parse(await readBody(req)) || {}; } catch { body = {}; }
      const worker = String(body.worker ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
      if (!worker) {
        json(res, 400, { code: 'BAD_WORKER', message: 'worker is required.' });
        return;
      }
      const key = encodeURIComponent(`loadtest|${worker}`);
      const r = await engineCall('DELETE', `/api/engine/rate-engine/sessions/${key}`);
      let out = null;
      try { out = JSON.parse(r.body ?? '{}'); } catch { out = null; }
      json(res, r.status === 200 ? 200 : 502, {
        ok: r.status === 200,
        dropped: Number(out?.dropped) || 0,
      });
      return;
    }

    json(res, 404, { code: 'NOT_FOUND', message: 'No such endpoint.' });
    return;
  }

  // ---- the guest API: rate-limited, allow-listed, forwarded signed ----
  const target = forwardTargetFor(method, url);
  if (url.startsWith('/api/')) {
    if (!target) {
      stats.apiNotFound();
      json(res, 404, { code: 'NOT_FOUND', message: 'No such endpoint.' });
      return;
    }
    if (!allow(ip)) {
      stats.apiRateLimited();
      json(res, 429, { code: 'RATE_LIMITED', message: 'Too many requests — slow down.' });
      return;
    }
    let rawBody = '';
    if (method === 'POST') {
      try {
        rawBody = await readBody(req);
      } catch {
        stats.apiTooLarge();
        json(res, 413, { code: 'TOO_LARGE', message: 'Request too large.' });
        return;
      }
    }
    const started = Date.now();
    const r = await engineCall(target.method, target.path, rawBody);
    stats.forward(
      `${method} ${url.split('?')[0]}`,
      r.status,
      Date.now() - started,
      r.status === 0,
    );
    if (r.status === 0) {
      json(res, 503, {
        code: 'BOOKING_UNAVAILABLE',
        message: 'Booking is briefly unavailable — please try again shortly.',
      });
      return;
    }
    let outBody = r.body ?? '';
    if (r.status === 200 && target.rates) {
      outBody = await withEngineRates(target.rates, url, outBody, ip);
    }
    res.writeHead(r.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(outBody);
    return;
  }

  // ---- the static site ----
  if (method !== 'GET' && method !== 'HEAD') {
    json(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'GET only.' });
    return;
  }
  const filePath = safeSitePath(SITE_ROOT, url);
  if (!filePath) {
    stats.recordStaticMiss();
    json(res, 404, { code: 'NOT_FOUND', message: 'No such page.' });
    return;
  }
  try {
    const data = await readFile(filePath);
    stats.recordStatic(data.length);
    res.writeHead(200, {
      'Content-Type': mimeFor(filePath),
      'Cache-Control': 'public, max-age=300',
    });
    res.end(method === 'HEAD' ? undefined : data);
  } catch {
    stats.recordStaticMiss();
    json(res, 404, { code: 'NOT_FOUND', message: 'No such page.' });
  }
});

// ---- heartbeat: report ourselves to the engine so Lodge Ops sees us ----
async function heartbeat() {
  const mem = process.memoryUsage();
  const body = JSON.stringify({
    version: VERSION,
    uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
    siteUrl: SITE_PUBLIC_URL,
    stats: {
      ...stats.snapshot(),
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      eventLoopLagMs,
    },
  });
  const r = await engineCall('PUT', '/api/engine/site-heartbeat', body);
  if (r.status !== 200) {
    console.warn(`[site] heartbeat not accepted (status ${r.status})`);
  }
}

server.listen(PORT, () => {
  console.log(`[site] LodgeIT Booking Website v${VERSION} listening on port ${PORT}`);
  if (!ENGINE_URL || !CLIENT_KEY || !CLIENT_SECRET) {
    console.warn('[site] ENGINE_URL / CLIENT_KEY / CLIENT_SECRET not set — guest API calls will fail closed.');
  }
  void heartbeat();
  setInterval(() => void heartbeat(), HEARTBEAT_MS).unref();
  // Hold one engine session open for the site's whole life (0.1.27).
  void openEngineSession().catch(() => {});
  void loadMediaManifest().then(() => void syncMedia().catch(() => {}));
  void syncConfig().catch(() => {});
  void loadSuiteContent().then(() => void syncSuiteContent().catch(() => {}));
  void loadPlanInclusions();
  setInterval(() => void syncMedia().catch(() => {}), MEDIA_SYNC_MS).unref();
  // Display config and suite content are light — re-pull on the heartbeat
  // cadence so a change made in Lodge Ops shows on the site within about a
  // minute of the engine having it.
  setInterval(() => void syncConfig().catch(() => {}), HEARTBEAT_MS).unref();
  setInterval(() => void syncSuiteContent().catch(() => {}), HEARTBEAT_MS).unref();
  setInterval(() => void syncPlanInclusions().catch(() => {}), HEARTBEAT_MS).unref();
});

/* A clean shutdown closes the engine session (and with it the session's
   cached answers) instead of leaving it to time out. */
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    void closeEngineSession().finally(() => {
      server.close(() => process.exit(0));
      // Never hang a deploy on a stuck socket.
      setTimeout(() => process.exit(0), 3_000).unref?.();
    });
  });
}
