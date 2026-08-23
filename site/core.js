/* 7 Star Lodges booking — SHARED CORE, framework-free by design (spec §23).
   All logic that is not presentation lives here: the API contract with the
   site server (/api/public, same origin — absolute paths on purpose so the
   /book/ path-mount still routes them through nginx), the session +
   analytics taxonomy (spec §16/§17), and the pure helpers the verification
   harness executes from source. The desktop UI (/booking.js) and the mobile
   UI (/m/booking.js) both render on top of this and never call the API
   directly. */
window.BKCore = (function () {
  'use strict';

  var API = '/api/public';

  // ---- pure helpers ----

  function nightsBetween(from, to) {
    var ms = Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z');
    return Math.round(ms / 86400000);
  }

  function money(amount, currency) {
    var n = Math.round(Number(amount));
    if (!isFinite(n)) return '';
    var s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (currency === 'ZAR' || !currency ? 'R' : currency + ' ') + s;
  }

  function fmtDate(iso) {
    var d = new Date(iso + 'T00:00:00Z');
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  function isoToday(offsetDays) {
    var d = new Date(Date.now() + (offsetDays || 0) * 86400000);
    return d.toISOString().slice(0, 10);
  }

  /** Attribution that must survive the journey (spec §17). */
  function captureSource(search, referrer, landing) {
    var out = {};
    var params = new URLSearchParams(search || '');
    params.forEach(function (v, k) {
      if (/^utm_/i.test(k) || k === 'gclid' || k === 'fbclid' || k === 'campaign') {
        out[k.toLowerCase()] = v;
      }
    });
    if (referrer) out.referrer = referrer;
    if (landing) out.landing = landing;
    return out;
  }

  /**
   * How a room's price renders under the Lodge Ops display setting
   * (rateDisplay: 'inclusive' | 'separate'). Never invents a breakdown: a
   * room without itemised taxes/fees shows its price plainly in either mode.
   * Returns { headline, note } with numbers, or headline null when unpriced.
   */
  function priceParts(room, config) {
    var rate = room.totalPrice != null ? Number(room.totalPrice) : null;
    if (rate == null || !isFinite(rate)) return { headline: null, note: null };
    var taxes = room.taxesTotal != null ? Number(room.taxesTotal) : null;
    var fees = room.feesTotal != null ? Number(room.feesTotal) : null;
    var known = (taxes != null && isFinite(taxes)) || (fees != null && isFinite(fees));
    var extras = (taxes != null && isFinite(taxes) ? taxes : 0) + (fees != null && isFinite(fees) ? fees : 0);
    var separate = config && config.rateDisplay === 'separate';
    if (!known) return { headline: rate, note: null };
    if (separate) return { headline: rate, note: { extras: extras, kind: 'plus' } };
    return { headline: rate + extras, note: { kind: 'included' } };
  }

  /** Deterministic 0..359 hue from a room id, for the generative fallback
   *  treatment when a room has no photo. Same room, same colour, always. */
  function hueFor(id) {
    var h = 0;
    var s = String(id || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }

  // ---- session + analytics (fire-and-forget; never blocks the guest) ----

  var sessionId = null;

  function post(path, body) {
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json().catch(function () { return null; }); });
  }

  function track(name, detail, state) {
    if (!sessionId) return;
    post('/events', { sessionId: sessionId, name: name, detail: detail || {}, state: state })
      .catch(function () {});
  }

  function startSession(surface) {
    var source = captureSource(location.search, document.referrer, location.pathname);
    if (surface) source.surface = surface;
    post('/sessions', { source: source })
      .then(function (r) { sessionId = r && r.sessionId; })
      .catch(function () {});
  }

  // ---- the API contract ----

  function searchAvailability(params) {
    var q = '?from=' + params.from + '&to=' + params.to +
      '&adults=' + params.adults + '&children=' + params.children +
      '&rooms=' + params.rooms;
    return fetch(API + '/availability' + q).then(function (res) {
      return res.json()
        .catch(function () { return null; })
        .then(function (j) { return { status: res.status, json: j }; });
    });
  }

  function fetchStatus() {
    return fetch(API + '/status').then(function (r) { return r.json(); });
  }

  return {
    nightsBetween: nightsBetween,
    money: money,
    fmtDate: fmtDate,
    isoToday: isoToday,
    captureSource: captureSource,
    hueFor: hueFor,
    priceParts: priceParts,
    startSession: startSession,
    track: track,
    searchAvailability: searchAvailability,
    fetchStatus: fetchStatus,
  };
})();

/* Exposed for the verification harness only. */
window.__bk = {
  nightsBetween: window.BKCore.nightsBetween,
  money: window.BKCore.money,
  fmtDate: window.BKCore.fmtDate,
  captureSource: window.BKCore.captureSource,
  hueFor: window.BKCore.hueFor,
  priceParts: window.BKCore.priceParts,
};
