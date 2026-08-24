/* 7 Star Lodges booking — the hidden LOAD HARNESS (0.1.30).

   Dave, 2026-08-25: type "load" anywhere on the page and a lightbox opens
   asking how many concurrent sessions to run; Go fires them at the Rate
   Engine so he can watch garbage collection bite. Shows the working
   connections, their response times, and a live graph of the totals.

   Three things make this honest rather than a toy:

   1. Each virtual session is a DISTINCT engine session (loadtest|<n>), so
      the run genuinely fills the session cache. Workers sharing one key
      would keep hitting the same cached nights and stress nothing.
   2. The latency is measured in the browser, end to end, exactly as a
      guest would experience it — and the engine's OWN heap is polled
      alongside it, because a latency spike only means something when you
      can see the heap it happened on. That pairing is the whole feature.
   3. It stops itself. The server caps concurrency and the run length, and
      this page honours what the server says rather than its own idea.

   Hidden, not secret: the server switch (LOAD_TEST=0) is what turns it off.
   Nothing here books anything, and nothing goes near Cloudbeds. */
window.BKLoad = (function () {
  'use strict';

  /* Chart hues: the data-viz reference palette's dark steps, validated
     against this site's surface (#12151c) — all four pass the lightness
     band, chroma floor, CVD separation, normal-vision floor and 3:1
     contrast. Panels never share an axis: one measure each. */
  var C_THROUGHPUT = '#199e70';
  var C_AVG = '#3987e5';
  var C_P95 = '#d95926';
  var C_HEAP = '#c98500';

  var STYLE = [
    '.blt-backdrop{position:fixed;inset:0;z-index:2400;background:rgba(8,10,14,0.78);',
    'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;',
    'justify-content:center;padding:18px;animation:blt-in 0.22s ease}',
    '@keyframes blt-in{from{opacity:0}}',
    '.blt{position:relative;width:min(940px,100%);max-height:calc(100vh - 36px);overflow-y:auto;',
    'border-radius:20px;background:#12151c;border:1px solid rgba(255,255,255,0.16);',
    'box-shadow:0 30px 90px rgba(0,0,0,0.6);color:#f4efe6;padding:22px 24px 24px;',
    'scrollbar-width:thin;scrollbar-color:rgba(201,168,106,0.5) transparent}',
    '.blt-x{position:absolute;top:12px;right:12px;width:34px;height:34px;border-radius:50%;',
    'border:1px solid rgba(255,255,255,0.25);background:rgba(12,14,19,0.55);color:#f4efe6;',
    'font-size:18px;line-height:1;cursor:pointer}',
    '.blt-x:hover{background:rgba(255,255,255,0.15)}',
    '.blt h2{margin:0;font-family:"Didot","Bodoni MT","Playfair Display",Georgia,serif;',
    'font-weight:400;font-size:23px}',
    '.blt-sub{margin:6px 0 16px;font-size:12.5px;color:#a8a296;max-width:64ch;line-height:1.5}',
    '.blt-ctl{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;margin-bottom:16px}',
    '.blt-f{display:flex;flex-direction:column;gap:5px}',
    '.blt-f label{font-size:10.5px;letter-spacing:0.09em;text-transform:uppercase;color:#a8a296}',
    '.blt-f input{width:120px;font:inherit;font-size:14px;padding:8px 10px;border-radius:10px;',
    'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.18);color:#f4efe6}',
    '.blt-go{font:inherit;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;',
    'padding:10px 22px;border-radius:999px;cursor:pointer;border:1px solid rgba(201,168,106,0.65);',
    'background:rgba(201,168,106,0.14);color:#c9a86a}',
    '.blt-go:hover{background:rgba(201,168,106,0.24)}',
    '.blt-go.stop{border-color:rgba(227,73,72,0.6);background:rgba(227,73,72,0.14);color:#e66767}',
    '.blt-errbreak{margin:2px 0 6px;font-size:12px;color:#e08a8a;min-height:1em}',
    '.blt-errbreak:empty{display:none}',
    '.blt-go:disabled{opacity:0.45;cursor:not-allowed}',
    '.blt-note{font-size:11.5px;color:#a8a296}',
    '.blt-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px 10px;margin:2px 0 18px}',
    '@media(min-width:820px){.blt-kpis{grid-template-columns:repeat(8,1fr)}}',
    '.blt-k{min-width:0}',
    '.blt-k b{display:block;font-size:18px;font-weight:400;font-variant-numeric:tabular-nums;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.blt-k span{display:block;font-size:10.5px;letter-spacing:0.09em;text-transform:uppercase;color:#a8a296;margin-top:2px}',
    '.blt-panel{margin-bottom:14px}',
    '.blt-ph{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:5px}',
    '.blt-pt{font-size:12px;letter-spacing:0.05em;color:#f4efe6}',
    '.blt-leg{display:flex;gap:12px;font-size:11px;color:#a8a296}',
    '.blt-leg i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px}',
    '.blt-canvas{width:100%;height:92px;display:block;border-radius:10px;background:rgba(255,255,255,0.03)}',
    '.blt-tablewrap{max-height:210px;overflow-y:auto;border-radius:10px;border:1px solid rgba(255,255,255,0.1)}',
    '.blt-t{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}',
    '.blt-t th{position:sticky;top:0;background:#171b23;text-align:left;font-weight:400;',
    'font-size:10.5px;letter-spacing:0.08em;text-transform:uppercase;color:#a8a296;padding:7px 10px}',
    '.blt-t td{padding:6px 10px;border-top:1px solid rgba(255,255,255,0.06)}',
    '.blt-t td.n{text-align:right}',
    '.blt-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;vertical-align:0}',
    '.blt-idle{background:#4a4f59}.blt-busy{background:#3987e5}.blt-okd{background:#199e70}.blt-errd{background:#e66767}',
    '.blt-dim{color:#a8a296}',
    '.blt-err{margin:0 0 12px;padding:9px 12px;border-radius:10px;font-size:12.5px;',
    'background:rgba(227,73,72,0.12);border:1px solid rgba(227,73,72,0.4);color:#f0b4b4}',
  ].join('');

  var TRIGGER = 'load';
  var HISTORY = 120; // samples on the graphs, one a second
  var installed = false;
  var el = null;
  var run = null;
  var caps = null;

  function style() {
    if (document.getElementById('blt-style')) return;
    var s = document.createElement('style');
    s.id = 'blt-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  /* ---- the hidden trigger ------------------------------------------- */

  function install() {
    if (installed) return;
    installed = true;
    var buf = '';
    document.addEventListener('keydown', function (ev) {
      // Never steal keystrokes meant for a field, and never fire on a
      // shortcut — a guest typing in the date box must be unaffected.
      var t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (!/^[a-z]$/i.test(ev.key)) { buf = ''; return; }
      buf = (buf + ev.key.toLowerCase()).slice(-TRIGGER.length);
      if (buf === TRIGGER && !el) { buf = ''; open(); }
    });
  }

  /* ---- the lightbox -------------------------------------------------- */

  function open() {
    style();
    var back = document.createElement('div');
    back.className = 'blt-backdrop';
    var box = document.createElement('div');
    box.className = 'blt';
    box.innerHTML =
      '<button class="blt-x" type="button" aria-label="Close">&times;</button>' +
      '<h2>Rate Engine load harness</h2>' +
      '<p class="blt-sub">Each virtual session is a separate guest with its own engine ' +
      'session key, so the run genuinely fills the rate cache. Every session runs for a ' +
      'random life between the two bounds below, then closes — dropping its cached rates ' +
      'on the engine — and a fresh one opens, so the cache constantly churns and garbage ' +
      'collection has something to do. Set the run to 0 for an overnight soak. Response ' +
      'times are measured here in the browser, end to end; the engine’s heap is read from ' +
      'the engine itself, so a latency spike can be lined up against the collection that ' +
      'caused it. Nothing is booked.</p>' +
      '<div class="blt-err" id="blt-err" style="display:none"></div>' +
      '<div class="blt-ctl">' +
        '<div class="blt-f"><label for="blt-n">Concurrent sessions</label>' +
        '<input id="blt-n" type="number" min="1" step="1" value="25" /></div>' +
        '<div class="blt-f"><label for="blt-secs">Run for (s, 0 = until Stop)</label>' +
        '<input id="blt-secs" type="number" min="0" step="10" value="0" /></div>' +
        '<div class="blt-f"><label for="blt-nights">Nights per quote</label>' +
        '<input id="blt-nights" type="number" min="1" max="62" step="1" value="7" /></div>' +
        '<div class="blt-f"><label for="blt-smin">Session life min (s)</label>' +
        '<input id="blt-smin" type="number" min="1" step="1" value="5" /></div>' +
        '<div class="blt-f"><label for="blt-smax">Session life max (s)</label>' +
        '<input id="blt-smax" type="number" min="1" step="1" value="45" /></div>' +
        '<button class="blt-go" id="blt-go" type="button">Go</button>' +
        '<span class="blt-note" id="blt-caps">checking…</span>' +
      '</div>' +
      '<div class="blt-kpis">' +
        '<div class="blt-k"><b id="blt-k-req">0</b><span>Requests</span></div>' +
        '<div class="blt-k"><b id="blt-k-rps">0</b><span>Per second</span></div>' +
        '<div class="blt-k"><b id="blt-k-avg">—</b><span>Avg</span></div>' +
        '<div class="blt-k"><b id="blt-k-p95">—</b><span>p95</span></div>' +
        '<div class="blt-k"><b id="blt-k-max">—</b><span>Slowest</span></div>' +
        '<div class="blt-k"><b id="blt-k-err">0</b><span>Errors</span></div>' +
        '<div class="blt-k"><b id="blt-k-heap">—</b><span id="blt-k-heaplbl">Engine heap</span></div>' +
        '<div class="blt-k"><b id="blt-k-cache">—</b><span>Nights cached</span></div>' +
        '<div class="blt-k"><b id="blt-k-sess">0</b><span>Sessions opened</span></div>' +
        '<div class="blt-k"><b id="blt-k-gcload">—</b><span>GC load</span></div>' +
        '<div class="blt-k"><b id="blt-k-gcmax">—</b><span>GC worst pause</span></div>' +
      '</div>' +
      '<div class="blt-errbreak" id="blt-errbreak"></div>' +
      panel('Requests completed per second', [['Throughput', C_THROUGHPUT]], 'blt-c-rps') +
      panel('Response time', [['Average', C_AVG], ['p95', C_P95]], 'blt-c-lat') +
      panel('Engine heap in use', [['Heap', C_HEAP]], 'blt-c-heap') +
      '<div class="blt-tablewrap"><table class="blt-t"><thead><tr>' +
        '<th>Session</th><th>State</th><th class="n">Done</th><th class="n">Last</th>' +
        '<th class="n">Avg</th><th class="n">Cycles</th><th class="n">Errors</th></tr></thead>' +
        '<tbody id="blt-rows"></tbody></table></div>';
    back.appendChild(box);
    document.body.appendChild(back);
    el = { back: back, box: box };

    back.addEventListener('mousedown', function (ev) { if (ev.target === back) close(); });
    box.querySelector('.blt-x').addEventListener('click', close);
    document.addEventListener('keydown', onEsc);
    box.querySelector('#blt-go').addEventListener('click', toggle);

    loadCaps();
  }

  function panel(title, series, id) {
    var leg = series.map(function (s) {
      return '<span><i style="background:' + s[1] + '"></i>' + s[0] + '</span>';
    }).join('');
    // A single-series panel is named by its title, so it carries no legend
    // box; two series always do, and identity is never colour alone.
    return '<div class="blt-panel"><div class="blt-ph"><span class="blt-pt">' + title + '</span>' +
      (series.length > 1 ? '<span class="blt-leg">' + leg + '</span>' : '') +
      '</div><canvas class="blt-canvas" id="' + id + '"></canvas></div>';
  }

  function onEsc(ev) { if (ev.key === 'Escape') close(); }

  function close() {
    stop();
    if (!el) return;
    document.removeEventListener('keydown', onEsc);
    el.back.remove();
    el = null;
  }

  function err(msg) {
    if (!el) return;
    var b = el.box.querySelector('#blt-err');
    b.style.display = msg ? '' : 'none';
    b.textContent = msg || '';
  }

  /* Reports WHICH failure it hit, not just that it failed. The first cut
     said "switched off on this server" for a 404 as well as for a genuine
     LOAD_TEST=0, and a 404 is what an out-of-date build or an edge that is
     not routing this path looks like — three very different fixes wearing
     one message. */
  function loadCaps() {
    var status = 0;
    fetch('/api/public/loadtest/status', { cache: 'no-store' })
      .then(function (r) {
        status = r.status;
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        if (!el) return;
        if (j && j.enabled) {
          caps = j;
          el.box.querySelector('#blt-caps').textContent =
            'up to ' + j.maxSessions + ' sessions, ' + j.maxSeconds + 's a run · site ' + (j.version || '?');
          return;
        }
        caps = null;
        el.box.querySelector('#blt-go').disabled = true;
        el.box.querySelector('#blt-caps').textContent =
          status === 404
            ? 'no harness at this address (HTTP 404)'
            : 'the harness is switched off here (LOAD_TEST=0)';
        if (status === 404) {
          err('The server answered 404 for /api/public/loadtest/status. Either this ' +
            'site build is older than 0.1.31, or the web server in front of it is not ' +
            'passing that path through. The page itself is fine.');
        }
      })
      .catch(function () {
        if (!el) return;
        caps = null;
        el.box.querySelector('#blt-caps').textContent = 'the harness could not be reached';
        el.box.querySelector('#blt-go').disabled = true;
        err('The status call did not complete at all — the site server may be down.');
      });
  }

  /* ---- the run ------------------------------------------------------- */

  function toggle() { if (run) stop(); else start(); }

  function num(id, dflt) {
    var v = Math.round(Number(el.box.querySelector(id).value));
    return Number.isFinite(v) && v > 0 ? v : dflt;
  }

  /* Like num(), but 0 is a legal answer (an unlimited run). */
  function numOrZero(id, dflt) {
    var v = Math.round(Number(el.box.querySelector(id).value));
    return Number.isFinite(v) && v >= 0 ? v : dflt;
  }

  /* A whole number in [lo, hi] inclusive. */
  function randInt(lo, hi) {
    if (hi < lo) hi = lo;
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  /* When this worker's current session should end and be recycled. */
  function rollSessionLife(w, r) {
    w.sessionEndsAt = Date.now() + randInt(r.sessMin, r.sessMax) * 1000;
  }

  function start() {
    if (!caps) return;
    err('');
    var want = num('#blt-n', 25);
    var secs = numOrZero('#blt-secs', 0);
    var nights = Math.min(62, num('#blt-nights', 7));
    var sMin = num('#blt-smin', 5);
    var sMax = num('#blt-smax', 45);
    if (sMax < sMin) sMax = sMin;
    // The SERVER's caps win over anything typed here, and the box is
    // corrected so the number on screen is the number being run.
    var n = Math.min(want, caps.maxSessions);
    // maxSeconds 0 means the server sets no limit (an overnight soak). Only
    // clamp when it names a real cap; an unlimited request (0) then becomes
    // that cap rather than running forever on a shared box.
    if (caps.maxSeconds > 0) secs = secs === 0 ? caps.maxSeconds : Math.min(secs, caps.maxSeconds);
    el.box.querySelector('#blt-n').value = String(n);
    el.box.querySelector('#blt-secs').value = String(secs);
    el.box.querySelector('#blt-smin').value = String(sMin);
    el.box.querySelector('#blt-smax').value = String(sMax);
    if (n < want) err('Capped at ' + n + ' sessions by the server.');

    run = {
      n: n, nights: nights, stop: false,
      sessMin: sMin, sessMax: sMax,
      // secs 0 -> Infinity: the run lasts until Stop. Every deadline test is
      // `now >= endsAt`, which Infinity never satisfies, so one value covers
      // both a timed run and an open-ended soak.
      startedAt: Date.now(), endsAt: secs > 0 ? Date.now() + secs * 1000 : Infinity,
      done: 0, errors: 0, maxMs: 0, recent: [], sessionsOpened: n,
      errBy: {},              // reason -> count, so errors are legible
      gcPrev: null,           // last engine GC snapshot, for interval deltas
      workers: [], series: { rps: [], avg: [], p95: [], heap: [] },
      lastTickDone: 0,
    };
    for (var i = 0; i < n; i++) {
      var w = { id: i + 1, state: 'idle', done: 0, errors: 0, last: null, total: 0,
        epoch: 1, cycles: 1, key: 'w' + (i + 1) + 'e1', sessionEndsAt: 0 };
      rollSessionLife(w, run);
      run.workers.push(w);
    }
    buildRows();
    var go = el.box.querySelector('#blt-go');
    go.textContent = 'Stop';
    go.classList.add('stop');

    for (var oi = 0; oi < run.workers.length; oi++) openSession(run.workers[oi].key);
    for (var w = 0; w < run.workers.length; w++) drive(run.workers[w], run);
    run.ticker = setInterval(tick, 1000);
    // A BOUNDED run ends itself even if the tab is ignored. An unlimited soak
    // has no stopper — it runs until Stop, which is the whole point.
    if (secs > 0) run.stopper = setTimeout(stop, secs * 1000 + 500);
    pollEngine();
  }

  function stop() {
    if (!run) return;
    run.stop = true;
    // Close every live session so the Open Sessions card empties with the
    // run instead of waiting out the TTL.
    for (var ci = 0; ci < run.workers.length; ci++) closeSession(run.workers[ci].key);
    clearInterval(run.ticker);
    clearTimeout(run.stopper);
    clearTimeout(run.enginePoll);
    run = null;
    if (el) {
      var go = el.box.querySelector('#blt-go');
      go.textContent = 'Go';
      go.classList.remove('stop');
      // The caps line was showing the live soak clock; put the ready line
      // back so the box does not look mid-run once it has stopped.
      loadCaps();
    }
  }

  /** One worker: a closed loop of quotes until the deadline. Each keeps its
   *  own dates moving so it is not re-reading one cached night forever. */
  function drive(w, r) {
    if (r.stop || Date.now() >= r.endsAt) { w.state = 'done'; return; }
    // A session that has reached its random life is CLOSED (its cached rates
    // dropped on the engine) and a fresh one opened before the next quote.
    // No quote for the old key is in flight here — drive loops only after the
    // previous fetch settles — so closing it now is safe.
    if (Date.now() >= w.sessionEndsAt) recycle(w, r);
    w.state = 'busy';
    var offset = (w.done * 3 + w.id * 7) % 300;
    var from = isoDay(offset);
    var to = isoDay(offset + r.nights);
    var t0 = performance.now();
    fetch('/api/public/loadtest/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker: w.key, from: from, to: to }),
      cache: 'no-store',
    })
      .then(function (res) { return res.json().catch(function () { return { ok: false }; }); })
      .then(function (j) {
        var ms = performance.now() - t0;
        if (r.stop) return;
        w.done += 1; w.last = ms; w.total += ms;
        r.done += 1;
        if (ms > r.maxMs) r.maxMs = ms;   // ALL-TIME slowest — catches a GC pause
        r.recent.push(ms);
        if (!j || j.ok !== true) {
          w.errors += 1; r.errors += 1; w.state = 'err';
          var reason = (j && j.reason) || (j && j.status ? 'engine ' + j.status : 'bad reply');
          if (reason === 'timeout' && j && j.timeoutMs) reason = 'timeout (' + Math.round(j.timeoutMs / 1000) + 's)';
          r.errBy[reason] = (r.errBy[reason] || 0) + 1;
        } else w.state = 'ok';
      })
      .catch(function () {
        if (r.stop) return;
        w.done += 1; w.errors += 1; r.done += 1; r.errors += 1; w.state = 'err';
        r.errBy['network'] = (r.errBy['network'] || 0) + 1;
      })
      .then(function () { if (!r.stop) drive(w, r); });
  }

  /* Register a worker's session on the engine so it shows in the Open
     Sessions card. Fire-and-forget once per session life (not per quote), so
     it adds nothing to the measured quote latency. */
  function openSession(key) {
    fetch('/api/public/loadtest/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker: key }),
      cache: 'no-store',
    }).catch(function () {});
  }

  /* Drop a worker's session (and its cached rates) on the engine. */
  function closeSession(key) {
    fetch('/api/public/loadtest/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker: key }),
      cache: 'no-store',
    }).catch(function () {});
  }

  /* End this worker's session (dropping its engine-side cache) and open a
     fresh one with a new random life. Fire-and-forget: the close must not
     stall the worker's quote loop, and a failed close is not fatal to the
     soak - the old session would simply age out on its TTL instead. */
  function recycle(w, r) {
    closeSession(w.key);
    w.epoch += 1;
    w.cycles += 1;
    w.key = 'w' + w.id + 'e' + w.epoch;
    r.sessionsOpened += 1;
    rollSessionLife(w, r);
    openSession(w.key);
  }

  function isoDay(offset) {
    var d = new Date();
    d.setUTCDate(d.getUTCDate() + 1 + offset);
    return d.toISOString().slice(0, 10);
  }

  /* ---- the engine's own vital signs ---------------------------------- */

  function pollEngine() {
    if (!run) return;
    fetch('/api/public/loadtest/engine', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (j) {
        if (!run || !el) return;
        var m = j && j.memory;
        if (m) {
          run.series.heap.push(m.heapUsedBytes / 1048576);
          trim(run.series.heap);
          // Used in the figure, the ceiling in the label: both together
          // overflowed the tile and were truncated to "63 MB / 1…", which
          // told Dave nothing about the number that matters.
          set('#blt-k-heap', mb(m.heapUsedBytes));
          set('#blt-k-heaplbl', 'Engine heap of ' + mb(m.heapLimitBytes));
          set('#blt-k-cache', (m.cacheEntries || 0).toLocaleString());
          // GC LOAD is the fraction of wall time spent paused for GC BETWEEN
          // this poll and the last — the number that actually answers "is GC
          // hurting throughput?". Worst pause is the longest single stop so
          // far. Both come straight from the engine's perf_hooks counters.
          if (typeof m.gcPauseMsTotal === 'number' && typeof m.uptimeMs === 'number') {
            var prev = run.gcPrev;
            if (prev) {
              var dPause = m.gcPauseMsTotal - prev.gcPauseMsTotal;
              var dWall = m.uptimeMs - prev.uptimeMs;
              if (dWall > 0) set('#blt-k-gcload', Math.max(0, (dPause / dWall) * 100).toFixed(1) + '%');
            }
            run.gcPrev = { gcPauseMsTotal: m.gcPauseMsTotal, uptimeMs: m.uptimeMs };
          }
          if (typeof m.gcMaxPauseMs === 'number') set('#blt-k-gcmax', Math.round(m.gcMaxPauseMs) + ' ms');
        }
      })
      .catch(function () { /* the engine going quiet is itself a result */ })
      .then(function () {
        if (!run) return;
        run.enginePoll = setTimeout(pollEngine, 1000);
      });
  }

  /* ---- one second of book-keeping ------------------------------------ */

  function tick() {
    if (!run || !el) return;
    var r = run;
    var rps = r.done - r.lastTickDone;
    r.lastTickDone = r.done;
    var recent = r.recent.slice();
    r.recent = [];
    var avg = recent.length ? recent.reduce(function (a, b) { return a + b; }, 0) / recent.length : null;
    var p95 = pct(recent, 95);

    r.series.rps.push(rps); trim(r.series.rps);
    r.series.avg.push(avg); trim(r.series.avg);
    r.series.p95.push(p95); trim(r.series.p95);

    set('#blt-k-req', r.done.toLocaleString());
    set('#blt-k-rps', String(rps));
    set('#blt-k-avg', ms(avg));
    set('#blt-k-p95', ms(p95));
    set('#blt-k-max', ms(r.maxMs || null));
    set('#blt-k-err', String(r.errors));
    set('#blt-k-sess', r.sessionsOpened.toLocaleString());
    // The error breakdown — what the failures actually ARE, not just how
    // many. Sorted commonest first; empty (and hidden) when there are none.
    var eb = el.box.querySelector('#blt-errbreak');
    if (eb) {
      var reasons = Object.keys(r.errBy).sort(function (a, b) { return r.errBy[b] - r.errBy[a]; });
      eb.textContent = reasons.length
        ? reasons.map(function (k) { return r.errBy[k].toLocaleString() + ' ' + k; }).join(' · ')
        : '';
    }
    // While a run is live the caps line shows how long it has been going and
    // how many sessions have churned — the two numbers a soak is watched by.
    var note = el.box.querySelector('#blt-caps');
    if (note) {
      note.textContent = 'running ' + elapsed(Date.now() - r.startedAt) + ' · ' +
        r.n + ' workers · ' + r.sessionsOpened.toLocaleString() + ' sessions opened' +
        (r.endsAt === Infinity ? ' · until Stop' : '');
    }

    drawRows();
    draw('blt-c-rps', [{ data: r.series.rps, color: C_THROUGHPUT }], 0);
    draw('blt-c-lat', [
      { data: r.series.avg, color: C_AVG },
      { data: r.series.p95, color: C_P95 },
    ], 0);
    draw('blt-c-heap', [{ data: r.series.heap, color: C_HEAP }], null);

    if (Date.now() >= r.endsAt) stop();
  }

  function trim(a) { while (a.length > HISTORY) a.shift(); }

  /* A short human duration for the soak clock: 45s, 12m 03s, 3h 07m. */
  function elapsed(msTotal) {
    var t = Math.floor(msTotal / 1000);
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
    if (m > 0) return m + 'm ' + String(sec).padStart(2, '0') + 's';
    return sec + 's';
  }

  function pct(list, p) {
    if (!list.length) return null;
    var s = list.slice().sort(function (a, b) { return a - b; });
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  }

  function set(id, text) {
    var n = el && el.box.querySelector(id);
    if (n) n.textContent = text;
  }

  function ms(v) {
    if (v == null || !isFinite(v)) return '—';
    return v >= 1000 ? (v / 1000).toFixed(2) + ' s' : Math.round(v) + ' ms';
  }

  function mb(bytes) {
    var n = Number(bytes);
    if (!isFinite(n) || n <= 0) return '—';
    return n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : Math.round(n / 1048576) + ' MB';
  }

  /* ---- the worker table ---------------------------------------------- */

  function buildRows() {
    var tb = el.box.querySelector('#blt-rows');
    tb.innerHTML = '';
    for (var i = 0; i < run.workers.length; i++) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td></td><td></td><td class="n"></td><td class="n"></td>' +
        '<td class="n"></td><td class="n"></td><td class="n"></td>';
      tb.appendChild(tr);
    }
    drawRows();
  }

  function drawRows() {
    if (!run || !el) return;
    var rows = el.box.querySelector('#blt-rows').children;
    for (var i = 0; i < run.workers.length && i < rows.length; i++) {
      var w = run.workers[i];
      var c = rows[i].children;
      var cls = w.state === 'busy' ? 'blt-busy' : w.state === 'err' ? 'blt-errd'
        : w.state === 'ok' ? 'blt-okd' : 'blt-idle';
      c[0].innerHTML = '<span class="blt-dot ' + cls + '"></span>loadtest|' + w.key;
      c[1].textContent = w.state === 'busy' ? 'in flight'
        : w.state === 'err' ? 'last call failed'
        : w.state === 'ok' ? 'connected' : w.state === 'done' ? 'finished' : 'idle';
      c[1].className = w.state === 'err' ? '' : 'blt-dim';
      c[2].textContent = String(w.done);
      c[3].textContent = ms(w.last);
      c[4].textContent = ms(w.done ? w.total / w.done : null);
      c[5].textContent = String(w.cycles);
      c[6].textContent = String(w.errors);
    }
  }

  /* ---- the graphs ----------------------------------------------------- */

  /** One panel, one measure, one y-axis — never two scales on one plot.
   *  `floor` pins the axis at zero for counts and rates; heap passes null
   *  so its own range fills the panel and the collection sawtooth is
   *  actually visible rather than a flat line near the top. */
  function draw(id, series, floor) {
    var cv = el && el.box.querySelector('#' + id);
    if (!cv) return;
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== w * dpr || cv.height !== h * dpr) {
      cv.width = w * dpr; cv.height = h * dpr;
    }
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    var all = [];
    series.forEach(function (s) {
      s.data.forEach(function (v) { if (v != null && isFinite(v)) all.push(v); });
    });
    if (!all.length) {
      g.fillStyle = '#6d6a62';
      g.font = '11px system-ui, sans-serif';
      g.fillText('waiting for the first second…', 10, h / 2 + 4);
      return;
    }
    var lo = floor != null ? floor : Math.min.apply(null, all);
    var hi = Math.max.apply(null, all);
    if (hi <= lo) hi = lo + 1;
    var pad = (hi - lo) * 0.12;
    hi += pad;
    if (floor == null) lo -= pad;

    // Recessive gridlines — three, behind everything.
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 1;
    for (var i = 1; i <= 3; i++) {
      var y = Math.round((h - 14) * (i / 4)) + 0.5;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }

    var plotH = h - 18;
    // Widen to the window only once there is a window's worth: a short run
    // fills the panel instead of huddling in its first few pixels.
    var span = Math.max(2, Math.min(HISTORY, longest(series)));
    var step = w / (span - 1);
    series.forEach(function (s) {
      g.strokeStyle = s.color;
      g.lineWidth = 2;               // 2px lines, per the mark spec
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      var started = false;
      for (var i = 0; i < s.data.length; i++) {
        var v = s.data[i];
        if (v == null || !isFinite(v)) { started = false; continue; }
        var x = i * step;
        var y = plotH - ((v - lo) / (hi - lo)) * plotH + 4;
        if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
      }
      g.stroke();
    });

    // The latest value, direct-labelled — never a number on every point.
    var last = null, lastColor = null;
    series.forEach(function (s) {
      for (var i = s.data.length - 1; i >= 0; i--) {
        if (s.data[i] != null && isFinite(s.data[i])) { last = s.data[i]; lastColor = s.color; break; }
      }
    });
    g.fillStyle = '#a8a296';         // text tokens, never the series colour
    g.font = '10.5px system-ui, sans-serif';
    g.fillText(fmtAxis(hi), 4, 11);
    g.fillText(fmtAxis(lo), 4, h - 3);
    if (last != null) {
      var label = fmtAxis(last);
      var tw = g.measureText(label).width;
      g.fillStyle = lastColor;
      g.fillRect(w - tw - 15, h - 12, 7, 7);
      g.fillStyle = '#f4efe6';
      g.fillText(label, w - tw - 4, h - 3);
    }
  }

  function longest(series) {
    var n = 0;
    for (var i = 0; i < series.length; i++) n = Math.max(n, series[i].data.length);
    return n;
  }

  function fmtAxis(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1000) return Math.round(v).toLocaleString();
    if (v >= 100) return String(Math.round(v));
    if (v >= 10) return v.toFixed(0);
    return v.toFixed(1);
  }

  return { install: install, open: open, close: close };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { window.BKLoad.install(); });
} else {
  window.BKLoad.install();
}
