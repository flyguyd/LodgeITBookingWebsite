/* 7 Star Lodges booking — rate calendar (shared by both builds).
   Replaces the native date picker on the ARRIVE field with a glass calendar
   that shows, for each day, the cheapest available suite rate for that night
   (Dave, 2026-08-23). Rates come from /api/public/rate-calendar via
   BKCore.fetchRateCalendar and are cached per month; the calendar renders
   instantly and the rates fill in when they arrive. Days the engine cannot
   price show no figure — nothing is ever invented. Sold-out nights render
   dimmed with a dash but stay pickable: multi-night stays and the
   show-unavailable setting decide what search results say. */
window.BKCal = (function () {
  'use strict';

  var DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function iso(y, m, d) {
    return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  /** Compact money for a day cell: R980 · R4.2k · R12.5k. */
  function fmtShort(n, currency) {
    var sym = currency === 'ZAR' || !currency ? 'R' : currency + ' ';
    if (n >= 1000) {
      var k = Math.round(n / 100) / 10;
      return sym + (k >= 100 ? Math.round(k) : k) + 'k';
    }
    return sym + Math.round(n);
  }

  function attach(input, opts) {
    var fetchRates = opts.fetchRates;
    var minIso = opts.minIso || '';
    var monthCache = {}; // 'YYYY-MM' -> {days} (also holds in-flight promises)

    // The native picker steps aside; the field stays the source of truth
    // (ISO in .value) so the form code never changes.
    try { input.type = 'text'; } catch (e) { /* some browsers refuse; fine */ }
    input.readOnly = true;
    input.setAttribute('inputmode', 'none');

    var pop = document.createElement('div');
    pop.className = 'cal glass';
    pop.hidden = true;
    // Under the field's label so relative positioning works in both builds.
    var host = input.closest('label') || input.parentElement;
    host.style.position = 'relative';
    host.appendChild(pop);

    var view = null; // {y, m} currently rendered

    function monthKey(y, m) { return y + '-' + String(m + 1).padStart(2, '0'); }

    function loadMonth(y, m) {
      var key = monthKey(y, m);
      if (monthCache[key]) return monthCache[key];
      var first = iso(y, m, 1);
      var next = m === 11 ? iso(y + 1, 0, 1) : iso(y, m + 1, 1);
      var p = fetchRates(first, next).then(function (r) {
        monthCache[key] = (r && r.days) ? { days: r.days, currency: r.currency } : { days: {}, currency: null };
        return monthCache[key];
      });
      monthCache[key] = p; // de-dupe concurrent loads
      return p;
    }

    function render(y, m) {
      view = { y: y, m: m };
      pop.textContent = '';

      var head = document.createElement('div');
      head.className = 'cal-head';
      var prev = navBtn('‹', -1);
      var title = document.createElement('span');
      title.className = 'cal-title';
      title.textContent = MONTHS[m] + ' ' + y;
      var next = navBtn('›', 1);
      head.appendChild(prev);
      head.appendChild(title);
      head.appendChild(next);
      pop.appendChild(head);

      var grid = document.createElement('div');
      grid.className = 'cal-grid';
      DOW.forEach(function (d) {
        var el = document.createElement('span');
        el.className = 'cal-dow';
        el.textContent = d;
        grid.appendChild(el);
      });

      var firstDow = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // Monday first
      var daysIn = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      for (var i = 0; i < firstDow; i++) {
        grid.appendChild(document.createElement('span'));
      }
      var cells = {};
      for (var d = 1; d <= daysIn; d++) {
        var dayIso = iso(y, m, d);
        var cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cal-day';
        if (dayIso === input.value) cell.className += ' picked';
        var num = document.createElement('span');
        num.className = 'cal-num';
        num.textContent = String(d);
        var rate = document.createElement('span');
        rate.className = 'cal-rate';
        rate.textContent = '';
        cell.appendChild(num);
        cell.appendChild(rate);
        if (minIso && dayIso < minIso) {
          cell.disabled = true;
          cell.className += ' past';
        } else {
          cell.addEventListener('click', pickHandler(dayIso));
        }
        cells[dayIso] = cell;
        grid.appendChild(cell);
      }
      pop.appendChild(grid);

      var note = document.createElement('div');
      note.className = 'cal-note';
      note.textContent = 'Cheapest available suite, per night';
      pop.appendChild(note);

      Promise.resolve(loadMonth(y, m)).then(function (data) {
        if (!view || view.y !== y || view.m !== m) return; // month moved on
        Object.keys(cells).forEach(function (dIso) {
          var day = data.days[dIso];
          var el = cells[dIso].querySelector('.cal-rate');
          if (!day || cells[dIso].disabled) return;
          if (day.available === false) {
            cells[dIso].classList.add('full');
            el.textContent = '—';
          } else if (day.minRate != null && isFinite(Number(day.minRate))) {
            el.textContent = fmtShort(Number(day.minRate), data.currency);
          }
        });
      });
    }

    function navBtn(label, delta) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cal-nav';
      b.textContent = label;
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var m = view.m + delta;
        var y = view.y;
        if (m < 0) { m = 11; y -= 1; }
        if (m > 11) { m = 0; y += 1; }
        render(y, m);
      });
      return b;
    }

    function pickHandler(dayIso) {
      return function (ev) {
        ev.stopPropagation();
        input.value = dayIso;
        close();
        if (opts.onPick) opts.onPick(dayIso);
      };
    }

    function open() {
      if (!pop.hidden) return;
      var base = input.value && /^\d{4}-\d{2}-\d{2}$/.test(input.value)
        ? input.value
        : (minIso || new Date().toISOString().slice(0, 10));
      render(Number(base.slice(0, 4)), Number(base.slice(5, 7)) - 1);
      pop.hidden = false;
      // The search bar can sit near the fold — bring the whole month into view.
      requestAnimationFrame(function () {
        pop.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
    function close() { pop.hidden = true; view = null; }

    input.addEventListener('click', function (ev) { ev.preventDefault(); open(); });
    input.addEventListener('focus', open);
    document.addEventListener('click', function (ev) {
      if (!pop.hidden && !host.contains(ev.target)) close();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') close();
    });

    return { open: open, close: close };
  }

  return { attach: attach, fmtShort: fmtShort };
})();

/* Exposed for the verification harness only. */
window.__bkcal = { fmtShort: window.BKCal.fmtShort };
