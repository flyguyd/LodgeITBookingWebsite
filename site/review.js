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
  /* The hold verification lives on the Lodge Ops API, served from the same
     origin as this page on the live host (as the chat widget is). */
  var HOLD_API = window.BK_HOLD_API || '/api/web/booking-hold';
  /* Inclusion rows shown before "Show all" (Dave, 2026-09-02). */
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
    if (plan && plan.description) rate.appendChild(el('p', 'rv-plan-desc', plan.description));
    var callouts = C.ruleCallouts(room);
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
      var hiddenRows = 0;
      secs.forEach(function (s, si) {
        var grp = el('div', 'rv-inc-group' + (s.negative ? ' negative' : ''));
        grp.appendChild(el('span', 'rv-inc-name', s.name));
        var chips = el('div', 'rv-inc-chips');
        s.tags.forEach(function (t) { chips.appendChild(el('span', 'rv-inc', String(t))); });
        grp.appendChild(chips);
        /* Two rows by default; the rest fold away behind one button. */
        if (si >= INCLUSION_ROWS) { grp.hidden = true; grp.classList.add('rv-inc-more'); hiddenRows += 1; }
        incl.appendChild(grp);
      });
      if (hiddenRows > 0) {
        var more = el('button', 'rv-inc-toggle');
        more.type = 'button';
        more.setAttribute('aria-expanded', 'false');
        var openLabel = 'Show all inclusions \u00b7 ' + hiddenRows + ' more';
        more.textContent = openLabel;
        more.addEventListener('click', function () {
          var open = more.getAttribute('aria-expanded') !== 'true';
          incl.querySelectorAll('.rv-inc-more').forEach(function (g) { g.hidden = !open; });
          more.setAttribute('aria-expanded', open ? 'true' : 'false');
          more.textContent = open ? 'Show fewer' : openLabel;
          if (ctx.track) ctx.track(open ? 'inclusions_expanded' : 'inclusions_collapsed', { roomTypeId: room.roomTypeId });
        });
        incl.appendChild(more);
      }
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
          total: one != null ? Math.round(one * (p.qty || 1) * 100) / 100 : null };
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
  function closeHoldModal() {
    var modal = $('holdModal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('hold-open');
  }
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { var m = $('holdModal'); if (m && !m.hidden) closeHoldModal(); }
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
     for a paid one. The choice is recorded on the hold in Lodge Ops and the
     reservations team is told; they arrange the payment. */
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
    var chosen = null, done = false;

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
      b.setAttribute('aria-label', 'Pay with ' + p.name);
      b.title = 'Pay with ' + p.name;
      b.appendChild(providerMark(p));
      b.appendChild(el('span', 'hold-payer-name', p.name));
      b.addEventListener('click', function () { if (chosen && !done) commit(chosen, p); });
      pay.appendChild(b);
      return b;
    });
    payWrap.appendChild(pay);
    host.appendChild(payWrap);

    var confirmWrap = el('div', 'hold-confirm');
    confirmWrap.hidden = true;
    var confirm = el('button', 'cta');
    confirm.type = 'button';
    confirm.id = 'holdConfirm';
    confirm.appendChild(el('span', 'cta-label', 'Confirm'));
    confirm.addEventListener('click', function () { if (chosen && !done) commit(chosen, null); });
    confirmWrap.appendChild(confirm);
    host.appendChild(confirmWrap);
    var note = el('p', 'hold-choice-note');
    note.id = 'holdChoiceNote';
    note.hidden = true;
    host.appendChild(note);

    function select(o) {
      chosen = o;
      optionButtons.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-hours') === String(o.hours) ? 'true' : 'false'); });
      note.hidden = true;
      if (o.price > 0 && providers.length) {
        payWrap.hidden = false; confirmWrap.hidden = true;
      } else {
        payWrap.hidden = true; confirmWrap.hidden = false;
        confirm.querySelector('.cta-label').textContent = o.price > 0
          ? 'Request a ' + o.hours + '-hour hold \u00b7 ' + exVat(o.price)
          : 'Hold it for ' + o.hours + ' hours \u00b7 free';
      }
      if (ctx.track) ctx.track('hold_option_selected', { hours: o.hours, price: o.price });
    }
    function busy(on) {
      optionButtons.concat(payButtons).forEach(function (b) { b.disabled = on; });
      confirm.disabled = on;
    }
    function commit(o, p) {
      busy(true);
      note.hidden = true;
      postJson(HOLD_API + '/choose', { id: holdId, hours: o.hours, provider: p ? p.key : null,
        snapshot: ctx.snapshot ? ctx.snapshot() : null })
        .then(function (j) {
          if (!j || j.ok !== true) {
            busy(false);
            note.className = 'hold-choice-note hold-choice-err';
            note.textContent = (j && j.message) || 'Your choice could not be saved just now \u2014 please try again.';
            note.hidden = false;
            if (ctx.track) ctx.track('hold_choice_failed', { hours: o.hours });
            return;
          }
          done = true;
          host.classList.add('hold-chosen');
          payWrap.hidden = true; confirmWrap.hidden = true;
          if (ctx.track) ctx.track('hold_chosen', { hours: o.hours, price: o.price, provider: p ? p.key : null, reference: j.reference });
          /* The hold is real: its own section below, with the clock. */
          showHeld(j, ctx);
        })
        .catch(function () {
          busy(false);
          note.className = 'hold-choice-note hold-choice-err';
          note.textContent = 'We could not reach the lodge \u2014 check your connection and try again.';
          note.hidden = false;
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
  function showHeld(hold, ctx) {
    ctx = ctx || state.ctx;
    var host = $('held'), card = $('heldCard');
    if (!host || !card || !hold) return;
    stopHeldTimer();
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
    card.appendChild(meta);

    var list = el('div', 'held-suites');
    (stay.suites || []).forEach(function (s) {
      var r = el('div', 'rv-row');
      r.appendChild(el('span', null, (s.name || 'Suite') + ((s.qty || 1) > 1 ? ' \u00d7 ' + s.qty : '') + (s.plan ? ' \u00b7 ' + s.plan : '')));
      r.appendChild(el('span', null, s.total != null ? C.moneyC(s.total, stay.currency) : 'on request'));
      list.appendChild(r);
    });
    card.appendChild(list);
    if (stay.total != null) {
      var grand = el('div', 'rv-grand');
      grand.appendChild(el('span', null, 'Grand total'));
      grand.appendChild(el('strong', null, C.moneyC(stay.total, stay.currency)));
      card.appendChild(grand);
    }

    var clock = el('div', 'held-clock');
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
      stopHeldTimer();
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
  function openRetrieve() {
    var modal = $('retrieveModal'), input = $('retrieveRef'), go = $('retrieveGo'), note = $('retrieveNote');
    if (!modal) return;
    input.value = ''; note.hidden = true; note.textContent = ''; go.disabled = false;
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
    if (link) link.addEventListener('click', openRetrieve);
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
    pay.disabled = true;
    /* Hold my booking exists only when holds are on in Lodge Ops AND
       check-in is more than the configured distance away (two weeks). */
    if (hold) { hold.disabled = true; hold.hidden = !holdOffered(ctx.config, ctx.from); }
    if (note) { note.hidden = true; if (t.continueNote) note.textContent = t.continueNote; }
    box.onchange = function () {
      pay.disabled = !box.checked;
      if (hold) hold.disabled = !box.checked;
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
