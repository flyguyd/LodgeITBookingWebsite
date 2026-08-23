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

  /** ISO date n days after an ISO date — UTC arithmetic, no DST surprises.
   *  Backs the nights selector: departure = arrival + nights. */
  function addDays(iso, n) {
    var d = new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000);
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

  /* ---- replicated suite content (Lodge Ops → engine → /suites.json) ---- */

  var BASIS_WORDS = {
    per_room_per_night: 'per room per night',
    per_person_per_night: 'per person per night',
    per_person_per_stay: 'per person per stay',
    per_room_per_stay: 'per room per stay',
    per_person_per_room_per_night: 'per person per room per night',
  };

  /** 'Conservation levy R150 per person per night' — null when not levied
   *  (amount absent or 0). Never invents an amount. */
  function levyLine(lodge) {
    if (!lodge) return null;
    var amount = Number(lodge.conservationLevy);
    if (!isFinite(amount) || amount <= 0) return null;
    var basis = BASIS_WORDS[lodge.conservationBasis] ||
      String(lodge.conservationBasis || '').replace(/_/g, ' ');
    return 'Conservation levy ' + money(amount, lodge.currency) + (basis ? ' ' + basis : '');
  }

  /** 'VAT 15%' — null when the lodge has not supplied a percentage. */
  function vatLine(lodge) {
    if (!lodge) return null;
    var pct = Number(lodge.vatPct);
    if (!isFinite(pct) || pct <= 0) return null;
    return 'VAT ' + (Math.round(pct * 100) / 100) + '%';
  }

  /** 'Extra guests per night: adult R350 · child R200 · infant free' — only
   *  the costs the lodge has set; null when none are. A configured 0 reads
   *  as free, honestly. */
  function extraGuestsLine(suite, currency) {
    if (!suite) return null;
    var parts = [];
    [['extraAdultCost', 'adult'], ['extraChildCost', 'child'], ['extraInfantCost', 'infant']]
      .forEach(function (d) {
        var v = suite[d[0]];
        if (v == null) return;
        var n = Number(v);
        if (!isFinite(n)) return;
        parts.push(d[1] + ' ' + (n > 0 ? money(n, currency) : 'free'));
      });
    return parts.length ? 'Extra guests per night: ' + parts.join(' · ') : null;
  }

  /* ---- the 5th-night promotion (Dave, 2026-08-23) ----
     Stays of 5+ nights: the 5th night is discounted 72.3% — the guest pays
     27.7% of the nightly rate (the board the lodge still provides), plus
     that night's conservation levy in full where the levy is not already
     itemised as its own line, plus VAT. DOCUMENTED ASSUMPTION: VAT is
     applied to the charged portion; if VAT should instead be computed on
     the FULL nightly rate, change `board * (1 + vatPct / 100)` to
     `board + (vatPct / 100) * nightly` — one line. Exactly one night is
     adjusted per stay, whatever its length. */
  var FIFTH_NIGHT_BOARD_SHARE = 0.277;

  /** One night's conservation levy for one room and this party. Per-stay
   *  bases add nothing for an extra night, honestly. */
  function levyForNight(lodge, party) {
    if (!lodge) return 0;
    var amt = Number(lodge.conservationLevy);
    if (!isFinite(amt) || amt <= 0) return 0;
    var persons = Math.max(1,
      ((party && Number(party.adults)) || 0) + ((party && Number(party.children)) || 0));
    switch (lodge.conservationBasis) {
      case 'per_room_per_night': return amt;
      case 'per_person_per_night': return amt * persons;
      case 'per_person_per_room_per_night': return amt * persons;
      default: return 0;
    }
  }

  /** The conservation levy for a WHOLE stay of one room, per its basis.
   *  "Persons" is adults + children — infants are never levied. */
  function levyForStay(lodge, party, nights) {
    if (!lodge || !(nights >= 1)) return 0;
    var amt = Number(lodge.conservationLevy);
    if (!isFinite(amt) || amt <= 0) return 0;
    var persons = Math.max(1,
      ((party && Number(party.adults)) || 0) + ((party && Number(party.children)) || 0));
    switch (lodge.conservationBasis) {
      case 'per_room_per_night': return amt * nights;
      case 'per_person_per_night': return amt * persons * nights;
      case 'per_person_per_stay': return amt * persons;
      case 'per_room_per_stay': return amt;
      case 'per_person_per_room_per_night': return amt * persons * nights;
      default: return 0;
    }
  }

  /**
   * The 5th-night adjustment for one room's stay total, or null when it does
   * not apply (under 5 nights, unpriced room, or the "free" night would not
   * actually save anything — a promo that costs more is never shown).
   * includeLevy: false when the stay's levy is itemised as its own line
   * (the itemised display) — charging it inside the 5th night as well
   * would collect it twice. Returns { total, saved }.
   */
  function fifthNightAdjust(room, nights, lodge, party, includeLevy) {
    if (!(nights >= 5)) return null;
    var t = room.totalPrice != null ? Number(room.totalPrice) : null;
    if (t == null || !isFinite(t) || !(t > 0)) return null;
    var nightly = t / nights;
    var vatPct = lodge && isFinite(Number(lodge.vatPct)) ? Number(lodge.vatPct) : 0;
    var board = FIFTH_NIGHT_BOARD_SHARE * nightly;
    var levy = includeLevy === false ? 0 : levyForNight(lodge, party);
    var charge = levy + board * (1 + vatPct / 100);
    var total = t - nightly + charge;
    var saved = t - total;
    if (!(saved > 0)) return null;
    // nightly + charge ride along so the day-by-day breakdown can show the
    // 5th night at its real reduced figure instead of an even split.
    return { total: total, saved: saved, nightly: nightly, charge: charge };
  }

  /**
   * Day-by-day breakdown behind the itemised price note (Dave, 2026-08-23):
   * one row per night — base rate plus that night's share of taxes & fees —
   * and the stay total. The provider itemises taxes/fees as STAY totals, so
   * their per-day figures are an even nightly allocation; the per-day BASE
   * uses the provider's real nightly prices whenever they are sent (falling
   * back to an even split of the displayed total). Null when the room has no
   * itemisation — no breakdown is ever invented.
   */
  function stayBreakdown(room, from, nights) {
    var total = room.totalPrice != null ? Number(room.totalPrice) : null;
    if (total == null || !isFinite(total) || !(nights >= 1) || !from) return null;
    var taxes = room.taxesTotal != null ? Number(room.taxesTotal) : null;
    var fees = room.feesTotal != null ? Number(room.feesTotal) : null;
    var known = (taxes != null && isFinite(taxes)) || (fees != null && isFinite(fees));
    if (!known) return null;
    var extras = (taxes != null && isFinite(taxes) ? taxes : 0) +
      (fees != null && isFinite(fees) ? fees : 0);
    var nightly = null;
    var np = room.nightlyPrices;
    if (np && np.length === nights) {
      nightly = [];
      for (var j = 0; j < np.length; j++) {
        var v = Number(np[j] && np[j].rate != null ? np[j].rate : np[j]);
        if (!isFinite(v)) { nightly = null; break; }
        nightly.push(v);
      }
    }
    /* A 5th-night-promo stay is NOT split evenly: nights carry the real
       nightly rate and the 5th its reduced charge, rescaled together so
       they sum exactly to the displayed total (a later VAT split scales
       every night by the same factor). */
    var promo = room.promoFree5 &&
      isFinite(Number(room.promoNightly)) && isFinite(Number(room.promoCharge5));
    var k = 1;
    if (promo) {
      var pre = (nights - 1) * Number(room.promoNightly) + Number(room.promoCharge5);
      k = pre > 0 ? total / pre : 1;
    }
    var rows = [];
    for (var i = 0; i < nights; i++) {
      var base = promo
        ? (i === 4 ? Number(room.promoCharge5) : Number(room.promoNightly)) * k
        : (nightly ? nightly[i] : total / nights);
      rows.push({
        date: addDays(from, i),
        base: base,
        extras: extras / nights,
        free5: promo && i === 4,
      });
    }
    return { rows: rows, baseTotal: total, extrasTotal: extras, grand: total + extras };
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

  /** Per-day cheapest-rate calendar for the date picker. Resolves to
   *  { days: { iso: { minRate, available } }, currency } or null — the
   *  picker renders without rates rather than failing. */
  function fetchRateCalendar(from, to, roomTypeId) {
    var q = '?from=' + from + '&to=' + to +
      (roomTypeId ? '&roomTypeId=' + encodeURIComponent(roomTypeId) : '');
    return fetch(API + '/rate-calendar' + q)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  return {
    nightsBetween: nightsBetween,
    money: money,
    fmtDate: fmtDate,
    isoToday: isoToday,
    addDays: addDays,
    captureSource: captureSource,
    hueFor: hueFor,
    priceParts: priceParts,
    levyLine: levyLine,
    vatLine: vatLine,
    extraGuestsLine: extraGuestsLine,
    fifthNightAdjust: fifthNightAdjust,
    levyForStay: levyForStay,
    stayBreakdown: stayBreakdown,
    startSession: startSession,
    track: track,
    searchAvailability: searchAvailability,
    fetchStatus: fetchStatus,
    fetchRateCalendar: fetchRateCalendar,
  };
})();

/* Exposed for the verification harness only. */
window.__bk = {
  nightsBetween: window.BKCore.nightsBetween,
  money: window.BKCore.money,
  fmtDate: window.BKCore.fmtDate,
  addDays: window.BKCore.addDays,
  captureSource: window.BKCore.captureSource,
  hueFor: window.BKCore.hueFor,
  priceParts: window.BKCore.priceParts,
  levyLine: window.BKCore.levyLine,
  vatLine: window.BKCore.vatLine,
  extraGuestsLine: window.BKCore.extraGuestsLine,
  fifthNightAdjust: window.BKCore.fifthNightAdjust,
  levyForStay: window.BKCore.levyForStay,
  stayBreakdown: window.BKCore.stayBreakdown,
};
