/* 7 Star Lodges booking — rate calendar + glass form controls (shared by
   both builds).

   BKCal.attach(input, opts) replaces the native date picker on the ARRIVE
   field with a glass calendar that shows, for each day, the cheapest
   available suite rate for that night (Dave, 2026-08-23) — two months side
   by side where the viewport allows (>= 720px), one larger month otherwise.
   Rates come from /api/public/rate-calendar via BKCore.fetchRateCalendar and
   are cached per month; the calendar renders instantly and the rates fill in
   when they arrive. Days the engine cannot price show no figure — nothing is
   ever invented. Sold-out nights render dimmed with a dash but stay
   pickable: multi-night stays and the show-unavailable setting decide what
   search results say.

   BKCal.glassSelect(select) dresses a native <select> in the site's glass
   language (the native popup cannot be styled): the select stays in the DOM
   as the value holder — hidden — while a styled trigger + popover list stand
   in for it. Picking an option sets select.value and fires a real 'change'
   event, so the form code never knows the difference; the trigger mirrors
   the select's [hidden] attribute, so the More…-swap logic keeps working
   untouched. */
window.BKCal = (function () {
  'use strict';

  var TODAY = new Date().toISOString().slice(0, 10);
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

  /* ---------------------------------------------------- the rate calendar */

  function attach(input, opts) {
    var fetchRates = opts.fetchRates;
    var minIso = opts.minIso || '';
    /* Bookable window: nothing in the past, nothing beyond maxIso (the site
       passes three years out) — days outside it disable, and the month
       navigation stops at the window's edges. */
    var maxIso = opts.maxIso || '';
    /* Rates are cached PER DAY so a page-load prefetch (opts.prefetchDays —
       the site passes 30) can warm the near future before the calendar ever
       opens, and opening it then fetches ONLY the days still missing from
       the visible months. Spans in flight are de-duped by their range. */
    var dayCache = {}; // iso -> {minRate, available}
    var currency = null;
    var pending = {}; // 'from..to' -> promise
    /* Range selection (Dave, 2026-08-23): the first click picks check-in and
       the calendar STAYS OPEN; a click on a later day picks checkout — the
       nights are computed and handed to opts.onRange. A click at or before
       check-in (including the next-day tap — the stay floor is 2 nights)
       restarts the range instead. */
    var rangeStart = null;
    var cellIndex = {}; // iso -> cell button, across the visible months

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

    var view = null; // {y, m} of the FIRST rendered month

    function addDay(d) {
      return new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    }

    function fetchSpan(from, to) {
      var key = from + '..' + to;
      if (pending[key]) return pending[key];
      var p = fetchRates(from, to).then(function (r) {
        delete pending[key];
        if (r && r.days) {
          currency = r.currency || currency;
          for (var k in r.days) dayCache[k] = r.days[k];
        }
        return null;
      });
      pending[key] = p;
      return p;
    }

    /** Resolve once every in-window day of the month is in dayCache —
     *  fetching only the missing stretch (past days are never asked for). */
    function ensureMonth(y, m) {
      var first = iso(y, m, 1);
      var next = m === 11 ? iso(y + 1, 0, 1) : iso(y, m + 1, 1);
      if (minIso && first < minIso) first = minIso;
      if (maxIso && next > addDay(maxIso)) next = addDay(maxIso);
      if (next <= first) return Promise.resolve(null);
      var missFrom = null;
      var missTo = null;
      for (var d = first; d < next; d = addDay(d)) {
        if (!dayCache[d]) {
          if (!missFrom) missFrom = d;
          missTo = d;
        }
      }
      if (!missFrom) return Promise.resolve(null);
      return fetchSpan(missFrom, addDay(missTo));
    }

    /* The page-load prefetch: today's next N days, before any open. */
    if (opts.prefetchDays > 0) {
      var pFrom = minIso || new Date().toISOString().slice(0, 10);
      fetchSpan(pFrom, addDay(addDaysIso(pFrom, opts.prefetchDays - 1)));
    }
    function addDaysIso(d, n) {
      return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    }

    function monthCount() {
      return window.matchMedia && window.matchMedia('(min-width: 720px)').matches ? 2 : 1;
    }

    /** One month block: title, dow row, day grid. Returns its cells. */
    function buildMonth(y, m) {
      var block = document.createElement('div');
      block.className = 'cal-month';
      var title = document.createElement('div');
      title.className = 'cal-title';
      title.textContent = MONTHS[m] + ' ' + y;
      block.appendChild(title);

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
      for (var i = 0; i < firstDow; i++) grid.appendChild(document.createElement('span'));
      var cells = {};
      for (var d = 1; d <= daysIn; d++) {
        var dayIso = iso(y, m, d);
        var cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cal-day';
        if (dayIso === input.value) cell.className += ' picked';
        cell.dataset.iso = dayIso;
        if (dayIso === TODAY) cell.className += ' today';
        var num = document.createElement('span');
        num.className = 'cal-num';
        num.textContent = String(d);
        var rate = document.createElement('span');
        rate.className = 'cal-rate';
        cell.appendChild(num);
        cell.appendChild(rate);
        if ((minIso && dayIso < minIso) || (maxIso && dayIso > maxIso)) {
          cell.disabled = true;
          cell.className += ' past';
        } else {
          cell.addEventListener('click', pickHandler(dayIso));
        }
        cells[dayIso] = cell;
        grid.appendChild(cell);
      }
      block.appendChild(grid);
      return { block: block, cells: cells, y: y, m: m };
    }

    function fillRates(built) {
      var paint = function () {
        if (!view) return;
        Object.keys(built.cells).forEach(function (dIso) {
          var day = dayCache[dIso];
          var cell = built.cells[dIso];
          if (!day || cell.disabled) return;
          var el = cell.querySelector('.cal-rate');
          if (day.available === false) {
            cell.classList.add('full');
            el.textContent = '—';
          } else if (day.minRate != null && isFinite(Number(day.minRate))) {
            el.textContent = fmtShort(Number(day.minRate), currency);
          }
        });
      };
      paint(); // whatever the prefetch already brought in shows instantly
      ensureMonth(built.y, built.m).then(paint);
    }

    function render(y, m) {
      view = { y: y, m: m };
      pop.textContent = '';
      cellIndex = {};
      var count = monthCount();
      pop.classList.toggle('cal-double', count === 2);

      var prev = navBtn('‹', -1);
      var next = navBtn('›', 1);
      // The nav never leaves the bookable window.
      var idx = y * 12 + m;
      if (minIso) {
        prev.disabled = idx <= Number(minIso.slice(0, 4)) * 12 + Number(minIso.slice(5, 7)) - 1;
      }
      if (maxIso) {
        next.disabled =
          idx + count - 1 >= Number(maxIso.slice(0, 4)) * 12 + Number(maxIso.slice(5, 7)) - 1;
      }
      pop.appendChild(prev);
      pop.appendChild(next);

      var months = document.createElement('div');
      months.className = 'cal-months';
      for (var i = 0; i < count; i++) {
        var mm = m + i;
        var yy = y + Math.floor(mm / 12);
        mm = ((mm % 12) + 12) % 12;
        var built = buildMonth(yy, mm);
        for (var k in built.cells) cellIndex[k] = built.cells[k];
        months.appendChild(built.block);
        fillRates(built);
      }
      pop.appendChild(months);

      var note = document.createElement('div');
      note.className = 'cal-note';
      note.textContent = 'Cheapest available suite, per night';
      pop.appendChild(note);

      // A month move mid-range keeps the suggestion visible where it lands.
      if (rangeStart) suggestFive();
    }

    function navBtn(label, delta) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cal-nav ' + (delta < 0 ? 'cal-prev' : 'cal-next');
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

    function setPicked(dayIso) {
      clearFree5();
      Object.keys(cellIndex).forEach(function (k) {
        cellIndex[k].classList.remove('picked');
        cellIndex[k].classList.remove('in-range');
      });
      if (cellIndex[dayIso]) cellIndex[dayIso].classList.add('picked');
    }

    function clearFree5() {
      var tags = pop.querySelectorAll('.cal-free5');
      for (var i = 0; i < tags.length; i++) tags[i].parentNode.removeChild(tags[i]);
    }

    /* The moment check-in is picked, a 5-night stay is suggested and the 5th
       night carries its promotion marker (Dave, 2026-08-23). The counting
       convention is his: each shaded day AFTER check-in is one night, so a
       5-night stay shades five days and the marker sits on the fifth —
       clicking that very cell books exactly 5 nights. Hovering another
       checkout previews that stay; mousing away restores the suggestion. */
    function shadeStay(endIso) {
      if (!rangeStart) return;
      var end = endIso && endIso > rangeStart ? endIso : addDaysIso(rangeStart, 5);
      Object.keys(cellIndex).forEach(function (k) {
        cellIndex[k].classList.toggle('in-range', k > rangeStart && k <= end);
      });
    }

    function suggestFive() {
      shadeStay(null);
      var fifth = cellIndex[addDaysIso(rangeStart, 5)];
      if (fifth && !fifth.disabled && !fifth.querySelector('.cal-free5')) {
        var b = document.createElement('span');
        b.className = 'cal-free5';
        b.textContent = '5th night free';
        fifth.appendChild(b);
      }
    }

    function pickHandler(dayIso) {
      return function (ev) {
        ev.stopPropagation();
        if (rangeStart) {
          var nights = Math.round(
            (Date.parse(dayIso + 'T00:00:00Z') - Date.parse(rangeStart + 'T00:00:00Z')) /
              86400000);
          if (nights >= 2) {
            var from = rangeStart;
            close();
            if (opts.onRange) opts.onRange(from, nights);
            return;
          }
        }
        rangeStart = dayIso;
        input.value = dayIso;
        setPicked(dayIso);
        suggestFive();
        if (opts.onPick) opts.onPick(dayIso);
      };
    }

    pop.addEventListener('mouseover', function (ev) {
      if (!rangeStart) return;
      var btn = ev.target && ev.target.closest ? ev.target.closest('.cal-day') : null;
      shadeStay(btn && !btn.disabled ? btn.dataset.iso : null);
    });

    function open() {
      if (!pop.hidden) return;
      rangeStart = null;
      var base = input.value && /^\d{4}-\d{2}-\d{2}$/.test(input.value)
        ? input.value
        : (minIso || new Date().toISOString().slice(0, 10));
      render(Number(base.slice(0, 4)), Number(base.slice(5, 7)) - 1);
      pop.hidden = false;
      // The search bar can sit near the fold — bring the months into view.
      requestAnimationFrame(function () {
        pop.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
    function close() { pop.hidden = true; view = null; rangeStart = null; }

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

  /* ------------------------------------------- glass-dressed <select> ---- */

  function glassSelect(select) {
    select.classList.add('gsel-native');

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'gsel';
    var labelEl = document.createElement('span');
    labelEl.className = 'gsel-label';
    var chev = document.createElement('span');
    chev.className = 'gsel-chev';
    chev.textContent = '▾';
    trigger.appendChild(labelEl);
    trigger.appendChild(chev);
    select.parentElement.insertBefore(trigger, select.nextSibling);

    var pop = document.createElement('div');
    pop.className = 'gsel-pop glass';
    pop.hidden = true;
    var holder = select.closest('label') || select.parentElement;
    holder.style.position = 'relative';
    holder.appendChild(pop);

    function label() {
      var o = select.options[select.selectedIndex];
      // A long promotional option label can carry a short form for the
      // closed trigger (data-short), so the bar field never overflows.
      return o ? (o.dataset.short || o.textContent) : '';
    }
    function sync() {
      labelEl.textContent = label();
      trigger.hidden = select.hidden;
    }

    function openList() {
      pop.textContent = '';
      Array.prototype.forEach.call(select.options, function (o) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'gsel-opt' + (o.value === select.value ? ' on' : '');
        b.textContent = o.textContent;
        b.addEventListener('click', function (ev) {
          ev.stopPropagation();
          select.value = o.value;
          // A REAL change event, so the form's own listeners all fire.
          select.dispatchEvent(new Event('change', { bubbles: true }));
          sync();
          pop.hidden = true;
        });
        pop.appendChild(b);
      });
      pop.hidden = false;
    }

    trigger.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (pop.hidden) openList(); else pop.hidden = true;
    });
    document.addEventListener('click', function (ev) {
      if (!pop.hidden && !holder.contains(ev.target)) pop.hidden = true;
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') pop.hidden = true;
    });
    // The form's More…-logic toggles [hidden] on the SELECT; mirror it onto
    // the trigger so that logic never needs to know about the dressing.
    if (window.MutationObserver) {
      new MutationObserver(sync).observe(select, { attributes: true, attributeFilter: ['hidden'] });
    }
    select.addEventListener('change', sync);
    sync();

    return { sync: sync };
  }

  return { attach: attach, glassSelect: glassSelect, fmtShort: fmtShort };
})();

/* Exposed for the verification harness only. */
window.__bkcal = { fmtShort: window.BKCal.fmtShort };
