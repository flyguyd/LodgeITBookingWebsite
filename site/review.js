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
      secs.forEach(function (s) {
        var grp = el('div', 'rv-inc-group' + (s.negative ? ' negative' : ''));
        grp.appendChild(el('span', 'rv-inc-name', s.name));
        var chips = el('div', 'rv-inc-chips');
        s.tags.forEach(function (t) { chips.appendChild(el('span', 'rv-inc', String(t))); });
        grp.appendChild(chips);
        incl.appendChild(grp);
      });
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

  var state = { open: false, ctx: null };

  /* Open the summary. ctx: { picks, from, to, nights, party, lodge, config,
     photosFor, art, buildBreakdown, extrasLabel, inclLabel, onBack, onPay,
     track }. */
  function open(ctx) {
    var host = $('review');
    if (!host || !ctx.picks || !ctx.picks.length) return null;
    state.ctx = ctx;
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
    totalsHost.appendChild(totals.box);

    /* The guest's own word. Text from Lodge Ops (Settings → Booking
       Website); the payment button only wakes once it is ticked. */
    var t = (ctx.config && ctx.config.text) || {};
    var agree = $('txtAgree');
    if (agree) agree.textContent = t.agreementText || DEFAULT_AGREE;
    var box = $('agreeBox'), pay = $('payBtn'), note = $('payNote');
    box.checked = false;
    pay.disabled = true;
    if (note) { note.hidden = true; if (t.continueNote) note.textContent = t.continueNote; }
    box.onchange = function () {
      pay.disabled = !box.checked;
      if (ctx.track) ctx.track(box.checked ? 'summary_agreed' : 'summary_unagreed', {});
    };
    pay.onclick = function () {
      if (!box.checked) return;
      if (ctx.onPay) ctx.onPay(totals);
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
    state.open = false;
  }

  function isOpen() { return state.open; }

  return { open: open, close: close, isOpen: isOpen, DEFAULT_AGREE: DEFAULT_AGREE };
})();
