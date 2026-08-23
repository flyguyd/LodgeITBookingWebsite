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
 *  booking API. Anything not listed does not exist publicly. */
export const FORWARD_ROUTES = {
  'GET /api/public/status': { method: 'GET', path: '/api/booking/status' },
  'GET /api/public/availability': { method: 'GET', path: '/api/booking/availability' },
  'POST /api/public/sessions': { method: 'POST', path: '/api/booking/sessions' },
  'POST /api/public/events': { method: 'POST', path: '/api/booking/events' },
};

export function forwardTargetFor(method, urlPath) {
  const clean = urlPath.split('?')[0];
  const route = FORWARD_ROUTES[`${method} ${clean}`];
  if (!route) return null;
  const qIdx = urlPath.indexOf('?');
  const query = qIdx >= 0 ? urlPath.slice(qIdx) : '';
  return { method: route.method, path: route.path + query };
}
