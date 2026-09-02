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
    return { box: box, grand: grandC / 100, currency: currency };
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
  function loadStripe(publishableKey) {
    if (!publishableKey) {
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
    var pay = el('div', 'hold-pay');
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
       card. Asked once; a square the engine does not list is hidden, and
       if the engine cannot be asked the usual modes stand. */
    function loadModes() {
      if (modes) return Promise.resolve(modes);
      return getJson(PAY_API + '/gateways').then(function (j) {
        var list = (j && Array.isArray(j.gateways)) ? j.gateways : null;
        modes = {};
        if (list) {
          list.forEach(function (g) { if (g && g.key) { modes[g.key] = g.mode === 'element' ? 'element' : 'redirect'; gwInfo[g.key] = g; } });
          payButtons.forEach(function (b) { b.hidden = !modes[b.getAttribute('data-provider')]; });
        } else {
          modes = STATIC_MODES;
        }
        return modes;
      }).catch(function () { modes = STATIC_MODES; return modes; });
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
        loadStripe(pk).then(function (stripe) {
          if (!payer || payer.key !== p.key || !mount.isConnected) return;
          stripeApi = stripe;
          var elements = stripe.elements();
          stripeCard = elements.create('card', {
            hidePostalCode: true,
            style: { base: { color: '#f3ede1', fontFamily: 'inherit', fontSize: '16px', '::placeholder': { color: 'rgba(243, 237, 225, 0.4)' }, iconColor: '#d8b46a' }, invalid: { color: '#e8a58a', iconColor: '#e8a58a' } }
          });
          mount.textContent = ''; mount.classList.remove('loading');
          stripeCard.mount(mount);
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
      if (ctx && ctx.onPay) ctx.onPay(ctx.totals || null);
      var t = (ctx && ctx.config && ctx.config.text) || {};
      note.className = 'hold-choice-note hold-choice-ok';
      note.textContent = t.continueNote || 'Secure checkout is almost ready \u2014 we have saved your selection, and the reservations team can confirm it today if you contact the lodge.';
      note.hidden = false;
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
    if (ev.key === 'Escape') { var m = $('retrieveModal'); if (m && !m.hidden) { m.hidden = true; document.body.classList.remove('hold-open'); } }
  });

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
    closeHoldModal();
    state.open = false;
  }

  function isOpen() { return state.open; }

  return { open: open, close: close, isOpen: isOpen, DEFAULT_AGREE: DEFAULT_AGREE,
    holdsConfig: holdsConfig, holdOffered: holdOffered, daysUntil: daysUntil,
    showHeld: showHeld, openRetrieve: openRetrieve };
})();
