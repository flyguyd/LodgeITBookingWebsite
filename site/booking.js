/* 7 Star Lodges booking site — framework-free by design (spec §23).
   Talks only to the engine's /api/public surface on the same origin. */
(function () {
  'use strict';

  var API = '/api/public';

  // ---- pure helpers (harness-tested from source; keep them dependency-free) ----

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

  // ---- element handles ----
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

  var sessionId = null;
  var current = { from: null, to: null, results: [], selected: null };

  // ---- session + analytics (fire-and-forget; never blocks the guest) ----

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

  function startSession() {
    post('/sessions', {
      source: captureSource(location.search, document.referrer, location.pathname),
    })
      .then(function (r) { sessionId = r && r.sessionId; })
      .catch(function () {});
  }

  // ---- UI states ----

  var stateEls = ['loading', 'maintenance', 'unavailable', 'empty', 'results'];
  function show(state) {
    stateEls.forEach(function (k) { els[k].hidden = k !== state; });
    if (state !== 'results') els.summary.hidden = true;
  }
  function hideStates() {
    stateEls.forEach(function (k) { els[k].hidden = true; });
  }

  // ---- init form ----

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
  els.arrive.value = isoToday(14);
  els.depart.value = isoToday(17);
  els.arrive.min = isoToday(0);
  els.depart.min = isoToday(1);

  // ---- search ----

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var from = els.arrive.value;
    var to = els.depart.value;
    els.note.hidden = true;
    if (!from || !to || nightsBetween(from, to) < 1) {
      els.note.textContent = 'Departure must be after arrival.';
      els.note.hidden = false;
      return;
    }
    current.from = from;
    current.to = to;
    current.selected = null;
    show('loading');
    els.btn.disabled = true;
    track('search_started', { from: from, to: to, adults: els.adults.value, children: els.children.value, rooms: els.rooms.value },
      { from: from, to: to });

    var q = '?from=' + from + '&to=' + to +
      '&adults=' + els.adults.value + '&children=' + els.children.value +
      '&rooms=' + els.rooms.value;
    fetch(API + '/availability' + q)
      .then(function (res) { return res.json().then(function (j) { return { status: res.status, json: j }; }); })
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
        track('availability_viewed', { count: current.results.length });
        if (!current.results.length) { show('empty'); return; }
        renderResults(r.json);
        show('results');
      })
      .catch(function () {
        els.btn.disabled = false;
        hideStates();
        els.note.textContent = 'We could not reach the lodge — check your connection and try again.';
        els.note.hidden = false;
      });
  });

  // ---- results ----

  function renderResults(payload) {
    var nights = payload.nights;
    els.resultsHead.textContent =
      fmtDate(payload.from) + ' → ' + fmtDate(payload.to) + ' · ' +
      nights + ' night' + (nights === 1 ? '' : 's');
    els.roomList.textContent = '';
    payload.results.forEach(function (room) {
      els.roomList.appendChild(renderRoom(room, nights));
    });
  }

  function renderRoom(room, nights) {
    var card = document.createElement('article');
    card.className = 'bk-room';

    var top = document.createElement('div');
    top.className = 'bk-room-top';
    var name = document.createElement('h3');
    name.className = 'bk-room-name';
    name.textContent = room.name;
    var price = document.createElement('div');
    price.className = 'bk-room-price';
    if (room.totalPrice != null) {
      var total = document.createElement('span');
      total.className = 'bk-room-total';
      total.textContent = money(room.totalPrice, room.currency);
      var pn = document.createElement('span');
      pn.className = 'bk-room-pn';
      pn.textContent = money(Number(room.totalPrice) / nights, room.currency) + ' per night';
      price.appendChild(total);
      price.appendChild(pn);
    }
    top.appendChild(name);
    top.appendChild(price);
    card.appendChild(top);

    var meta = document.createElement('div');
    meta.className = 'bk-room-meta';
    // Factual scarcity only — no artificial urgency (spec §7).
    if (room.available > 0 && room.available <= 2) {
      meta.appendChild(tag(room.available === 1 ? 'Last suite at this price' : 'Only ' + room.available + ' left', true));
    }
    if (room.restrictions && room.restrictions.minLos > 1) {
      meta.appendChild(tag('Minimum ' + room.restrictions.minLos + ' nights'));
    }
    meta.appendChild(tag('Free cancellation terms shown at checkout'));
    card.appendChild(meta);

    var actions = document.createElement('div');
    actions.className = 'bk-room-actions';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bk-select';
    btn.textContent = 'Select';
    btn.addEventListener('click', function () { selectRoom(room, nights, card); });
    actions.appendChild(btn);
    card.appendChild(actions);
    return card;
  }

  function tag(text, scarce) {
    var t = document.createElement('span');
    t.className = 'bk-tag' + (scarce ? ' scarce' : '');
    t.textContent = text;
    return t;
  }

  // ---- selection ----

  function selectRoom(room, nights, card) {
    current.selected = room;
    var cards = els.roomList.querySelectorAll('.bk-room');
    for (var i = 0; i < cards.length; i++) cards[i].classList.remove('selected');
    card.classList.add('selected');

    els.sumRoom.textContent = room.name;
    els.sumDates.textContent = fmtDate(current.from) + ' → ' + fmtDate(current.to);
    els.sumTotal.textContent = room.totalPrice != null ? money(room.totalPrice, room.currency) : '';
    els.sumNights.textContent = nights + ' night' + (nights === 1 ? '' : 's');
    els.summary.hidden = false;
    els.continueNote.hidden = true;
    track('room_selected', { roomTypeId: room.roomTypeId, total: room.totalPrice },
      { from: current.from, to: current.to, roomTypeId: room.roomTypeId });
  }

  els.continueBtn.addEventListener('click', function () {
    if (!current.selected) return;
    // Honest state: checkout ships in the next build; the intent is recorded
    // so the reservations team can follow up on abandoned selections.
    track('checkout_started', { roomTypeId: current.selected.roomTypeId });
    els.continueNote.hidden = false;
  });

  // ---- boot ----

  startSession();
  fetch(API + '/status')
    .then(function (r) { return r.json(); })
    .then(function (s) { if (s && s.maintenance) show('maintenance'); })
    .catch(function () {});

  // Exposed for the verification harness only.
  window.__bk = { nightsBetween: nightsBetween, money: money, fmtDate: fmtDate, captureSource: captureSource };
})();
