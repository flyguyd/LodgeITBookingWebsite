/* The stay summary (Dave, 2026-09-02): after the guest has added suites and
   pressed Continue, one page in the site's own glass language that says
   EVERYTHING before any money moves — every suite chosen, the rate plan and
   what it includes, the night-by-night statement for each suite, every
   charge, the totals per suite, the grand total, and the guest's own word
   that it is all correct before the payment step opens.

   Shared by the desktop and the mobile build (one renderer, two skins —
   review.css carries both). Presentation only: every figure comes from the
   same BKCore helpers the cards and the summary bar use, so the page can
   never disagree with the number the guest was just shown. */
window.BKReview = (function () {
  'use strict';
  var C = window.BKCore;
  var $ = function (id) { return document.getElementById(id); };

  var DEFAULT_AGREE = 'I agree that all of the information above is correct and satisfactory.';
  var DEFAULT_HOLD_INTRO = 'To hold your booking we need a valid email address. We will send a short code to it \u2014 type the code back here and your hold page opens.';
  var DEFAULT_HOLD_SENT = 'We have sent a code to your email address. It is good for 30 minutes.';
  var DEFAULT_HOLD_TITLE = 'Your booking is on hold';
  var DEFAULT_HOLD_BODY = 'Thank you \u2014 your email address is verified and the stay below is noted. The reservations team will be in touch to confirm your hold.';
  /* "What's this?" under Hold my booking (Dave, 2026-09-02). */
  var DEFAULT_HOLD_WHAT = 'A booking hold is a way for you to hold this booking, without obligation, for a chosen amount of time. It lets you share the details with your travelling partners, book flights and make other arrangements without fear of losing your booking. The only requirement is an email address to send the hold information to.';
  /* The hold verification lives on the Lodge Ops API, served from the same
     origin as this page on the live host (as the chat widget is). */
  var HOLD_API = window.BK_HOLD_API || '/api/web/booking-hold';
  /* Inclusion CHIP ROWS shown before "Show all" (Dave, 2026-09-02, from
     his screenshot: the first two rows of chips, not the first two
     sections). Measured after layout, so it is rows as the guest sees
     them on that screen. */
  var INCLUSION_ROWS = 2;
  /* An address this browser verified is not asked for a code again (Dave,
     2026-09-02): the earlier hold's id is the proof Lodge Ops checks. */
  var VERIFIED_KEY = 'bk-hold-verified';
  function storedVerified() {
    try {
      var v = JSON.parse(localStorage.getItem(VERIFIED_KEY) || 'null');
      return v && typeof v.email === 'string' && typeof v.holdId === 'string' ? v : null;
    } catch (e) { return null; }
  }
  function rememberVerified(email, holdId) {
    try { localStorage.setItem(VERIFIED_KEY, JSON.stringify({ email: email, holdId: holdId, at: Date.now() })); } catch (e) { /* private mode */ }
  }

  /* Holds (Dave, 2026-09-02; Settings → Booking Engine → Holds): the button
     only when check-in is more than buttonMinDays away; the Hold page's
     three options, each with its own distance; the payment providers
     enabled there. The same defaults as Lodge Ops keeps. */
  var HOLD_DEFAULTS = { enabled: true, buttonMinDays: 14, options: [
    { hours: 24, price: 0, minDays: 0 }, { hours: 36, price: 150, minDays: 42 }, { hours: 72, price: 989, minDays: 91 }] };
  var PROVIDERS = [
    { key: 'stripe', name: 'Stripe' }, { key: 'yoco', name: 'Yoco' },
    { key: 'paypal', name: 'PayPal' }, { key: 'turnstay', name: 'TurnStay' }];
  function holdsConfig(config) {
    var h = (config && config.holds && typeof config.holds === 'object') ? config.holds : {};
    var raw = Array.isArray(h.options) ? h.options : [];
    function num(v, d, max) { var n = Number(v); return isFinite(n) && n >= 0 ? Math.min(max, n) : d; }
    return {
      enabled: h.enabled !== false,
      buttonMinDays: Math.round(num(h.buttonMinDays, HOLD_DEFAULTS.buttonMinDays, 3650)),
      options: HOLD_DEFAULTS.options.map(function (d) {
        var o = null;
        for (var i = 0; i < raw.length; i++) { if (raw[i] && Number(raw[i].hours) === d.hours) { o = raw[i]; break; } }
        o = o || {};
        return { hours: d.hours,
          price: d.hours === 24 ? 0 : Math.round(num(o.price, d.price, 1000000) * 100) / 100,
          minDays: d.hours === 24 ? 0 : Math.round(num(o.minDays, d.minDays, 3650)) };
      }),
    };
  }
  function enabledProviders(config) {
    var p = (config && config.payments && typeof config.payments === 'object') ? config.payments : {};
    return PROVIDERS.filter(function (x) { return p[x.key] === true; });
  }
  /* Whole days from today to an ISO date, UTC like every date here. */
  function daysUntil(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    var t = Date.parse(iso + 'T00:00:00Z');
    var today = Date.parse(C.isoToday() + 'T00:00:00Z');
    return isFinite(t) ? Math.round((t - today) / 86400000) : null;
  }
  function holdOffered(config, from) {
    var h = holdsConfig(config), d = daysUntil(from);
    return h.enabled && d != null && d > h.buttonMinDays;
  }
  function exVat(price) {
    var whole = Math.floor(price), frac = Math.round((price - whole) * 100);
    return 'R' + String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? '.' + (frac < 10 ? '0' : '') + frac : '') + ' + VAT';
  }
  function fmtUntil(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var hh = d.getHours(), mm = d.getMinutes();
    return C.fmtDate(d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate()) +
      ' at ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* The chosen plan's option object — its description and the inclusion
     list FOR THIS QUOTE (rule deltas already applied by planOptionsFor). */
  function chosenPlan(room) {
    var plans = room.plans || [];
    for (var i = 0; i < plans.length; i++) {
      if (String(plans[i].planId) === String(room.planId)) return plans[i];
    }
    return plans.length ? plans[0] : null;
  }

  /* The inclusions as sections. Plans replicated before sections existed
     fall back to Included / Not included, exactly as the compare lightbox
     does. Null when the plan carries no inclusion group at all. */
  function inclusionSections(inc) {
    if (!inc) return null;
    var secs = inc.sections && inc.sections.length ? inc.sections.slice() : [];
    if (!secs.length) {
      if ((inc.included || []).length) secs.push({ name: 'Included', negative: false, tags: inc.included });
      if ((inc.excluded || []).length) secs.push({ name: 'Not included', negative: true, tags: inc.excluded });
    }
    secs = secs.filter(function (s) { return s && s.tags && s.tags.length; });
    /* Exclusions sink to the bottom, as on the compare table. */
    return secs.length ? secs.filter(function (s) { return !s.negative; })
      .concat(secs.filter(function (s) { return s.negative; })) : null;
  }

  /* A datalist of country names for the Country fields, built in the
     browser from the ISO list (no names to keep up to date); null where
     Intl.DisplayNames is missing, and the field is then plain text. */
  var ISO_COUNTRIES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW';
  var countryListCache = null;
  function countryList() {
    if (countryListCache !== null) return countryListCache ? countryListCache.cloneNode(true) : null;
    try {
      var dn = new Intl.DisplayNames(['en'], { type: 'region' });
      var names = ISO_COUNTRIES.split(' ').map(function (c) { return dn.of(c); }).filter(function (n) { return n && n.length > 2; }).sort();
      var dl = document.createElement('datalist'); dl.id = 'bsCountries';
      names.forEach(function (n) { var o = document.createElement('option'); o.value = n; dl.appendChild(o); });
      countryListCache = dl;
      return dl.cloneNode(true);
    } catch (e) { countryListCache = false; return null; }
  }

  function partyLabel(party) {
    var a = Number(party && party.adults) || 0;
    var c = Number(party && party.children) || 0;
    var s = a + (a === 1 ? ' adult' : ' adults');
    if (c > 0) s += ', ' + c + (c === 1 ? ' child' : ' children');
    return s;
  }

  /* One suite's card: photo, name (× quantity), the plan and what it
     includes, what the rules said, the full statement, the suite total. */
  function renderPick(ctx, pick, index) {
    var room = pick.room;
    var qty = pick.qty || 1;
    var nights = ctx.nights;
    var card = el('article', 'glass rv-room');
    card.style.animationDelay = (0.05 + index * 0.08) + 's';

    var photo = el('div', 'rv-photo');
    var urls = ctx.photosFor ? ctx.photosFor(room) : [];
    if (urls.length) {
      var img = el('img');
      img.src = urls[0];
      img.alt = room.name;
      img.loading = 'lazy';
      img.addEventListener('error', function () {
        img.remove();
        if (ctx.art) photo.insertBefore(ctx.art(room), photo.firstChild);
      });
      photo.appendChild(img);
    } else if (ctx.art) {
      photo.appendChild(ctx.art(room));
    }
    card.appendChild(photo);

    var body = el('div', 'rv-body');
    var top = el('div', 'rv-top');
    var name = el('h3', 'rv-name', room.name);
    if (qty > 1) name.appendChild(el('span', 'rv-qty', ' × ' + qty));
    top.appendChild(name);
    /* The bin (Dave, 2026-09-02): remove this suite from the stay. */
    if (ctx.onRemove) {
      var bin = el('button', 'rv-bin');
      bin.type = 'button';
      bin.setAttribute('aria-label', 'Remove ' + room.name + ' from your stay');
      bin.title = 'Remove from your stay';
      bin.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
      bin.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (ctx.track) ctx.track('summary_suite_removed', { roomTypeId: room.roomTypeId });
        ctx.onRemove(room.roomTypeId);
      });
      top.appendChild(bin);
    }
    var pp = C.priceParts(room, ctx.config);
    if (pp.headline != null) {
      var price = el('div', 'rv-price');
      var suiteTotal = pp.headline + (pp.note && pp.note.kind === 'plus' ? pp.note.extras : 0);
      price.appendChild(el('span', 'rv-total', C.money(suiteTotal * qty, room.currency)));
      price.appendChild(el('span', 'rv-pn',
        C.money(pp.headline / nights, room.currency) + ' a night' + (qty > 1 ? ' per suite' : '')));
      if (room.rateBasis === 'per_guest_per_night' && Number(room.adultsPriced) >= 1) {
        price.appendChild(el('span', 'rv-pn rv-ppn',
          C.money(pp.headline / nights / Number(room.adultsPriced), room.currency) + ' per person a night'));
      }
      if (pp.note) {
        price.appendChild(el('span', 'rv-taxnote',
          pp.note.kind === 'plus'
            ? '+ ' + C.money(pp.note.extras * qty, room.currency) + ctx.extrasLabel(room)
            : ctx.inclLabel(room)));
      }
      top.appendChild(price);
    }
    body.appendChild(top);

    /* The rate: plan name, its description, how it was priced. */
    var plan = chosenPlan(room);
    var rate = el('div', 'rv-rate');
    var rateHead = el('div', 'rv-rate-head');
    rateHead.appendChild(el('span', 'rv-kicker', 'Rate'));
    rateHead.appendChild(el('span', 'rv-plan', (plan && plan.name) || room.planName || 'Standard rate'));
    var basis = C.rateBasisLabel(room);
    if (basis) rateHead.appendChild(el('span', 'rv-basis', basis));
    rate.appendChild(rateHead);
    /* The plan's description line is not shown here (Dave, 2026-09-02:
       remove "This is the Oase Standard Rack Rate."); the cards keep it. */
    /* Refund terms get their own labelled line (Dave, 2026-09-02: add
       refundable information to the Your stay suite cards), so the same
       words are not repeated as a callout chip below it. */
    var refund = el('div', 'rv-refund');
    refund.appendChild(el('span', 'rv-kicker', 'Refunds'));
    var rfLabel = C.refundLabel ? C.refundLabel(room.refundable) : '';
    refund.appendChild(el('span', 'rv-refund-text' + (rfLabel ? '' : ' rv-muted'),
      rfLabel || 'Refund terms for this rate are available from the lodge on request.'));
    rate.appendChild(refund);
    var callouts = C.ruleCallouts(room).filter(function (c) { return c.kind !== 'refund'; });
    if (callouts.length) {
      var co = el('div', 'rv-callouts');
      callouts.forEach(function (c) {
        co.appendChild(el('span', 'rv-callout rv-callout-' + c.kind, c.text));
      });
      rate.appendChild(co);
    }
    var secs = inclusionSections(plan && plan.inclusions);
    if (secs) {
      var incl = el('div', 'rv-inclusions');
      incl.appendChild(el('span', 'rv-kicker rv-inc-head', 'Included in this rate'));
      secs.forEach(function (s) {
        var grp = el('div', 'rv-inc-group' + (s.negative ? ' negative' : ''));
        grp.appendChild(el('span', 'rv-inc-name', s.name));
        var chips = el('div', 'rv-inc-chips');
        s.tags.forEach(function (t) { chips.appendChild(el('span', 'rv-inc', String(t))); });
        grp.appendChild(chips);
        incl.appendChild(grp);
      });
      /* Folded to INCLUSION_ROWS chip rows once it is on the page and
         has a width — see foldInclusions, called by open(). */
      incl.__fold = function () { foldInclusions(incl, room, ctx); };
      rate.appendChild(incl);
    } else {
      rate.appendChild(el('p', 'rv-plan-desc rv-muted', 'Inclusions as described for this rate.'));
    }
    body.appendChild(rate);

    /* The full statement — the SAME element the card hangs off its price
       and the lightbox embeds — shown open, with a quantity line when the
       guest takes more than one of this suite. */
    var bd = ctx.buildBreakdown ? ctx.buildBreakdown(room, nights) : null;
    var stmt = el('div', 'rv-statement');
    stmt.appendChild(el('span', 'rv-kicker', qty > 1 ? 'Cost breakdown · per suite' : 'Cost breakdown'));
    if (bd) {
      bd.hidden = false;
      bd.classList.add('rv-open');
      stmt.appendChild(bd);
      if (qty > 1 && pp.headline != null) {
        var mult = el('div', 'rv-mult');
        var suiteTotal2 = pp.headline + (pp.note && pp.note.kind === 'plus' ? pp.note.extras : 0);
        mult.appendChild(el('span', null, qty + ' suites × ' + C.moneyC(suiteTotal2, room.currency)));
        mult.appendChild(el('span', null, C.moneyC(suiteTotal2 * qty, room.currency)));
        stmt.appendChild(mult);
      }
    } else {
      stmt.appendChild(el('p', 'rv-plan-desc rv-muted', 'Rates on request — the lodge will confirm this suite’s price with you.'));
    }
    body.appendChild(stmt);
    card.appendChild(body);
    return card;
  }

  /* Fold an inclusion list to its first INCLUSION_ROWS rows of chips as
     laid out on THIS screen: chips further down, and any section left
     with nothing showing, hide behind one "Show all inclusions · N more"
     button. Measured, not counted — a wide screen shows more per row. */
  function foldInclusions(incl, room, ctx) {
    var chips = Array.prototype.slice.call(incl.querySelectorAll('.rv-inc'));
    if (!chips.length) return;
    var tops = [];
    chips.forEach(function (c) {
      var t = Math.round(c.getBoundingClientRect().top);
      if (tops.indexOf(t) < 0) tops.push(t);
    });
    tops.sort(function (a, b) { return a - b; });
    if (tops.length <= INCLUSION_ROWS) return;
    var limit = tops[INCLUSION_ROWS];
    var hidden = [];
    chips.forEach(function (c) {
      if (Math.round(c.getBoundingClientRect().top) >= limit) { c.hidden = true; c.classList.add('rv-inc-more'); hidden.push(c); }
    });
    incl.querySelectorAll('.rv-inc-group').forEach(function (g) {
      var shown = g.querySelectorAll('.rv-inc:not([hidden])').length;
      if (!shown) { g.hidden = true; g.classList.add('rv-inc-more'); }
    });
    if (!hidden.length) return;
    var more = el('button', 'rv-inc-toggle');
    more.type = 'button';
    more.setAttribute('aria-expanded', 'false');
    var openLabel = 'Show all inclusions \u00b7 ' + hidden.length + ' more';
    more.textContent = openLabel;
    more.addEventListener('click', function () {
      var open = more.getAttribute('aria-expanded') !== 'true';
      incl.querySelectorAll('.rv-inc-more').forEach(function (n) { n.hidden = !open; });
      more.setAttribute('aria-expanded', open ? 'true' : 'false');
      more.textContent = open ? 'Show fewer' : openLabel;
      if (ctx && ctx.track) ctx.track(open ? 'inclusions_expanded' : 'inclusions_collapsed', { roomTypeId: room.roomTypeId });
    });
    incl.appendChild(more);
  }

  /* Every charge across every suite, added up line by line — accommodation,
     any discount, each tax and levy line by its label — then the grand
     total. Same helpers, same rounding (cents), so the column adds up to
     the cent and equals what the summary bar showed. */
  function renderTotals(ctx, picks) {
    var box = el('section', 'glass rv-totals');
    box.appendChild(el('span', 'rv-kicker', 'Charges & totals'));
    var accC = 0, discC = 0, grandC = 0, currency = null, priced = 0;
    var lineC = {}, lineOrder = [];
    picks.forEach(function (p) {
      var room = p.room, qty = p.qty || 1;
      var bd = C.stayBreakdown(room, ctx.from, ctx.nights);
      if (!bd) return;
      priced += 1;
      currency = currency || room.currency;
      accC += Math.round(bd.baseTotal * 100) * qty;
      discC += Math.round(bd.discount * 100) * qty;
      grandC += Math.round(bd.grand * 100) * qty;
      C.stayMath(room, ctx.lodge, ctx.party, ctx.nights).forEach(function (l) {
        if (!(l.label in lineC)) { lineC[l.label] = 0; lineOrder.push(l.label); }
        lineC[l.label] += Math.round(l.amount * 100) * qty;
      });
    });
    function row(label, cents, cls) {
      var r = el('div', 'rv-row' + (cls ? ' ' + cls : ''));
      r.appendChild(el('span', null, label));
      r.appendChild(el('span', null, C.moneyC(cents / 100, currency)));
      box.appendChild(r);
    }
    if (!priced) {
      box.appendChild(el('p', 'rv-plan-desc rv-muted', 'The lodge will confirm the price of your stay with you.'));
      return { box: box, grand: null };
    }
    var suites = picks.reduce(function (n, p) { return n + (p.qty || 1); }, 0);
    row('Accommodation · ' + suites + (suites === 1 ? ' suite' : ' suites') + ' · ' +
      ctx.nights + (ctx.nights === 1 ? ' night' : ' nights'), accC);
    if (discC > 0) row('Discount', -discC, 'rv-disc');
    lineOrder.forEach(function (label) { row(label, lineC[label]); });
    var unpriced = picks.length - priced;
    if (unpriced > 0) {
      box.appendChild(el('p', 'rv-plan-desc rv-muted',
        unpriced + (unpriced === 1 ? ' suite is' : ' suites are') + ' on request and not in these totals.'));
    }
    var grand = el('div', 'rv-grand');
    grand.appendChild(el('span', null, 'Grand total'));
    grand.appendChild(el('strong', null, C.moneyC(grandC / 100, currency)));
    box.appendChild(grand);
    box.appendChild(renderDepositLine(ctx, grandC / 100, currency));
    return { box: box, grand: grandC / 100, currency: currency };
  }

  /* THE DEPOSIT, under the grand total and louder than anywhere else on
     the site (Dave, 2026-09-04): the same rule Lodge Ops applies when the
     booking is made - the Booking deposits card on Settings > Booking
     Engine (fixed / percent / first N nights, and the days before check-in
     inside which the whole stay is due). Outside that window: the deposit
     and the balance with its date. Inside it, or with no deposit rule: the
     whole stay is due when the guest books. */
  function depositFor(config, from, grand, nights) {
    var d = (config && config.deposit) || {};
    var mode = d.mode === 'fixed' || d.mode === 'nights' ? d.mode : 'percent';
    var amount = Number(d.amount); if (!isFinite(amount) || amount < 0) amount = 0;
    var days = Math.round(Number(d.fullPaymentDays)); if (!isFinite(days) || days < 0) days = 0;
    var out = daysUntil(from);
    var full = { kind: 'full', due: grand, deposit: null, balance: null, balanceDueOn: null, fullPaymentDays: days };
    if (days <= 0 || out == null || out <= days || !(grand > 0) || amount <= 0) return full;
    var dep;
    if (mode === 'fixed') dep = amount;
    else if (mode === 'percent') dep = grand * Math.min(100, amount) / 100;
    else dep = nights > 0 ? grand * Math.min(nights, Math.round(amount)) / nights : grand;
    dep = Math.round(Math.min(Math.max(dep, 0), grand) * 100) / 100;
    if (dep <= 0 || dep >= grand) return full;
    var dueOn = new Date(Date.parse(from + 'T00:00:00Z') - days * 86400000).toISOString().slice(0, 10);
    return { kind: 'deposit', due: dep, deposit: dep, balance: Math.round((grand - dep) * 100) / 100, balanceDueOn: dueOn, fullPaymentDays: days };
  }
  function renderDepositLine(ctx, grand, currency) {
    var d = depositFor(ctx.config, ctx.from, grand, ctx.nights);
    var wrap = el('div', 'rv-deposit' + (d.kind === 'full' ? ' rv-deposit-full' : '')); wrap.id = 'rvDeposit';
    var head = el('div', 'rv-deposit-head');
    head.appendChild(el('span', 'rv-deposit-label', d.kind === 'deposit' ? 'Deposit to secure your booking' : 'Due when you book'));
    head.appendChild(el('strong', 'rv-deposit-amount', C.moneyC(d.due, currency)));
    wrap.appendChild(head);
    if (d.kind === 'deposit') {
      wrap.appendChild(el('p', 'rv-deposit-note', 'Pay this deposit now and your suites are yours. The balance of ' + C.moneyC(d.balance, currency) + ' is not due until ' + C.fmtDate(d.balanceDueOn) + '.'));
    } else {
      wrap.appendChild(el('p', 'rv-deposit-note', d.fullPaymentDays > 0
        ? 'Your check-in is within ' + d.fullPaymentDays + ' days, so the full amount is due when you book.'
        : 'The full amount is due when you book.'));
    }
    return wrap;
  }

  var state = { open: false, ctx: null, hold: null };

  /* ---- Hold my booking: email → code → the Hold page (Dave, 2026-09-02) ---- */
  function staySnapshot(ctx, totals) {
    return {
      from: ctx.from, to: ctx.to, nights: ctx.nights,
      currency: totals && totals.currency || null,
      total: totals && totals.grand != null ? Math.round(totals.grand * 100) / 100 : null,
      suites: ctx.picks.map(function (p) {
        var pp = C.priceParts(p.room, ctx.config);
        var one = pp.headline != null ? pp.headline + (pp.note && pp.note.kind === 'plus' ? pp.note.extras : 0) : null;
        return { roomTypeId: String(p.room.roomTypeId), name: p.room.name, qty: p.qty || 1, plan: p.room.planName || null,
          total: one != null ? Math.round(one * (p.qty || 1) * 100) / 100 : null,
          /* The plan's refund terms travel with the hold (Dave, 2026-09-02):
             the hold cards and the hold emails say them per suite. */
          refund: (C.refundLabel ? C.refundLabel(p.room.refundable) : '') || null };
      }),
    };
  }
  function postJson(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }
  function validEmail(v) { return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }

  /* Already verified in this browser (Dave, 2026-09-02: "do not send a
     new verification, just close the modal and continue"): no modal at
     all — the earlier hold's id goes to Lodge Ops and the Hold section
     opens. Only if Lodge Ops will not take it (too old, another address)
     does the modal appear, at the code step, since a code was then sent. */
  function holdWithPrior(ctx, totals, prior, button) {
    var label = button ? button.querySelector('.cta-label') : null;
    var was = label ? label.textContent : '';
    if (button) { button.disabled = true; if (label) label.textContent = 'One moment\u2026'; }
    function restore() { if (button) { button.disabled = false; if (label) label.textContent = was; } }
    if (ctx.track) ctx.track('hold_started', { prior: true, total: totals && totals.grand != null ? totals.grand.toFixed(2) : null });
    postJson(HOLD_API + '/start', { email: prior.email, stay: staySnapshot(ctx, totals), priorHoldId: prior.holdId })
      .then(function (j) {
        restore();
        if (j && j.ok === true && j.verified === true && j.id) {
          rememberVerified(j.email || prior.email, j.id);
          if (ctx.track) ctx.track('hold_verified', { prior: true });
          openHoldPage(ctx, totals, j.id, j.email || prior.email);
          return;
        }
        if (j && j.ok === true && j.id) {
          /* Not taken: a code went out — pick it up at the code step. */
          openHoldModal(ctx, totals, { id: j.id, email: j.email || prior.email });
          return;
        }
        openHoldModal(ctx, totals);
        if (j && j.message) { var n = $('holdNote'); if (n) { n.textContent = j.message; n.hidden = false; } }
      })
      .catch(function () {
        restore();
        openHoldModal(ctx, totals);
        var n = $('holdNote'); if (n) { n.textContent = 'We could not reach the lodge \u2014 check your connection and try again.'; n.hidden = false; }
      });
  }

  function openHoldModal(ctx, totals, resume) {
    var modal = $('holdModal');
    if (!modal) return;
    var t = (ctx.config && ctx.config.text) || {};
    var intro = $('txtHoldIntro'); if (intro) intro.textContent = t.holdIntro || DEFAULT_HOLD_INTRO;
    var sent = $('txtHoldSent'); if (sent) sent.textContent = t.holdSent || DEFAULT_HOLD_SENT;
    var email = $('holdEmail'), send = $('holdSend'), note = $('holdNote');
    var codeStep = $('holdCodeStep'), code = $('holdCode'), verify = $('holdVerify'), codeNote = $('holdCodeNote');
    var emailStep = $('holdEmailStep'), known = $('holdKnown');
    state.hold = { id: null, email: '', totals: totals };
    var prior = storedVerified();
    email.value = prior ? prior.email : ''; code.value = '';
    note.hidden = true; note.textContent = ''; codeNote.hidden = true; codeNote.textContent = '';
    emailStep.hidden = false; codeStep.hidden = true;
    send.disabled = false; verify.disabled = false;
    /* A verified address is offered back, and Send reads Continue for it. */
    function isPrior() { return !!prior && String(email.value || '').trim().toLowerCase() === prior.email; }
    function sendLabel() {
      var p = isPrior();
      send.textContent = p ? 'Continue' : 'Send';
      if (known) known.hidden = !p;
    }
    sendLabel();
    email.oninput = sendLabel;
    if (resume && resume.id) {
      /* A code is already on its way to this address. */
      state.hold.id = resume.id; state.hold.email = resume.email;
      email.value = resume.email;
      emailStep.hidden = true; codeStep.hidden = false;
      var sentTo = $('holdSentTo'); if (sentTo) sentTo.textContent = resume.email;
    }
    modal.hidden = false;
    document.body.classList.add('hold-open');
    if (ctx.track) ctx.track('hold_started', { total: totals && totals.grand != null ? totals.grand.toFixed(2) : null });
    setTimeout(function () { try { (resume && resume.id ? code : email).focus(); } catch (e) { /* fine */ } }, 50);

    function fail(el, msg) { el.textContent = msg; el.hidden = false; }

    send.onclick = function () {
      var v = String(email.value || '').trim().toLowerCase();
      if (!validEmail(v)) { fail(note, 'Please enter a valid email address.'); email.focus(); return; }
      note.hidden = true;
      send.disabled = true;
      var usePrior = isPrior();
      send.textContent = usePrior ? 'One moment\u2026' : 'Sending\u2026';
      var body = { email: v, stay: staySnapshot(ctx, totals) };
      if (usePrior) body.priorHoldId = prior.holdId;
      postJson(HOLD_API + '/start', body)
        .then(function (j) {
          send.disabled = false; sendLabel();
          if (!j || j.ok !== true) { fail(note, (j && j.message) || 'We could not send the code just now \u2014 please try again.'); if (ctx.track) ctx.track('hold_send_failed', {}); return; }
          if (j.verified === true && j.id) {
            /* Already verified: straight to the hold, no code. */
            rememberVerified(j.email || v, j.id);
            if (ctx.track) ctx.track('hold_verified', { prior: true });
            closeHoldModal();
            openHoldPage(ctx, totals, j.id, j.email || v);
            return;
          }
          state.hold.id = j.id; state.hold.email = j.email || v;
          emailStep.hidden = true; codeStep.hidden = false;
          var to = $('holdSentTo'); if (to) to.textContent = state.hold.email;
          if (ctx.track) ctx.track('hold_code_sent', {});
          setTimeout(function () { try { code.focus(); } catch (e) { /* fine */ } }, 50);
        })
        .catch(function () { send.disabled = false; sendLabel(); fail(note, 'We could not reach the lodge \u2014 check your connection and try again.'); });
    };
    email.onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); send.click(); } };
    verify.onclick = function () {
      var v = String(code.value || '').trim().toUpperCase();
      if (v.length < 4) { fail(codeNote, 'Type the code from the email.'); code.focus(); return; }
      codeNote.hidden = true;
      verify.disabled = true;
      postJson(HOLD_API + '/verify', { id: state.hold.id, code: v })
        .then(function (j) {
          verify.disabled = false;
          if (!j || j.ok !== true) {
            fail(codeNote, (j && j.message) || 'That code does not match.');
            if (ctx.track) ctx.track('hold_code_rejected', {});
            if (j && j.attemptsLeft === 0) { emailStep.hidden = false; codeStep.hidden = true; fail(note, j.message || 'Please send a new code.'); }
            return;
          }
          if (ctx.track) ctx.track('hold_verified', {});
          rememberVerified(state.hold.email, j.holdId);
          closeHoldModal();
          openHoldPage(ctx, totals, j.holdId, state.hold.email);
        })
        .catch(function () { verify.disabled = false; fail(codeNote, 'We could not reach the lodge \u2014 check your connection and try again.'); });
    };
    code.onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); verify.click(); } };
    var again = $('holdAgain');
    if (again) again.onclick = function () { emailStep.hidden = false; codeStep.hidden = true; codeNote.hidden = true; email.value = ''; sendLabel(); email.focus(); };
    var close = $('holdClose');
    if (close) close.onclick = closeHoldModal;
    modal.onclick = function (ev) { if (ev.target === modal) closeHoldModal(); };
  }
  function openWhatModal(ctx) {
    var modal = $('whatModal'), body = $('txtHoldWhat');
    if (!modal) return;
    var t = (ctx && ctx.config && ctx.config.text) || {};
    if (body) body.textContent = t.holdWhatsThis || DEFAULT_HOLD_WHAT;
    modal.hidden = false;
    document.body.classList.add('hold-open');
    if (ctx && ctx.track) ctx.track('hold_explained', {});
    function closeWhat() { modal.hidden = true; document.body.classList.remove('hold-open'); }
    var x = $('whatClose'); if (x) x.onclick = closeWhat;
    modal.onclick = function (ev) { if (ev.target === modal) closeWhat(); };
    setTimeout(function () { try { if (x) x.focus(); } catch (e) { /* fine */ } }, 50);
  }
  function closeHoldModal() {
    var modal = $('holdModal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('hold-open');
  }
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      var m = $('holdModal'); if (m && !m.hidden) closeHoldModal();
      var w = $('whatModal'); if (w && !w.hidden) { w.hidden = true; document.body.classList.remove('hold-open'); }
    }
  });

  /* The Hold section: the verified address, the stay as it was agreed, a
     reference, and the choices. Rendered BELOW the summary, above the
     footer (Dave, 2026-09-02: not a new page), and scrolled to. */
  function openHoldPage(ctx, totals, holdId, email) {
    var host = $('hold');
    if (!host) return;
    var t = (ctx.config && ctx.config.text) || {};
    var title = $('holdTitle'); if (title) title.textContent = t.holdPageTitle || DEFAULT_HOLD_TITLE;
    var body = $('holdBody'); if (body) body.textContent = t.holdPageBody || DEFAULT_HOLD_BODY;
    var ref = $('holdRef'); if (ref) ref.textContent = String(holdId || '').replace(/-/g, '').slice(0, 8).toUpperCase();
    var em = $('holdPageEmail'); if (em) em.textContent = email || '';
    var when = $('holdWhen');
    var suites = ctx.picks.reduce(function (n, p) { return n + (p.qty || 1); }, 0);
    if (when) when.textContent = C.fmtDate(ctx.from) + ' \u2014 ' + C.fmtDate(ctx.to) + ' \u00b7 ' +
      ctx.nights + (ctx.nights === 1 ? ' night' : ' nights') + ' \u00b7 ' + suites + (suites === 1 ? ' suite' : ' suites') + ' \u00b7 ' + partyLabel(ctx.party);
    var list = $('holdSuites');
    if (list) {
      list.textContent = '';
      ctx.picks.forEach(function (p) {
        var row = el('div', 'rv-row');
        row.appendChild(el('span', null, p.room.name + ((p.qty || 1) > 1 ? ' \u00d7 ' + p.qty : '') + (p.room.planName ? ' \u00b7 ' + p.room.planName : '')));
        var pp = C.priceParts(p.room, ctx.config);
        var one = pp.headline != null ? pp.headline + (pp.note && pp.note.kind === 'plus' ? pp.note.extras : 0) : null;
        row.appendChild(el('span', null, one != null ? C.moneyC(one * (p.qty || 1), p.room.currency) : 'on request'));
        list.appendChild(row);
        var rf = C.refundLabel ? C.refundLabel(p.room.refundable) : '';
        if (rf) list.appendChild(el('div', 'hold-refund', rf));
      });
    }
    var grand = $('holdGrand');
    if (grand) grand.textContent = totals && totals.grand != null ? C.moneyC(totals.grand, totals.currency) : '';
    renderHoldChoices(ctx, holdId);
    host.hidden = false;
    if (ctx.track) ctx.track('hold_page_opened', { holdId: holdId });
    try { host.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* fine */ }
  }

  /* A brand-coloured wordmark per provider — CSS marks, no image files to
     fetch, the same square on every provider. */
  function providerMark(p) {
    var mark = el('span', 'hold-logo hold-logo-' + p.key);
    mark.setAttribute('aria-hidden', 'true');
    if (p.key === 'paypal') {
      mark.appendChild(el('span', 'hold-logo-a', 'Pay'));
      mark.appendChild(el('span', 'hold-logo-b', 'Pal'));
    } else if (p.key === 'turnstay') {
      mark.appendChild(el('span', 'hold-logo-a', 'Turn'));
      mark.appendChild(el('span', 'hold-logo-b', 'Stay'));
    } else {
      mark.appendChild(el('span', 'hold-logo-a', p.name.toLowerCase()));
    }
    return mark;
  }

  /* The Hold page's choices (Dave, 2026-09-02): the options the distance
     to check-in allows, then a square button per enabled payment provider
     for a paid one. Pressing a square SELECTS it (highlighted, the others
     greyed) and opens the way to pay below it: a card form on our page for
     a gateway that takes the card here, or a "Click here to make payment"
     button for one that takes it on its own page. Pressing the same square
     again puts everything back. Stripe's card fields are STRIPE'S OWN
     (Stripe Elements, an iframe from js.stripe.com): the number goes from
     the guest's browser to Stripe and nowhere else — the rate engine only
     creates the PaymentIntent and checks with Stripe afterwards; Lodge
     Ops sees neither. Stripe refused a raw card number on 2026-09-02, and
     the raw-card form that sent one is gone. */
  var PAY_API = window.BK_PAY_API || '/api/public/payments';
  var STATIC_MODES = { stripe: 'element', yoco: 'redirect', paypal: 'redirect', turnstay: 'redirect' };
  var STRIPE_JS = 'https://js.stripe.com/v3/';
  var stripeLoad = null;
  /* Stripe.js, loaded once when first needed (never on a page that does not
     take a card). A test rig may set window.Stripe itself. */
  function loadStripe(publishableKey, offered) {
    if (publishableKey && !/^pk_/.test(publishableKey)) {
      return Promise.reject(new Error('the key Lodge Ops passed for Stripe is not a publishable key (they start with pk_) \u2014 in Lodge Ops, Settings \u2192 Stripe, put the publishable key in its own field'));
    }
    if (!publishableKey) {
      /* Two different gaps read the same on the page unless named
         (Dave, 2026-09-03): the engine is not OFFERING Stripe at all (no
         usable keys on it, or Lodge Ops has not shared them), or it offers
         Stripe but sent no publishable key. */
      if (!offered) {
        return Promise.reject(new Error('the booking engine is not offering Stripe right now \u2014 it holds no usable Stripe keys, or Lodge Ops has not shared them. In Lodge Ops open Settings \u2192 Booking Engine: check Stripe is ticked under Payment providers, read Stripe\u2019s chip (\u201cmissing: \u2026\u201d names the key it lacks), then press \u201cShare keys with the engine now\u201d; the Stripe page must hold both the secret key and the publishable key.'));
      }
      return Promise.reject(new Error('Stripe\u2019s publishable key has not reached this site \u2014 in Lodge Ops, Settings \u2192 Stripe, fill in the publishable key (pk_live_\u2026 or pk_test_\u2026) and save; the Booking Engine page shows whether the engine offers Stripe.'));
    }
    var make = function () {
      try { return Promise.resolve(window.Stripe(publishableKey)); }
      catch (e) {
        /* Stripe.js explains itself well (a live key on an http page, a
           malformed key) \u2014 pass its words on. */
        return Promise.reject(new Error('Stripe would not start: ' + ((e && e.message) || e)));
      }
    };
    if (window.Stripe) return make();
    if (!stripeLoad) {
      stripeLoad = new Promise(function (resolve, reject) {
        var sc = document.createElement('script');
        sc.src = STRIPE_JS; sc.async = true;
        sc.onload = function () { window.Stripe ? resolve() : reject(new Error('Stripe\u2019s script loaded but did not define Stripe')); };
        sc.onerror = function () { stripeLoad = null; reject(new Error('Stripe\u2019s script (js.stripe.com) could not be loaded \u2014 a content blocker, a firewall or a Content-Security-Policy on the site may be in the way')); };
        document.head.appendChild(sc);
      });
    }
    return stripeLoad.then(make);
  }
  var PAY_KEY = 'bk-hold-pay';
  function rememberPayment(holdId, reference, paymentId) {
    try { localStorage.setItem(PAY_KEY, JSON.stringify({ holdId: holdId, reference: reference, paymentId: paymentId, at: Date.now() })); } catch (e) { /* private mode */ }
  }
  function forgetPayment() { try { localStorage.removeItem(PAY_KEY); } catch (e) { /* fine */ } }
  function readPayment() { try { var v = JSON.parse(localStorage.getItem(PAY_KEY) || 'null'); return v && v.paymentId ? v : null; } catch (e) { return null; } }
  function getJson(url) { return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }); }
  function secureRow() {
    var row = el('div', 'hold-secure');
    var lock = el('span', 'hold-secure-item');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    var r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', '4'); r.setAttribute('y', '10'); r.setAttribute('width', '16'); r.setAttribute('height', '11'); r.setAttribute('rx', '2');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M8 10V7a4 4 0 0 1 8 0v3');
    svg.appendChild(r); svg.appendChild(p);
    lock.appendChild(svg); lock.appendChild(document.createTextNode('Secure payment · encrypted'));
    row.appendChild(lock);
    var pci = el('span', 'hold-secure-item');
    var svg2 = svg.cloneNode(true); svg2.textContent = '';
    var c = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    c.setAttribute('d', 'M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z');
    svg2.appendChild(c);
    pci.appendChild(svg2); pci.appendChild(document.createTextNode('PCI DSS compliant gateway'));
    row.appendChild(pci);
    var brands = el('span', 'hold-brands');
    brands.appendChild(el('span', 'hold-brand hold-brand-visa', 'VISA'));
    brands.appendChild(el('span', 'hold-brand hold-brand-mc', 'Mastercard'));
    brands.appendChild(el('span', 'hold-brand hold-brand-amex', 'AMEX'));
    row.appendChild(brands);
    return row;
  }
  function renderHoldChoices(ctx, holdId) {
    var host = $('holdChoice');
    if (!host) return;
    host.textContent = '';
    var holds = holdsConfig(ctx.config);
    var days = daysUntil(ctx.from);
    var options = holds.options.filter(function (o) { return o.minDays === 0 || (days != null && days > o.minDays); });
    var providers = enabledProviders(ctx.config);
    if (!holds.enabled || !options.length) { host.hidden = true; return; }
    host.hidden = false;
    var chosen = null, done = false, payer = null, modes = null, fees = {}, gwInfo = {};
    var stripeCard = null, stripeApi = null;

    host.appendChild(el('p', 'kicker hold-kicker', 'How long shall we hold it?'));
    var list = el('div', 'hold-options');
    var optionButtons = options.map(function (o) {
      var b = el('button', 'hold-opt');
      b.type = 'button';
      b.setAttribute('data-hours', String(o.hours));
      b.setAttribute('aria-pressed', 'false');
      b.appendChild(el('span', 'hold-opt-hours', o.hours + ' hours'));
      b.appendChild(el('span', 'hold-opt-price', o.price > 0 ? exVat(o.price) : 'Free'));
      b.addEventListener('click', function () { if (!done) select(o); });
      list.appendChild(b);
      return b;
    });
    host.appendChild(list);

    var payWrap = el('div', 'hold-paywrap');
    payWrap.hidden = true;
    payWrap.appendChild(el('p', 'kicker hold-kicker', 'Pay the hold fee with'));
    /* Shown while the engine is being asked which gateways it will take, so
       the squares never appear and then vanish (Dave, 2026-09-03: "they
       flicker on and then off and don't come back"). */
    var payWait = el('p', 'hold-choice-note hold-paywait-note', 'Checking payment options\u2026');
    payWait.id = 'holdPayChecking';
    payWait.hidden = true;
    payWrap.appendChild(payWait);
    var payMissing = el('p', 'hold-choice-note hold-choice-err');
    payMissing.id = 'holdPayMissing';
    payMissing.hidden = true;
    payWrap.appendChild(payMissing);
    var pay = el('div', 'hold-pay');
    pay.hidden = true;
    var payButtons = providers.map(function (p) {
      var b = el('button', 'hold-payer');
      b.type = 'button';
      b.setAttribute('data-provider', p.key);
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', 'Pay with ' + p.name);
      b.title = 'Pay with ' + p.name;
      b.appendChild(providerMark(p));
      b.appendChild(el('span', 'hold-payer-name', p.name));
      b.addEventListener('click', function () { if (chosen && !done) togglePayer(p); });
      pay.appendChild(b);
      return b;
    });
    payWrap.appendChild(pay);
    var panel = el('div', 'hold-paypanel');
    panel.id = 'holdPayPanel';
    panel.hidden = true;
    payWrap.appendChild(panel);
    host.appendChild(payWrap);

    var confirmWrap = el('div', 'hold-confirm');
    confirmWrap.hidden = true;
    var confirm = el('button', 'cta');
    confirm.type = 'button';
    confirm.id = 'holdConfirm';
    confirm.appendChild(el('span', 'cta-label', 'Confirm'));
    confirm.addEventListener('click', function () { if (chosen && !done) commit(chosen, null, null); });
    confirmWrap.appendChild(confirm);
    host.appendChild(confirmWrap);
    var note = el('p', 'hold-choice-note');
    note.id = 'holdChoiceNote';
    note.hidden = true;
    host.appendChild(note);

    /* Which gateways the engine will actually take, and how each takes the
       card. Asked once, BEFORE the squares are shown: a square the engine
       does not list is hidden; if the engine cannot be asked, or lists none
       of the gateways Lodge Ops has switched on, every enabled square stays
       with the usual modes and a note says the payment side is still being
       set up — an empty section with a paid option chosen is the one thing
       this must never leave the guest with (Dave, 2026-09-03). */
    var modesLoad = null;
    function loadModes() {
      if (modes) return Promise.resolve(modes);
      if (modesLoad) return modesLoad;
      modesLoad = getJson(PAY_API + '/gateways').then(function (j) {
        var list = (j && Array.isArray(j.gateways)) ? j.gateways : null;
        var found = {};
        if (list) {
          list.forEach(function (g) { if (g && g.key) { found[g.key] = g.mode === 'element' ? 'element' : 'redirect'; gwInfo[g.key] = g; } });
        }
        var anyEnabled = providers.some(function (p) { return !!found[p.key]; });
        if (list && anyEnabled) {
          modes = found;
          payButtons.forEach(function (b) { b.hidden = !modes[b.getAttribute('data-provider')]; });
          payMissing.hidden = true;
        } else {
          modes = STATIC_MODES;
          payButtons.forEach(function (b) { b.hidden = false; });
          payMissing.textContent = list
            ? 'Our payment provider is still being set up for these options. You can try one, or contact us to secure the hold.'
            : 'Our payment provider could not be reached just now. You can try one, or contact us to secure the hold.';
          payMissing.hidden = false;
          if (ctx.track) ctx.track('hold_gateways_unavailable', { listed: list ? list.length : null, enabled: providers.map(function (p) { return p.key; }) });
        }
        return modes;
      }).catch(function () {
        modes = STATIC_MODES;
        payButtons.forEach(function (b) { b.hidden = false; });
        payMissing.textContent = 'Our payment provider could not be reached just now. You can try one, or contact us to secure the hold.';
        payMissing.hidden = false;
        return modes;
      }).then(function (m) { payWait.hidden = true; pay.hidden = false; return m; });
      return modesLoad;
    }
    function loadFee(o) {
      if (fees[o.hours]) return Promise.resolve(fees[o.hours]);
      return getJson(PAY_API + '/fee?hours=' + o.hours).then(function (j) {
        fees[o.hours] = (j && j.ok && j.total > 0) ? j : { total: null };
        return fees[o.hours];
      }).catch(function () { return { total: null }; });
    }
    function feeLabel(o) {
      var f = fees[o.hours];
      return f && f.total > 0 ? C.moneyC(f.total, f.currency) + ' incl. VAT' : exVat(o.price);
    }

    function select(o) {
      chosen = o;
      optionButtons.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-hours') === String(o.hours) ? 'true' : 'false'); });
      note.hidden = true;
      if (o.price > 0 && providers.length) {
        payWrap.hidden = false; confirmWrap.hidden = true;
        /* The squares wait for the engine's answer; the kicker and the
           "Checking…" line hold the space so the page does not jump. */
        if (!modes) { payWait.hidden = false; pay.hidden = true; }
        loadModes(); loadFee(o).then(function () { if (payer) renderPanel(payer); });
        if (payer) renderPanel(payer);
      } else {
        payWrap.hidden = true; confirmWrap.hidden = false;
        clearPayer();
        confirm.querySelector('.cta-label').textContent = o.price > 0
          ? 'Request a ' + o.hours + '-hour hold · ' + exVat(o.price)
          : 'Hold it for ' + o.hours + ' hours · free';
      }
      if (ctx.track) ctx.track('hold_option_selected', { hours: o.hours, price: o.price });
    }
    function dropStripe() {
      if (stripeCard) { try { stripeCard.unmount(); } catch (e) { /* fine */ } stripeCard = null; }
    }
    function clearPayer() {
      payer = null;
      dropStripe();
      payButtons.forEach(function (b) { b.classList.remove('on'); b.classList.remove('dim'); b.setAttribute('aria-pressed', 'false'); });
      panel.textContent = ''; panel.hidden = true;
    }
    function togglePayer(p) {
      if (payer && payer.key === p.key) { clearPayer(); return; }
      payer = p;
      payButtons.forEach(function (b) {
        var mine = b.getAttribute('data-provider') === p.key;
        b.classList.toggle('on', mine); b.classList.toggle('dim', !mine);
        b.setAttribute('aria-pressed', mine ? 'true' : 'false');
      });
      if (ctx.track) ctx.track('hold_gateway_selected', { provider: p.key });
      loadModes().then(function () { if (payer && payer.key === p.key) renderPanel(p); });
    }
    function renderPanel(p) {
      panel.textContent = '';
      panel.hidden = false;
      var mode = (modes || STATIC_MODES)[p.key] || 'redirect';
      dropStripe();
      panel.className = 'hold-paypanel ' + (mode === 'element' ? 'hold-cardform' : 'hold-redirect');
      panel.setAttribute('data-mode', mode);
      var err = el('p', 'hold-choice-note hold-choice-err'); err.id = 'holdPayNote'; err.hidden = true;
      if (mode === 'element') {
        panel.appendChild(el('p', 'kicker hold-kicker', 'Card details · ' + p.name));
        var form = document.createElement('form');
        form.setAttribute('autocomplete', 'on');
        form.noValidate = true; /* our own messages, not the browser's bubbles */
        form.addEventListener('submit', function (ev) { ev.preventDefault(); payElement(); });
        var nameL = el('label', null, 'Name on card');
        var nameI = document.createElement('input');
        nameI.name = 'ccName'; nameI.id = 'cc-ccName'; nameI.type = 'text'; nameI.required = true;
        nameI.setAttribute('autocomplete', 'cc-name'); nameI.setAttribute('maxlength', '80'); nameI.setAttribute('placeholder', 'As printed on the card');
        nameL.appendChild(nameI); form.appendChild(nameL);
        var cardL = el('label', null, 'Card number, expiry and CVC');
        var mount = el('div', 'hold-stripe-el loading', 'Loading the secure card fields\u2026');
        mount.id = 'holdCardElement';
        cardL.appendChild(mount); form.appendChild(cardL);
        var sec = secureRow();
        var by = el('span', 'hold-secure-item hold-secure-stripe', 'Card fields by Stripe \u2014 never seen by this site');
        sec.insertBefore(by, sec.firstChild);
        form.appendChild(sec);
        var go = el('button', 'cta hold-paynow'); go.type = 'submit'; go.id = 'holdPayNow'; go.disabled = true;
        go.appendChild(el('span', 'cta-label', 'Pay ' + feeLabel(chosen) + ' and hold it'));
        form.appendChild(go);
        form.appendChild(err);
        panel.appendChild(form);
        var pk = (gwInfo[p.key] && gwInfo[p.key].publishableKey) || (ctx.config && ctx.config.stripePublishableKey) || '';
        loadStripe(pk, !!gwInfo[p.key]).then(function (stripe) {
          if (!payer || payer.key !== p.key || !mount.isConnected) return;
          stripeApi = stripe;
          var elements = stripe.elements();
          stripeCard = elements.create('card', {
            hidePostalCode: true,
            style: { base: { color: '#f3ede1', fontFamily: 'inherit', fontSize: '16px', '::placeholder': { color: 'rgba(243, 237, 225, 0.4)' }, iconColor: '#d8b46a' }, invalid: { color: '#e8a58a', iconColor: '#e8a58a' } }
          });
          mount.textContent = ''; mount.classList.remove('loading');
          stripeCard.mount(mount);
          revealPanel(panel);
          stripeCard.on('ready', function () { revealPanel(panel); });
          stripeCard.on('focus', function () { mount.classList.add('focus'); });
          stripeCard.on('blur', function () { mount.classList.remove('focus'); });
          stripeCard.on('change', function (e) {
            mount.classList.toggle('bad', !!(e && e.error));
            if (e && e.error) { err.textContent = e.error.message; err.hidden = false; } else { err.hidden = true; }
            go.disabled = !(e && e.complete);
          });
        }).catch(function (e) {
          var why = (e && e.message) || 'check your connection';
          try { console.warn('[booking] Stripe Elements not loaded:', why); } catch (x) { /* fine */ }
          mount.textContent = 'The secure card fields could not be loaded: ' + why + '. You can choose another payment method.';
          mount.classList.add('bad');
          revealPanel(panel);
        });
        function payElement() {
          err.hidden = true;
          if (!nameI.value.trim()) { nameI.classList.add('bad'); err.textContent = 'Please enter the name on the card.'; err.hidden = false; try { nameI.focus(); } catch (x) { /* fine */ } return; }
          if (!stripeCard || !stripeApi) { err.textContent = 'The secure card fields are still loading \u2014 one moment.'; err.hidden = false; return; }
          commit(chosen, p, { name: nameI.value.trim().slice(0, 80) });
        }
      } else {
        panel.appendChild(el('p', 'kicker hold-kicker', 'Pay with ' + p.name));
        panel.appendChild(el('p', null, 'You will be taken to ' + p.name + '’s secure page to pay ' + feeLabel(chosen) + '. This page keeps your hold and updates itself once the payment is done.'));
        panel.appendChild(secureRow());
        var go2 = el('button', 'cta hold-paynow'); go2.type = 'button'; go2.id = 'holdPayNow';
        go2.appendChild(el('span', 'cta-label', 'Click here to make payment'));
        go2.addEventListener('click', function () { commit(chosen, p, null); });
        panel.appendChild(go2);
        panel.appendChild(err);
      }
      revealPanel(panel);
    }
    function busy(on) {
      optionButtons.concat(payButtons).forEach(function (b) { b.disabled = on; });
      confirm.disabled = on;
      var go = panel.querySelector('#holdPayNow'); if (go) go.disabled = on;
      panel.querySelectorAll('input').forEach(function (i) { i.disabled = on; });
    }
    function fail(msg) {
      busy(false);
      var target = panel.hidden ? note : (panel.querySelector('#holdPayNote') || note);
      target.className = 'hold-choice-note hold-choice-err';
      target.textContent = msg;
      target.hidden = false;
    }
    /* Stripe on the page: the hold first (its reference is what the payment
       is for), then a PaymentIntent from the engine, then Stripe.js confirms
       it IN THE BROWSER with the card in Stripe's fields, then the engine
       is asked what Stripe says, then Lodge Ops is told — which checks with
       the engine before it believes it. */
    function payWithStripe(hold, p, billing) {
      return postJson(PAY_API + '/intent', { gateway: p.key, reference: hold.reference, hours: hold.hours, email: hold.email })
        .then(function (j) {
          if (!j || j.ok !== true) throw new Error((j && j.message) || 'The payment could not be started \u2014 please try again or choose another payment method.');
          if (j.status === 'paid') return j.paymentId;
          if (!j.clientSecret) throw new Error('The payment could not be started \u2014 please try again.');
          return stripeApi.confirmCardPayment(j.clientSecret, { payment_method: { card: stripeCard, billing_details: { name: billing.name, email: hold.email || undefined } } })
            .then(function (res) {
              if (res && res.error) throw new Error(res.error.message || 'The payment was not accepted \u2014 please check the card or try another.');
              return j.paymentId;
            });
        })
        .then(function (paymentId) {
          /* Stripe's word on it, through the engine — never the browser's. */
          var tries = 0;
          function verify() {
            return postJson(PAY_API + '/status', { paymentId: paymentId }).then(function (st) {
              if (st && st.status === 'paid') return st;
              if (++tries < 6) return new Promise(function (r) { setTimeout(r, 1500); }).then(verify);
              throw new Error((st && st.error) || 'The payment has not been confirmed yet \u2014 please retrieve your hold in a moment to see its state.');
            });
          }
          return verify().then(function (st) {
            if (ctx.track) ctx.track('hold_fee_paid', { reference: hold.reference, provider: p.key, amount: st.amount });
            return postJson(HOLD_API + '/paid', { id: hold.holdId, reference: hold.reference, paymentId: paymentId })
              .then(function (k) { return (k && k.ok === true) ? k : hold; });
          });
        });
    }
    /* Hosted page: the hold, then the checkout on the engine, then the
       gateway's page in a new tab; this page waits and asks the engine
       until the payment is done. */
    function openCheckout(hold, p) {
      var w = null;
      try { w = window.open('', '_blank'); } catch (e) { w = null; }
      var here = location.href.split('#')[0].split('?')[0];
      return postJson(PAY_API + '/checkout', { gateway: p.key, reference: hold.reference, hours: hold.hours, email: hold.email, returnUrl: here, cancelUrl: here })
        .then(function (j) {
          if (!j || j.ok !== true || !j.url) { if (w) w.close(); throw new Error((j && j.message) || 'The payment page could not be opened — please try again or choose another payment method.'); }
          rememberPayment(hold.holdId, hold.reference, j.paymentId);
          if (w) { try { w.location = j.url; } catch (e) { w = null; } }
          if (!w) { try { window.open(j.url, '_blank'); } catch (e) { location.href = j.url; } }
          if (ctx.track) ctx.track('hold_payment_started', { reference: hold.reference, provider: p.key });
          return { hold: hold, paymentId: j.paymentId, url: j.url, gateway: p };
        });
    }
    function commit(o, p, billing) {
      busy(true);
      note.hidden = true;
      var payNote = panel.querySelector('#holdPayNote'); if (payNote) payNote.hidden = true;
      postJson(HOLD_API + '/choose', { id: holdId, hours: o.hours, provider: p ? p.key : null,
        snapshot: ctx.snapshot ? ctx.snapshot() : null })
        .then(function (j) {
          if (!j || j.ok !== true) {
            if (ctx.track) ctx.track('hold_choice_failed', { hours: o.hours });
            throw new Error((j && j.message) || 'Your choice could not be saved just now — please try again.');
          }
          if (ctx.track) ctx.track('hold_chosen', { hours: o.hours, price: o.price, provider: p ? p.key : null, reference: j.reference });
          if (!p || j.feePaid) return { hold: j };
          var mode = (modes || STATIC_MODES)[p.key] || 'redirect';
          return mode === 'element' ? payWithStripe(j, p, billing || { name: '' }).then(function (h) { return { hold: h }; }) : openCheckout(j, p);
        })
        .then(function (r) {
          done = true;
          host.classList.add('hold-chosen');
          payWrap.hidden = true; confirmWrap.hidden = true;
          /* The hold is real: its own section below, with the clock. */
          showHeld(r.hold, ctx, r.paymentId ? { paymentId: r.paymentId, url: r.url, gateway: r.gateway } : null);
        })
        .catch(function (e) {
          fail(e && e.message && !/fetch|network/i.test(e.message) ? e.message : 'We could not reach the lodge — check your connection and try again.');
        });
    }
  }

  /* ---- The hold section (Dave, 2026-09-02): every detail of the hold, its
     reference number, a running clock until it ends, the end time in the
     guest's own time zone, how to come back to it, and the two ways on:
     cancel and search again, or make the reservation. Shown after "Hold
     it" and again after Retrieve booking. ---- */
  var heldTimer = null;
  function stopHeldTimer() { if (heldTimer) { clearInterval(heldTimer); heldTimer = null; } }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function countdown(untilMs) {
    var left = Math.max(0, Math.floor((untilMs - Date.now()) / 1000));
    var d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
    return (d > 0 ? d + (d === 1 ? ' day ' : ' days ') : '') + pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }
  function localUntil(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    } catch (e) { return d.toString(); }
  }
  var payPoll = null;
  function stopPayPoll() { if (payPoll) { clearInterval(payPoll); payPoll = null; } }
  /* The fee line on the held card: paid (how, with what card), owed, or
     nothing for a free hold. */
  function feeLine(hold) {
    if (!(hold.price > 0)) return null;
    if (hold.feePaid) {
      return 'Paid ' + C.moneyC(hold.feeAmount != null ? hold.feeAmount : hold.feeTotal, hold.feeCurrency || 'ZAR') + ' incl. VAT' +
        (hold.feeGateway ? ' via ' + providerNameOf(hold.feeGateway) : '') +
        (hold.cardLast4 ? ' \u00b7 ' + (hold.cardBrand || 'card') + ' \u2022\u2022\u2022\u2022 ' + hold.cardLast4 : '');
    }
    return (hold.feeTotal > 0 ? C.moneyC(hold.feeTotal, 'ZAR') + ' incl. VAT' : exVat(hold.price)) + ' \u2014 not yet paid';
  }
  function showHeld(hold, ctx, pending) {
    ctx = ctx || state.ctx;
    var host = $('held'), card = $('heldCard');
    if (!host || !card || !hold) return;
    stopHeldTimer(); stopPayPoll();
    /* The agreement stands while the hold does (Dave, 2026-09-02): ticked
       and locked, the buttons awake; cancelling unlocks it for the next
       search. */
    var agreeBox = $('agreeBox');
    if (agreeBox && hold.status === 'held') {
      agreeBox.checked = true;
      agreeBox.disabled = true;
      var pb = $('payBtn'), hb = $('holdBtn');
      if (pb) { pb.disabled = false; pb.removeAttribute('title'); }
      if (hb) { hb.disabled = false; hb.removeAttribute('title'); }
    }
    card.textContent = '';
    var stay = hold.stay || {};
    var active = hold.active !== false && hold.status === 'held' && Date.parse(hold.holdUntil) > Date.now();
    var title = $('heldTitle');
    if (title) title.textContent = active ? 'Your booking is held' : hold.status === 'cancelled' ? 'This hold was cancelled' : 'This hold has run out';

    var refBlock = el('div', 'held-refblock');
    refBlock.appendChild(el('span', 'rv-kicker', 'Reference number'));
    var ref = el('div', 'held-ref', hold.reference || '');
    ref.id = 'heldRef';
    refBlock.appendChild(ref);
    card.appendChild(refBlock);

    var meta = document.createElement('dl');
    meta.className = 'hold-meta';
    function row(k, v, id) { var dt = el('dt', null, k); var dd = el('dd', null, v); if (id) dd.id = id; meta.appendChild(dt); meta.appendChild(dd); }
    row('Email', hold.email || '');
    var nights = stay.nights || 0;
    if (stay.from && stay.to) row('Stay', C.fmtDate(stay.from) + ' \u2014 ' + C.fmtDate(stay.to) + ' \u00b7 ' + nights + (nights === 1 ? ' night' : ' nights'));
    row('Hold', hold.hours + ' hours \u00b7 ' + (hold.price > 0 ? exVat(hold.price) : 'free') + (hold.provider ? ' \u00b7 ' + providerNameOf(hold.provider) : ''));
    var feeText = feeLine(hold);
    if (feeText) row('Fee', feeText, 'heldFee');
    card.appendChild(meta);
    var feeEl = $('heldFee');
    if (feeEl && hold.feePaid) feeEl.className = 'held-fee-paid';
    /* A hosted-page payment under way (Dave, 2026-09-02): say so, keep the
       page open, and ask the engine every few seconds until it is done. */
    if (pending && pending.paymentId && !hold.feePaid && active) {
      var wait = el('p', 'hold-paywait'); wait.id = 'heldPayWait';
      wait.appendChild(document.createTextNode('Waiting for your payment on ' + (pending.gateway ? pending.gateway.name : 'the payment page') + '\u2026 '));
      if (pending.url) { var a = el('a', null, 'Open the payment page again'); a.href = pending.url; a.target = '_blank'; a.rel = 'noopener'; wait.appendChild(a); }
      card.appendChild(wait);
      var tries = 0;
      payPoll = setInterval(function () {
        if (++tries > 450) { stopPayPoll(); return; }
        postJson(PAY_API + '/status', { paymentId: pending.paymentId }).then(function (j) {
          if (!j || j.status === 'pending') return;
          stopPayPoll();
          if (j.status !== 'paid') { wait.textContent = 'The payment did not go through (' + (j.error || j.status) + '). You can retrieve this hold with its reference number and pay again.'; return; }
          postJson(HOLD_API + '/paid', { id: hold.holdId, reference: hold.reference, paymentId: pending.paymentId }).then(function (k) {
            forgetPayment();
            if (ctx && ctx.track) ctx.track('hold_fee_paid', { reference: hold.reference, provider: pending.gateway ? pending.gateway.key : null, amount: j.amount });
            showHeld((k && k.ok === true) ? k : hold, ctx, null);
          }).catch(function () { /* next poll tick is gone; the retrieve flow shows it paid */ });
        }).catch(function () { /* try again on the next tick */ });
      }, 4000);
    }

    var list = el('div', 'held-suites');
    (stay.suites || []).forEach(function (s) {
      var r = el('div', 'rv-row');
      r.appendChild(el('span', null, (s.name || 'Suite') + ((s.qty || 1) > 1 ? ' \u00d7 ' + s.qty : '') + (s.plan ? ' \u00b7 ' + s.plan : '')));
      r.appendChild(el('span', null, s.total != null ? C.moneyC(s.total, stay.currency) : 'on request'));
      list.appendChild(r);
      if (s.refund) list.appendChild(el('div', 'hold-refund', s.refund));
    });
    card.appendChild(list);
    if (stay.total != null) {
      var grand = el('div', 'rv-grand');
      grand.appendChild(el('span', null, 'Grand total'));
      grand.appendChild(el('strong', null, C.moneyC(stay.total, stay.currency)));
      card.appendChild(grand);
    }
    /* The held-rate check (Dave, 2026-09-03): opening a held booking asks
       the rate engine again, fresh, for the same stay; a suite whose rate
       went UP while the hold stood is said here, under the grand total,
       with the reassurance that the held rate stands until the clock runs
       out. A rate that stayed or fell says nothing. */
    var rc = hold.rateCheck;
    if (active && rc && rc.increased && rc.increased.length) {
      var notes = el('div', 'held-ratenote'); notes.id = 'heldRateNote';
      rc.increased.forEach(function (s) {
        var amt = C.moneyC(s.delta, rc.currency || stay.currency);
        notes.appendChild(el('p', null, 'While your booking was held, the rate for ' + (s.name || 'this suite') + ((s.qty || 1) > 1 ? ' (each)' : '') + ' changed by ' + amt + ', but your rate is locked in until ' + localUntil(hold.holdUntil) + '.'));
      });
      card.appendChild(notes);
    }

    var clock = el('div', 'held-clock');
    /* When the hold was taken, in the guest's own time (Dave, 2026-09-02). */
    if (hold.chosenAt) {
      var taken = el('div', 'held-taken', 'Hold taken on ' + localUntil(hold.chosenAt) + ' (your local time)');
      taken.id = 'heldTaken';
      clock.appendChild(taken);
    }
    clock.appendChild(el('span', 'rv-kicker', active ? 'Time left on this hold' : 'This hold'));
    var timer = el('div', 'held-timer'); timer.id = 'heldTimer';
    clock.appendChild(timer);
    var until = el('div', 'held-until'); until.id = 'heldUntil';
    var untilMs = Date.parse(hold.holdUntil);
    until.textContent = (active ? 'Runs out on ' : (hold.status === 'cancelled' ? 'Cancelled; it would have run out on ' : 'Ran out on ')) + localUntil(hold.holdUntil) + ' (your local time)';
    clock.appendChild(until);
    card.appendChild(clock);

    var msg = el('p', 'held-msg', 'When you come back to this page, click \u201cRetrieve booking\u201d under the Check availability button and enter your reference number ' + (hold.reference || '') + '.');
    msg.id = 'heldMsg';
    card.appendChild(msg);

    var actions = el('div', 'held-actions');
    var cancel = el('button', 'cta cta-ghost'); cancel.type = 'button'; cancel.id = 'heldCancel';
    cancel.appendChild(el('span', 'cta-label', active ? 'Cancel the hold and search again' : 'Search again'));
    var reserve = el('button', 'cta'); reserve.type = 'button'; reserve.id = 'heldReserve';
    reserve.appendChild(el('span', 'cta-label', 'Make the reservation'));
    reserve.hidden = !active;
    actions.appendChild(cancel); actions.appendChild(reserve);
    card.appendChild(actions);
    var note = el('p', 'hold-choice-note'); note.id = 'heldNote'; note.hidden = true;
    card.appendChild(note);

    function expire() {
      timer.textContent = '00:00:00';
      until.textContent = 'This hold ran out on ' + localUntil(hold.holdUntil) + ' (your local time)';
      reserve.hidden = true;
      cancel.querySelector('.cta-label').textContent = 'Search again';
      if (title) title.textContent = 'This hold has run out';
      stopHeldTimer();
    }
    if (active) {
      timer.textContent = countdown(untilMs);
      heldTimer = setInterval(function () {
        if (untilMs - Date.now() <= 0) { expire(); return; }
        timer.textContent = countdown(untilMs);
      }, 1000);
    } else {
      timer.textContent = '00:00:00';
    }

    cancel.onclick = function () {
      if (!active) { finishCancel(); return; }
      cancel.disabled = true;
      postJson(HOLD_API + '/cancel', { reference: hold.reference })
        .then(function (j) {
          cancel.disabled = false;
          if (!j || j.ok !== true) { note.className = 'hold-choice-note hold-choice-err'; note.textContent = (j && j.message) || 'The hold could not be cancelled just now \u2014 please try again.'; note.hidden = false; return; }
          if (ctx && ctx.track) ctx.track('hold_cancelled', { reference: hold.reference });
          finishCancel();
        })
        .catch(function () { cancel.disabled = false; note.className = 'hold-choice-note hold-choice-err'; note.textContent = 'We could not reach the lodge \u2014 check your connection and try again.'; note.hidden = false; });
    };
    function finishCancel() {
      stopHeldTimer(); stopPayPoll(); forgetPayment();
      var ab = $('agreeBox');
      if (ab) { ab.disabled = false; ab.checked = false; }
      host.hidden = true;
      var h = $('hold'); if (h) h.hidden = true;
      close();
      if (ctx && ctx.onCancelHold) ctx.onCancelHold();
    }
    reserve.onclick = function () {
      if (ctx && ctx.track) ctx.track('reservation_started', { reference: hold.reference });
      /* Make the reservation from the held card (Dave, 2026-09-03): the
         checkout rides the hold's nights and its locked-in rate. */
      startCheckout(ctx.totals || null, hold);
    };

    host.hidden = false;
    try { host.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* fine */ }
  }
  function providerNameOf(key) {
    for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].key === key) return PROVIDERS[i].name;
    return key;
  }

  /* ---- Retrieve booking (Dave, 2026-09-02): the reference number from the
     hold email rebuilds the page from the hold's snapshot. ---- */
  function openRetrieve(prefill) {
    var modal = $('retrieveModal'), input = $('retrieveRef'), go = $('retrieveGo'), note = $('retrieveNote');
    if (!modal) return;
    input.value = typeof prefill === 'string' ? prefill : ''; note.hidden = true; note.textContent = ''; go.disabled = false;
    modal.hidden = false;
    document.body.classList.add('hold-open');
    setTimeout(function () { try { input.focus(); } catch (e) { /* fine */ } }, 50);
    function closeRetrieve() { modal.hidden = true; document.body.classList.remove('hold-open'); }
    go.onclick = function () {
      var ref = String(input.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (ref.length < 6) { note.textContent = 'Type the reference number from your hold email.'; note.hidden = false; input.focus(); return; }
      go.disabled = true; note.hidden = true;
      postJson(HOLD_API + '/retrieve', { reference: ref })
        .then(function (j) {
          go.disabled = false;
          if (!j || j.ok !== true || !j.hold) { note.textContent = (j && j.message) || 'No hold with that reference number was found.'; note.hidden = false; return; }
          if (!window.BKBooking || !window.BKBooking.restoreHold(j.hold)) {
            note.textContent = 'That hold was found but cannot be rebuilt here \u2014 please contact the lodge with reference ' + ref + '.';
            note.hidden = false;
            return;
          }
          closeRetrieve();
          if (window.BKCore && window.BKCore.track) window.BKCore.track('hold_retrieved', { reference: ref });
        })
        .catch(function () { go.disabled = false; note.textContent = 'We could not reach the lodge \u2014 check your connection and try again.'; note.hidden = false; });
    };
    input.onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); go.click(); } };
    var x = $('retrieveClose'); if (x) x.onclick = closeRetrieve;
    modal.onclick = function (ev) { if (ev.target === modal) closeRetrieve(); };
  }
  document.addEventListener('DOMContentLoaded', function () {
    var link = $('retrieveLink');
    if (link) link.addEventListener('click', function () { openRetrieve(); });
    /* Back from a gateway's page (Dave, 2026-09-02): ?pay=<engine payment
       id>&r=success|cancel|failure. The engine is asked how it went; a paid
       one is recorded on the hold (Lodge Ops checks with the engine before
       it believes it) and the hold is brought back on screen through
       Retrieve booking with its reference filled in. */
    var m = /[?&]pay=([0-9a-f-]{36})/i.exec(location.search);
    if (!m) return;
    var paymentId = m[1], back = /[?&]r=([a-z]+)/.exec(location.search), remembered = readPayment();
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* fine */ }
    var ref = remembered && remembered.paymentId === paymentId ? remembered.reference : null;
    if (remembered && remembered.kind === 'checkout' && remembered.paymentId === paymentId) {
      /* A booking's hosted payment (Dave, 2026-09-03): the engine's word,
         then Lodge Ops records it and the congratulations open. */
      if (back && back[1] !== 'success') return;
      postJson(PAY_API + '/status', { paymentId: paymentId }).then(function (j) {
        if (!j || j.status !== 'paid') return;
        return postJson(CHECKOUT_API + '/paid', { id: remembered.checkoutId, paymentId: paymentId }).then(function (k) {
          forgetPayment();
          if (k && k.ok === true && k.checkout) { openSuccess(k.checkout); }
        });
      }).catch(function () { /* the guest can retrieve later */ });
      return;
    }
    if (back && back[1] !== 'success') { if (ref) openRetrieve(ref); return; }
    postJson(PAY_API + '/status', { paymentId: paymentId }).then(function (j) {
      if (j && j.status === 'paid') {
        var body = { paymentId: paymentId };
        if (remembered && remembered.paymentId === paymentId) { body.id = remembered.holdId; body.reference = remembered.reference; }
        else if (j.reference) { body.reference = j.reference; }
        return postJson(HOLD_API + '/paid', body).then(function () { forgetPayment(); openRetrieve(ref || j.reference || ''); });
      }
      if (ref) openRetrieve(ref);
    }).catch(function () { if (ref) openRetrieve(ref); });
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      ['retrieveModal', 'termsModal', 'successModal'].forEach(function (id) { var m = $(id); if (m && !m.hidden) { m.hidden = true; document.body.classList.remove('hold-open'); if (id === 'successModal') stopFireworks(); } });
    }
  });

  /* ================================================================
     THE CHECKOUT (Dave, 2026-09-03): "Make the reservation".
     Booking summary — the nights and rates held on the rate engine for the
     configured minutes (a countdown, pinned top-right when scrolled off),
     the email for the receipt, the terms and conditions (a link opens them
     from Lodge Ops' Booking Engine page), Continue to payment.
     Payment — the amount due now (a deposit when check-in is further away
     than the full-payment window, else the whole stay), the same gateway
     squares as the hold fee, the red Simulate successful payment button
     when Lodge Ops allows it, the card fields or the hosted page, then the
     congratulations over fireworks. Lodge Ops decides every figure; this
     page only shows them.
     ================================================================ */
  var CHECKOUT_API = window.BK_CHECKOUT_API || '/api/web/booking-checkout';
  var checkoutTimer = null, pinObserver = null;
  var checkoutState = { current: null, ctx: null };
  function stopCheckoutTimer() {
    if (checkoutTimer) { clearInterval(checkoutTimer); checkoutTimer = null; }
    if (pinObserver) { try { pinObserver.disconnect(); } catch (e) { /* fine */ } pinObserver = null; }
    var pin = $('pinnedTimer'); if (pin) pin.hidden = true;
  }
  function mmss(untilMs) {
    var left = Math.max(0, Math.floor((untilMs - Date.now()) / 1000));
    var m = Math.floor(left / 60), sec = left % 60;
    return pad2(m) + ':' + pad2(sec);
  }
  function termsParagraphs(text) {
    var host = $('termsBody');
    if (!host) return;
    host.textContent = '';
    var t = String(text || '').trim();
    if (!t) { host.appendChild(el('p', 'terms-empty', 'No terms and conditions have been published yet — the lodge is adding them.')); return; }
    t.split(/\n\s*\n/).forEach(function (para) {
      var p = document.createElement('p');
      para.split(/\n/).forEach(function (line, i) { if (i) p.appendChild(document.createElement('br')); p.appendChild(document.createTextNode(line)); });
      host.appendChild(p);
    });
  }
  function openTerms(config) {
    var m = $('termsModal'); if (!m) return;
    termsParagraphs(config && config.terms);
    m.hidden = false; document.body.classList.add('hold-open');
    function closeTerms() { m.hidden = true; document.body.classList.remove('hold-open'); }
    var x = $('termsClose'); if (x) x.onclick = closeTerms;
    m.onclick = function (ev) { if (ev.target === m) closeTerms(); };
  }

  /* Scroll a section to the top of the window ONCE ITS CONTENT IS THERE.
     A section built after a fetch starts as a one-line placeholder near
     the foot of the page: a scroll made then stops where the page ends,
     and when the card fills in and the page grows nobody scrolls again
     (Dave, 2026-09-04: "the scroll to booking summary isn't scrolling far
     enough"). So every section scrolls when it is built, and again on the
     frame after layout in case fonts or images move it. */
  function scrollToSection(host) {
    if (!host) return;
    function go() { try { host.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* fine */ } }
    go();
    if (window.requestAnimationFrame) requestAnimationFrame(function () { requestAnimationFrame(go); });
  }
  /* The same, only when the section's top is still below the top of the
     window - for content that lands later (the gateway squares), so a
     guest who has already scrolled on is not yanked back. */
  function nudgeToSection(host) {
    if (!host) return;
    try { if (host.getBoundingClientRect().top > 8) scrollToSection(host); } catch (e) { /* fine */ }
  }
  /* Bring a gateway panel fully onto the screen once it is rendered
     (Dave, 2026-09-04: "when you click the gateway its off the screen").
     The panel lands BELOW the squares the guest just clicked, so the
     bottom of it is what is out of view: scroll so the whole panel shows
     (its top, when it is taller than the window). Nothing moves when it
     is already in view. Runs on the frame after layout, and again when
     Stripe's card fields mount and the panel grows. */
  function revealPanel(panel) {
    if (!panel) return;
    function go() {
      try {
        if (panel.hidden || !panel.isConnected) return;
        var r = panel.getBoundingClientRect();
        var h = window.innerHeight || document.documentElement.clientHeight || 0;
        if (r.top >= 0 && r.bottom <= h) return;
        panel.scrollIntoView({ behavior: 'smooth', block: r.height > h - 40 ? 'start' : 'end' });
      } catch (e) { /* fine */ }
    }
    if (window.requestAnimationFrame) requestAnimationFrame(function () { requestAnimationFrame(go); }); else go();
    /* And once more after the panel has settled - the secure card fields
       (or the note that they could not load) arrive a moment later and
       make it taller. go() is a no-op when the panel is already in view. */
    setTimeout(go, 450);
    setTimeout(go, 1100);
  }

  /* Start: the section, the call to Lodge Ops (which takes the nights on
     the engine), the card. fromHold = the hold view when the guest came
     from the held card. */
  function startCheckout(totals, fromHold) {
    var ctx = state.ctx; if (!ctx) return;
    var host = $('bookingSummary'), card = $('bookingSummaryCard');
    if (!host || !card) return;
    checkoutState.ctx = ctx;
    var pay = $('payment'); if (pay) pay.hidden = true;
    stopCheckoutTimer();
    card.textContent = '';
    card.appendChild(el('p', 'hold-choice-note', 'Holding your suites and rates on the booking engine…'));
    host.hidden = false;
    scrollToSection(host);
    var stay = fromHold && fromHold.stay ? fromHold.stay : staySnapshot(ctx, totals || ctx.totals);
    if (ctx.track) ctx.track('checkout_hold_requested', { fromHold: fromHold ? fromHold.reference : null, total: stay && stay.total != null ? Number(stay.total).toFixed(2) : null });
    postJson(CHECKOUT_API + '/start', {
      stay: stay,
      snapshot: ctx.snapshot ? ctx.snapshot() : null,
      email: fromHold && fromHold.email ? fromHold.email : null,
      holdReference: fromHold ? fromHold.reference : null
    }).then(function (j) {
      if (!j || j.ok !== true || !j.checkout) {
        card.textContent = '';
        var err = el('p', 'hold-choice-note hold-choice-err', (j && j.message) || 'The booking could not be started just now — please try again in a moment.');
        card.appendChild(err);
        var back = el('button', 'cta cta-ghost'); back.type = 'button'; back.appendChild(el('span', 'cta-label', 'Search again'));
        back.onclick = function () { host.hidden = true; if (ctx.onCancelHold) ctx.onCancelHold(); };
        card.appendChild(back);
        if (ctx.track) ctx.track('checkout_hold_failed', { message: j && j.message });
        return;
      }
      if (ctx.track) ctx.track('checkout_held', { reference: j.checkout.reference, minutes: j.checkout.holdMinutes, amountDue: j.checkout.amountDue, kind: j.checkout.amountKind });
      showCheckout(j.checkout, ctx);
    }).catch(function () {
      card.textContent = '';
      card.appendChild(el('p', 'hold-choice-note hold-choice-err', 'We could not reach the lodge — check your connection and try again.'));
    });
  }

  /* The booking summary card. */
  function showCheckout(co, ctx) {
    var host = $('bookingSummary'), card = $('bookingSummaryCard'), title = $('bookingSummaryTitle');
    checkoutState.current = co;
    card.textContent = '';
    var stay = co.stay || {};
    var untilMs = Date.parse(co.holdUntil);
    var active = co.active !== false && co.status !== 'expired' && co.status !== 'cancelled' && untilMs > Date.now();
    if (title) title.textContent = co.paid ? 'Your booking is paid' : active ? 'Your booking is being held for you' : 'The time to complete this booking has run out';

    var refBlock = el('div', 'held-refblock');
    refBlock.appendChild(el('span', 'rv-kicker', 'Booking reference'));
    var ref = el('div', 'bs-ref', co.reference || ''); ref.id = 'bsRef';
    refBlock.appendChild(ref);
    card.appendChild(refBlock);

    var meta = document.createElement('dl'); meta.className = 'bs-meta';
    function row(k, v, id) { var dt = el('dt', null, k); var dd = el('dd', null, v); if (id) dd.id = id; meta.appendChild(dt); meta.appendChild(dd); }
    var nights = stay.nights || 0;
    if (stay.from && stay.to) row('Stay', C.fmtDate(stay.from) + ' — ' + C.fmtDate(stay.to) + ' · ' + nights + (nights === 1 ? ' night' : ' nights'), 'bsStay');
    if (ctx && ctx.party) row('Guests', partyLabel(ctx.party));
    if (co.holdReference) row('From your hold', co.holdReference);
    card.appendChild(meta);

    var list = el('div', 'held-suites bs-suites');
    (stay.suites || []).forEach(function (s) {
      var r = el('div', 'rv-row');
      r.appendChild(el('span', null, (s.name || 'Suite') + ((s.qty || 1) > 1 ? ' × ' + s.qty : '') + (s.plan ? ' · ' + s.plan : '')));
      r.appendChild(el('span', null, s.total != null ? C.moneyC(s.total * (s.qty || 1), co.currency) : 'on request'));
      list.appendChild(r);
      if (s.refund) list.appendChild(el('div', 'hold-refund', s.refund));
    });
    card.appendChild(list);
    if (co.total != null) {
      var grand = el('div', 'rv-grand');
      grand.appendChild(el('span', null, 'Grand total'));
      grand.appendChild(el('strong', null, C.moneyC(co.total, co.currency)));
      grand.id = 'bsGrand';
      card.appendChild(grand);
    }
    /* The deposit, under the total, when the stay is outside the
       full-payment window (Dave, 2026-09-04): the figure Lodge Ops worked
       out from the deposit rule - what the guest will be asked for next. */
    if (!co.paid && co.amountKind === 'deposit' && co.amountDue != null) {
      var dep = el('div', 'pay-deposit bs-deposit'); dep.id = 'bsDeposit';
      var depLine = el('p');
      depLine.appendChild(document.createTextNode('Deposit amount to secure your booking '));
      depLine.appendChild(el('strong', null, C.moneyC(co.amountDue, co.currency)));
      dep.appendChild(depLine);
      card.appendChild(dep);
    }

    /* The rates held: the message and the countdown (Dave: "these rates
       are being held for the {booking hold time} min timer counting down"). */
    var held = el('div', 'bs-held'); held.id = 'bsHeld';
    var msg = el('p', 'bs-held-msg'); msg.id = 'bsHeldMsg';
    var timer = el('div', 'bs-held-timer'); timer.id = 'bsTimer';
    held.appendChild(msg); held.appendChild(timer);
    card.appendChild(held);
    var pin = $('pinnedTimer'), pinVal = $('pinnedTimerValue');
    function paintTimer() {
      var v = mmss(untilMs);
      timer.textContent = v;
      if (pinVal) pinVal.textContent = v;
    }
    function expire() {
      stopCheckoutTimer();
      held.classList.add('out');
      if (pin) pin.classList.add('out');
      msg.textContent = 'The time to complete this booking has run out — the suites have been released. Please search again to start afresh.';
      timer.textContent = '00:00';
      if (title) title.textContent = 'The time to complete this booking has run out';
      var btns = card.querySelectorAll('button.cta, input');
      btns.forEach(function (b) { b.disabled = true; });
      var pay = $('payment'); if (pay) pay.hidden = true;
      if (ctx && ctx.track) ctx.track('checkout_expired', { reference: co.reference });
    }
    if (co.paid) {
      msg.textContent = 'Paid — thank you. The reservations team will be in touch with your confirmation.';
      timer.textContent = '✓';
    } else if (active) {
      msg.textContent = 'These rates and your suites are being held for you for ' + co.holdMinutes + ' minutes while you complete your booking.';
      paintTimer();
      checkoutTimer = setInterval(function () { if (untilMs - Date.now() <= 0) { expire(); return; } paintTimer(); }, 1000);
      /* Pinned when the card's own clock scrolls out of view. */
      if (pin && 'IntersectionObserver' in window) {
        pin.classList.remove('out');
        pinObserver = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) { pin.hidden = en.isIntersecting || !checkoutTimer; });
        }, { threshold: 0 });
        pinObserver.observe(held);
      }
    } else {
      held.classList.add('out');
      msg.textContent = 'The time to complete this booking has run out — please search again to start afresh.';
      timer.textContent = '00:00';
    }

    if (co.paid) { host.hidden = false; return; }

    /* Who is booking (Dave, 2026-09-04): the booker's name, phone and
       email, their postal address, and the other guests in the party (the
       guest count less the booker) — a name each, phone and country if
       they like. Starred fields must be given before Continue wakes. */
    var emailWrap = el('div', 'bs-email bs-guest'); emailWrap.id = 'bsGuest';
    var countries = countryList();
    if (countries) emailWrap.appendChild(countries);
    function field(host, label, id, type, mode, auto, placeholder, value, required, span) {
      var w = el('div', 'bs-field' + (span ? ' bs-span2' : ''));
      var l = el('label', null, label); l.setAttribute('for', id);
      if (required) l.appendChild(el('span', 'bs-req', ' *'));
      var i = document.createElement('input');
      i.id = id; i.type = type; i.className = 'hold-input'; if (mode) i.inputMode = mode;
      if (auto) i.setAttribute('autocomplete', auto);
      if (placeholder) i.placeholder = placeholder;
      i.value = value || '';
      if (required) i.required = true;
      if (/Country/.test(label) && countries) i.setAttribute('list', 'bsCountries');
      w.appendChild(l); w.appendChild(i); host.appendChild(w);
      return i;
    }
    emailWrap.appendChild(el('span', 'rv-kicker bs-sub', 'Your details'));
    var grid1 = el('div', 'bs-grid'); emailWrap.appendChild(grid1);
    var nameI = field(grid1, 'Your full name', 'bsName', 'text', null, 'name', 'First and last name', co.guestName, true);
    var phoneI = field(grid1, 'Phone number', 'bsPhone', 'tel', 'tel', 'tel', '+27 82 123 4567', co.phone, true);
    var emailI = field(grid1, 'E-mail address', 'bsEmail', 'email', 'email', 'email', 'you@example.com', co.email, true, true);
    var addr = co.address || {};
    emailWrap.appendChild(el('span', 'rv-kicker bs-sub', 'Postal address'));
    var grid2 = el('div', 'bs-grid'); emailWrap.appendChild(grid2);
    var streetI = field(grid2, 'House number and Road/Street', 'bsStreet', 'text', null, 'address-line1', '', addr.street, false, true);
    var aptI = field(grid2, 'Apartment number', 'bsApartment', 'text', null, 'address-line2', '', addr.apartment, false);
    var cityI = field(grid2, 'City', 'bsCity', 'text', null, 'address-level2', '', addr.city, false);
    var postI = field(grid2, 'Post Code', 'bsPostCode', 'text', null, 'postal-code', '', addr.postCode, true);
    var stateI = field(grid2, 'State', 'bsState', 'text', null, 'address-level1', 'Province / state', addr.state, true);
    var countryI = field(grid2, 'Country', 'bsCountry', 'text', null, 'country-name', '', addr.country, true);
    /* The other guests: the party as searched, less the booker. */
    var party = (ctx && ctx.party) || {};
    var others = Math.max(0, (Number(party.adults) || 0) + (Number(party.children) || 0) - 1);
    var priorGuests = Array.isArray(co.guests) ? co.guests : [];
    var guestRows = [];
    if (others > 0) {
      emailWrap.appendChild(el('span', 'rv-kicker bs-sub', others === 1 ? 'Your other guest' : 'Your other guests'));
      for (var gi = 0; gi < others; gi++) {
        var gWrap = el('div', 'bs-guest-row'); gWrap.setAttribute('data-guest', String(gi + 2));
        gWrap.appendChild(el('span', 'bs-guest-n', 'Guest ' + (gi + 2)));
        var gGrid = el('div', 'bs-grid bs-grid3'); gWrap.appendChild(gGrid);
        var prior = priorGuests[gi] || {};
        guestRows.push({
          name: field(gGrid, 'Guest name', 'bsGuestName' + (gi + 2), 'text', null, 'off', 'First and last name', prior.name, true),
          phone: field(gGrid, 'Phone Number', 'bsGuestPhone' + (gi + 2), 'tel', 'tel', 'off', '', prior.phone, false),
          country: field(gGrid, 'Country', 'bsGuestCountry' + (gi + 2), 'text', null, 'off', '', prior.country, false)
        });
        emailWrap.appendChild(gWrap);
      }
    }
    emailWrap.appendChild(el('p', 'bs-reqnote', '* required'));
    card.appendChild(emailWrap);

    /* I agree to the terms and conditions — the link opens them. */
    var agreeWrap = el('div', 'bs-agree');
    var agreeLbl = el('label', 'agree');
    var agreeBox = document.createElement('input'); agreeBox.type = 'checkbox'; agreeBox.id = 'bsAgree';
    var agreeTxt = el('span', null, 'I agree to the ');
    var termsLink = el('a', null, 'terms and conditions'); termsLink.id = 'bsTermsLink'; termsLink.href = '#terms';
    termsLink.onclick = function (ev) { ev.preventDefault(); openTerms(ctx && ctx.config); if (ctx && ctx.track) ctx.track('terms_opened', { reference: co.reference }); };
    agreeTxt.appendChild(termsLink); agreeTxt.appendChild(document.createTextNode('.'));
    agreeLbl.appendChild(agreeBox); agreeLbl.appendChild(agreeTxt);
    agreeWrap.appendChild(agreeLbl);
    card.appendChild(agreeWrap);

    var actions = el('div', 'bs-actions');
    var cancel = el('button', 'cta cta-ghost'); cancel.type = 'button'; cancel.id = 'bsCancel';
    cancel.appendChild(el('span', 'cta-label', 'Cancel and search again'));
    var go = el('button', 'cta'); go.type = 'button'; go.id = 'bsContinue'; go.disabled = true; go.title = 'You must agree first';
    go.appendChild(el('span', 'cta-label', 'Continue to payment'));
    actions.appendChild(cancel); actions.appendChild(go);
    card.appendChild(actions);
    var note = el('p', 'hold-choice-note'); note.id = 'bsNote'; note.hidden = true;
    card.appendChild(note);

    function validPhone(v) { return /^\+?[\d\s().-]{6,40}$/.test(v) && (v.match(/\d/g) || []).length >= 6; }
    function missing() {
      if (nameI.value.trim().length < 2) return 'Enter your full name first';
      if (!validPhone(phoneI.value.trim())) return 'Enter your phone number first';
      if (!validEmail(emailI.value.trim())) return 'Enter your email address first';
      if (!postI.value.trim()) return 'Enter your post code first';
      if (!stateI.value.trim()) return 'Enter your state first';
      if (!countryI.value.trim()) return 'Enter your country first';
      for (var k = 0; k < guestRows.length; k++) {
        if (guestRows[k].name.value.trim().length < 2) return 'Enter the name of guest ' + (k + 2) + ' first';
        var gp = guestRows[k].phone.value.trim();
        if (gp && !validPhone(gp)) return 'Check the phone number of guest ' + (k + 2);
      }
      if (!agreeBox.checked) return 'You must agree first';
      return null;
    }
    function gate() {
      var why = missing();
      go.disabled = !!why;
      if (why) go.title = why; else go.removeAttribute('title');
    }
    agreeBox.onchange = function () { gate(); if (ctx && ctx.track) ctx.track(agreeBox.checked ? 'terms_agreed' : 'terms_unagreed', { reference: co.reference }); };
    [nameI, phoneI, emailI, streetI, aptI, cityI, postI, stateI, countryI].forEach(function (i) { i.oninput = gate; });
    guestRows.forEach(function (g) { g.name.oninput = gate; g.phone.oninput = gate; g.country.oninput = gate; });
    function detailsPayload() {
      return {
        id: co.id, email: emailI.value.trim(), name: nameI.value.trim(), phone: phoneI.value.trim(),
        address: { street: streetI.value.trim(), apartment: aptI.value.trim(), city: cityI.value.trim(), postCode: postI.value.trim(), state: stateI.value.trim(), country: countryI.value.trim() },
        guests: guestRows.map(function (g) { return { name: g.name.value.trim(), phone: g.phone.value.trim(), country: g.country.value.trim() }; })
      };
    }
    gate();

    cancel.onclick = function () {
      cancel.disabled = true;
      postJson(CHECKOUT_API + '/cancel', { id: co.id }).then(function () {
        stopCheckoutTimer();
        host.hidden = true;
        var pay = $('payment'); if (pay) pay.hidden = true;
        if (ctx && ctx.track) ctx.track('checkout_cancelled', { reference: co.reference });
        if (co.holdReference) { /* the hold stands; back to the held card */ var h = $('held'); if (h) { try { h.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* fine */ } } }
        else { close(); if (ctx && ctx.onCancelHold) ctx.onCancelHold(); }
      }).catch(function () { cancel.disabled = false; });
    };
    go.onclick = function () {
      if (go.disabled) return;
      go.disabled = true; note.hidden = true;
      postJson(CHECKOUT_API + '/continue', detailsPayload()).then(function (j) {
        if (!j || j.ok !== true || !j.checkout) {
          go.disabled = false;
          note.className = 'hold-choice-note hold-choice-err';
          note.textContent = (j && j.message) || 'That step could not be saved just now — please try again.';
          note.hidden = false;
          return;
        }
        checkoutState.current = j.checkout;
        agreeBox.disabled = true; emailWrap.querySelectorAll('input').forEach(function (i) { i.disabled = true; });
        if (ctx && ctx.track) ctx.track('checkout_continued', { reference: co.reference, amountDue: j.checkout.amountDue, kind: j.checkout.amountKind });
        showPayment(j.checkout, ctx, untilMs);
      }).catch(function () {
        go.disabled = false;
        note.className = 'hold-choice-note hold-choice-err';
        note.textContent = 'We could not reach the lodge — check your connection and try again.';
        note.hidden = false;
      });
    };
    host.hidden = false;
    /* The card is built now, so the page is tall enough to bring the
       section to the top - the placeholder scroll could not. */
    scrollToSection(host);
  }

  /* The payment section: the amount due, the deposit lines, the gateways. */
  function showPayment(co, ctx, untilMs) {
    var host = $('payment'), card = $('paymentCard');
    if (!host || !card) return;
    card.textContent = '';
    var stay = co.stay || {};
    var meta = document.createElement('dl'); meta.className = 'bs-meta';
    function row(k, v, id) { var dt = el('dt', null, k); var dd = el('dd', null, v); if (id) dd.id = id; meta.appendChild(dt); meta.appendChild(dd); }
    row('Booking', co.reference, 'payRef');
    row('Suites', (stay.suites || []).map(function (s) { return (s.name || 'Suite') + ((s.qty || 1) > 1 ? ' × ' + s.qty : ''); }).join(', '), 'paySuites');
    if (stay.from && stay.to) row('Check-in / out', C.fmtDate(stay.from) + ' — ' + C.fmtDate(stay.to) + ' · ' + (stay.nights || 0) + (stay.nights === 1 ? ' night' : ' nights'), 'payDates');
    row('Stay total', co.total != null ? C.moneyC(co.total, co.currency) : 'on request', 'payTotal');
    card.appendChild(meta);

    var amount = el('div', 'pay-amount'); amount.id = 'payAmount';
    amount.appendChild(el('span', null, co.amountKind === 'deposit' ? 'Deposit due now' : 'Amount due now'));
    amount.appendChild(el('strong', null, C.moneyC(co.amountDue, co.currency)));
    card.appendChild(amount);
    if (co.amountKind === 'deposit') {
      var dep = el('div', 'pay-deposit'); dep.id = 'payDeposit';
      var l1 = el('p'); l1.appendChild(document.createTextNode('Deposit amount required to secure your booking ')); l1.appendChild(el('strong', null, C.moneyC(co.amountDue, co.currency))); l1.appendChild(document.createTextNode('.'));
      var l2 = el('p'); l2.appendChild(document.createTextNode('Your balance payment will not be due until ')); l2.appendChild(el('strong', null, co.balanceDueOn ? C.fmtDate(co.balanceDueOn) : 'later')); l2.appendChild(document.createTextNode('.'));
      dep.appendChild(l1); dep.appendChild(l2);
      card.appendChild(dep);
    }

    /* The gateways — the same squares as the hold fee. */
    var providers = enabledProviders(ctx.config);
    var payWrap = el('div', 'hold-paywrap');
    payWrap.appendChild(el('p', 'kicker hold-kicker', 'Pay with'));
    var payWait = el('p', 'hold-choice-note hold-paywait-note', 'Checking payment options…'); payWait.id = 'payChecking';
    payWrap.appendChild(payWait);
    var payMissing = el('p', 'hold-choice-note hold-choice-err'); payMissing.id = 'payMissing'; payMissing.hidden = true;
    payWrap.appendChild(payMissing);
    var squares = el('div', 'hold-pay'); squares.hidden = true; squares.id = 'paySquares';
    var payer = null, modes = null, gwInfo = {}, stripeCard = null, stripeApi = null, done = false;
    var payButtons = providers.map(function (p) {
      var b = el('button', 'hold-payer'); b.type = 'button';
      b.setAttribute('data-provider', p.key); b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'Pay with ' + p.name); b.title = 'Pay with ' + p.name;
      b.appendChild(providerMark(p)); b.appendChild(el('span', 'hold-payer-name', p.name));
      b.addEventListener('click', function () { if (!done) togglePayer(p); });
      squares.appendChild(b);
      return b;
    });
    payWrap.appendChild(squares);
    var panel = el('div', 'hold-paypanel'); panel.id = 'payPanel'; panel.hidden = true;
    payWrap.appendChild(panel);
    var amountLabel = C.moneyC(co.amountDue, co.currency);
    var simulateOn = !!(ctx.config && ctx.config.payments && ctx.config.payments.simulate === true);
    /* SIMULATED PAYMENT as a gateway of its own (Dave, 2026-09-04: "make
       the simulate appear as a selectable gateway"), only while Lodge Ops
       allows simulated payments. A red square beside the real gateways;
       choosing it renders a card form already filled with test details
       and a red button that records the payment as paid without any
       processing. Never offered when the switch is off. */
    var SIMULATE = { key: 'simulate', name: 'Simulate' };
    var sim = null;
    if (simulateOn) {
      sim = el('button', 'hold-payer hold-payer-sim'); sim.type = 'button';
      sim.setAttribute('data-provider', 'simulate'); sim.setAttribute('aria-pressed', 'false');
      sim.setAttribute('aria-label', 'Simulate a successful payment'); sim.title = 'Simulate a successful payment — testing only';
      var simMark = el('span', 'hold-logo hold-logo-sim'); simMark.setAttribute('aria-hidden', 'true');
      simMark.appendChild(el('span', 'hold-logo-a', 'TEST'));
      sim.appendChild(simMark); sim.appendChild(el('span', 'hold-payer-name', 'Simulate'));
      sim.addEventListener('click', function () { if (!done) togglePayer(SIMULATE); });
      squares.appendChild(sim);
      payButtons.push(sim);
    }
    card.appendChild(payWrap);
    var note = el('p', 'hold-choice-note'); note.id = 'payNoteLine'; note.hidden = true;
    card.appendChild(note);

    getJson(PAY_API + '/gateways').then(function (j) {
      var list = (j && Array.isArray(j.gateways)) ? j.gateways : null;
      var found = {};
      if (list) list.forEach(function (g) { if (g && g.key) { found[g.key] = g.mode === 'element' ? 'element' : 'redirect'; gwInfo[g.key] = g; } });
      var anyEnabled = providers.some(function (p) { return !!found[p.key]; });
      if (list && anyEnabled) { modes = found; payButtons.forEach(function (b) { var k = b.getAttribute('data-provider'); b.hidden = k !== 'simulate' && !modes[k]; }); }
      else {
        modes = STATIC_MODES; payButtons.forEach(function (b) { b.hidden = false; });
        payMissing.textContent = list ? 'Our payment provider is still being set up. You can try one, or contact us to secure the booking.' : 'Our payment provider could not be reached just now. You can try one, or contact us to secure the booking.';
        payMissing.hidden = false;
      }
    }).catch(function () {
      modes = STATIC_MODES; payButtons.forEach(function (b) { b.hidden = false; });
      payMissing.textContent = 'Our payment provider could not be reached just now. You can try one, or contact us to secure the booking.'; payMissing.hidden = false;
    }).then(function () { payWait.hidden = true; squares.hidden = false; nudgeToSection(host); });

    function dropStripe() { if (stripeCard) { try { stripeCard.unmount(); } catch (e) { /* fine */ } stripeCard = null; } }
    function clearPayer() { payer = null; dropStripe(); payButtons.forEach(function (b) { b.classList.remove('on'); b.classList.remove('dim'); b.setAttribute('aria-pressed', 'false'); }); panel.textContent = ''; panel.hidden = true; }
    function togglePayer(p) {
      if (payer && payer.key === p.key) { clearPayer(); return; }
      payer = p;
      payButtons.forEach(function (b) { var mine = b.getAttribute('data-provider') === p.key; b.classList.toggle('on', mine); b.classList.toggle('dim', !mine); b.setAttribute('aria-pressed', mine ? 'true' : 'false'); });
      if (ctx.track) ctx.track('checkout_gateway_selected', { reference: co.reference, provider: p.key });
      renderPanel(p);
    }
    function busy(on) { payButtons.forEach(function (b) { b.disabled = on; }); panel.querySelectorAll('button, input').forEach(function (i) { i.disabled = on; }); }
    function fail(msgText) {
      busy(false);
      var target = panel.hidden ? note : (panel.querySelector('#payErr') || note);
      target.className = 'hold-choice-note hold-choice-err'; target.textContent = msgText; target.hidden = false;
    }
    /* A payment that FAILED (declined, refused, the gateway said no) is
       reported to Lodge Ops so Admin and Reservations hear of it (Dave,
       2026-09-04). A connection problem on this side is not a failed
       payment and is not reported. Fire and forget. */
    function reportFailure(gatewayKey, msgText) {
      if (/could not reach the lodge|check your connection/i.test(msgText || '')) return;
      if (ctx.track) ctx.track('checkout_payment_failed', { reference: co.reference, provider: gatewayKey, message: msgText });
      postJson(CHECKOUT_API + '/payment-failed', { id: co.id, gateway: gatewayKey, message: String(msgText || '').slice(0, 300) }).catch(function () { /* told the guest already */ });
    }
    function verifyPaid(paymentId) {
      var tries = 0;
      function verify() {
        return postJson(PAY_API + '/status', { paymentId: paymentId }).then(function (st) {
          if (st && st.status === 'paid') return st;
          if (++tries < 6) return new Promise(function (r) { setTimeout(r, 1500); }).then(verify);
          throw new Error((st && st.error) || 'The payment has not been confirmed yet — please try again in a moment.');
        });
      }
      return verify();
    }
    function recordPaid(paymentId) {
      return postJson(CHECKOUT_API + '/paid', { id: co.id, paymentId: paymentId }).then(function (k) {
        if (!k || k.ok !== true || !k.checkout) throw new Error((k && k.message) || 'The payment went through but could not be recorded — please contact the lodge with reference ' + co.reference + '.');
        return k.checkout;
      });
    }
    function celebrate(paidCo) {
      done = true; busy(true);
      checkoutState.current = paidCo;
      stopCheckoutTimer();
      if (ctx.track) ctx.track('checkout_paid', { reference: co.reference, amount: paidCo.paidAmount, gateway: paidCo.paymentGateway });
      forgetPayment();
      showCheckout(paidCo, ctx);
      var pay = $('payment'); if (pay) pay.hidden = true;
      openSuccess(paidCo);
    }
    function simulate() {
      busy(true); note.hidden = true;
      postJson(PAY_API + '/simulate', { reference: co.reference, email: co.email || undefined })
        .then(function (j) {
          if (!j || j.ok !== true || !j.paymentId) throw new Error((j && j.message) || 'The simulated payment was refused.');
          return recordPaid(j.paymentId);
        })
        .then(celebrate)
        .catch(function (e) { fail(e && e.message ? e.message : 'The simulated payment could not be made.'); });
    }
    function renderPanel(p) {
      panel.textContent = ''; panel.hidden = false;
      var mode = p.key === 'simulate' ? 'simulate' : ((modes || STATIC_MODES)[p.key] || 'redirect');
      dropStripe();
      panel.className = 'hold-paypanel ' + (mode === 'element' || mode === 'simulate' ? 'hold-cardform' : 'hold-redirect') + (mode === 'simulate' ? ' hold-simform' : '');
      panel.setAttribute('data-mode', mode);
      var err = el('p', 'hold-choice-note hold-choice-err'); err.id = 'payErr'; err.hidden = true;
      if (mode === 'simulate') {
        panel.appendChild(el('p', 'kicker hold-kicker', 'Card details · Simulated payment'));
        panel.appendChild(el('p', 'hold-sim-note', 'A test card is already filled in. Nothing is charged: the payment is recorded as paid without any processing.'));
        var sform = document.createElement('form'); sform.setAttribute('autocomplete', 'off'); sform.noValidate = true; sform.id = 'paySimForm';
        function simField(label, id, value, extra) {
          var l = el('label', null, label);
          var i = document.createElement('input'); i.id = id; i.name = id; i.type = 'text'; i.value = value; i.setAttribute('spellcheck', 'false');
          if (extra) Object.keys(extra).forEach(function (k) { i.setAttribute(k, extra[k]); });
          l.appendChild(i); return l;
        }
        sform.appendChild(simField('Name on card', 'pay-simName', 'Test Guest', { autocomplete: 'off' }));
        sform.appendChild(simField('Card number', 'pay-simCard', '4242 4242 4242 4242', { inputmode: 'numeric', autocomplete: 'off' }));
        var srow = el('div', 'hold-simrow');
        srow.appendChild(simField('Expiry', 'pay-simExp', '12/34', { inputmode: 'numeric', autocomplete: 'off' }));
        srow.appendChild(simField('CVC', 'pay-simCvc', '123', { inputmode: 'numeric', autocomplete: 'off' }));
        sform.appendChild(srow);
        var sgo = el('button', 'pay-simulate'); sgo.type = 'submit'; sgo.id = 'paySimulate';
        sgo.textContent = 'Simulate successful payment — ' + amountLabel;
        sform.appendChild(sgo); sform.appendChild(err); panel.appendChild(sform);
        sform.addEventListener('submit', function (ev) { ev.preventDefault(); simulate(); });
      } else if (mode === 'element') {
        panel.appendChild(el('p', 'kicker hold-kicker', 'Card details · ' + p.name));
        var form = document.createElement('form'); form.setAttribute('autocomplete', 'on'); form.noValidate = true;
        var nameL = el('label', null, 'Name on card');
        var nameI = document.createElement('input'); nameI.name = 'ccName'; nameI.id = 'pay-ccName'; nameI.type = 'text'; nameI.required = true;
        nameI.setAttribute('autocomplete', 'cc-name'); nameI.setAttribute('maxlength', '80'); nameI.setAttribute('placeholder', 'As printed on the card');
        nameL.appendChild(nameI); form.appendChild(nameL);
        var cardL = el('label', null, 'Card number, expiry and CVC');
        var mount = el('div', 'hold-stripe-el loading', 'Loading the secure card fields…'); mount.id = 'payCardElement';
        cardL.appendChild(mount); form.appendChild(cardL);
        var sec = secureRow();
        var by = el('span', 'hold-secure-item hold-secure-stripe', 'Card fields by Stripe — never seen by this site');
        sec.insertBefore(by, sec.firstChild); form.appendChild(sec);
        var go = el('button', 'cta hold-paynow'); go.type = 'submit'; go.id = 'payNow'; go.disabled = true;
        go.appendChild(el('span', 'cta-label', 'Pay ' + amountLabel));
        form.appendChild(go); form.appendChild(err); panel.appendChild(form);
        form.addEventListener('submit', function (ev) {
          ev.preventDefault(); err.hidden = true;
          if (!nameI.value.trim()) { err.textContent = 'Please enter the name on the card.'; err.hidden = false; return; }
          if (!stripeCard || !stripeApi) { err.textContent = 'The secure card fields are still loading — one moment.'; err.hidden = false; return; }
          busy(true);
          postJson(PAY_API + '/intent', { gateway: p.key, reference: co.reference, email: co.email || undefined })
            .then(function (j) {
              if (!j || j.ok !== true) throw new Error((j && j.message) || 'The payment could not be started — please try again or choose another payment method.');
              if (j.status === 'paid') return j.paymentId;
              if (!j.clientSecret) throw new Error('The payment could not be started — please try again.');
              return stripeApi.confirmCardPayment(j.clientSecret, { payment_method: { card: stripeCard, billing_details: { name: nameI.value.trim().slice(0, 80), email: co.email || undefined } } })
                .then(function (res) { if (res && res.error) throw new Error(res.error.message || 'The payment was not accepted — please check the card or try another.'); return j.paymentId; });
            })
            .then(function (paymentId) { return verifyPaid(paymentId).then(function () { return recordPaid(paymentId); }); })
            .then(celebrate)
            .catch(function (e) { var m = e && e.message && !/fetch|network/i.test(e.message) ? e.message : 'We could not reach the lodge — check your connection and try again.'; fail(m); reportFailure(p.key, m); });
        });
        var pk = (gwInfo[p.key] && gwInfo[p.key].publishableKey) || (ctx.config && ctx.config.stripePublishableKey) || '';
        loadStripe(pk, !!gwInfo[p.key]).then(function (stripe) {
          if (!payer || payer.key !== p.key || !mount.isConnected) return;
          stripeApi = stripe;
          stripeCard = stripe.elements().create('card', { hidePostalCode: true, style: { base: { color: '#f3ede1', fontFamily: 'inherit', fontSize: '16px', '::placeholder': { color: 'rgba(243, 237, 225, 0.4)' }, iconColor: '#d8b46a' }, invalid: { color: '#e8a58a', iconColor: '#e8a58a' } } });
          mount.textContent = ''; mount.classList.remove('loading');
          stripeCard.mount(mount);
          revealPanel(panel);
          stripeCard.on('ready', function () { revealPanel(panel); });
          stripeCard.on('change', function (e) { mount.classList.toggle('bad', !!(e && e.error)); if (e && e.error) { err.textContent = e.error.message; err.hidden = false; } else { err.hidden = true; } go.disabled = !(e && e.complete); });
        }).catch(function (e) {
          mount.textContent = 'The secure card fields could not be loaded: ' + ((e && e.message) || 'check your connection') + '. You can choose another payment method.';
          mount.classList.add('bad');
          revealPanel(panel);
        });
      } else {
        panel.appendChild(el('p', 'kicker hold-kicker', 'Pay with ' + p.name));
        panel.appendChild(el('p', null, 'You will be taken to ' + p.name + '’s secure page to pay ' + amountLabel + '. This page keeps your booking and updates itself once the payment is done.'));
        panel.appendChild(secureRow());
        var go2 = el('button', 'cta hold-paynow'); go2.type = 'button'; go2.id = 'payNow';
        go2.appendChild(el('span', 'cta-label', 'Click here to make payment'));
        go2.addEventListener('click', function () {
          busy(true);
          var w = null; try { w = window.open('', '_blank'); } catch (e) { w = null; }
          var here = location.href.split('#')[0].split('?')[0];
          postJson(PAY_API + '/checkout', { gateway: p.key, reference: co.reference, email: co.email || undefined, returnUrl: here, cancelUrl: here })
            .then(function (j) {
              if (!j || j.ok !== true || !j.url) { if (w) w.close(); throw new Error((j && j.message) || 'The payment page could not be opened — please try again or choose another payment method.'); }
              try { localStorage.setItem(PAY_KEY, JSON.stringify({ kind: 'checkout', checkoutId: co.id, reference: co.reference, paymentId: j.paymentId })); } catch (e) { /* fine */ }
              if (w) { try { w.location = j.url; } catch (e) { w = null; } }
              if (!w) { try { window.open(j.url, '_blank'); } catch (e) { location.href = j.url; } }
              var wait = el('p', 'hold-paywait', 'Waiting for your payment on ' + p.name + '…'); panel.appendChild(wait);
              var tries = 0;
              var poll = setInterval(function () {
                if (++tries > 450 || done) { clearInterval(poll); return; }
                postJson(PAY_API + '/status', { paymentId: j.paymentId }).then(function (st) {
                  if (!st || st.status === 'pending') return;
                  clearInterval(poll);
                  if (st.status !== 'paid') { var m2 = 'The payment did not go through (' + (st.error || st.status) + '). You can try again.'; fail(m2); reportFailure(p.key, m2); return; }
                  recordPaid(j.paymentId).then(celebrate).catch(function (e) { fail(e.message); });
                }).catch(function () { /* next tick */ });
              }, 4000);
            })
            .catch(function (e) { fail(e && e.message ? e.message : 'We could not reach the lodge — check your connection and try again.'); });
        });
        panel.appendChild(go2); panel.appendChild(err);
      }
      revealPanel(panel);
    }
    host.hidden = false;
    scrollToSection(host);
  }

  /* Congratulations, over ten seconds of fireworks. */
  var fireworksRaf = null, fireworksStop = null;
  function stopFireworks() { if (fireworksRaf) { cancelAnimationFrame(fireworksRaf); fireworksRaf = null; } if (fireworksStop) { clearTimeout(fireworksStop); fireworksStop = null; } }
  function runFireworks(canvas, ms) {
    var ctx2 = canvas.getContext('2d'); if (!ctx2) return;
    var W = canvas.width = canvas.clientWidth || window.innerWidth, H = canvas.height = canvas.clientHeight || window.innerHeight;
    var parts = [], rockets = [], t0 = Date.now(), last = t0;
    var colours = ['#d8b46a', '#f3ede1', '#e8a58a', '#7fd1b9', '#9ec5ff', '#f6c1ff'];
    function launch() { rockets.push({ x: W * (0.15 + Math.random() * 0.7), y: H, vx: (Math.random() - 0.5) * 1.5, vy: -(H * 0.012 + Math.random() * H * 0.006), c: colours[Math.floor(Math.random() * colours.length)], burstAt: H * (0.25 + Math.random() * 0.35) }); }
    function burst(r) { var n = 60 + Math.floor(Math.random() * 40); for (var i = 0; i < n; i++) { var a = (Math.PI * 2 * i) / n, sp = 2 + Math.random() * 4; parts.push({ x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, c: r.c }); } }
    function frame() {
      var now = Date.now(), dt = Math.min(40, now - last) / 16; last = now;
      ctx2.fillStyle = 'rgba(8, 10, 14, 0.22)'; ctx2.fillRect(0, 0, W, H);
      if (Math.random() < 0.06 && now - t0 < ms - 1500) launch();
      rockets = rockets.filter(function (r) { r.x += r.vx * dt; r.y += r.vy * dt; r.vy += 0.12 * dt; ctx2.fillStyle = r.c; ctx2.beginPath(); ctx2.arc(r.x, r.y, 2.2, 0, Math.PI * 2); ctx2.fill(); if (r.y <= r.burstAt || r.vy >= 0) { burst(r); return false; } return true; });
      parts = parts.filter(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.05 * dt; p.vx *= 0.985; p.vy *= 0.985; p.life -= 0.012 * dt; if (p.life <= 0) return false; ctx2.globalAlpha = Math.max(0, p.life); ctx2.fillStyle = p.c; ctx2.beginPath(); ctx2.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx2.fill(); ctx2.globalAlpha = 1; return true; });
      if (now - t0 < ms || parts.length || rockets.length) fireworksRaf = requestAnimationFrame(frame); else { fireworksRaf = null; ctx2.clearRect(0, 0, W, H); }
    }
    ctx2.clearRect(0, 0, W, H);
    for (var i = 0; i < 3; i++) launch();
    fireworksRaf = requestAnimationFrame(frame);
    fireworksStop = setTimeout(function () { /* the loop winds down by itself once ms is up */ }, ms);
  }
  function openSuccess(co) {
    var m = $('successModal'); if (!m) return;
    /* Paid: the search, Your stay, the hold sections and the payment are
       over (Dave, 2026-09-04: "remove the sections Your Hold, Your Stay,
       Available Suites"). The paid Booking summary is what remains. */
    ['results', 'review', 'hold', 'held', 'payment'].forEach(function (id) { var h = $(id); if (h) h.hidden = true; });
    stopHeldTimer(); stopCheckoutTimer();
    var pin = $('pinnedTimer'); if (pin) pin.hidden = true;
    state.open = false;
    var ref = $('successRef'); if (ref) ref.textContent = 'Booking reference ' + (co.reference || '') + ' · ' + C.moneyC(co.paidAmount != null ? co.paidAmount : co.amountDue, co.paidCurrency || co.currency) + ' received';
    m.hidden = false; document.body.classList.add('hold-open');
    var canvas = $('fireworks');
    var reduce = false; try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* fine */ }
    if (canvas && !reduce) runFireworks(canvas, 10000);
    function closeSuccess() { stopFireworks(); m.hidden = true; document.body.classList.remove('hold-open'); }
    var x = $('successClose'); if (x) x.onclick = closeSuccess;
    m.onclick = function (ev) { if (ev.target === m) closeSuccess(); };
  }

  /* Open the summary as a section below the results (the results stay;
     the page scrolls down to it). ctx: { picks, from, to, nights, party, lodge, config,
     photosFor, art, buildBreakdown, extrasLabel, inclLabel, onBack, onPay,
     track }. */
  function open(ctx) {
    var host = $('review');
    if (!host || !ctx.picks || !ctx.picks.length) return null;
    state.ctx = ctx;
    var prevHold = $('hold'); if (prevHold) prevHold.hidden = true; // a fresh summary retires an earlier hold section
    var prevHeld = $('held'); if (prevHeld) prevHeld.hidden = true; stopHeldTimer();
    var head = $('reviewHead'), meta = $('reviewMeta');
    var suites = ctx.picks.reduce(function (n, p) { return n + (p.qty || 1); }, 0);
    if (head) head.textContent = C.fmtDate(ctx.from) + ' — ' + C.fmtDate(ctx.to);
    if (meta) meta.textContent = ctx.nights + (ctx.nights === 1 ? ' night' : ' nights') + ' · ' +
      suites + (suites === 1 ? ' suite' : ' suites') + ' · ' + partyLabel(ctx.party);
    var rooms = $('reviewRooms');
    rooms.textContent = '';
    ctx.picks.forEach(function (p, i) { rooms.appendChild(renderPick(ctx, p, i)); });
    host.hidden = false; // on the page, with a width, before the inclusions are measured
    rooms.querySelectorAll('.rv-inclusions').forEach(function (incl) { if (incl.__fold) incl.__fold(); });
    var totalsHost = $('reviewTotals');
    totalsHost.textContent = '';
    var totals = renderTotals(ctx, ctx.picks);
    ctx.totals = totals;
    totalsHost.appendChild(totals.box);

    /* The guest's own word. Text from Lodge Ops (Settings → Booking
       Website); the payment button only wakes once it is ticked. */
    var t = (ctx.config && ctx.config.text) || {};
    var agree = $('txtAgree');
    if (agree) agree.textContent = t.agreementText || DEFAULT_AGREE;
    var box = $('agreeBox'), pay = $('payBtn'), hold = $('holdBtn'), note = $('payNote');
    box.checked = false;
    box.disabled = false;
    /* Disabled until agreed; hovering a disabled button says why (Dave,
       2026-09-02: "You must agree first") — the wrapper's CSS tooltip,
       and a title for browsers that show one on a disabled control. */
    var MUST_AGREE = 'You must agree first';
    function gate(btn, on) {
      if (!btn) return;
      btn.disabled = !on;
      if (on) btn.removeAttribute('title'); else btn.setAttribute('title', MUST_AGREE);
    }
    gate(pay, false);
    /* Hold my booking exists only when holds are on in Lodge Ops AND
       check-in is more than the configured distance away (two weeks). */
    if (hold) { gate(hold, false); hold.hidden = !holdOffered(ctx.config, ctx.from); }
    /* "What's this?" lives and dies with the button. */
    var what = $('holdWhat'), holdCol = $('holdCol');
    if (holdCol) holdCol.hidden = !!(hold && hold.hidden);
    if (what) what.onclick = function () { openWhatModal(ctx); };
    if (note) { note.hidden = true; if (t.continueNote) note.textContent = t.continueNote; }
    box.onchange = function () {
      gate(pay, box.checked);
      if (hold) gate(hold, box.checked);
      if (ctx.track) ctx.track(box.checked ? 'summary_agreed' : 'summary_unagreed', {});
    };
    pay.onclick = function () {
      if (!box.checked) return;
      if (ctx.onPay) ctx.onPay(totals);
    };
    /* A fresh summary retires an earlier checkout section. */
    var prevBs = $('bookingSummary'); if (prevBs) prevBs.hidden = true;
    var prevPay = $('payment'); if (prevPay) prevPay.hidden = true;
    stopCheckoutTimer();
    if (hold) hold.onclick = function () {
      if (!box.checked || hold.hidden || hold.disabled) return;
      var prior = storedVerified();
      if (prior) holdWithPrior(ctx, totals, prior, hold);
      else openHoldModal(ctx, totals);
    };
    var back = $('backBtn');
    if (back) back.onclick = function () { if (ctx.onBack) ctx.onBack(); };

    host.hidden = false;
    state.open = true;
    if (ctx.track) ctx.track('summary_viewed', {
      suites: suites,
      total: totals.grand != null ? totals.grand.toFixed(2) : null,
    });
    try { host.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* older browsers */ }
    return totals;
  }

  function close() {
    var host = $('review');
    if (host) host.hidden = true;
    var hold = $('hold');
    if (hold) hold.hidden = true;
    var held = $('held');
    if (held) held.hidden = true;
    stopHeldTimer();
    var bs = $('bookingSummary'); if (bs) bs.hidden = true;
    var pay = $('payment'); if (pay) pay.hidden = true;
    stopCheckoutTimer();
    closeHoldModal();
    state.open = false;
  }

  function isOpen() { return state.open; }

  return { open: open, close: close, isOpen: isOpen, DEFAULT_AGREE: DEFAULT_AGREE,
    holdsConfig: holdsConfig, holdOffered: holdOffered, daysUntil: daysUntil,
    showHeld: showHeld, openRetrieve: openRetrieve,
    startCheckout: startCheckout, showCheckout: showCheckout };
})();
