/* 7 Star Lodges booking — suite lightbox (shared by both builds).
   Clicking a suite card opens this instead of selecting the suite (Dave,
   2026-08-23): a glass modal with the full photo gallery, the complete
   description, occupancy, amenities and pricing — and the Add-to-stay
   action lives HERE (plus the card's own button on the full build).
   Self-contained: injects its own styles, builds its DOM per open, closes
   on X, backdrop or Escape. */
window.BKLight = (function () {
  'use strict';

  var STYLE = [
    '.blb-backdrop{position:fixed;inset:0;z-index:2000;background:rgba(8,10,14,0.72);',
    'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);',
    'display:flex;align-items:center;justify-content:center;padding:18px;animation:blb-in 0.25s ease}',
    '@keyframes blb-in{from{opacity:0}}',
    '.blb{position:relative;width:min(680px,100%);max-height:calc(100vh - 36px);overflow-y:auto;',
    'border-radius:22px;background:rgba(18,21,28,0.97);border:1px solid rgba(255,255,255,0.16);',
    'box-shadow:0 30px 90px rgba(0,0,0,0.6);color:#f4efe6;',
    'scrollbar-width:thin;scrollbar-color:rgba(201,168,106,0.5) transparent;animation:blb-rise 0.3s cubic-bezier(0.2,0.7,0.2,1)}',
    '@keyframes blb-rise{from{transform:translateY(18px);opacity:0}}',
    '.blb::-webkit-scrollbar{width:6px}.blb::-webkit-scrollbar-thumb{background:rgba(201,168,106,0.45);border-radius:999px}',
    '.blb-x{position:absolute;top:12px;right:12px;z-index:3;width:36px;height:36px;border-radius:50%;',
    'border:1px solid rgba(255,255,255,0.25);background:rgba(12,14,19,0.55);color:#f4efe6;',
    'font-size:19px;line-height:1;cursor:pointer}',
    '.blb-x:hover{background:rgba(255,255,255,0.15)}',
    '.blb-photo{position:relative;height:min(46vh,340px);background:#141922;border-radius:22px 22px 0 0;overflow:hidden}',
    '.blb-photo img,.blb-photo .blb-art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
    '.blb-photo.blb-grey img,.blb-photo.blb-grey .blb-art{filter:grayscale(0.55) brightness(0.85)}',
    '.blb-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:2;width:38px;height:38px;',
    'border-radius:50%;border:1px solid rgba(255,255,255,0.3);background:rgba(12,14,19,0.5);',
    'color:#f4efe6;font-size:19px;line-height:1;cursor:pointer}',
    '.blb-nav:hover{background:rgba(255,255,255,0.18)}',
    '.blb-prev{left:12px}.blb-next{right:12px}',
    '.blb-dots{position:absolute;bottom:10px;left:0;right:0;display:flex;justify-content:center;gap:6px;z-index:2}',
    '.blb-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,0.35)}',
    '.blb-dot.on{background:#c9a86a}',
    '.blb-body{padding:20px 24px 24px}',
    '.blb-top{display:flex;justify-content:space-between;align-items:baseline;gap:14px;flex-wrap:wrap}',
    '.blb-name{margin:0;font-family:"Didot","Bodoni MT","Playfair Display","Georgia",serif;font-weight:400;font-size:27px}',
    '.blb-subtitle{margin:4px 0 0;width:100%;font-size:13px;letter-spacing:0.16em;text-transform:uppercase;color:#c9a86a}',
    '.blb-table{display:grid;grid-template-columns:1.4fr 1fr 1fr 1.2fr;gap:0;margin-top:16px;',
    'border:1px solid rgba(255,255,255,0.14);border-radius:14px;overflow:hidden;font-size:13px}',
    '.blb-th{background:rgba(255,255,255,0.06);color:rgba(244,239,230,0.62);font-size:10.5px;',
    'letter-spacing:0.14em;text-transform:uppercase;padding:9px 12px}',
    '.blb-td{padding:9px 12px;border-top:1px solid rgba(255,255,255,0.08);color:#f4efe6}',
    '.blb-td.dim{color:rgba(244,239,230,0.62)}',
    '.blb-td.gold{color:#c9a86a}',
    '.blb-cta2{margin-top:14px;width:100%;min-height:48px;border-radius:14px;cursor:pointer;',
    'background:transparent;border:1px solid rgba(201,168,106,0.6);color:#c9a86a;',
    'font:600 14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;letter-spacing:0.05em;',
    'transition:background 0.15s,transform 0.15s cubic-bezier(0.34,1.56,0.64,1)}',
    '.blb-cta2:hover{background:rgba(201,168,106,0.12)}.blb-cta2:active{transform:scale(0.97)}',
    '.blb-price{text-align:right}',
    '.blb-total{display:block;font-family:"Didot","Bodoni MT","Playfair Display","Georgia",serif;font-size:23px;color:#d8b46a}',
    '.blb-sub{display:block;font-size:12px;color:rgba(244,239,230,0.62);margin-top:2px}',
    '.blb-pp{display:block;font-size:12px;color:#d8b46a;opacity:0.9;margin-top:2px}',
    '.blb-note{display:block;font-size:11.5px;color:rgba(244,239,230,0.62);font-style:italic;margin-top:3px}',
    '.blb-desc{margin:14px 0 0;color:rgba(244,239,230,0.75);font-size:14.5px;line-height:1.7;white-space:pre-line}',
    '.blb-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:14px}',
    '.blb-chip{font-size:11.5px;color:rgba(244,239,230,0.62);border:1px solid rgba(255,255,255,0.16);',
    'border-radius:999px;padding:5px 12px}',
    '.blb-chip.gold{color:#d8b46a;border-color:rgba(201,168,106,0.55)}',
    '.blb-extra{margin:12px 0 0;font-size:12.5px;color:rgba(244,239,230,0.62);font-style:italic}',
    /* The embedded cost breakdown (Dave, 2026-08-31): the SAME .bk-breakdown
       element the card shows as a hover tip, re-seated as a flowing block —
       so its popover positioning and size caps are neutralised here. */
    '.blb-bd{margin-top:16px}',
    '.blb-bd-h{font-size:10.5px;letter-spacing:0.14em;text-transform:uppercase;',
    'color:rgba(244,239,230,0.62);margin:0 0 8px}',
    '.blb-bd .bk-breakdown{position:static;min-width:0;max-width:none;max-height:none;',
    'overflow:visible;box-shadow:none;background:rgba(255,255,255,0.04);',
    'border:1px solid rgba(255,255,255,0.14)}',
    '.blb-soldout{margin:16px 0 0;padding:11px 16px;border-radius:12px;text-align:center;',
    'border:1px solid rgba(201,168,106,0.4);color:#d8b46a;font-size:13px;letter-spacing:0.06em}',
    '.blb-cta{margin-top:18px;width:100%;min-height:52px;border:0;border-radius:14px;cursor:pointer;',
    'background:linear-gradient(140deg,#d8b46a,#b28a3c);color:#16120a;font:600 15px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
    'letter-spacing:0.05em;transition:transform 0.15s cubic-bezier(0.34,1.56,0.64,1),filter 0.15s}',
    '.blb-cta:hover{filter:brightness(1.06)}.blb-cta:active{transform:scale(0.97)}',
    '.blb-cta.on{background:transparent;border:1px solid rgba(201,168,106,0.6);color:#d8b46a}',
  ].join('');

  var stack = [];

  function ensureStyle() {
    if (document.getElementById('blb-style')) return;
    var st = document.createElement('style');
    st.id = 'blb-style';
    st.textContent = STYLE;
    document.head.appendChild(st);
  }

  /**
   * opts: { title, photos:[urls], artHue, soldOut, soldOutText, picked,
   *         price:{headline, perNight, note}, description, chips:[{text,gold}],
   *         extraLine, onToggle(picked_now) -> new picked state | undefined }
   * Returns { close }.
   */
  function open(opts) {
    ensureStyle();
    var backdrop = document.createElement('div');
    backdrop.className = 'blb-backdrop';
    var box = document.createElement('div');
    box.className = 'blb';
    backdrop.appendChild(box);

    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'blb-x';
    x.setAttribute('aria-label', 'Close');
    x.innerHTML = '&times;';
    box.appendChild(x);

    // ---- gallery ----
    var photo = document.createElement('div');
    photo.className = 'blb-photo' + (opts.soldOut ? ' blb-grey' : '');
    var idx = 0;
    var img = null;
    var dots = [];
    function showPhoto(i) {
      if (!opts.photos.length) return;
      idx = ((i % opts.photos.length) + opts.photos.length) % opts.photos.length;
      img.src = opts.photos[idx];
      dots.forEach(function (d, j) { d.className = 'blb-dot' + (j === idx ? ' on' : ''); });
    }
    if (opts.photos && opts.photos.length) {
      img = document.createElement('img');
      img.alt = opts.title || '';
      photo.appendChild(img);
      if (opts.photos.length > 1) {
        var prev = document.createElement('button');
        prev.type = 'button';
        prev.className = 'blb-nav blb-prev';
        prev.textContent = '‹';
        var next = document.createElement('button');
        next.type = 'button';
        next.className = 'blb-nav blb-next';
        next.textContent = '›';
        prev.addEventListener('click', function () { showPhoto(idx - 1); });
        next.addEventListener('click', function () { showPhoto(idx + 1); });
        photo.appendChild(prev);
        photo.appendChild(next);
        var dotRow = document.createElement('div');
        dotRow.className = 'blb-dots';
        opts.photos.forEach(function (_, j) {
          var d = document.createElement('span');
          d.className = 'blb-dot';
          dots.push(d);
          dotRow.appendChild(d);
        });
        photo.appendChild(dotRow);
      }
      showPhoto(0);
    } else {
      var art = document.createElement('div');
      art.className = 'blb-art';
      var h = opts.artHue || 0;
      art.style.background =
        'linear-gradient(150deg, hsl(' + h + ' 24% 22%), hsl(' + ((h + 40) % 360) + ' 30% 12%))';
      photo.appendChild(art);
    }
    if (!opts.noPhoto) box.appendChild(photo);

    // ---- body ----
    var body = document.createElement('div');
    body.className = 'blb-body';
    var top = document.createElement('div');
    top.className = 'blb-top';
    var name = document.createElement('h2');
    name.className = 'blb-name';
    name.textContent = opts.title || '';
    top.appendChild(name);
    if (opts.subtitle) {
      var sub = document.createElement('p');
      sub.className = 'blb-subtitle';
      sub.textContent = opts.subtitle;
      top.appendChild(sub);
    }
    if (opts.price && opts.price.headline) {
      var price = document.createElement('div');
      price.className = 'blb-price';
      var t = document.createElement('span');
      t.className = 'blb-total';
      t.textContent = opts.price.headline;
      price.appendChild(t);
      if (opts.price.perNight) {
        var pn = document.createElement('span');
        pn.className = 'blb-sub';
        pn.textContent = opts.price.perNight;
        price.appendChild(pn);
      }
      /* The per-person average, gold like the card's (2026-08-31). */
      if (opts.price.perPerson) {
        var ppl = document.createElement('span');
        ppl.className = 'blb-pp';
        ppl.textContent = opts.price.perPerson;
        price.appendChild(ppl);
      }
      if (opts.price.note) {
        var nt = document.createElement('span');
        nt.className = 'blb-note';
        nt.textContent = opts.price.note;
        price.appendChild(nt);
      }
      top.appendChild(price);
    }
    body.appendChild(top);

    if (opts.description) {
      var desc = document.createElement('p');
      desc.className = 'blb-desc';
      desc.textContent = opts.description;
      body.appendChild(desc);
    }
    if (opts.chips && opts.chips.length) {
      var chips = document.createElement('div');
      chips.className = 'blb-chips';
      opts.chips.forEach(function (c) {
        var el = document.createElement('span');
        el.className = 'blb-chip' + (c.gold ? ' gold' : '');
        el.textContent = c.text;
        chips.appendChild(el);
      });
      body.appendChild(chips);
    }
    /* The full cost breakdown, embedded rather than hover-only (Dave,
       2026-08-31): the caller hands over the ready-built statement element;
       absent (unpriced room, or the caller withheld it) nothing renders. */
    if (opts.breakdown) {
      var bdWrap = document.createElement('div');
      bdWrap.className = 'blb-bd';
      var bdHead = document.createElement('div');
      bdHead.className = 'blb-bd-h';
      bdHead.textContent = 'Cost breakdown';
      bdWrap.appendChild(bdHead);
      bdWrap.appendChild(opts.breakdown);
      body.appendChild(bdWrap);
    }
    /* The occupancy & extra-cost table (Dave, 2026-08-23): included and
       maximum guests per age group, the total maximum, and what an extra
       guest above the included number costs. */
    if (opts.occupancy && opts.occupancy.rows && opts.occupancy.rows.length) {
      var tbl = document.createElement('div');
      tbl.className = 'blb-table';
      ['Guests', 'Included', 'Maximum', 'Extra guest'].forEach(function (h) {
        var th = document.createElement('span');
        th.className = 'blb-th';
        th.textContent = h;
        tbl.appendChild(th);
      });
      opts.occupancy.rows.forEach(function (row) {
        var cells = [
          { t: row.label, c: 'blb-td' },
          { t: row.included, c: 'blb-td' + (row.included === '—' ? ' dim' : '') },
          { t: row.max, c: 'blb-td' + (row.max === '—' ? ' dim' : '') },
          { t: row.extra, c: 'blb-td' + (row.extra === '—' ? ' dim' : ' gold') },
        ];
        cells.forEach(function (cdef) {
          var td = document.createElement('span');
          td.className = cdef.c;
          td.textContent = cdef.t;
          tbl.appendChild(td);
        });
      });
      if (opts.occupancy.totalMax) {
        [{ t: 'Total maximum', c: 'blb-td' }, { t: '', c: 'blb-td' },
         { t: opts.occupancy.totalMax, c: 'blb-td gold' }, { t: '', c: 'blb-td' }]
          .forEach(function (cdef) {
            var td = document.createElement('span');
            td.className = cdef.c;
            td.textContent = cdef.t;
            tbl.appendChild(td);
          });
      }
      body.appendChild(tbl);
    }
    if (opts.extraLine) {
      var ex = document.createElement('p');
      ex.className = 'blb-extra';
      ex.textContent = opts.extraLine;
      body.appendChild(ex);
    }
    if (opts.customNode) body.appendChild(opts.customNode);

    if (opts.soldOut) {
      var so = document.createElement('div');
      so.className = 'blb-soldout';
      so.textContent = opts.soldOutText || 'Unavailable for your dates';
      body.appendChild(so);
      if (opts.onShowAvailability) {
        var avail = document.createElement('button');
        avail.type = 'button';
        avail.className = 'blb-cta2';
        avail.textContent = 'Show availability';
        avail.addEventListener('click', function () { opts.onShowAvailability(); });
        body.appendChild(avail);
      }
    } else if (opts.onToggle) {
      var cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'blb-cta' + (opts.picked ? ' on' : '');
      var pickedNow = !!opts.picked;
      var label = function () {
        cta.textContent = pickedNow ? 'Remove from stay' : 'Add to stay';
        cta.className = 'blb-cta' + (pickedNow ? ' on' : '');
      };
      label();
      cta.addEventListener('click', function () {
        var r = opts.onToggle(pickedNow);
        pickedNow = r === undefined ? !pickedNow : !!r;
        label();
      });
      body.appendChild(cta);
    }
    box.appendChild(body);

    var api;
    function close() {
      document.removeEventListener('keydown', onKey);
      var at = stack.indexOf(api);
      if (at >= 0) stack.splice(at, 1);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }
    function onKey(ev) {
      // Stacked lightboxes: Escape peels only the TOP one.
      if (ev.key === 'Escape' && stack[stack.length - 1] === api) close();
      if (ev.key === 'ArrowLeft' && img) showPhoto(idx - 1);
      if (ev.key === 'ArrowRight' && img) showPhoto(idx + 1);
    }
    x.addEventListener('click', close);
    backdrop.addEventListener('click', function (ev) {
      if (ev.target === backdrop) close();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    api = { close: close };
    stack.push(api);
    return api;
  }

  return { open: open };
})();

/* 7 Star Lodges booking — the rate-comparison lightbox (shared by both
   builds; Dave, 2026-08-26). "Compare these rates" on a suite card opens
   this: each rate plan is a COLUMN, the inclusions are ROWS grouped under
   their sub-group names exactly as arranged on the Lodge Ops Rate Plan
   Support page, and every cell says whether that plan includes the item.
   This replaces the per-pill hover tip — side by side beats a dozen
   tooltips. Self-contained like BKLight: injects its own styles, builds
   its DOM per open, closes on X, backdrop or Escape. */
window.BKCompare = (function () {
  'use strict';

  var STYLE = [
    '.bcx-backdrop{position:fixed;inset:0;z-index:2100;background:rgba(8,10,14,0.72);',
    'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);',
    'display:flex;align-items:center;justify-content:center;padding:18px;animation:bcx-in 0.25s ease}',
    '@keyframes bcx-in{from{opacity:0}}',
    '.bcx{position:relative;display:flex;flex-direction:column;width:min(820px,100%);max-height:calc(100vh - 36px);overflow:hidden;',
    'border-radius:22px;background:rgba(18,21,28,0.97);border:1px solid rgba(255,255,255,0.16);',
    'box-shadow:0 30px 90px rgba(0,0,0,0.6);color:#f4efe6;padding:22px 24px 24px;',
    'animation:bcx-rise 0.3s cubic-bezier(0.2,0.7,0.2,1)}',
    '@keyframes bcx-rise{from{transform:translateY(18px);opacity:0}}',
    '.bcx-x{position:absolute;top:12px;right:12px;width:36px;height:36px;border-radius:50%;',
    'border:1px solid rgba(255,255,255,0.25);background:rgba(12,14,19,0.55);color:#f4efe6;',
    'font-size:19px;line-height:1;cursor:pointer}',
    '.bcx-x:hover{background:rgba(255,255,255,0.15)}',
    '.bcx-title{margin:0;font-family:"Didot","Bodoni MT","Playfair Display","Georgia",serif;font-weight:400;font-size:24px}',
    '.bcx-sub{margin:4px 0 14px;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#c9a86a}',
    '.bcx-scroll{overflow:auto;flex:1 1 auto;min-height:0;',
    'scrollbar-width:thin;scrollbar-color:rgba(201,168,106,0.5) transparent}',
    '.bcx-scroll::-webkit-scrollbar{width:6px;height:6px}',
    '.bcx-scroll::-webkit-scrollbar-thumb{background:rgba(201,168,106,0.45);border-radius:999px}',
    '.bcx-head{position:sticky;top:0;z-index:2;background:rgba(18,21,28,0.99)}',
    '.bcx-grid{display:grid;gap:0;min-width:100%;border-top:1px solid rgba(255,255,255,0.1)}',
    '.bcx-cell{padding:9px 10px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:13.5px}',
    '.bcx-plan{display:flex;flex-direction:column;gap:2px;align-items:flex-start}',
    '.bcx-plan-name{font-weight:600}',
    '.bcx-plan-total{font-size:14px;color:#c9a86a}',
    '.bcx-plan-group{font-size:11px;color:rgba(244,239,230,0.55)}',
    '.bcx-best{font-size:9.5px;letter-spacing:0.12em;text-transform:uppercase;color:#0e0f13;',
    'background:#c9a86a;border-radius:999px;padding:2px 7px;font-weight:700}',
    '.bcx-sec{grid-column:1 / -1;padding:12px 10px 5px;font-size:11px;letter-spacing:0.18em;',
    'text-transform:uppercase;color:#c9a86a;border-bottom:1px solid rgba(255,255,255,0.08)}',
    '.bcx-tag{color:rgba(244,239,230,0.9)}',
    '.bcx-mark{text-align:center;font-size:14px}',
    '.bcx-in{color:#c9a86a}',
    '.bcx-out{color:rgba(227,110,95,0.9)}',
    '.bcx-na{color:rgba(244,239,230,0.3)}',
    '.bcx-legend{margin:12px 2px 0;font-size:11.5px;color:rgba(244,239,230,0.55)}',
    '.bcx-empty{margin:14px 2px 4px;font-size:13.5px;color:rgba(244,239,230,0.65)}',
  ].join('');

  var styled = false;
  function ensureStyle() {
    if (styled) return;
    var el = document.createElement('style');
    el.textContent = STYLE;
    document.head.appendChild(el);
    styled = true;
  }

  /* One row per inclusion item, grouped under the FIRST sub-group name that
     mentions it — the same item can sit in different sections on different
     plans ("Lunch" in Meals on Full Board, in Not included on Half Board),
     and one honest row beats two half-truthful ones. The cell verdicts come
     from the flat rollup, so the included-beats-excluded resolution made in
     Lodge Ops holds here too. Plans replicated before sections existed fall
     back to two synthetic sections. */
  function buildGroups(plans) {
    var groups = [];
    var byName = {};
    var seenTag = {};
    plans.forEach(function (p) {
      var inc = p.inclusions || {};
      var secs = inc.sections && inc.sections.length ? inc.sections : [];
      if (!secs.length) {
        if ((inc.included || []).length) secs.push({ name: 'Included', negative: false, tags: inc.included });
        if ((inc.excluded || []).length) secs.push({ name: 'Not included', negative: true, tags: inc.excluded });
      }
      secs.forEach(function (s) {
        if (!s.tags || !s.tags.length) return;
        var grp = byName[s.name];
        if (!grp) {
          grp = { name: s.name, negative: s.negative === true, tags: [] };
          byName[s.name] = grp;
          groups.push(grp);
        }
        s.tags.forEach(function (t) {
          if (!seenTag[t]) {
            seenTag[t] = 1;
            grp.tags.push(t);
          }
        });
      });
    });
    /* Exclusion sections sink to the BOTTOM whatever plan donated them —
       "what you don't get" read mid-list as if it were another perk. The
       positive sections keep their first-appearance order. */
    return groups.filter(function (g) { return !g.negative; })
      .concat(groups.filter(function (g) { return g.negative; }));
  }

  function verdict(p, tag) {
    var inc = p.inclusions || {};
    if ((inc.included || []).indexOf(tag) !== -1) return 'in';
    if ((inc.excluded || []).indexOf(tag) !== -1) return 'out';
    return 'na';
  }

  /** Which of THIS plan's sub-groups holds the tag — for the cell tooltip.
   *  The row may sit under another plan's section name, so the tooltip is
   *  where each plan's own filing is still visible. */
  function sectionOf(p, tag) {
    var secs = (p.inclusions || {}).sections || [];
    for (var i = 0; i < secs.length; i += 1) {
      if ((secs[i].tags || []).indexOf(tag) !== -1) return secs[i].name;
    }
    return null;
  }

  /** The plain-words tooltip for one cell (Dave, 2026-08-26: make it clear
   *  whether things are included or not). */
  function cellTitle(p, tag) {
    var v = verdict(p, tag);
    var sec = sectionOf(p, tag);
    var where = sec ? ' (' + sec + ')' : '';
    if (v === 'in') return tag + ' is included in ' + p.name + where;
    if (v === 'out') return tag + ' is NOT included in ' + p.name + where;
    return p.name + ' does not mention ' + tag;
  }

  function open(opts) {
    ensureStyle();
    var plans = (opts && opts.plans) || [];
    var money = window.BKCore.money;

    var backdrop = document.createElement('div');
    backdrop.className = 'bcx-backdrop';
    var box = document.createElement('div');
    box.className = 'bcx';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Compare these rates');

    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'bcx-x';
    x.textContent = '×';
    box.appendChild(x);

    var h = document.createElement('h3');
    h.className = 'bcx-title';
    h.textContent = 'Compare these rates';
    box.appendChild(h);
    var sub = document.createElement('p');
    sub.className = 'bcx-sub';
    sub.textContent = opts.suiteName || '';
    box.appendChild(sub);

    var groups = buildGroups(plans);
    var scroll = document.createElement('div');
    scroll.className = 'bcx-scroll';
    var grid = document.createElement('div');
    grid.className = 'bcx-grid';
    grid.style.gridTemplateColumns =
      'minmax(130px, 1.4fr) repeat(' + plans.length + ', minmax(110px, 1fr))';

    // Header row: the plans, each with its stay total for THIS suite. The
    // header STAYS PUT while the rows scroll under it (Dave, 2026-08-26) —
    // a comparison whose column names have scrolled away compares nothing.
    var corner = document.createElement('div');
    corner.className = 'bcx-cell bcx-head';
    grid.appendChild(corner);
    plans.forEach(function (p) {
      var cell = document.createElement('div');
      cell.className = 'bcx-cell bcx-plan bcx-head';
      var nm = document.createElement('span');
      nm.className = 'bcx-plan-name';
      nm.textContent = p.name;
      cell.appendChild(nm);
      if (p.grandTotal != null) {
        var tt = document.createElement('span');
        tt.className = 'bcx-plan-total';
        tt.textContent = money(p.grandTotal, opts.currency);
        cell.appendChild(tt);
      }
      if (p.cheapest === true) {
        var b = document.createElement('span');
        b.className = 'bcx-best';
        b.textContent = 'Lowest rate';
        cell.appendChild(b);
      }
      var inc = p.inclusions || {};
      if (inc.group) {
        var gname = document.createElement('span');
        gname.className = 'bcx-plan-group';
        gname.textContent = inc.group;
        cell.appendChild(gname);
      }
      grid.appendChild(cell);
    });

    groups.forEach(function (grp) {
      var sec = document.createElement('div');
      sec.className = 'bcx-sec';
      sec.textContent = grp.name;
      grid.appendChild(sec);
      grp.tags.forEach(function (tag) {
        var tcell = document.createElement('div');
        tcell.className = 'bcx-cell bcx-tag';
        tcell.textContent = tag;
        grid.appendChild(tcell);
        plans.forEach(function (p) {
          var v = verdict(p, tag);
          var m = document.createElement('div');
          m.className = 'bcx-cell bcx-mark bcx-' + v;
          m.textContent = v === 'in' ? '✓' : v === 'out' ? '✗' : '—';
          m.title = cellTitle(p, tag);
          grid.appendChild(m);
        });
      });
    });

    if (groups.length) {
      scroll.appendChild(grid);
      box.appendChild(scroll);
      var legend = document.createElement('p');
      legend.className = 'bcx-legend';
      legend.textContent = '✓ included · ✗ not included · — not specified';
      box.appendChild(legend);
    } else {
      var empty = document.createElement('p');
      empty.className = 'bcx-empty';
      empty.textContent =
        'No inclusion details have been set up for these rates yet — the prices above are the whole story.';
      box.appendChild(empty);
    }

    function close() {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(ev) {
      if (ev.key === 'Escape') close();
    }
    x.addEventListener('click', close);
    backdrop.addEventListener('click', function (ev) {
      if (ev.target === backdrop) close();
    });
    box.addEventListener('click', function (ev) { ev.stopPropagation(); });
    document.addEventListener('keydown', onKey);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    return { close: close };
  }

  return { open: open };
})();
