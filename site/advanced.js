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
  var state = { on: false, groups: [], results: [], picks: {}, combos: [], comboResults: [], comboPicks: {}, seq: 0, nights: 0, from: null, to: null, code: '' };
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
        var sel = selectFor(d[2], d[3], g[d[1]], function (v) { g[d[1]] = v; });
        f.appendChild(sel);
        fields.appendChild(f);
        // The same glass trigger + list the search bar's own counts wear
        // (Dave, 2026-09-04: "the person counts in advanced need to be
        // styled the same as the main search panel").
        if (window.BKCal && window.BKCal.glassSelect) window.BKCal.glassSelect(sel);
      });
      row.appendChild(fields);
      if (state.groups.length > 1) {
        var rm = el('button', 'adv-remove', 'Remove');
        rm.type = 'button';
        rm.setAttribute('aria-label', 'Remove room ' + (i + 1));
        rm.addEventListener('click', function () {
          state.groups.splice(i, 1);
          state.results = [];
          state.comboResults = [];
          state.combos = [];
          state.picks = {};
          state.comboPicks = {};
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

  // ---- the room combinations that could share ONE suite ----
  /** Dave, 2026-09-04: "If the user asks for 2 rooms of 2 adults and 1
   *  child, also look at family rooms that have the capacity to
   *  accommodate both groups in 1 room." Every search also asks for the
   *  rooms TOGETHER: all of them as one party, and with three rooms each
   *  pair as well (four rooms or more: everyone together only — the pairs
   *  would be too many searches to be honest about). */
  function combos() {
    var n = state.groups.length;
    if (n < 2) return [];
    var out = [];
    if (n === 3) out.push([0, 1], [0, 2], [1, 2]);
    var all = [];
    for (var i = 0; i < n; i++) all.push(i);
    out.push(all);
    return out.map(function (rooms) {
      var t = { adults: 0, children: 0, infants: 0 };
      rooms.forEach(function (i) { var g = state.groups[i]; t.adults += g.adults; t.children += g.children; t.infants += g.infants; });
      return { rooms: rooms, party: t };
    });
  }
  function comboLabel(c) {
    return 'Rooms ' + c.rooms.map(function (i) { return i + 1; }).join(' + ') + ' together';
  }
  /** The combo (index) whose chosen suite covers room i, else -1. */
  function coveredBy(i) {
    for (var c = 0; c < state.combos.length; c++) {
      if (state.comboPicks[c] && state.combos[c].rooms.indexOf(i) >= 0) return c;
    }
    return -1;
  }
  /** Is this suite chosen by any OTHER room or combination? A suite is one
   *  suite: the moment it is taken anywhere it leaves every other list. */
  function takenElsewhere(ownerKey, roomTypeId) {
    var id = String(roomTypeId);
    // A choice this owner would REPLACE does not hide the suite: a
    // combination may take a suite one of its own rooms holds (the rooms
    // then share it), and a room may take the suite it is sharing (it keeps
    // it alone). Only a choice that would stand beside this one hides it.
    var own = ownerKey.charAt(0) === 'c' ? state.combos[Number(ownerKey.slice(1))].rooms : [Number(ownerKey.slice(1))];
    for (var k in state.picks) {
      if ('r' + k !== ownerKey && state.picks[k] === id && own.indexOf(Number(k)) < 0) return true;
    }
    for (var c in state.comboPicks) {
      if ('c' + c === ownerKey || state.comboPicks[c] !== id) continue;
      var overlaps = state.combos[Number(c)].rooms.some(function (i) { return own.indexOf(i) >= 0; });
      if (!overlaps) return true;
    }
    return false;
  }

  // ---- the results (one block per room, then one per combination) ----
  /** One suite in a block: TWO click zones (Dave, 2026-09-04) — the pad
   *  around the radio chooses the suite; the name, details and rate open
   *  the suite's lightbox, the same one the standard cards open, whose
   *  Add / Remove button chooses or un-chooses it for this room. */
  function optionFor(room, ownerKey, radioName, checked, onPick, onUnpick) {
    var id = String(room.roomTypeId);
    var row = el('div', 'adv-opt' + (checked ? ' on' : ''));
    row.setAttribute('data-suite', id);
    var pad = el('label', 'adv-opt-pick');
    pad.title = 'Choose this suite';
    var radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = radioName;
    radio.value = id;
    radio.checked = checked;
    radio.addEventListener('change', function () { onPick(id); });
    pad.appendChild(radio);
    row.appendChild(pad);
    var main = el('button', 'adv-opt-main');
    main.type = 'button';
    main.title = 'See the suite';
    var txt = el('span', 'adv-opt-text');
    txt.appendChild(el('span', 'adv-opt-name', room.name));
    var pp = C.priceParts(room, api.config ? api.config() : {});
    var meta = [];
    if (room.sleeps) meta.push('Sleeps ' + room.sleeps);
    if (room.availabilityKnown === false) meta.push('Availability on request');
    else if (room.available > 0 && room.available <= 2) meta.push(room.available === 1 ? 'Last suite' : 'Only ' + room.available + ' left');
    if (meta.length) txt.appendChild(el('span', 'adv-opt-meta', meta.join(' · ')));
    main.appendChild(txt);
    main.appendChild(el('span', 'adv-opt-price', pp.headline != null
      ? C.money(pp.headline + (pp.note && pp.note.kind === 'plus' ? pp.note.extras : 0), room.currency)
      : 'Rates on request'));
    main.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (!api.openSuite) { onPick(id); return; }
      api.openSuite(room, state.nights, isChosen(ownerKey, id), function () {
        if (isChosen(ownerKey, id)) { onUnpick(); return false; }
        onPick(id);
        return true;
      });
    });
    row.appendChild(main);
    return row;
  }
  function isChosen(ownerKey, id) {
    return ownerKey.charAt(0) === 'c'
      ? state.comboPicks[Number(ownerKey.slice(1))] === id
      : state.picks[Number(ownerKey.slice(1))] === id;
  }
  function unpick(ownerKey) {
    if (ownerKey.charAt(0) === 'c') delete state.comboPicks[Number(ownerKey.slice(1))];
    else delete state.picks[Number(ownerKey.slice(1))];
    renderResults();
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
      var cov = coveredBy(i);
      if (cov >= 0) {
        var shared = state.combos[cov];
        var others = shared.rooms.filter(function (k) { return k !== i; }).map(function (k) { return 'Room ' + (k + 1); });
        var sr = state.comboResults[cov];
        var sname = sr && sr.rooms ? (sr.rooms.filter(function (x) { return String(x.roomTypeId) === state.comboPicks[cov]; })[0] || {}).name : null;
        block.classList.add('shared');
        block.appendChild(el('p', 'adv-note adv-share-note', 'Sharing ' + (sname ? 'the ' + sname : 'one suite') + ' with ' + others.join(' and ') + ' — chosen below. Pick a suite here to give this room its own.'));
      }
      if (r.status === 'loading') {
        block.appendChild(el('p', 'adv-note', 'Asking the lodge…'));
        complete = false;
      } else if (r.status === 'error') {
        block.appendChild(el('p', 'adv-note', r.message || 'Something went wrong — please try again.'));
        complete = false;
      } else {
        var shown = r.rooms.filter(function (room) { return !takenElsewhere('r' + i, room.roomTypeId); });
        if (!shown.length && cov < 0) {
          block.appendChild(el('p', 'adv-note', r.rooms.length
            ? 'Every suite that takes this party is already chosen for another room.'
            : 'No suite takes ' + partyLabel(g) + ' for these dates.'));
        }
        var list = el('div', 'adv-list');
        shown.forEach(function (room) {
          list.appendChild(optionFor(room, 'r' + i, 'advRoom' + (i + 1), state.picks[i] === String(room.roomTypeId), function (id) { pick(i, id); }, function () { unpick('r' + i); }));
        });
        block.appendChild(list);
        var own = !!state.picks[i] && shown.some(function (room) { return String(room.roomTypeId) === state.picks[i]; });
        if (!own && cov < 0) complete = false;
      }
      els.results.appendChild(block);
    });
    state.combos.forEach(function (c, ci) {
      var r = state.comboResults[ci] || { status: 'loading', rooms: [] };
      var block = el('section', 'adv-block adv-block-shared glass');
      block.setAttribute('data-combo', String(ci + 1));
      block.setAttribute('data-rooms', c.rooms.map(function (i) { return i + 1; }).join('+'));
      var head = el('div', 'adv-block-head');
      head.appendChild(el('span', 'kicker', comboLabel(c)));
      head.appendChild(el('span', 'adv-block-party', partyLabel(c.party)));
      block.appendChild(head);
      block.appendChild(el('p', 'adv-note adv-share-lead', 'One suite with room for everyone in these rooms — priced for the whole party.'));
      if (r.status === 'loading') {
        block.appendChild(el('p', 'adv-note', 'Asking the lodge…'));
      } else if (r.status === 'error') {
        block.appendChild(el('p', 'adv-note', r.message || 'Something went wrong — please try again.'));
      } else {
        var shown = r.rooms.filter(function (room) { return !takenElsewhere('c' + ci, room.roomTypeId); });
        if (!shown.length) {
          block.appendChild(el('p', 'adv-note', r.rooms.length
            ? 'Every suite that takes everyone is already chosen for another room.'
            : 'No suite takes ' + partyLabel(c.party) + ' together for these dates.'));
        }
        var list = el('div', 'adv-list');
        shown.forEach(function (room) {
          list.appendChild(optionFor(room, 'c' + ci, 'advCombo' + (ci + 1), state.comboPicks[ci] === String(room.roomTypeId), function (id) { pickCombo(ci, id); }, function () { unpick('c' + ci); }));
        });
        block.appendChild(list);
        if (state.comboPicks[ci] && !shown.some(function (room) { return String(room.roomTypeId) === state.comboPicks[ci]; })) complete = false;
      }
      els.results.appendChild(block);
    });
    // The running total (Dave, 2026-09-04: "add a row below the cards with a
    // total as selections are made") — the same figures the options show,
    // added up over the suites chosen so far.
    var tot = chosenTotal();
    var row = el('div', 'adv-total glass');
    var left = el('div', 'adv-total-text');
    var roomsWithSuite = state.groups.filter(function (g, i) { return coveredBy(i) >= 0 || !!state.picks[i]; }).length;
    left.appendChild(el('strong', null, complete
      ? 'Every room has its suite'
      : (roomsWithSuite ? roomsWithSuite + ' of ' + state.groups.length + ' rooms ' + (roomsWithSuite === 1 ? 'has' : 'have') + ' a suite so far' : 'No suite chosen yet')));
    left.appendChild(el('span', 'adv-total-note', tot.n
      ? (tot.n + (tot.n === 1 ? ' suite' : ' suites') + ' · ' + state.nights + (state.nights === 1 ? ' night' : ' nights') + (tot.priced ? ' · taxes included' : ' · suites on request are not in the total'))
      : 'Pick a suite in each room above — the total adds up here.'));
    row.appendChild(left);
    row.appendChild(el('div', 'adv-total-amount', tot.n && tot.currency ? C.money(tot.sum, tot.currency) : '—'));
    els.results.appendChild(row);
    els.cont.hidden = false;
    els.cont.disabled = !complete;
    els.contNote.textContent = complete
      ? 'Every room has its suite.'
      : 'Choose a suite for every room to continue.';
  }
  /** The chosen suites' prices added up — exactly the figures on the options. */
  function chosenTotal() {
    var out = { sum: 0, n: 0, priced: true, currency: null };
    assignments().forEach(function (a) {
      if (!a.room || !a.id) return;
      out.n += 1;
      var pp = C.priceParts(a.room, api.config ? api.config() : {});
      if (pp.headline == null) { out.priced = false; return; }
      out.sum += pp.headline + (pp.note && pp.note.kind === 'plus' ? pp.note.extras : 0);
      out.currency = a.room.currency || out.currency;
    });
    return out;
  }
  function dropSuiteElsewhere(ownerKey, id) {
    for (var k in state.picks) if ('r' + k !== ownerKey && state.picks[k] === id) delete state.picks[k];
    for (var c in state.comboPicks) if ('c' + c !== ownerKey && state.comboPicks[c] === id) delete state.comboPicks[c];
  }
  function pick(i, roomTypeId) {
    var id = String(roomTypeId);
    state.picks[i] = id;
    // This room now has its own suite: it leaves any shared choice it was in.
    state.combos.forEach(function (c, ci) { if (c.rooms.indexOf(i) >= 0) delete state.comboPicks[ci]; });
    dropSuiteElsewhere('r' + i, id);
    renderResults();
    if (api.onPick) api.onPick(i, roomTypeId);
  }
  function pickCombo(ci, roomTypeId) {
    var id = String(roomTypeId);
    state.comboPicks[ci] = id;
    var rooms = state.combos[ci].rooms;
    // The rooms sharing it give up their own suites and any other sharing.
    rooms.forEach(function (i) { delete state.picks[i]; });
    state.combos.forEach(function (c, k) {
      if (k !== ci && c.rooms.some(function (i) { return rooms.indexOf(i) >= 0; })) delete state.comboPicks[k];
    });
    dropSuiteElsewhere('c' + ci, id);
    renderResults();
    if (api.onPick) api.onPick(rooms, roomTypeId);
  }

  // ---- the search: every room in parallel, and the rooms together ----
  function partyStrings(g) {
    return { adults: String(g.adults), children: String(g.children), infants: String(g.infants) };
  }
  function fitsAll(room, g) {
    // The engine refuses an oversize party when the suite's maxima are set
    // (028); when only "sleeps" is known, the count of everyone must fit.
    if (room.restricted || room.overCapacity) return false;
    if (room.sleeps && room.sleeps < g.adults + g.children + g.infants) return false;
    return true;
  }
  function runOne(g, seq, land) {
    var ps = partyStrings(g);
    api.search({ from: state.from, to: state.to, rooms: 1, adults: ps.adults, children: ps.children, infants: ps.infants, code: state.code || '' })
      .then(function (r) {
        if (seq !== state.seq) return;
        if (r.status !== 200) {
          land({ status: 'error', rooms: [], message: r.status === 503
            ? 'Bookings are briefly paused — please try again shortly.'
            : (r.json && r.json.message) || null });
        } else {
          var rooms = api.hydrate(r.json, ps);
          land({
            status: 'done', json: r.json,
            /* The same rule as the cards (Dave, 2026-09-04: "Advanced
               search fails only showing 1 suite"): a suite is listed
               unless it is sold out, refused for the party, or over
               capacity — one whose availability the lodge cannot confirm
               is listed "Availability on request", exactly as its card is. */
            rooms: rooms.filter(function (room) {
              return fitsAll(room, g) && (room.available > 0 || room.availabilityKnown === false);
            }),
          });
        }
      }).catch(function () {
        if (seq !== state.seq) return;
        land({ status: 'error', rooms: [], message: 'We could not reach the lodge — check your connection and try again.' });
      });
  }
  function search(from, to, nights, code) {
    var seq = ++state.seq;
    state.from = from;
    state.to = to;
    state.nights = nights;
    state.code = code || '';
    state.picks = {};
    state.comboPicks = {};
    state.combos = combos();
    state.results = state.groups.map(function () { return { status: 'loading', rooms: [] }; });
    state.comboResults = state.combos.map(function () { return { status: 'loading', rooms: [] }; });
    renderResults();
    if (api.onSearch) api.onSearch(state.groups.slice());
    state.groups.forEach(function (g, i) {
      runOne(g, seq, function (res) { state.results[i] = res; renderResults(); });
    });
    state.combos.forEach(function (c, ci) {
      runOne(c.party, seq, function (res) { state.comboResults[ci] = res; renderResults(); });
    });
  }
  /** Every suite chosen, in ROOM order: a room's own suite, or the shared
   *  suite where the rooms it covers first appear. */
  function assignments() {
    var out = [];
    var seenCombo = {};
    state.groups.forEach(function (g, i) {
      var cov = coveredBy(i);
      if (cov >= 0) {
        if (seenCombo[cov]) return;
        seenCombo[cov] = true;
        var c = state.combos[cov];
        var cr = state.comboResults[cov];
        var room = cr && cr.rooms ? cr.rooms.filter(function (x) { return String(x.roomTypeId) === state.comboPicks[cov]; })[0] : null;
        out.push({ room: room, id: state.comboPicks[cov], group: c.party, rooms: c.rooms.slice(), order: i });
        return;
      }
      var r = state.results[i];
      var own = r && r.rooms ? r.rooms.filter(function (x) { return String(x.roomTypeId) === state.picks[i]; })[0] : null;
      out.push({ room: own, id: state.picks[i] || null, group: g, rooms: [i], order: i });
    });
    return out;
  }
  function continueClicked() {
    var picks = {};
    var order = [];
    var ok = true;
    assignments().forEach(function (a) {
      if (!a.room || !a.id) { ok = false; return; }
      picks[a.id] = { room: a.room, qty: 1, group: a.group, rooms: a.rooms, order: a.order };
      order.push(a.id);
    });
    if (!ok || !order.length) return;
    api.onContinue(picks, party(), {
      from: state.from, to: state.to, nights: state.nights,
      json: state.results[0] && state.results[0].json,
      order: order,
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
    state.comboResults = [];
    state.combos = [];
    state.picks = {};
    state.comboPicks = {};
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
      state.comboResults = [];
      state.combos = [];
      state.picks = {};
      state.comboPicks = {};
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
    // One entry per SUITE with the party it sleeps — rooms sharing a suite
    // are one entry with their parties added up, so the hold and the
    // checkout price that suite for everyone in it.
    return assignments().map(function (a) {
      return { adults: String(a.group.adults), children: String(a.group.children), infants: String(a.group.infants), roomTypeId: a.id || null, rooms: a.rooms.map(function (i) { return i + 1; }) };
    });
  }
  window.BKAdv = {
    attach: attach, open: open, close: close,
    isOn: function () { return state.on; },
    search: search, party: party, snapshotGroups: snapshotGroups,
    groups: function () { return state.groups.slice(); },
    picks: function () { return Object.assign({}, state.picks); },
    assignments: assignments,
  };
})();
