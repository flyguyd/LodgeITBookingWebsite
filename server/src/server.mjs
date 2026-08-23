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
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createRateLimiter,
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

const STARTED_AT = Date.now();
const allow = createRateLimiter(RATE_LIMIT, RATE_WINDOW_MS);
let lastEngineOk = null;

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

const server = createServer(async (req, res) => {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';
  // Behind nginx the client address is X-Forwarded-For's FIRST untrusted hop;
  // we take the last entry our proxy appended, falling back to the socket.
  const fwd = String(req.headers['x-forwarded-for'] ?? '');
  const ip = fwd ? fwd.split(',').pop().trim() : (req.socket.remoteAddress ?? 'unknown');

  // ---- health (open, minimal) ----
  if (method === 'GET' && url.split('?')[0] === '/health') {
    json(res, 200, {
      ok: true,
      version: VERSION,
      engineReachable: lastEngineOk,
      uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
    });
    return;
  }

  // ---- the guest API: rate-limited, allow-listed, forwarded signed ----
  const target = forwardTargetFor(method, url);
  if (url.startsWith('/api/')) {
    if (!target) {
      json(res, 404, { code: 'NOT_FOUND', message: 'No such endpoint.' });
      return;
    }
    if (!allow(ip)) {
      json(res, 429, { code: 'RATE_LIMITED', message: 'Too many requests — slow down.' });
      return;
    }
    let rawBody = '';
    if (method === 'POST') {
      try {
        rawBody = await readBody(req);
      } catch {
        json(res, 413, { code: 'TOO_LARGE', message: 'Request too large.' });
        return;
      }
    }
    const r = await engineCall(target.method, target.path, rawBody);
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
    json(res, 404, { code: 'NOT_FOUND', message: 'No such page.' });
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mimeFor(filePath),
      'Cache-Control': 'public, max-age=300',
    });
    res.end(method === 'HEAD' ? undefined : data);
  } catch {
    json(res, 404, { code: 'NOT_FOUND', message: 'No such page.' });
  }
});

// ---- heartbeat: report ourselves to the engine so Lodge Ops sees us ----
async function heartbeat() {
  const body = JSON.stringify({
    version: VERSION,
    uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
    siteUrl: SITE_PUBLIC_URL,
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
});
