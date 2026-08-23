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
  createRateLimiter,
  createStatsRecorder,
  forwardTargetFor,
  mimeFor,
  safeSitePath,
  signHeaders,
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
const MEDIA_SYNC_MS = Number(process.env.MEDIA_SYNC_MS) || 600_000;
/* The site's OWN datastore (Dave, 2026-08-23): suite photography synced from
   Lodge Ops through the engine is cached here and guests are served from
   this disk, never from the engine. Excluded from the deploy rsync. */
const DATA_DIR = process.env.SITE_DATA_DIR || join(here, '..', '..', 'data');
const MEDIA_DIR = join(DATA_DIR, 'media');

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

async function engineCall(method, path, rawBody = '') {
  if (!ENGINE_URL || !CLIENT_KEY || !CLIENT_SECRET) {
    return { status: 0, body: null, error: 'not_configured' };
  }
  try {
    const res = await fetch(ENGINE_URL + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...signHeaders(CLIENT_KEY, CLIENT_SECRET, method, path, rawBody),
      },
      body: rawBody || undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.text();
    lastEngineOk = res.status < 500;
    return { status: res.status, body };
  } catch (e) {
    lastEngineOk = false;
    return { status: 0, body: null, error: String(e) };
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

// ---- the suite-media cache ----
// manifest: id -> { roomTypeId, contentType, sortOrder }; rooms.json is the
// public view the booking pages read (roomTypeId -> [ids, best first]).
let mediaManifest = {};

function roomsView() {
  const byRoom = {};
  for (const [id, m] of Object.entries(mediaManifest)) {
    (byRoom[m.roomTypeId] = byRoom[m.roomTypeId] || []).push({ id, sort: m.sortOrder ?? 0 });
  }
  const out = {};
  for (const [room, list] of Object.entries(byRoom)) {
    out[room] = list.sort((a, b) => a.sort - b.sort).map((x) => x.id);
  }
  return out;
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
      res.writeHead(302, { Location: 'm/', 'Cache-Control': 'no-store', Vary: 'User-Agent' });
      res.end();
      return;
    }
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
    res.writeHead(r.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(r.body ?? '');
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
  void loadMediaManifest().then(() => void syncMedia().catch(() => {}));
  setInterval(() => void syncMedia().catch(() => {}), MEDIA_SYNC_MS).unref();
});
