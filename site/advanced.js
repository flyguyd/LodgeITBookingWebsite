/* 7 Star Lodges booking — the ADVANCED SEARCH (Dave, 2026-09-04).
   One search per ROOM: each room is its own party (adults, children,
   infants); every room's search fires in parallel; as each answer lands the
   suites that can take that party are listed with a radio button; picking a
   suite for one room takes it out of every other room's list. Shared by the
   desktop and mobile builds — each hands in an adapter (how to read the base
   party, run a search, hydrate an answer, and continue to the stay). Zero
   framework, like the rest of the site. */
(function () {
  'use strict';
  var C = window.BKCore;
  var api = null;
  var state = { on: false, groups: [], results: [], picks: {}, seq: 0, nights: 0, from: null, to: null };
  var els = {};

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function num(v, lo, hi, dflt) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return dflt;
    return Math.min(Math.max(n, lo), hi);
  }
  function defaultGroup() {
    var b = api && api.baseParty ? api.baseParty() : null;
    return {
      adults: num(b && b.adults, 1, 12, 2),
      children: num(b && b.children, 0, 12, 0),
      infants: num(b && b.infants, 0, 6, 0),
    };
  }
  function maxRooms() {
    var n = api && api.maxRooms ? Number(api.maxRooms()) : 0;
    return isFinite(n) && n >= 1 ? n : 1;
  }
  function partyLabel(g) {
    var s = g.adults + (g.adults === 1 ? ' adult' : ' adults');
    if (g.children > 0) s += ', ' + g.children + (g.children === 1 ? ' child' : ' children');
    if (g.infants > 0) s += ', ' + g.infants + (g.infants === 1 ? ' infant' : ' infants');
    return s;
  }
  /** Every room's party added up — what the stay summary, the hold and the
   *  conservation levy see as "the party". */
  function party() {
    var t = { adults: 0, children: 0, infants: 0 };
    state.groups.forEach(function (g) { t.adults += g.adults; t.children += g.children; t.infants += g.infants; });
    return { adults: String(t.adults), children: String(t.children), infants: String(t.infants) };
  }

  // ---- the rooms (the form half) ----
  function selectFor(lo, hi, value, onChange) {
    var s = document.createElement('select');
    s.className = 'adv-sel';
    for (var i = lo; i <= hi; i++) {
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = String(i);
      if (i === value) o.selected = true;
      s.appendChild(o);
    }
    s.addEventListener('change', function () { onChange(parseInt(s.value, 10)); });
    return s;
  }
  function renderGroups() {
    els.groups.textContent = '';
    state.groups.forEach(function (g, i) {
      var row = el('div', 'adv-room');
      row.setAttribute('data-room', String(i + 1));
      row.appendChild(el('span', 'adv-room-name', 'Room ' + (i + 1)));
      var fields = el('div', 'adv-fields');
      [['Adults', 'adults', 1, 12], ['Children', 'children', 0, 12], ['Infants', 'infants', 0, 6]].forEach(function (d) {
        var f = el('label', 'adv-field');
        f.appendChild(el('span', null, d[0]));
        f.appendChild(selectFor(d[2], d[3], g[d[1]], function (v) { g[d[1]] = v; }));
        fields.appendChild(f);
      });
      row.appendChild(fields);
      if (state.groups.length > 1) {
        var rm = el('button', 'adv-remove', 'Remove');
        rm.type = 'button';
        rm.setAttribute('aria-label', 'Remove room ' + (i + 1));
        rm.addEventListener('click', function () {
          state.groups.splice(i, 1);
          state.results = [];
          state.picks = {};
          renderGroups();
          renderResults();
        });
        row.appendChild(rm);
      }
      els.groups.appendChild(row);
    });
    els.add.disabled = state.groups.length >= maxRooms();
    els.add.textContent = state.groups.length >= maxRooms()
      ? 'Every suite is spoken for at ' + maxRooms() + ' rooms'
      : '+ Add another room';
  }

  // ---- the results (one block per room) ----
  function pickedElsewhere(i, roomTypeId) {
    for (var k in state.picks) {
      if (Number(k) !== i && state.picks[k] === String(roomTypeId)) return true;
    }
    return false;
  }
  function renderResults() {
    els.results.textContent = '';
    if (!state.results.length) { els.cont.hidden = true; return; }
    var complete = true;
    state.groups.forEach(function (g, i) {
      var r = state.results[i] || { status: 'loading', rooms: [] };
      var block = el('section', 'adv-block glass');
      block.setAttribute('data-room', String(i + 1));
      var head = el('div', 'adv-block-head');
      head.appendChild(el('span', 'kicker', 'Room ' + (i + 1)));
      head.appendChild(el('span', 'adv-block-party', partyLabel(g)));
      block.appendChild(head);
      if (r.status === 'loading') {
        block.appendChild(el('p', 'adv-note', 'Asking the lodge…'));
        complete = false;
      } else if (r.status === 'error') {
        block.appendChild(el('p', 'adv-note', r.message || 'Something went wrong — please try again.'));
        complete = false;
      } else {
        var shown = r.rooms.filter(function (room) { return !pickedElsewhere(i, room.roomTypeId); });
        if (!shown.length) {
          block.appendChild(el('p', 'adv-note', r.rooms.length
            ? 'Every suite that takes this party is already chosen for another room.'
            : 'No suite takes ' + partyLabel(g) + ' for these dates.'));
          complete = false;
        }
        var list = el('div', 'adv-list');
        shown.forEach(function (room) {
          var id = String(room.roomTypeId);
          var lab = el('label', 'adv-opt' + (state.picks[i] === id ? ' on' : ''));
          lab.setAttribute('data-suite', id);
          var radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = 'advRoom' + (i + 1);
          radio.value = id;
          radio.checked = state.picks[i] === id;
          radio.addEventListener('change', function () { pick(i, id); });
          lab.appendChild(radio);
          var txt = el('span', 'adv-opt-main');
          txt.appendChild(el('span', 'adv-opt-name', room.name));
          var pp = C.priceParts(room, api.config ? api.config() : {});
          var meta = [];
          if (room.sleeps) meta.push('Sleeps ' + room.sleeps);
          if (room.available > 0 && room.available <= 2) meta.push(room.available === 1 ? 'Last suite' : 'Only ' + room.available + ' left');
          if (meta.length) txt.appendChild(el('span', 'adv-opt-meta', meta.join(' · ')));
          lab.appendChild(txt);
          lab.appendChild(el('span', 'adv-opt-price', pp.headline != null
            ? C.money(pp.headline + (pp.note && pp.note.kind === 'plus' ? pp.note.extras : 0), room.currency)
            : 'Rates on request'));
          list.appendChild(lab);
        });
        block.appendChild(list);
        if (!state.picks[i] || !shown.some(function (room) { return String(room.roomTypeId) === state.picks[i]; })) complete = false;
      }
      els.results.appendChild(block);
    });
    els.cont.hidden = false;
    els.cont.disabled = !complete;
    els.contNote.textContent = complete
      ? 'Every room has its suite.'
      : 'Choose a suite for every room to continue.';
  }
  function pick(i, roomTypeId) {
    state.picks[i] = String(roomTypeId);
    // Another room that had this suite loses it — the suite is one suite.
    for (var k in state.picks) if (Number(k) !== i && state.picks[k] === String(roomTypeId)) delete state.picks[k];
    renderResults();
    if (api.onPick) api.onPick(i, roomTypeId);
  }

  // ---- the search: every room in parallel ----
  function search(from, to, nights, code) {
    var seq = ++state.seq;
    state.from = from;
    state.to = to;
    state.nights = nights;
    state.picks = {};
    state.results = state.groups.map(function () { return { status: 'loading', rooms: [] }; });
    renderResults();
    if (api.onSearch) api.onSearch(state.groups.slice());
    state.groups.forEach(function (g, i) {
      api.search({
        from: from, to: to, rooms: 1,
        adults: String(g.adults), children: String(g.children), infants: String(g.infants),
        code: code || '',
      }).then(function (r) {
        if (seq !== state.seq) return;
        if (r.status !== 200) {
          state.results[i] = { status: 'error', rooms: [], message: r.status === 503
            ? 'Bookings are briefly paused — please try again shortly.'
            : (r.json && r.json.message) || null };
        } else {
          var rooms = api.hydrate(r.json, { adults: String(g.adults), children: String(g.children), infants: String(g.infants) });
          state.results[i] = {
            status: 'done', json: r.json,
            rooms: rooms.filter(function (room) { return room.available > 0 && !room.restricted; }),
          };
        }
        renderResults();
      }).catch(function () {
        if (seq !== state.seq) return;
        state.results[i] = { status: 'error', rooms: [], message: 'We could not reach the lodge — check your connection and try again.' };
        renderResults();
      });
    });
  }
  function continueClicked() {
    var picks = {};
    var ok = true;
    state.groups.forEach(function (g, i) {
      var id = state.picks[i];
      var r = state.results[i];
      var room = r && r.rooms ? r.rooms.filter(function (x) { return String(x.roomTypeId) === id; })[0] : null;
      if (!room) { ok = false; return; }
      picks[id] = { room: room, qty: 1, group: g };
    });
    if (!ok) return;
    api.onContinue(picks, party(), {
      from: state.from, to: state.to, nights: state.nights,
      json: state.results[0] && state.results[0].json,
    });
  }

  // ---- open / close ----
  function open(prefill) {
    if (!api) return;
    if (!state.groups.length) state.groups = [defaultGroup()];
    if (prefill) {
      state.groups[0] = { adults: num(prefill.adults, 1, 12, 2), children: num(prefill.children, 0, 12, 0), infants: num(prefill.infants, 0, 6, 0) };
    }
    state.on = true;
    document.body.classList.add('adv-on');
    els.panel.hidden = false;
    renderGroups();
    renderResults();
    if (api.onToggle) api.onToggle(true);
    if (api.scrollTop) api.scrollTop();
    C.track('advanced_search_opened', { rooms: state.groups.length });
  }
  function close() {
    state.on = false;
    document.body.classList.remove('adv-on');
    els.panel.hidden = true;
    state.results = [];
    state.picks = {};
    if (api.onToggle) api.onToggle(false);
  }
  function attach(opts) {
    api = opts;
    els.panel = opts.panel;
    els.groups = opts.panel.querySelector('.adv-rooms');
    els.add = opts.panel.querySelector('.adv-add');
    els.results = opts.panel.querySelector('.adv-results');
    els.cont = opts.panel.querySelector('.adv-continue');
    els.contNote = opts.panel.querySelector('.adv-continue-note');
    els.closeBtn = opts.panel.querySelector('.adv-close');
    state.groups = [defaultGroup()];
    els.add.addEventListener('click', function () {
      if (state.groups.length >= maxRooms()) return;
      state.groups.push(defaultGroup());
      state.results = [];
      state.picks = {};
      renderGroups();
      renderResults();
    });
    els.cont.addEventListener('click', continueClicked);
    if (els.closeBtn) els.closeBtn.addEventListener('click', close);
    els.panel.hidden = true;
  }
  /** The rooms with the suite each one chose — kept on the hold so Lodge
   *  Ops can re-price every suite for ITS party. */
  function snapshotGroups() {
    return state.groups.map(function (g, i) {
      return { adults: String(g.adults), children: String(g.children), infants: String(g.infants), roomTypeId: state.picks[i] || null };
    });
  }
  window.BKAdv = {
    attach: attach, open: open, close: close,
    isOn: function () { return state.on; },
    search: search, party: party, snapshotGroups: snapshotGroups,
    groups: function () { return state.groups.slice(); },
    picks: function () { return Object.assign({}, state.picks); },
  };
})();
