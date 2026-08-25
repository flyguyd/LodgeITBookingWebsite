/* 7 Star Lodges booking — MOBILE UI on top of ../core.js. Presentation only;
   built for one thumb: steppers instead of selects, whole-card tap-to-add
   (any number of suites), and a sticky glass bar carrying total + Continue. */
(function () {
  'use strict';
  var C = window.BKCore;

  var $ = function (id) { return document.getElementById(id); };
  var form = $('searchForm');
  var els = {
    arrive: $('fArrive'), nights: $('fNights'), nightsCustom: $('fNightsCustom'),
    adults: $('fAdults'), children: $('fChildren'), rooms: $('fRooms'),
    code: $('fCode'), btn: $('searchBtn'),
    note: $('formNote'), loading: $('stateLoading'),
    maintenance: $('stateMaintenance'), unavailable: $('stateUnavailable'),
    empty: $('stateEmpty'), results: $('results'), resultsHead: $('resultsHead'),
    roomList: $('roomList'), summary: $('summary'), sumRoom: $('sumRoom'),
    sumDates: $('sumDates'), sumTotal: $('sumTotal'), sumNights: $('sumNights'),
    continueBtn: $('continueBtn'), continueNote: $('continueNote'),
  };

  var current = { from: null, to: null, results: [], picks: {}, nights: 0 };
  var media = {};
  /* Display config managed on the Lodge Ops Booking Website page —
     rateDisplay: 'inclusive' | 'separate'. */
  var config = {};
  /* Replicated suite settings + lodge levy/VAT from Lodge Ops, cached by the
     site server and served as /suites.json. */
  var suites = {};
  var lodge = null;
  /* One level up from /m/ — resolves correctly under the /book/ mount too. */
  var MEDIA_BASE = '../media/';

  // ---- steppers (adults / children / suites) ----
  Array.prototype.forEach.call(document.querySelectorAll('.stepper'), function (box) {
    var out = box.querySelector('output');
    var min = Number(out.dataset.min);
    var max = Number(out.dataset.max);
    Array.prototype.forEach.call(box.querySelectorAll('.step'), function (btn) {
      btn.addEventListener('click', function () {
        var next = Number(out.textContent) + Number(btn.dataset.step);
        if (next >= min && next <= max) out.textContent = String(next);
      });
    });
  });

  // ---- UI states ----
  var stateEls = ['loading', 'maintenance', 'unavailable', 'empty', 'results'];
  function show(state) {
    stateEls.forEach(function (k) { els[k].hidden = k !== state; });
    if (state !== 'results') hideSummary();
  }
  function hideStates() { stateEls.forEach(function (k) { els[k].hidden = true; }); }
  function hideSummary() { els.summary.classList.remove('on'); els.summary.hidden = true; }
  function showSummary() {
    els.summary.hidden = false;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { els.summary.classList.add('on'); });
    });
  }

  els.arrive.value = C.isoToday(14);
  els.arrive.min = C.isoToday(0);

  /* Nights: 2-14 in the dropdown, 'More…' swaps it for a free text box
     (Dave, 2026-08-23). Departure = arrival + nights. */
  for (var ni = 2; ni <= 14; ni++) {
    var o = document.createElement('option');
    o.value = String(ni);
    o.textContent = String(ni);
    if (ni === 4) o.selected = true;
    els.nights.appendChild(o);
  }
  var more = document.createElement('option');
  more.value = 'more';
  more.textContent = 'More…';
  els.nights.appendChild(more);
  /* The 5th-night promotion is visible right in the list; the closed
     trigger shows the short form so the field never overflows. */
  var opt5 = els.nights.querySelector('option[value="5"]');
  opt5.textContent = '5 — 5th night’s accommodation free';
  opt5.dataset.short = '5';
  var lastNights = '4';
  els.nights.addEventListener('change', function () {
    if (els.nights.value === 'more') {
      els.nights.hidden = true;
      els.nightsCustom.hidden = false;
      els.nightsCustom.focus();
    } else {
      lastNights = els.nights.value;
    }
  });
  /* Leaving the box empty steps back to the dropdown — no dead end. */
  els.nightsCustom.addEventListener('blur', function () {
    if (els.nightsCustom.value === '') {
      els.nightsCustom.hidden = true;
      els.nights.hidden = false;
      els.nights.value = lastNights;
    }
  });
  function currentNights() {
    var raw = els.nightsCustom.hidden ? els.nights.value : els.nightsCustom.value;
    var n = parseInt(raw, 10);
    return isFinite(n) ? n : 0;
  }

  /* A checkout click on the calendar sets the whole Nights control:
     2-14 lands on the dropdown, longer stays on the free text box. */
  function setNights(n) {
    if (n >= 2 && n <= 14) {
      els.nightsCustom.hidden = true;
      els.nightsCustom.value = '';
      els.nights.hidden = false;
      els.nights.value = String(n);
      els.nights.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      els.nights.hidden = true;
      els.nightsCustom.hidden = false;
      els.nightsCustom.value = String(n);
    }
  }

  /* The rate calendar replaces the native picker on Arrive: each day shows
     the cheapest available suite for that night. First click = check-in
     (stays open), a later-day click = checkout. */
  if (window.BKCal) {
    window.BKCal.attach(els.arrive, {
      fetchRates: C.fetchRateCalendar,
      minIso: C.isoToday(0),
      maxIso: C.isoToday(365 * 3),
      /* Warm the next 30 days the moment the page loads, so the calendar
         opens with its rates already there. */
      prefetchDays: 30,
      onRange: function (fromIso, nights) { setNights(nights); },
    });
    /* The native select popup cannot be styled — dress Nights in the site's
       glass language. The select stays as the value holder. */
    window.BKCal.glassSelect(els.nights);
  }

  /* Suites list in the order set on Guest Suites settings (replicated as
     suites[id].sortOrder); anything unknown keeps its place at the end. */
  function suiteOrdered(list) {
    return list.slice().sort(function (a, b) {
      var avA = a.available > 0 ? 0 : 1;
      var avB = b.available > 0 ? 0 : 1;
      if (avA !== avB) return avA - avB; // sold-out suites after the bookable
      var sa = suites[String(a.roomTypeId)];
      var sb = suites[String(b.roomTypeId)];
      var oa = sa && sa.sortOrder != null ? sa.sortOrder : 1e9;
      var ob = sb && sb.sortOrder != null ? sb.sortOrder : 1e9;
      return oa - ob;
    });
  }

  // ---- search ----
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var from = els.arrive.value;
    var n = currentNights();
    els.note.hidden = true;
    if (!from) {
      els.note.textContent = 'Choose an arrival date.';
      els.note.hidden = false;
      return;
    }
    if (!(n >= 2)) {
      els.note.textContent = 'How many nights? Two or more.';
      els.note.hidden = false;
      return;
    }
    if (n > 30) {
      els.note.textContent = 'Stays longer than 30 nights: contact the lodge directly.';
      els.note.hidden = false;
      return;
    }
    var to = C.addDays(from, n);
    updateUrl(from, n);
    current.from = from;
    current.to = to;
    current.picks = {};
    show('loading');
    els.btn.disabled = true;
    var params = {
      from: from, to: to,
      adults: els.adults.textContent, children: els.children.textContent,
      rooms: els.rooms.textContent,
      code: els.code ? els.code.value.trim().toUpperCase() : '',
    };
    C.track('search_started', params, { from: from, to: to });
    C.searchAvailability(params)
      .then(function (r) {
        els.btn.disabled = false;
        if (r.status === 503) { show('maintenance'); return; }
        if (r.status === 501) { show('unavailable'); return; }
        if (r.status !== 200) {
          els.note.textContent = (r.json && r.json.message) || 'Something went wrong — please try again.';
          els.note.hidden = false;
          hideStates();
          return;
        }
        current.results = r.json.results || [];
        current.nights = r.json.nights;
        current.ratePlans = r.json.ratePlans || [];
        /* Prices come from the Rate Engine ONLY (0.1.26): the server strips
           the provider's figures and attaches the offered plans' quotes.
           Each suite maps its first priced plan onto the card; further
           plans become pills the guest can switch between. A suite the
           engine does not price shows "Rates on request" — never a number
           from anywhere else. (The old site-side 5th-night promotion is
           retired with this: pricing rules live in the Rate Engine now.)
           The conservation levy still comes from the replicated lodge
           settings — the engine knows nothing of it. */
        var party = { adults: els.adults.textContent, children: els.children.textContent };
        current.results.forEach(function (room) {
          room.plans = C.planOptionsFor(room.roomTypeId, current.ratePlans);
          /* A search lands on the CHEAPEST priced plan (0.1.29), not merely
             the first one offered — the guest sees the best price the lodge
             has for them without having to hunt through the pills. */
          var pick = C.defaultPlanOption(room.plans);
          if (pick) C.applyPlanToRoom(room, pick, lodge, party, r.json.nights);
        });
        /* The provider omits fully booked room types entirely — when Lodge
           Ops says to show them, the replicated suite list fills the gaps. */
        if (config.showUnavailable === true) {
          var present = {};
          current.results.forEach(function (room) { present[String(room.roomTypeId)] = true; });
          Object.keys(suites).forEach(function (id) {
            if (present[id] || id.charAt(0) === '_') return;
            if (!suites[id] || !suites[id].name) return;
            current.results.push({
              roomTypeId: id, name: suites[id].name, available: 0,
              totalPrice: null, currency: null, photos: [],
            });
          });
        }
        C.track('availability_viewed', { count: current.results.length });
        /* Fully-booked suites appear only when Lodge Ops says so
           (site_config.showUnavailable); the empty state judges what is
           actually shown. */
        var visible = current.results.filter(function (room) {
          return room.available > 0 || config.showUnavailable === true;
        });
        if (!visible.length) { show('empty'); return; }
        renderResults({ from: r.json.from, to: r.json.to, nights: r.json.nights, results: suiteOrdered(visible) });
        show('results');
        els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
      .catch(function () {
        els.btn.disabled = false;
        hideStates();
        els.note.textContent = 'We could not reach the lodge — check your connection and try again.';
        els.note.hidden = false;
      });
  });

  // ---- results ----
  function photosFor(room) {
    var own = media[String(room.roomTypeId)];
    if (own && own.length) {
      return own.map(function (id) { return MEDIA_BASE + id; });
    }
    if (room.photos && room.photos.length) return room.photos;
    return [];
  }

  /* The levy/VAT header line above the cards was removed (Dave, 2026-08-24):
     the itemised statement on each card is where those facts now live. */

  function renderResults(payload) {
    els.resultsHead.textContent =
      C.fmtDate(payload.from) + ' — ' + C.fmtDate(payload.to) + ' · ' +
      payload.nights + ' night' + (payload.nights === 1 ? '' : 's');
    els.roomList.textContent = '';
    payload.results.forEach(function (room, i) {
      els.roomList.appendChild(renderRoom(room, payload.nights, i));
    });
  }


  /* The itemised note's hover card: the FULL statement — each night's rate,
     the accommodation subtotal, every tax and levy line with its arithmetic,
     and the total, all to the cent so the column visibly adds up (Dave,
     2026-08-23). Hover on desktop, tap on touch — the tap never toggles the
     room pick. */
  function attachBreakdown(price, noteEl, room, nights) {
    var bd = C.stayBreakdown(room, current.from, nights);
    if (!bd) return;
    var party = { adults: els.adults.textContent, children: els.children.textContent };
    var lines = C.stayMath(room, lodge, party, nights);
    var tip = document.createElement('div');
    tip.className = 'bk-breakdown';
    tip.hidden = true;
    function addRow(label, cents, cls, marker) {
      var r = document.createElement('div');
      r.className = 'bk-row' + (cls ? ' ' + cls : '');
      var d = document.createElement('span');
      d.textContent = label;
      if (marker) {
        var f = document.createElement('em');
        f.className = 'bk-free';
        f.textContent = marker;
        d.appendChild(f);
      }
      var v = document.createElement('span');
      v.textContent = C.moneyC(cents / 100, room.currency);
      r.appendChild(d);
      r.appendChild(v);
      tip.appendChild(r);
    }
    /* The last night absorbs the sub-cent remainder so the nights sum
       exactly to the Accommodation line. */
    var accC = Math.round(bd.baseTotal * 100);
    var leftC = accC;
    bd.rows.forEach(function (row, i) {
      var c = i === bd.rows.length - 1 ? leftC : Math.round(row.base * 100);
      leftC -= c;
      addRow(C.fmtDate(row.date), c, '', row.free5 ? '5th night free' : null);
    });
    var totalC = accC;
    addRow('Accommodation', accC, 'bk-sub', null);
    lines.forEach(function (l) {
      var c = Math.round(l.amount * 100);
      totalC += c;
      addRow(l.label, c, '', null);
    });
    addRow('Total', totalC, 'bk-total', null);
    price.style.position = 'relative';
    price.appendChild(tip);
    noteEl.className += ' has-tip';
    noteEl.addEventListener('mouseenter', function () { tip.hidden = false; });
    noteEl.addEventListener('mouseleave', function () { tip.hidden = true; });
    noteEl.addEventListener('click', function (ev) {
      ev.stopPropagation();
      tip.hidden = false;
    });
    /* A tap can land on the tip itself the instant it opens under the
       finger — it must never bubble into the card's pick toggle. */
    tip.addEventListener('click', function (ev) { ev.stopPropagation(); });
    document.addEventListener('click', function (ev) {
      if (!tip.hidden && !price.contains(ev.target)) tip.hidden = true;
    });
  }



  /* The occupancy & extra-cost table for the lightbox: Included / Maximum /
     Extra-guest cost per age group, plus the total maximum. Values the lodge
     has not set show as an em dash; a configured 0 extra cost reads free. */
  function occupancyFor(sc, currency) {
    if (!sc) return null;
    var dash = '\u2014';
    var n = function (v) { return v != null && isFinite(Number(v)) ? String(v) : dash; };
    var x = function (v) {
      if (v == null || !isFinite(Number(v))) return dash;
      return Number(v) > 0 ? C.money(v, currency) + '/night' : 'free';
    };
    var rows = [
      { label: 'Adults', included: n(sc.includedAdults), max: n(sc.maxAdults), extra: x(sc.extraAdultCost) },
      { label: 'Children', included: n(sc.includedChildren), max: n(sc.maxChildren), extra: x(sc.extraChildCost) },
      { label: 'Infants', included: n(sc.includedInfants), max: n(sc.maxInfants), extra: x(sc.extraInfantCost) },
    ];
    var any = rows.some(function (r) { return r.included !== dash || r.max !== dash || r.extra !== dash; });
    if (!any && sc.maxTotalGuests == null) return null;
    return { rows: rows, totalMax: sc.maxTotalGuests != null ? String(sc.maxTotalGuests) : null };
  }

  /* An unavailable suite offers its own availability calendar: our calendar,
     filtered to just this suite's rates. Reached from the sold-out card's
     button and from inside the suite lightbox alike. */
  function openAvailability(room) {
    if (!window.BKLight || !window.BKCal) return;
    var holder = document.createElement('div');
    window.BKCal.inline(holder, {
      fetchRates: function (f, t) {
        return C.fetchRateCalendar(f, t, String(room.roomTypeId));
      },
      minIso: C.isoToday(0),
      maxIso: C.isoToday(365 * 3),
    });
    window.BKLight.open({
      title: 'Suite Availability',
      subtitle: room.name,
      noPhoto: true,
      photos: [],
      customNode: holder,
    });
  }

  /* The card click opens the full story — gallery, description, amenities,
     pricing — and the Add action lives inside (Dave, 2026-08-23). */
  function openLightbox(room, nights) {
    if (!window.BKLight) { togglePick(room); return; }
    var sc = suites[String(room.roomTypeId)] || null;
    var pp = C.priceParts(room, config);
    var soldOut = !(room.available > 0) && room.availabilityKnown !== false;
    var availUnknown = room.availabilityKnown === false;
    var chips = [];
    if (room.promoFree5) chips.push({ text: '5th night\u2019s accommodation free', gold: true });
    var sleeps = (sc && sc.maxTotalGuests) || room.maxGuests;
    if (sleeps) chips.push({ text: 'Sleeps ' + sleeps });
    if (sc && sc.pool) chips.push({ text: sc.pool });
    if (sc && sc.style) chips.push({ text: sc.style });
    ((sc && sc.amenities) || []).forEach(function (a) { chips.push({ text: a }); });
    var price = null;
    if (pp.headline != null) {
      price = {
        headline: C.money(pp.headline, room.currency),
        perNight: C.money(pp.headline / nights, room.currency) + ' a night',
        note: pp.note
          ? (pp.note.kind === 'plus'
            ? '+ ' + C.money(pp.note.extras, room.currency) + extrasLabel(room)
            : inclLabel(room))
          : null,
      };
    }
    window.BKLight.open({
      title: room.name,
      photos: photosFor(room),
      artHue: C.hueFor(room.roomTypeId),
      soldOut: soldOut,
      soldOutText: 'Unavailable for your dates',
      picked: !!current.picks[room.roomTypeId],
      price: price,
      description: String((sc && sc.description) || room.description || '').replace(/<[^>]*>/g, ''),
      chips: chips,
      occupancy: occupancyFor(sc, room.currency),
      extraLine: C.extraGuestsLine(sc, room.currency),
      onToggle: soldOut ? null : function () {
        togglePick(room);
        return !!current.picks[room.roomTypeId];
      },
      onShowAvailability: soldOut ? function () { openAvailability(room); } : null,
    });
  }


  /* What the itemised extras actually contain, said plainly. */
  function extrasLabel(room) {
    if (room.levyAdded) return room.vatDerived ? ' VAT & levy' : ' taxes, fees & levy';
    return room.vatDerived ? ' VAT' : ' taxes & fees';
  }

  /* The inclusive display's note, equally plainly: what the headline has
     folded in. Levy worked out from the replicated settings + VAT declared
     inside the rate, unless the provider itemised its own extras too. */
  function inclLabel(room) {
    if (room.levyAdded) return room.providerExtras ? 'taxes, fees & levy included' : 'VAT & levy included';
    return room.vatDerived ? 'VAT included' : 'taxes & fees included';
  }

  /* The summary bar's amount: the grand total the guest will actually pay,
     with the base-plus-extras split as a small line under it — the long
     one-line form crushed the bar's layout on a phone (Dave, 2026-08-24). */
  function fillBarTotal(el, total, picks) {
    el.textContent = '';
    if (!total) return;
    el.appendChild(document.createTextNode(
      C.money(total.sum + total.extras, total.currency)));
    if (total.extras > 0) {
      var labels = {};
      picks.forEach(function (p) { labels[extrasLabel(p.room)] = true; });
      var keys = Object.keys(labels);
      var split = document.createElement('span');
      split.className = 'sum-split';
      split.textContent = C.money(total.sum, total.currency) + ' + ' +
        C.money(total.extras, total.currency) +
        (keys.length === 1 ? keys[0] : ' taxes & fees');
      el.appendChild(split);
    }
  }

  function renderRoom(room, nights, index) {
    var card = document.createElement('article');
    card.className = 'glass room';
    card.style.animationDelay = (0.05 + index * 0.08) + 's';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;

    var photo = document.createElement('div');
    photo.className = 'room-photo';
    var urls = photosFor(room);
    if (urls.length) {
      var img = document.createElement('img');
      img.src = urls[0];
      img.alt = room.name;
      img.loading = 'lazy';
      img.addEventListener('error', function () {
        img.remove();
        photo.insertBefore(art(room), photo.firstChild);
      });
      photo.appendChild(img);
    } else {
      photo.appendChild(art(room));
    }
    var soldOut = !(room.available > 0) && room.availabilityKnown !== false;
    var availUnknown = room.availabilityKnown === false;
    if (soldOut) {
      card.classList.add('soldout');
      var so = document.createElement('span');
      so.className = 'room-scarce';
      so.textContent = 'Unavailable for your dates';
      photo.appendChild(so);
    } else if (availUnknown) {
      /* The engine holds no availability for these dates (beyond its synced
         window, or a suite it has never been told about). Said plainly —
         never rendered as sold out, which would be a guess. */
      var unk = document.createElement('span');
      unk.className = 'room-scarce';
      unk.textContent = 'Availability on request';
      photo.appendChild(unk);
    }
    if (room.available > 0 && room.available <= 2) {
      var sc = document.createElement('span');
      sc.className = 'room-scarce';
      sc.textContent = room.available === 1 ? 'Last suite' : 'Only ' + room.available + ' left';
      photo.appendChild(sc);
    }
    var pickMark = document.createElement('span');
    pickMark.className = 'room-pick';
    pickMark.textContent = '✓';
    photo.appendChild(pickMark);
    card.appendChild(photo);

    var body = document.createElement('div');
    body.className = 'room-body';
    var top = document.createElement('div');
    top.className = 'room-top';
    var name = document.createElement('h3');
    name.className = 'room-name';
    name.textContent = room.name;
    top.appendChild(name);
    var pp = C.priceParts(room, config);
    if (pp.headline != null) {
      var price = document.createElement('div');
      price.className = 'room-price';
      var total = document.createElement('span');
      total.className = 'room-total';
      total.textContent = C.money(pp.headline, room.currency);
      var pn = document.createElement('span');
      pn.className = 'room-pn';
      pn.textContent = C.money(pp.headline / nights, room.currency) + ' a night';
      price.appendChild(total);
      price.appendChild(pn);
      if (pp.note) {
        var noteEl = document.createElement('span');
        noteEl.className = 'room-taxnote';
        noteEl.textContent = pp.note.kind === 'plus'
          ? '+ ' + C.money(pp.note.extras, room.currency) + extrasLabel(room)
          : inclLabel(room);
        price.appendChild(noteEl);
        if (pp.note.kind === 'plus') attachBreakdown(price, noteEl, room, nights);
      }
      top.appendChild(price);
    } else if (!soldOut) {
      /* Bookable but not priced by the Rate Engine — said plainly, never a
         number from anywhere else. */
      var ror = document.createElement('div');
      ror.className = 'room-price';
      var rorS = document.createElement('span');
      rorS.className = 'room-ror';
      rorS.textContent = 'Rates on request';
      ror.appendChild(rorS);
      top.appendChild(ror);
    }
    body.appendChild(top);

    /* Rate plan options (0.1.26): when more than one offered plan prices
       this suite, the guest switches between them here; the card re-prices
       in place and any pick keeps the chosen plan. */
    var plans = room.plans || [];
    if (plans.length > 1 && !soldOut) {
      var planRow = document.createElement('div');
      planRow.className = 'room-plans';
      plans.forEach(function (opt) {
        var pb = document.createElement('button');
        pb.type = 'button';
        pb.className = 'room-plan' + (opt.planId === room.planId ? ' on' : '')
          + (opt.cheapest === true ? ' best' : '');
        pb.textContent = opt.name;
        /* The cheapest plan wears its tag (0.1.29) so the guest can see
           which pill is the best price without comparing totals by hand.
           Only ever one, and only when there is something to compare. */
        if (opt.cheapest === true) {
          var tag = document.createElement('span');
          tag.className = 'plan-best';
          tag.textContent = 'Lowest rate';
          pb.appendChild(tag);
        }
        /* The inclusions moved from a per-pill hover to the Compare
           lightbox (Dave, 2026-08-26) — side by side beats thirteen
           tooltips. The pill keeps only the plan's own description. */
        if (opt.description) pb.title = opt.description;
        pb.addEventListener('click', function (ev) {
          ev.stopPropagation();
          if (opt.planId === room.planId) return;
          var party = { adults: els.adults.textContent, children: els.children.textContent };
          C.applyPlanToRoom(room, opt, lodge, party, nights);
          C.track('plan_selected',
            { roomTypeId: room.roomTypeId, planId: opt.planId, total: room.totalPrice },
            stateCheckpoint());
          var fresh = renderRoom(room, nights, index);
          fresh.style.animationDelay = '0s';
          card.parentNode.replaceChild(fresh, card);
          /* A little nudge on the compare button each time the guest
             switches plans (Dave, 2026-08-26): the moment they are weighing
             plans is the moment the comparison is useful. Runs once and
             cleans itself up. */
          var cbtn = fresh.querySelector('.rate-compare');
          if (cbtn) {
            cbtn.classList.add('pulse');
            cbtn.addEventListener('animationend', function () {
              cbtn.classList.remove('pulse');
            });
          }
          if (fresh.__refresh) fresh.__refresh();
          updateSummary();
        });
        planRow.appendChild(pb);
      });
      /* Compare these rates lives WITH the pills it compares (Dave,
         2026-08-26 — under the price it read as part of the price). Only
         when there is more than one plan; stopPropagation because the whole
         card opens the suite lightbox. */
      if (window.BKCompare) {
        var cmp = document.createElement('button');
        cmp.type = 'button';
        cmp.className = 'rate-compare';
        cmp.textContent = 'Compare these rates';
        cmp.addEventListener('click', function (ev) {
          ev.stopPropagation();
          window.BKCompare.open({
            suiteName: room.name,
            plans: room.plans,
            currency: room.currency,
          });
          C.track('rates_compared', { roomTypeId: room.roomTypeId });
        });
        planRow.appendChild(cmp);
      }
      body.appendChild(planRow);
    }

    /* The lodge's own words and facts win over the provider's. */
    var sc = suites[String(room.roomTypeId)] || null;
    var descText = (sc && sc.description) || room.description;
    if (descText) {
      var desc = document.createElement('p');
      desc.className = 'room-desc';
      desc.textContent = String(descText).replace(/<[^>]*>/g, '');
      body.appendChild(desc);
    }

    var meta = document.createElement('div');
    meta.className = 'room-meta';
    if (room.promoFree5) {
      var promo = tag('5th night’s accommodation free');
      promo.className += ' room-promo';
      meta.appendChild(promo);
    }
    var sleeps = (sc && sc.maxTotalGuests) || room.maxGuests;
    if (sleeps) meta.appendChild(tag('Sleeps ' + sleeps));
    if (sc && sc.pool) meta.appendChild(tag(sc.pool));
    if (sc && sc.style) meta.appendChild(tag(sc.style));
    if (room.restrictions && room.restrictions.minLos > 1) {
      meta.appendChild(tag('Min ' + room.restrictions.minLos + ' nights'));
    }
    meta.appendChild(tag('Tap for details'));
    body.appendChild(meta);

    if (sc && sc.amenities && sc.amenities.length) {
      var am = document.createElement('div');
      am.className = 'room-amenities';
      sc.amenities.forEach(function (a) {
        var chip = document.createElement('span');
        chip.className = 'room-am';
        chip.textContent = a;
        am.appendChild(chip);
      });
      body.appendChild(am);
    }
    var xg = C.extraGuestsLine(sc, room.currency);
    if (xg) {
      var xEl = document.createElement('p');
      xEl.className = 'room-extra';
      xEl.textContent = xg;
      body.appendChild(xEl);
    }

    var qtyRow = document.createElement('div');
    qtyRow.className = 'room-qty';
    qtyRow.hidden = true;
    var minus = stepBtn('−');
    var qtyVal = document.createElement('span');
    qtyVal.className = 'room-qty-n';
    var plus = stepBtn('+');
    qtyRow.appendChild(minus);
    qtyRow.appendChild(qtyVal);
    qtyRow.appendChild(plus);
    body.appendChild(qtyRow);
    card.appendChild(body);

    function refresh() {
      var pick = current.picks[room.roomTypeId];
      card.classList.toggle('selected', !!pick);
      qtyRow.hidden = !(pick && room.available > 1);
      if (pick) qtyVal.textContent = pick.qty + ' of ' + room.available;
    }
    card.__refresh = refresh;

    function details() { openLightbox(room, nights); }
    card.addEventListener('click', details);
    card.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); details(); }
    });
    if (soldOut) {
      pickMark.remove();
      qtyRow.remove();
      /* No Add action here; the card offers this suite's own calendar. */
      var avail = document.createElement('button');
      avail.type = 'button';
      avail.className = 'room-cta-avail';
      avail.textContent = 'Show availability';
      avail.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openAvailability(room);
      });
      body.appendChild(avail);
      return card;
    }
    minus.addEventListener('click', function (ev) { ev.stopPropagation(); bumpQty(room, -1); });
    plus.addEventListener('click', function (ev) { ev.stopPropagation(); bumpQty(room, 1); });
    return card;
  }

  function stepBtn(label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'step';
    b.textContent = label;
    return b;
  }

  function art(room) {
    var h = C.hueFor(room.roomTypeId);
    var el = document.createElement('div');
    el.className = 'room-art';
    el.style.background =
      'linear-gradient(150deg, hsl(' + h + ' 24% 22%), hsl(' + ((h + 40) % 360) + ' 30% 12%)),' +
      'radial-gradient(circle at 70% 20%, hsl(' + ((h + 20) % 360) + ' 40% 34% / 0.5), transparent 60%)';
    return el;
  }

  function tag(text) {
    var t = document.createElement('span');
    t.className = 'room-tag';
    t.textContent = text;
    return t;
  }

  // ---- multi-selection (same model as the full site) ----
  function pickedRooms() {
    return Object.keys(current.picks).map(function (k) { return current.picks[k]; });
  }
  function stateCheckpoint() {
    return {
      from: current.from, to: current.to,
      rooms: pickedRooms().map(function (p) {
        return { roomTypeId: p.room.roomTypeId, qty: p.qty, planId: p.room.planId || null };
      }),
    };
  }
  function togglePick(room) {
    if (current.picks[room.roomTypeId]) {
      delete current.picks[room.roomTypeId];
      C.track('room_selected', { roomTypeId: room.roomTypeId, action: 'removed' }, stateCheckpoint());
    } else {
      current.picks[room.roomTypeId] = { room: room, qty: 1 };
      C.track('room_selected',
        { roomTypeId: room.roomTypeId, planId: room.planId || null, total: room.totalPrice },
        stateCheckpoint());
    }
    refreshCards();
    updateSummary();
  }
  function bumpQty(room, delta) {
    var pick = current.picks[room.roomTypeId];
    if (!pick) return;
    var next = pick.qty + delta;
    if (next < 1) { togglePick(room); return; }
    if (next > room.available) return;
    pick.qty = next;
    C.track('room_selected', { roomTypeId: room.roomTypeId, qty: next }, stateCheckpoint());
    refreshCards();
    updateSummary();
  }
  function refreshCards() {
    var cards = els.roomList.querySelectorAll('.room');
    for (var i = 0; i < cards.length; i++) if (cards[i].__refresh) cards[i].__refresh();
  }
  function selectionTotal() {
    var sum = 0, extras = 0, priced = false, currency = null;
    pickedRooms().forEach(function (p) {
      var pp = C.priceParts(p.room, config);
      if (pp.headline != null) {
        sum += pp.headline * p.qty;
        if (pp.note && pp.note.kind === 'plus') extras += pp.note.extras * p.qty;
        priced = true;
        currency = currency || p.room.currency;
      }
    });
    return priced ? { sum: sum, extras: extras, currency: currency } : null;
  }
  function updateSummary() {
    var picks = pickedRooms();
    if (!picks.length) { hideSummary(); return; }
    var suites = picks.reduce(function (n, p) { return n + p.qty; }, 0);
    els.sumRoom.textContent = picks
      .map(function (p) {
        var planTag = p.room.plans && p.room.plans.length > 1 && p.room.planName
          ? ' — ' + p.room.planName : '';
        return p.room.name + planTag + (p.qty > 1 ? ' ×' + p.qty : '');
      })
      .join(' · ');
    els.sumDates.textContent = suites + ' suite' + (suites === 1 ? '' : 's');
    var total = selectionTotal();
    fillBarTotal(els.sumTotal, total, picks);
    els.sumNights.textContent = current.nights + ' night' + (current.nights === 1 ? '' : 's');
    els.continueNote.hidden = true;
    showSummary();
  }

  els.continueBtn.addEventListener('click', function () {
    var picks = pickedRooms();
    if (!picks.length) return;
    var total = selectionTotal();
    C.track('checkout_started', {
      rooms: picks.map(function (p) {
        return { roomTypeId: p.room.roomTypeId, qty: p.qty, planId: p.room.planId || null };
      }),
      total: total ? total.sum.toFixed(2) : null,
    }, stateCheckpoint());
    els.continueNote.hidden = false;
  });


  /* Lodge Ops-managed copy: every guest-facing string can be overridden from
     Settings \u2192 Booking Website. Defaults live in the HTML. */
  function setText(id, value) {
    var el = document.getElementById(id);
    if (el && value) el.textContent = value;
  }
  function applySiteText() {
    var t = config.text || {};
    setText('txtBrand', t.brand);
    setText('txtKicker', t.heroKicker);
    setText('txtLine1', t.heroLine1);
    setText('txtSub', t.heroSub);
    setText('txtMaintTitle', t.maintenanceTitle);
    setText('txtMaintBody', t.maintenanceBody);
    setText('txtUnavailTitle', t.unavailableTitle);
    setText('txtUnavailBody', t.unavailableBody);
    setText('txtEmptyTitle', t.emptyTitle);
    setText('txtEmptyBody', t.emptyBody);
    setText('continueNote', t.continueNote);
    if (t.heroLine2) {
      var el = document.getElementById('txtLine2');
      if (el) {
        var words = String(t.heroLine2).trim().split(/\s+/);
        var last = words.pop();
        el.textContent = words.join(' ') + (words.length ? ' ' : '');
        var em = document.createElement('em');
        em.textContent = last;
        el.appendChild(em);
      }
    }
  }
  /* The logo doubles as the browser-tab icon (Dave, 2026-08-24). */
  function applyLogo() {
    if (!config.logoId) return;
    var img = document.getElementById('siteLogo');
    if (img) {
      img.src = MEDIA_BASE + config.logoId;
      img.hidden = false;
      var star = document.getElementById('brandStar');
      if (star) star.hidden = true;
    }
    var fav = document.getElementById('favicon');
    if (fav) fav.href = MEDIA_BASE + config.logoId;
  }

  /* Shareable URLs (Dave, 2026-08-23): the search lands in the query string
     so a copied link renders the same for the next person — and the same
     params a desktop link carries restore here after the phone redirect. */
  function updateUrl(from, n) {
    try {
      var p = new URLSearchParams(location.search);
      p.set('arrive', from);
      p.set('nights', String(n));
      p.set('adults', els.adults.textContent);
      p.set('children', els.children.textContent);
      p.set('suites', els.rooms.textContent);
      history.replaceState(null, '', location.pathname + '?' + p.toString());
    } catch (e) { /* never let sharing break searching */ }
  }
  function restoreFromUrl() {
    try {
      var p = new URLSearchParams(location.search);
      var arrive = p.get('arrive');
      var n = parseInt(p.get('nights') || '', 10);
      if (!arrive || !/^\d{4}-\d{2}-\d{2}$/.test(arrive)) return;
      if (!(n >= 2 && n <= 30)) return;
      if (arrive < C.isoToday(0)) return; // a stale link keeps the defaults
      var setOut = function (el, v, lo, hi) {
        var x = parseInt(v || '', 10);
        if (x >= lo && x <= hi) el.textContent = String(x);
      };
      els.arrive.value = arrive;
      setNights(n);
      setOut(els.adults, p.get('adults'), 1, 12);
      setOut(els.children, p.get('children'), 0, 12);
      setOut(els.rooms, p.get('suites'), 1, 6);
      if (form.requestSubmit) form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true }));
    } catch (e) { /* defaults are a fine landing */ }
  }

  // ---- boot ----
  C.startSession('mobile');
  C.fetchStatus()
    .then(function (s) { if (s && s.maintenance) show('maintenance'); })
    .catch(function () {});
  fetch('../config.json')
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (c) {
      config = c || {};
      applySiteText();
      applyLogo();
    })
    .catch(function () {});
  fetch(MEDIA_BASE + 'rooms.json')
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (m) { media = m || {}; })
    .catch(function () {});
  fetch('../suites.json')
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (j) {
      suites = (j && j.suites) || {};
      lodge = (j && j.lodge) || null;
    })
    .catch(function () {});
  restoreFromUrl();
})();
