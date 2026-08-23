/* 7 Star Lodges booking — MOBILE UI on top of ../core.js. Presentation only;
   built for one thumb: steppers instead of selects, whole-card tap-to-add
   (any number of suites), and a sticky glass bar carrying total + Continue. */
(function () {
  'use strict';
  var C = window.BKCore;

  var $ = function (id) { return document.getElementById(id); };
  var form = $('searchForm');
  var els = {
    arrive: $('fArrive'), depart: $('fDepart'), adults: $('fAdults'),
    children: $('fChildren'), rooms: $('fRooms'), btn: $('searchBtn'),
    note: $('formNote'), loading: $('stateLoading'),
    maintenance: $('stateMaintenance'), unavailable: $('stateUnavailable'),
    empty: $('stateEmpty'), results: $('results'), resultsHead: $('resultsHead'),
    roomList: $('roomList'), summary: $('summary'), sumRoom: $('sumRoom'),
    sumDates: $('sumDates'), sumTotal: $('sumTotal'), sumNights: $('sumNights'),
    continueBtn: $('continueBtn'), continueNote: $('continueNote'),
  };

  var current = { from: null, to: null, results: [], picks: {}, nights: 0 };
  var media = {};
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
  els.depart.value = C.isoToday(17);
  els.arrive.min = C.isoToday(0);
  els.depart.min = C.isoToday(1);

  // ---- search ----
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var from = els.arrive.value;
    var to = els.depart.value;
    els.note.hidden = true;
    if (!from || !to || C.nightsBetween(from, to) < 1) {
      els.note.textContent = 'Departure must be after arrival.';
      els.note.hidden = false;
      return;
    }
    current.from = from;
    current.to = to;
    current.picks = {};
    show('loading');
    els.btn.disabled = true;
    var params = {
      from: from, to: to,
      adults: els.adults.textContent, children: els.children.textContent,
      rooms: els.rooms.textContent,
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
        C.track('availability_viewed', { count: current.results.length });
        if (!current.results.length) { show('empty'); return; }
        renderResults(r.json);
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

  function renderResults(payload) {
    els.resultsHead.textContent =
      C.fmtDate(payload.from) + ' — ' + C.fmtDate(payload.to) + ' · ' +
      payload.nights + ' night' + (payload.nights === 1 ? '' : 's');
    els.roomList.textContent = '';
    payload.results.forEach(function (room, i) {
      els.roomList.appendChild(renderRoom(room, payload.nights, i));
    });
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
    if (room.totalPrice != null) {
      var price = document.createElement('div');
      price.className = 'room-price';
      var total = document.createElement('span');
      total.className = 'room-total';
      total.textContent = C.money(room.totalPrice, room.currency);
      var pn = document.createElement('span');
      pn.className = 'room-pn';
      pn.textContent = C.money(Number(room.totalPrice) / nights, room.currency) + ' a night';
      price.appendChild(total);
      price.appendChild(pn);
      top.appendChild(price);
    }
    body.appendChild(top);

    var meta = document.createElement('div');
    meta.className = 'room-meta';
    if (room.maxGuests) meta.appendChild(tag('Sleeps ' + room.maxGuests));
    if (room.restrictions && room.restrictions.minLos > 1) {
      meta.appendChild(tag('Min ' + room.restrictions.minLos + ' nights'));
    }
    meta.appendChild(tag('Tap to add'));
    body.appendChild(meta);

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

    card.addEventListener('click', function () { togglePick(room); });
    card.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); togglePick(room); }
    });
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
      rooms: pickedRooms().map(function (p) { return { roomTypeId: p.room.roomTypeId, qty: p.qty }; }),
    };
  }
  function togglePick(room) {
    if (current.picks[room.roomTypeId]) {
      delete current.picks[room.roomTypeId];
      C.track('room_selected', { roomTypeId: room.roomTypeId, action: 'removed' }, stateCheckpoint());
    } else {
      current.picks[room.roomTypeId] = { room: room, qty: 1 };
      C.track('room_selected', { roomTypeId: room.roomTypeId, total: room.totalPrice }, stateCheckpoint());
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
    var sum = 0, priced = false, currency = null;
    pickedRooms().forEach(function (p) {
      if (p.room.totalPrice != null) {
        sum += Number(p.room.totalPrice) * p.qty;
        priced = true;
        currency = currency || p.room.currency;
      }
    });
    return priced ? { sum: sum, currency: currency } : null;
  }
  function updateSummary() {
    var picks = pickedRooms();
    if (!picks.length) { hideSummary(); return; }
    var suites = picks.reduce(function (n, p) { return n + p.qty; }, 0);
    els.sumRoom.textContent = picks
      .map(function (p) { return p.room.name + (p.qty > 1 ? ' ×' + p.qty : ''); })
      .join(' · ');
    els.sumDates.textContent = suites + ' suite' + (suites === 1 ? '' : 's');
    var total = selectionTotal();
    els.sumTotal.textContent = total ? C.money(total.sum, total.currency) : '';
    els.sumNights.textContent = current.nights + ' night' + (current.nights === 1 ? '' : 's');
    els.continueNote.hidden = true;
    showSummary();
  }

  els.continueBtn.addEventListener('click', function () {
    var picks = pickedRooms();
    if (!picks.length) return;
    var total = selectionTotal();
    C.track('checkout_started', {
      rooms: picks.map(function (p) { return { roomTypeId: p.room.roomTypeId, qty: p.qty }; }),
      total: total ? total.sum.toFixed(2) : null,
    }, stateCheckpoint());
    els.continueNote.hidden = false;
  });

  // ---- boot ----
  C.startSession('mobile');
  C.fetchStatus()
    .then(function (s) { if (s && s.maintenance) show('maintenance'); })
    .catch(function () {});
  fetch(MEDIA_BASE + 'rooms.json')
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (m) { media = m || {}; })
    .catch(function () {});
})();
