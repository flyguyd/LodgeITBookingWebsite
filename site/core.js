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

  /** money to the cent — the itemised math must visibly add up, and whole
   *  rand can be off by one where the true amounts carry cents. */
  function moneyC(amount, currency) {
    var n = Number(amount);
    if (!isFinite(n)) return '';
    var s = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '−' : '') +
      (currency === 'ZAR' || !currency ? 'R' : currency + ' ') + s;
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
    /* Engine-priced rooms carry each night's real VAT (0.1.26); the extras
       column then splits VAT per night exactly and only the non-VAT part
       (the levy) evenly. Fallback stays the even split. */
    var perVat = null;
    var nv = room.nightlyVat;
    if (nv && nv.length === nights) {
      perVat = [];
      var vatSum = 0;
      for (var m = 0; m < nv.length; m++) {
        var vv = Number(nv[m]);
        if (!isFinite(vv)) { perVat = null; break; }
        perVat.push(vv);
        vatSum += vv;
      }
      if (perVat && !(vatSum <= extras + 0.005)) perVat = null;
    }
    var restPerNight = perVat
      ? (extras - perVat.reduce(function (a, b) { return a + b; }, 0)) / nights
      : null;
    /* A DISCOUNT CODE took money off (engine 0.1.40): the nightly rows and
       the Accommodation line show the ORIGINAL amounts and the discount then
       appears as its own negative line, so the guest sees what the code
       saved. Display recomposition ONLY — every charged figure (VAT
       included) keeps coming from the discounted rate; total stays what the
       guest pays. */
    var disc = !promo && room.discountApplied === true &&
      isFinite(Number(room.discountTotal)) && Number(room.discountTotal) > 0
      ? Number(room.discountTotal) : 0;
    if (disc > 0 && nightly && room.nightlyDiscount && room.nightlyDiscount.length === nights) {
      for (var q = 0; q < nights; q++) {
        var dq = Number(room.nightlyDiscount[q]);
        if (isFinite(dq)) nightly[q] += dq;
      }
    }
    var accTotal = total + disc;
    var rows = [];
    for (var i = 0; i < nights; i++) {
      var base = promo
        ? (i === 4 ? Number(room.promoCharge5) : Number(room.promoNightly)) * k
        : (nightly ? nightly[i] : accTotal / nights);
      var rowDate = addDays(from, i);
      rows.push({
        date: rowDate,
        base: base,
        extras: perVat ? perVat[i] + restPerNight : extras / nights,
        free5: promo && i === 4,
        /* Rule messages for THIS night (engine 0.1.45), so the row can
           carry a tag next to the date it belongs to. */
        messages: (room.nightMessages && room.nightMessages[rowDate]) || [],
      });
    }
    /* baseTotal is the ACCOMMODATION LINE as displayed — original when a
       discount rode along; `discount` brings it back to the charged figure. */
    return { rows: rows, baseTotal: accTotal, discount: disc, extrasTotal: extras, grand: total + extras };
  }

  /** 'R175 × 2 guests × 4 nights' — how the levy total is reached, spelled
   *  out per its basis. Empty when the lodge levies nothing. */
  function levyMathLabel(lodge, party, nights) {
    if (!lodge) return '';
    var amt = Number(lodge.conservationLevy);
    if (!isFinite(amt) || amt <= 0) return '';
    var persons = Math.max(1,
      ((party && Number(party.adults)) || 0) + ((party && Number(party.children)) || 0));
    var cur = lodge.currency;
    var g = persons + (persons === 1 ? ' guest' : ' guests');
    var nn = nights + (nights === 1 ? ' night' : ' nights');
    switch (lodge.conservationBasis) {
      case 'per_room_per_night': return money(amt, cur) + ' × ' + nn;
      case 'per_person_per_night':
      case 'per_person_per_room_per_night': return money(amt, cur) + ' × ' + g + ' × ' + nn;
      case 'per_person_per_stay': return money(amt, cur) + ' × ' + g;
      case 'per_room_per_stay': return money(amt, cur) + ' per stay';
      default: return '';
    }
  }

  /**
   * The itemised extras as individual lines with the arithmetic shown —
   * every number a guest needs to reach the final amount themselves
   * (Dave, 2026-08-23). Only ever states amounts actually charged on this
   * room: derived VAT reads as VAT, provider figures read as the
   * provider's, the levy line carries its own multiplication.
   */
  function stayMath(room, lodge, party, nights) {
    var lines = [];
    var vatPct = lodge && Number(lodge.vatPct) > 0 ? Number(lodge.vatPct) : 0;
    var pctS = Math.round(vatPct * 100) / 100;
    var taxes = isFinite(Number(room.taxesTotal)) ? Number(room.taxesTotal) : 0;
    var fees = isFinite(Number(room.feesTotal)) ? Number(room.feesTotal) : 0;
    var levy = room.levyAdded ? levyForStay(lodge, party, nights) : 0;
    var levyVat = levy * vatPct / 100;
    if (taxes > 0) {
      /* With a discount applied the Accommodation line shows the ORIGINAL
         amount, but VAT is charged on what the guest pays — the label says
         which figure the percentage is really on, so the arithmetic a guest
         checks by hand still works out. */
      lines.push({
        label: room.vatDerived
          ? 'VAT ' + pctS + '% on ' +
            (room.discountApplied === true ? 'discounted accommodation' : 'accommodation')
          : 'Taxes (provider)',
        amount: taxes,
      });
    }
    var provFees = fees - levy - levyVat;
    if (provFees > 0.005) lines.push({ label: 'Fees (provider)', amount: provFees });
    if (levy > 0) {
      var math = levyMathLabel(lodge, party, nights);
      lines.push({ label: 'Conservation levy' + (math ? ' · ' + math : ''), amount: levy });
      if (levyVat > 0) lines.push({ label: 'VAT ' + pctS + '% on levy', amount: levyVat });
    }
    return lines;
  }

  /* ---- rates from the Rate Engine (0.1.26) ----
     The availability answer carries `ratePlans`: the plans Lodge Ops offers
     to visitors, each with per-suite nights and totals straight from the
     Rate Engine. Provider rate figures never reach the browser any more —
     the site server strips them — so everything priced on these pages goes
     through the two helpers below. */

  /**
   * Apply a quote's DYNAMIC inclusion changes (engine 0.1.43) to the plan's
   * static inclusion list. A rate rule that matched this stay can add or
   * remove inclusions — "stay 5 nights and breakfast is included" — so what
   * the guest is shown must be the list FOR THIS QUOTE, not the plan's
   * standing one. Matching is case-insensitive; the plan's own casing is
   * kept where it already lists a tag.
   *
   * Removed tags leave the list entirely (they are no longer included, not
   * newly excluded). Added tags join the plan's first positive section, or
   * a new "Included" one when the plan has no sections at all.
   */
  function applyInclusionDeltas(inclusions, added, removed) {
    var add = (added || []).map(String);
    var rem = (removed || []).map(String);
    if (!inclusions && !add.length) return inclusions || null;
    if (!add.length && !rem.length) return inclusions || null;
    var src = inclusions || {};
    var remKeys = {};
    rem.forEach(function (t) { remKeys[t.toLowerCase()] = 1; });
    var keep = function (list) {
      return (list || []).filter(function (t) { return !remKeys[String(t).toLowerCase()]; });
    };
    var out = {
      included: keep(src.included),
      excluded: keep(src.excluded),
      sections: (src.sections || []).map(function (sec) {
        return {
          name: sec.name,
          negative: sec.negative === true,
          tags: keep(sec.tags),
        };
      }),
    };
    if (add.length) {
      var has = {};
      out.included.forEach(function (t) { has[String(t).toLowerCase()] = 1; });
      var fresh = add.filter(function (t) {
        var k = t.toLowerCase();
        if (has[k]) return false;
        has[k] = 1;
        return true;
      });
      if (fresh.length) {
        out.included = out.included.concat(fresh);
        var target = null;
        for (var i = 0; i < out.sections.length; i += 1) {
          if (!out.sections[i].negative) { target = out.sections[i]; break; }
        }
        if (!target) {
          target = { name: 'Included', negative: false, tags: [] };
          out.sections.push(target);
        }
        target.tags = target.tags.concat(fresh);
      }
    }
    /* Sections emptied by a removal carry no rows — drop them so the
       compare table never grows a heading with nothing under it. */
    out.sections = out.sections.filter(function (sec) { return sec.tags.length; });
    return out;
  }

  /** The refund policy in plain words (engine 0.1.45). Nonrefundable has
   *  no window; the other two carry how many nights before check-in the
   *  policy holds good up to. */
  function refundLabel(r) {
    if (!r || !r.policy) return '';
    if (r.policy === 'nonrefundable') return 'Nonrefundable';
    /* A partial policy says HOW MUCH comes back when the engine quoted it
       (engine 0.1.54) — a rule saved before the field existed stays a bare
       "Partially refundable" rather than gaining an invented figure. */
    var pct = Number(r.refundPct);
    var name = r.policy === 'partial'
      ? 'Partially refundable' + (isFinite(pct) && pct >= 1 ? ' (' + pct + '% refunded)' : '')
      : 'Fully refundable';
    var n = Number(r.nightsBefore);
    if (!isFinite(n) || n < 0) return name;
    return name + ' up to ' + n + ' night' + (n === 1 ? '' : 's') + ' before check-in';
  }

  /**
   * EVERYTHING THE RATE RULES SAID ABOUT THIS STAY, as lines the card shows
   * WITHOUT a hover (Dave, 2026-08-31: "fix the booking site to show client
   * messages, discounts and anything else that we can set in the rules") —
   * until now all of it lived only inside the itemised hover statement,
   * which the inclusive display never even attached. One list, shared by
   * both builds and the lightbox, so nothing the rules produce can hide
   * behind a display mode again: stay-scoped messages, the discount a code
   * earned, the refund policy, and inclusion changes the rules made.
   */
  function ruleCallouts(room) {
    var out = [];
    (room.rateMessages || []).forEach(function (t) {
      if (String(t).trim()) out.push({ kind: 'msg', text: String(t) });
    });
    if (room.discountApplied === true && Number(room.discountTotal) > 0) {
      out.push({
        kind: 'discount',
        text: 'Discount applied — you save ' + moneyC(room.discountTotal, room.currency),
      });
    }
    (room.inclusionsAdded || []).forEach(function (t) {
      if (String(t).trim()) out.push({ kind: 'inc', text: '+ ' + String(t) + ' included' });
    });
    (room.inclusionsRemoved || []).forEach(function (t) {
      if (String(t).trim()) out.push({ kind: 'exc', text: '− ' + String(t) + ' not included' });
    });
    var rf = refundLabel(room.refundable);
    if (rf) out.push({ kind: 'refund', text: rf });
    return out;
  }

  /** The plan options that actually price one suite's stay — engine order
   *  (the offered list's order) preserved, unpriced or LoS-blocked plans
   *  left out. Empty = the suite has no rate to show, honestly. */
  function planOptionsFor(roomTypeId, ratePlans) {
    var out = [];
    (ratePlans || []).forEach(function (p) {
      var s = p && p.suites && p.suites[String(roomTypeId)];
      if (!s || s.available !== true) return;
      if (s.rateTotal == null || s.grandTotal == null) return;
      out.push({
        planId: String(p.id),
        name: p.name || 'Standard rate',
        description: p.description || null,
        /* What the plan includes/excludes (engine 0.1.36) — the pill's
           hover. Null when Lodge Ops has not linked an inclusion group. */
        inclusions: applyInclusionDeltas(p.inclusions, s.inclusionsAdded, s.inclusionsRemoved),
        /* What a rate rule changed about the inclusions for THIS stay
           (engine 0.1.43) — kept alongside so the UI can call them out. */
        inclusionsAdded: (s.inclusionsAdded || []).map(String),
        inclusionsRemoved: (s.inclusionsRemoved || []).map(String),
        /* Stay-level messages a rate rule passed through (engine 0.1.43).
           Several rules may each contribute a line — all are delivered,
           duplicates already collapsed by the engine. */
        messages: (s.messages || []).map(String),
        /* The refund policy for this stay (engine 0.1.45): the strictest
           policy any night carried, with its notice window. */
        refundable: s.refundable || null,
        rateTotal: Number(s.rateTotal),
        vatTotal: s.vatTotal != null ? Number(s.vatTotal) : 0,
        grandTotal: Number(s.grandTotal),
        /* HOW the engine arrived at the figures (engine 2026-08-31): a
           per-guest root prices nightly x adults, and says which adults it
           priced. Absent on an older engine — the label then simply does
           not render, never a guess. */
        rateBasis: s.rateBasis === 'per_guest_per_night' ? 'per_guest_per_night'
          : s.rateBasis === 'per_room_per_night' ? 'per_room_per_night' : null,
        adultsPriced: s.adultsPriced != null && isFinite(Number(s.adultsPriced))
          ? Number(s.adultsPriced) : null,
        /* A discount code the guest typed took money off this plan's stay
           (engine 0.1.40): the flag plus what it saved and the pre-discount
           accommodation, for the itemised statement. */
        discountApplied: s.discountApplied === true,
        discountTotal: s.discountTotal != null ? Number(s.discountTotal) : 0,
        preDiscountTotal: s.preDiscountTotal != null ? Number(s.preDiscountTotal) : null,
        nights: s.nights || [],
        cheapest: false,
      });
    });
    return markCheapest(out);
  }

  /**
   * Flag the option that costs the guest least (0.1.29). grandTotal is the
   * engine's all-in figure for the stay; the conservation levy sits on top
   * of every plan identically, so it cannot change which plan is cheapest
   * and is deliberately left out of the comparison.
   *
   * A tie keeps the FIRST plan in the offered order — Dave's ordering wins
   * when the money is the same. One plan is never tagged: "cheapest of one"
   * tells the guest nothing.
   */
  function markCheapest(options) {
    if (!options || options.length < 2) return options || [];
    var best = null;
    options.forEach(function (o) {
      o.cheapest = false;
      var t = Number(o.grandTotal);
      if (!isFinite(t)) return;
      if (best === null || t < Number(best.grandTotal)) best = o;
    });
    if (best) best.cheapest = true;
    return options;
  }

  /** The option a search should land on. THE HOUSE DEFAULT IS ALL INCLUSIVE
   *  (Dave, 2026-08-26): the card opens on the fullest presentation of the
   *  stay whenever a plan by that name prices it — matched on the name,
   *  case-insensitively, hyphen tolerated, because that is what the plan is
   *  called in Lodge Ops. Only when no All Inclusive plan prices the stay
   *  does the old order apply: the cheapest, else the first priced plan.
   *  Never null for a non-empty list. The "Lowest rate" tag still marks the
   *  cheapest pill either way — defaulting high must not hide the low. */
  function defaultPlanOption(options) {
    if (!options || !options.length) return null;
    for (var a = 0; a < options.length; a += 1) {
      var n = String((options[a] && options[a].name) || '').toLowerCase().replace(/-/g, ' ');
      if (n.indexOf('all inclusive') !== -1) return options[a];
    }
    for (var i = 0; i < options.length; i += 1) {
      if (options[i] && options[i].cheapest === true) return options[i];
    }
    return options[0];
  }

  /**
   * Map one engine plan option onto a room's display figures: totalPrice is
   * the accommodation EX VAT, taxesTotal the engine's VAT (so both display
   * modes show the engine's arithmetic, not a derivation), nightly rate and
   * VAT arrays ride along for the day-by-day breakdown, and the conservation
   * levy — which the engine knows nothing of — is added from the replicated
   * lodge settings exactly as before.
   */
  function applyPlanToRoom(room, opt, lodge, party, nights) {
    room.planId = opt.planId;
    room.planName = opt.name;
    room.totalPrice = opt.rateTotal;
    room.rateBasis = opt.rateBasis || null;
    room.adultsPriced = opt.adultsPriced != null ? opt.adultsPriced : null;
    room.taxesTotal = opt.vatTotal > 0 ? opt.vatTotal : null;
    room.vatDerived = opt.vatTotal > 0;
    room.providerExtras = false;
    room.currency = (lodge && lodge.currency) || 'ZAR';
    room.nightlyPrices = (opt.nights || []).map(function (n) { return { rate: n.rate }; });
    /* NIGHT-SCOPED rule messages, by date (engine 0.1.45) — the breakdown
       tags the matching night's row with them. Stay-scoped lines are on
       room.rateMessages and belong to the whole stay. */
    room.nightMessages = {};
    (opt.nights || []).forEach(function (n) {
      var msgs = (n.messages || [])
        .filter(function (m) { return m && m.scope === 'night' && m.text; })
        .map(function (m) { return String(m.text); });
      if (msgs.length && n.date) room.nightMessages[String(n.date)] = msgs;
    });
    /* The refund policy the engine quoted for this plan (engine 0.1.45). */
    room.refundable = opt.refundable || null;
    /* Inclusion changes the rules made (engine 0.1.43) — onto the room so
       the card can call them out, not only the compare lightbox. */
    room.inclusionsAdded = (opt.inclusionsAdded || []).slice();
    room.inclusionsRemoved = (opt.inclusionsRemoved || []).slice();
    room.nightlyVat = (opt.nights || []).map(function (n) {
      return n.vatAmount != null ? Number(n.vatAmount) : 0;
    });
    /* Discount-code figures ride along — and are explicitly CLEARED when
       the guest switches to a plan the code did not touch, or a stale
       discount line would survive the switch. */
    /* Rate-rule messages for the chosen plan (engine 0.1.43) — CLEARED on
       every switch so a line from the previous plan never lingers. */
    room.rateMessages = (opt.messages || []).slice();
    room.discountApplied = opt.discountApplied === true && Number(opt.discountTotal) > 0;
    room.discountTotal = room.discountApplied ? Number(opt.discountTotal) : 0;
    room.preDiscountTotal = room.discountApplied && opt.preDiscountTotal != null
      ? Number(opt.preDiscountTotal) : null;
    room.nightlyDiscount = (opt.nights || []).map(function (n) {
      return n.discountAmount != null ? Number(n.discountAmount) : 0;
    });
    var levyStay = levyForStay(lodge, party, nights);
    var vatPct = lodge && Number(lodge.vatPct) > 0 ? Number(lodge.vatPct) : 0;
    room.feesTotal = levyStay > 0 ? levyStay * (1 + vatPct / 100) : null;
    room.levyAdded = levyStay > 0;
    return room;
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
    /* The discount code rides the availability request and feeds the Rate
       Engine's discount_code qualifier (engine 0.1.34). OMITTED when blank,
       never sent as '': a rule gated on a code fails closed on "no code",
       and that distinction is the whole feature. The site server strips
       this param before the provider sees it. */
    if (params.code) q += '&code=' + encodeURIComponent(params.code);
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

  /** The rate basis said to the GUEST, plainly: how this suite's figures
   *  were priced. '' when the engine did not annotate (an older engine) —
   *  the site then shows nothing rather than guessing. */
  function rateBasisLabel(room) {
    if (!room || room.rateBasis == null) return '';
    if (room.rateBasis === 'per_guest_per_night') {
      var n = Number(room.adultsPriced);
      return 'Per-guest rate' +
        (isFinite(n) && n >= 1 ? ' · priced for ' + n + (n === 1 ? ' adult' : ' adults') : '');
    }
    return 'Per-suite rate';
  }

  return {
    nightsBetween: nightsBetween,
    money: money,
    rateBasisLabel: rateBasisLabel,
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
    moneyC: moneyC,
    levyMathLabel: levyMathLabel,
    stayMath: stayMath,
    planOptionsFor: planOptionsFor,
    applyInclusionDeltas: applyInclusionDeltas,
    refundLabel: refundLabel,
    ruleCallouts: ruleCallouts,
    markCheapest: markCheapest,
    defaultPlanOption: defaultPlanOption,
    applyPlanToRoom: applyPlanToRoom,
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
  moneyC: window.BKCore.moneyC,
  levyMathLabel: window.BKCore.levyMathLabel,
  stayMath: window.BKCore.stayMath,
  planOptionsFor: window.BKCore.planOptionsFor,
  markCheapest: window.BKCore.markCheapest,
  defaultPlanOption: window.BKCore.defaultPlanOption,
  applyPlanToRoom: window.BKCore.applyPlanToRoom,
  rateBasisLabel: window.BKCore.rateBasisLabel,
};
