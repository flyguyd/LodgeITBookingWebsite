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
    '.blb-note{display:block;font-size:11.5px;color:rgba(244,239,230,0.62);font-style:italic;margin-top:3px}',
    '.blb-desc{margin:14px 0 0;color:rgba(244,239,230,0.75);font-size:14.5px;line-height:1.7;white-space:pre-line}',
    '.blb-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:14px}',
    '.blb-chip{font-size:11.5px;color:rgba(244,239,230,0.62);border:1px solid rgba(255,255,255,0.16);',
    'border-radius:999px;padding:5px 12px}',
    '.blb-chip.gold{color:#d8b46a;border-color:rgba(201,168,106,0.55)}',
    '.blb-extra{margin:12px 0 0;font-size:12.5px;color:rgba(244,239,230,0.62);font-style:italic}',
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
