/* 7 Star Lodges booking — desktop/tablet UI on top of core.js.
   Presentation only: every API call, helper and analytics event lives in
   BKCore. This file renders the magazine layout and the glass behaviour. */
(function () {
  'use strict';
  var C = window.BKCore;

  var $ = function (id) { return document.getElementById(id); };
  var form = $('searchForm');
  var els = {
    arrive: $('fArrive'), nights: $('fNights'), nightsCustom: $('fNightsCustom'),
    adults: $('fAdults'), children: $('fChildren'), rooms: $('fRooms'), btn: $('searchBtn'),
    note: $('formNote'), loading: $('stateLoading'),
    maintenance: $('stateMaintenance'), unavailable: $('stateUnavailable'),
    empty: $('stateEmpty'), results: $('results'), resultsHead: $('resultsHead'),
    roomList: $('roomList'), summary: $('summary'), sumRoom: $('sumRoom'),
    sumDates: $('sumDates'), sumTotal: $('sumTotal'), sumNights: $('sumNights'),
    continueBtn: $('continueBtn'), continueNote: $('continueNote'),
  };

  /* picks: roomTypeId -> { room, qty } — guests can take MORE THAN ONE suite
     (Dave, 2026-08-23), and more than one unit of a type when available. */
  var current = { from: null, to: null, results: [], picks: {}, nights: 0 };
  /* Relative on purpose: under the /book/ path-mount this resolves to
     /book/media/… which nginx strips back to /media/… for the site server. */
  var MEDIA_BASE = 'media/';
  /* roomTypeId -> [urls]: the lodge's own suite photography, synced from
     Lodge Ops through the engine and cached by this site's server. Falls
     back to provider photos, then to the generative treatment. */
  var media = {};
  /* Display config managed on the Lodge Ops Booking Website page —
     rateDisplay: 'inclusive' | 'separate'. */
  var config = {};
  /* Replicated suite settings from Lodge Ops (descriptions, occupancy,
     amenities, extra guest costs) + the lodge block (conservation levy,
     VAT), cached by the site server and served as /suites.json. */
  var suites = {};
  var lodge = null;

  // ---- UI states ----
  var stateEls = ['loading', 'maintenance', 'unavailable', 'empty', 'results'];
  function show(state) {
    stateEls.forEach(function (k) { els[k].hidden = k !== state; });
    if (state !== 'results') hideSummary();
  }
  function hideStates() { stateEls.forEach(function (k) { els[k].hidden = true; }); }
  function hideSummary() {
    els.summary.classList.remove('on');
    els.summary.hidden = true;
  }
  function showSummary() {
    els.summary.hidden = false;
    /* next frame so the slide-up transition actually plays */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { els.summary.classList.add('on'); });
    });
  }

  // ---- form init ----
  function fillSelect(el, from, to, selectedValue) {
    for (var i = from; i <= to; i++) {
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = String(i);
      if (i === selectedValue) o.selected = true;
      el.appendChild(o);
    }
  }
  fillSelect(els.adults, 1, 12, 2);
  fillSelect(els.children, 0, 12, 0);
  fillSelect(els.rooms, 1, 6, 1);
  els.arrive.value = C.isoToday(14);
  els.arrive.min = C.isoToday(0);

  /* Nights: 2-14 in the dropdown, 'More…' swaps it for a free text box
     (Dave, 2026-08-23). Departure = arrival + nights. */
  fillSelect(els.nights, 2, 14, 4);
  var more = document.createElement('option');
  more.value = 'more';
  more.textContent = 'More…';
  els.nights.appendChild(more);
  /* The 5th-night promotion is visible right in the list; the closed
     trigger shows the short form so the bar never overflows. */
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
    C.track('search_started',
      { from: from, to: to, adults: els.adults.value, children: els.children.value, rooms: els.rooms.value },
      { from: from, to: to });

    C.searchAvailability({
      from: from, to: to,
      adults: els.adults.value, children: els.children.value, rooms: els.rooms.value,
    })
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
        /* 5+ nights: the 5th night's accommodation is free — each room's
           stay total is re-priced through the shared rule before display. */
        if (r.json.nights >= 5) {
          current.results.forEach(function (room) {
            var adj = C.fifthNightAdjust(room, r.json.nights, lodge,
              { adults: els.adults.value, children: els.children.value });
            if (adj) { room.totalPrice = adj.total; room.promoFree5 = true; }
          });
        }
        /* Real Cloudbeds does not itemise taxes on this endpoint. Under the
           itemised setting, derive the VAT portion from the lodge's declared
           vatPct (rates are VAT-inclusive) so guests still see base + VAT.
           Provider itemisation, when present, always wins. */
        if (config.rateDisplay === 'separate' && lodge && Number(lodge.vatPct) > 0) {
          current.results.forEach(function (room) {
            var t = Number(room.totalPrice);
            var hasOwn = (room.taxesTotal != null && isFinite(Number(room.taxesTotal))) ||
              (room.feesTotal != null && isFinite(Number(room.feesTotal)));
            if (!hasOwn && isFinite(t) && t > 0) {
              var vat = t * Number(lodge.vatPct) / (100 + Number(lodge.vatPct));
              room.totalPrice = t - vat;
              room.taxesTotal = vat;
              room.vatDerived = true;
            }
          });
        }
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

  /* The lodge-wide facts under the results heading: conservation levy and
     VAT, straight from the Guest Suites settings. Hidden when unset. */
  function applyStayNote() {
    var el = document.getElementById('stayNote');
    if (!el) return;
    var parts = [C.levyLine(lodge), C.vatLine(lodge)].filter(Boolean);
    el.textContent = parts.join(' · ');
    el.hidden = !parts.length;
  }

  function renderResults(payload) {
    var nights = payload.nights;
    els.resultsHead.textContent =
      C.fmtDate(payload.from) + ' — ' + C.fmtDate(payload.to) + ' · ' +
      nights + ' night' + (nights === 1 ? '' : 's');
    applyStayNote();
    els.roomList.textContent = '';
    payload.results.forEach(function (room, i) {
      els.roomList.appendChild(renderRoom(room, nights, i));
    });
  }


  /* The itemised note's hover card: each night's base + share of taxes &
     fees, and the stay total. Hover on desktop, tap on touch — the tap
     never toggles the room pick. */
  function attachBreakdown(price, noteEl, room, nights) {
    var bd = C.stayBreakdown(room, current.from, nights);
    if (!bd) return;
    var tip = document.createElement('div');
    tip.className = 'bk-breakdown';
    tip.hidden = true;
    bd.rows.forEach(function (row) {
      var r = document.createElement('div');
      r.className = 'bk-row';
      var d = document.createElement('span');
      d.textContent = C.fmtDate(row.date);
      var v = document.createElement('span');
      v.textContent = C.money(row.base, room.currency) + ' + ' + C.money(row.extras, room.currency);
      r.appendChild(d);
      r.appendChild(v);
      tip.appendChild(r);
    });
    var t = document.createElement('div');
    t.className = 'bk-row bk-total';
    var tl = document.createElement('span');
    tl.textContent = 'Total';
    var tv = document.createElement('span');
    tv.textContent = C.money(bd.grand, room.currency);
    t.appendChild(tl);
    t.appendChild(tv);
    tip.appendChild(t);
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


  /* The card click opens the full story — gallery, description, amenities,
     pricing — and the Add action lives inside (Dave, 2026-08-23). */
  function openLightbox(room, nights) {
    if (!window.BKLight) { togglePick(room); return; }
    var sc = suites[String(room.roomTypeId)] || null;
    var pp = C.priceParts(room, config);
    var soldOut = !(room.available > 0);
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
            ? '+ ' + C.money(pp.note.extras, room.currency) + (room.vatDerived ? ' VAT' : ' taxes & fees')
            : 'taxes & fees included')
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
      extraLine: C.extraGuestsLine(sc, room.currency),
      onToggle: soldOut ? null : function () {
        togglePick(room);
        return !!current.picks[room.roomTypeId];
      },
    });
  }

  function renderRoom(room, nights, index) {
    var card = document.createElement('article');
    card.className = 'glass room';
    card.style.animationDelay = (0.08 + index * 0.09) + 's';
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
    /* Factual scarcity only — no artificial urgency (spec §7). */
    var soldOut = !(room.available > 0);
    if (soldOut) {
      card.classList.add('soldout');
      var so = document.createElement('span');
      so.className = 'room-scarce';
      so.textContent = 'Unavailable for your dates';
      photo.appendChild(so);
    }
    if (room.available > 0 && room.available <= 2) {
      var sc = document.createElement('span');
      sc.className = 'room-scarce';
      sc.textContent = room.available === 1 ? 'Last suite' : 'Only ' + room.available + ' left';
      photo.appendChild(sc);
    }
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
          ? '+ ' + C.money(pp.note.extras, room.currency) + (room.vatDerived ? ' VAT' : ' taxes & fees')
          : 'taxes & fees included';
        price.appendChild(noteEl);
        if (pp.note.kind === 'plus') attachBreakdown(price, noteEl, room, nights);
      }
      top.appendChild(price);
    }
    body.appendChild(top);

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
      meta.appendChild(tag('Minimum ' + room.restrictions.minLos + ' nights'));
    }
    meta.appendChild(tag('Book direct — best rate'));
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

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'room-cta';
    btn.textContent = 'Add to stay';
    body.appendChild(btn);

    /* quantity stepper, shown once picked when the type has spare units */
    var qtyRow = document.createElement('div');
    qtyRow.className = 'room-qty';
    qtyRow.hidden = true;
    var minus = qtyBtn('−');
    var qtyVal = document.createElement('span');
    qtyVal.className = 'room-qty-n';
    var plus = qtyBtn('+');
    qtyRow.appendChild(minus);
    qtyRow.appendChild(qtyVal);
    qtyRow.appendChild(plus);
    body.appendChild(qtyRow);
    card.appendChild(body);

    function refresh() {
      var pick = current.picks[room.roomTypeId];
      card.classList.toggle('selected', !!pick);
      btn.textContent = pick ? 'Remove from stay' : 'Add to stay';
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
      btn.remove();
      qtyRow.remove();
      return card;
    }
    btn.addEventListener('click', function (ev) { ev.stopPropagation(); togglePick(room); });
    minus.addEventListener('click', function (ev) { ev.stopPropagation(); bumpQty(room, -1); });
    plus.addEventListener('click', function (ev) { ev.stopPropagation(); bumpQty(room, 1); });
    return card;
  }

  function qtyBtn(label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'room-qty-btn';
    b.textContent = label;
    return b;
  }

  /* The generative fallback: a deterministic dusk gradient per suite, so a
     photo-less room still looks deliberate rather than broken. */
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

  // ---- selection: any number of suites, any spare units of each ----
  function pickedRooms() {
    return Object.keys(current.picks).map(function (k) { return current.picks[k]; });
  }

  function togglePick(room) {
    if (current.picks[room.roomTypeId]) {
      delete current.picks[room.roomTypeId];
      C.track('room_selected', { roomTypeId: room.roomTypeId, action: 'removed' }, stateCheckpoint());
    } else {
      current.picks[room.roomTypeId] = { room: room, qty: 1 };
      C.track('room_selected',
        { roomTypeId: room.roomTypeId, total: room.totalPrice }, stateCheckpoint());
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

  function stateCheckpoint() {
    return {
      from: current.from,
      to: current.to,
      rooms: pickedRooms().map(function (p) { return { roomTypeId: p.room.roomTypeId, qty: p.qty }; }),
    };
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
      .map(function (p) { return p.room.name + (p.qty > 1 ? ' ×' + p.qty : ''); })
      .join(' · ');
    els.sumDates.textContent = C.fmtDate(current.from) + ' — ' + C.fmtDate(current.to) +
      ' · ' + suites + ' suite' + (suites === 1 ? '' : 's');
    var total = selectionTotal();
    els.sumTotal.textContent = total
      ? C.money(total.sum, total.currency) +
        (total.extras > 0 ? ' + ' + C.money(total.extras, total.currency) + ' taxes & fees' : '')
      : '';
    els.sumNights.textContent = current.nights + ' night' + (current.nights === 1 ? '' : 's');
    els.continueNote.hidden = true;
    showSummary();
  }

  els.continueBtn.addEventListener('click', function () {
    var picks = pickedRooms();
    if (!picks.length) return;
    /* Honest state: checkout ships in its own certified batch; the intent —
       every suite and quantity — is recorded so the team can follow up. */
    var total = selectionTotal();
    C.track('checkout_started', {
      rooms: picks.map(function (p) { return { roomTypeId: p.room.roomTypeId, qty: p.qty }; }),
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
    setText('txtFootBrand', t.brand);
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
  function applyLogo() {
    if (!config.logoId) return;
    var img = document.getElementById('siteLogo');
    if (img) {
      img.src = MEDIA_BASE + config.logoId;
      img.hidden = false;
      var star = document.getElementById('brandStar');
      if (star) star.hidden = true;
    }
  }

  /* Shareable URLs (Dave, 2026-08-23): the search lands in the query string
     so a copied link renders the same for the next person. replaceState —
     no history spam; existing params (full=1, utm_*) survive. */
  function updateUrl(from, n) {
    try {
      var p = new URLSearchParams(location.search);
      p.set('arrive', from);
      p.set('nights', String(n));
      p.set('adults', els.adults.value);
      p.set('children', els.children.value);
      p.set('suites', els.rooms.value);
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
      var setSel = function (el, v, lo, hi) {
        var x = parseInt(v || '', 10);
        if (x >= lo && x <= hi) el.value = String(x);
      };
      els.arrive.value = arrive;
      setNights(n);
      setSel(els.adults, p.get('adults'), 1, 12);
      setSel(els.children, p.get('children'), 0, 12);
      setSel(els.rooms, p.get('suites'), 1, 6);
      if (form.requestSubmit) form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true }));
    } catch (e) { /* defaults are a fine landing */ }
  }

  // ---- boot ----
  C.startSession('desktop');
  C.fetchStatus()
    .then(function (s) { if (s && s.maintenance) show('maintenance'); })
    .catch(function () {});
  fetch('config.json')
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
  fetch('suites.json')
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (j) {
      suites = (j && j.suites) || {};
      lodge = (j && j.lodge) || null;
    })
    .catch(function () {});
  restoreFromUrl();
})();
