/* manager.js — the manager's view. One screen, one global.
 *
 * A CSM's screen is the queue. A manager's question is a different one: where
 * does the book actually sit, and which client is about to go the wrong way.
 * That question is answered by shape before it is answered by a list, so this
 * surface is a tree on a canvas rather than a table.
 *
 * The tree runs LEFT TO RIGHT, not top down. The prior art (manager-tree.html,
 * sales-pipeline v5) went top down, and it was right for four columns of short
 * labels. Here every node is a name — a manager, a band, a nonprofit — and
 * twenty-five band nodes side by side is 6000px of canvas nobody can read.
 * Left to right gives each name its own line and lets depth be the only thing
 * that moves horizontally. The pan/zoom maths is taken from the prior art
 * unchanged; only the axis is swapped.
 *
 * EVERYTHING HERE IS MOCK DATA and the screen says so in a banner that never
 * scrolls away. DEMO.org loads engagements for one manager only. The other four
 * carry band counts with nothing behind them, and opening one of those bands
 * says exactly that. Filling them with invented clients would make the shape
 * look proven when it is not.
 *
 * No network, no library. The repository token in this app reads a private
 * repo, so a third-party request is a real problem and not a style preference.
 */

const MANAGER = (() => {
  "use strict";

  /* Geometry. Column widths differ by depth because the things in each column
     are different lengths: a band name is short, a nonprofit's name is not.
     Everything here is as tight as the longest real name allows, because the
     canvas is fitted to the screen and every spare pixel comes straight off
     the readable size of the type. */
  const COL_W = [246, 236, 232, 276];
  const PAD = 40, GAP_X = 60, ROW_GAP = 13;
  const ZMIN = 0.28, ZMAX = 2.4;

  /* Under this, the names are too small to read. A fit that lands below it is
     not a view of the tree, it is a picture of one. */
  const READABLE = 0.5;

  const COL_X = (() => {
    const out = []; let x = PAD;
    for (const w of COL_W) { out.push(x); x += w + GAP_X; }
    return out;
  })();

  /* Icons are drawn, never typed. Square caps because the rest of the app
     draws them that way and a rounded cap in one corner reads as a mistake. */
  const icon = (d) =>
    `<svg class="mg-i" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" ` +
    `fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square">${d}</svg>`;

  const I = {
    plus:      icon('<path d="M10 4.6V15.4"/><path d="M4.6 10H15.4"/>'),
    minus:     icon('<path d="M4.6 10H15.4"/>'),
    fit:       icon('<path d="M4.5 7.5V4.5H8"/><path d="M12 4.5h3.5v3"/>' +
                    '<path d="M15.5 12.5v3H12"/><path d="M8 15.5H4.5v-3"/>'),
    close:     icon('<path d="M5.2 5.2l9.6 9.6"/><path d="M14.8 5.2l-9.6 9.6"/>'),
    chevRight: icon('<path d="M7.6 4.8L12.8 10l-5.2 5.2"/>'),
    chevDown:  icon('<path d="M4.8 7.6L10 12.8l5.2-5.2"/>'),
  };

  /* Session state. It lives in the closure rather than on the global because
     app.js already owns several short top-level names, and a classic script
     that re-declares one of them is a hard SyntaxError, not a warning. */
  const S = {
    host: null, rail: null, esc: (s) => String(s ?? ""),
    root: null, bandColor: {}, demo: true,
    collapsed: new Set(), parents: new Map(), levels: new Map(),
    recs: new Map(), order: [],
    focusId: null, selectedId: null, returnFocus: null, panelTimer: 0,
    z: 1, px: 0, py: 0, moved: false,
    off: [],
    vp: null, canvas: null, edges: null, zoomOut: null, panel: null, scrim: null,
  };

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const kids = (n) => (n && n.children) || [];
  const hasKids = (n) => kids(n).length > 0;
  const isOpen = (n) => hasKids(n) && !S.collapsed.has(n.id);

  const descendants = (n) => kids(n).reduce((a, c) => a + 1 + descendants(c), 0);

  const meta = (html) => `<span class="mg-meta">${html}</span>`;

  /* Every listener goes through here so a second render() can take them all
     off again. The host and the rail survive a re-render, so a listener left
     on either of them would fire twice. */
  const on = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    S.off.push(() => el.removeEventListener(type, fn, opts));
  };

  /* Only a token string may reach a style attribute. DEMO.BAND_COLOR is ours,
     but the rule is cheaper to keep than to reason about every time. */
  const bandVar = (key) => {
    const v = S.bandColor[key];
    return typeof v === "string" && /^var\(--[a-z0-9-]+\)$/i.test(v) ? v : "var(--quill)";
  };

  /* The band a node belongs to: itself if it is one, otherwise its parent's. */
  function bandOf(n) {
    let cur = n;
    while (cur && cur.kind !== "band") cur = S.parents.get(cur.id);
    return cur || null;
  }

  /* Evidence text carries the repository's own notation — `attempt:2`,
     outcome slugs. Escape first, then mark the backticks, so the code path can
     never carry markup through. */
  function ticks(raw) {
    return S.esc(raw).replace(/`([^`]+)`/g, '<code class="mg-code">$1</code>');
  }

  /* ------------------------------------------------------------- the shell */

  function shell(data) {
    const root = S.root;
    const mgrs = kids(root);
    const book = mgrs.reduce((a, m) => a + (m.book || 0), 0);
    const live = S.demo ? "" :
      " The rest of the app runs on the live repository; this screen does not.";

    return `
      <div class="mg-screen">
        <header class="mg-head">
          <div class="mg-head-top">
            <h1 class="mg-title">${S.esc(root.name)}</h1>
            <p class="mg-sub">
              <span class="mg-num">${book}</span> engagements ·
              <span class="mg-num">${mgrs.length}</span> managers
            </p>
          </div>
          <p class="mg-banner">
            This view is a mock. The tree below is fixed sample data written to
            show the shape of the book. It is not read from the repository, and
            nothing on this screen writes to an issue.${live}
          </p>
        </header>

        <div class="mg-bar">
          <div class="mg-grp" role="group" aria-label="Zoom">
            <button type="button" class="mg-btn mg-icon" data-act="out" aria-label="Zoom out">${I.minus}</button>
            <span class="mg-zoom" role="status" aria-live="off"><span class="mg-sr">Zoom </span><span class="mg-zval">100%</span></span>
            <button type="button" class="mg-btn mg-icon" data-act="in" aria-label="Zoom in">${I.plus}</button>
            <button type="button" class="mg-btn mg-icon" data-act="fit" aria-label="Fit the whole tree">${I.fit}</button>
          </div>
          <div class="mg-grp">
            <button type="button" class="mg-btn" data-act="expand">Open all</button>
            <button type="button" class="mg-btn" data-act="collapse">Close all</button>
          </div>
        </div>

        <div class="mg-vp">
          <div class="mg-canvas" role="tree" aria-label="Customer Success, by manager and likelihood">
            <svg class="mg-edges" aria-hidden="true"></svg>
          </div>
          <p class="mg-hint">Drag to move. Scroll or pinch to zoom. Click a client to read the record.</p>
        </div>

        <div class="mg-scrim" hidden></div>
        <aside class="mg-panel" role="dialog" aria-label="Engagement detail" hidden>
          <div class="mg-panel-bar">
            <button type="button" class="mg-btn mg-icon mg-close" aria-label="Close the detail panel">${I.close}</button>
          </div>
          <div class="mg-panel-body"></div>
        </aside>
      </div>`;
  }

  /* --------------------------------------------------------------- the rail */

  function drawRail() {
    if (!S.rail) return;
    const mgrs = kids(S.root);

    /* Band totals across the whole department. These are the counts the mock
       declares, not a sum of loaded engagements — there are only five of those. */
    const totals = new Map();
    for (const m of mgrs) for (const b of kids(m)) {
      totals.set(b.band, (totals.get(b.band) || 0) + (b.count || 0));
    }

    const legend = [...totals.entries()].map(([band, n]) => {
      const name = (kids(mgrs[0]).find((b) => b.band === band) || {}).name || band;
      return `<li class="mg-leg">
          <span class="mg-swatch" style="--mg-band:${bandVar(band)}"></span>
          <span class="mg-leg-name">${S.esc(name)}</span>
          <span class="mg-num">${n}</span>
        </li>`;
    }).join("");

    const list = mgrs.map((m) => `
      <li>
        <button type="button" class="mg-jump" data-jump="${S.esc(m.id)}">
          <span class="mg-jump-name">${S.esc(m.name)}</span>
          <span class="mg-jump-meta">
            <span class="mg-num">${m.book || 0}</span> in the book ·
            ${m.populated ? "data loaded" : "no data loaded"}
          </span>
        </button>
      </li>`).join("");

    S.rail.innerHTML = `
      <div class="mg-rail">
        <h2 class="mg-rail-h">Likelihood bands</h2>
        <ul class="mg-legend">${legend}</ul>
        <h2 class="mg-rail-h">Managers</h2>
        <ul class="mg-jumps">${list}</ul>
        ${S.root.note ? `<p class="mg-rail-note">${S.esc(S.root.note)}</p>` : ""}
      </div>`;

    on(S.rail, "click", (e) => {
      const b = e.target.closest("[data-jump]");
      if (!b) return;
      const id = b.getAttribute("data-jump");
      S.collapsed.delete(id);
      S.focusId = id;
      draw();
      const rec = S.recs.get(id);
      if (rec) { centre(rec); focusNode(id); }
    });
  }

  /* --------------------------------------------------------------- the tree */

  function nodeEl(n, depth) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `mg-node mg-${S.esc(n.kind)}`;
    el.setAttribute("role", "treeitem");
    el.setAttribute("aria-level", String((S.levels.get(n.id) || 1)));
    el.dataset.id = n.id;
    el.style.width = COL_W[Math.min(depth, COL_W.length - 1)] + "px";
    el.style.left = COL_X[Math.min(depth, COL_X.length - 1)] + "px";
    el.tabIndex = n.id === S.focusId ? 0 : -1;

    const band = bandOf(n);
    if (band) el.style.setProperty("--mg-band", bandVar(band.band));
    el.setAttribute("aria-selected", String(n.id === S.selectedId));
    if (n.id === S.selectedId) el.classList.add("mg-on");

    const open = isOpen(n);
    if (hasKids(n)) el.setAttribute("aria-expanded", String(open));

    const parts = [];
    parts.push(
      `<span class="mg-row">
         <span class="mg-name">${S.esc(n.name)}</span>
         ${hasKids(n) ? `<span class="mg-chev">${open ? I.chevDown : I.chevRight}</span>` : ""}
       </span>`
    );

    if (n.kind === "root") {
      const mgrs = kids(n);
      const book = mgrs.reduce((a, m) => a + (m.book || 0), 0);
      parts.push(meta(`<span class="mg-num">${book}</span> engagements · ${plural(mgrs.length, "manager")}`));
    } else if (n.kind === "manager") {
      parts.push(meta(
        `<span class="mg-num">${n.book || 0}</span> in the book · ` +
        (n.populated ? "data loaded" : "no data loaded")
      ));
    } else if (n.kind === "band") {
      const loaded = kids(n).length;
      parts.push(meta(
        `<span class="mg-num">${n.count || 0}</span> ${(n.count === 1 ? "engagement" : "engagements")} · ` +
        (loaded ? `${loaded} loaded` : "none loaded")
      ));
    } else if (n.kind === "engagement") {
      parts.push(meta(S.esc(n.phase || "")));
      parts.push(meta(`<span class="mg-num">${n.days || 0}</span> days · ${S.esc(n.owner || "")}`));
    }

    if (n.note) parts.push(`<span class="mg-note">${S.esc(n.note)}</span>`);

    if (hasKids(n) && !open) {
      parts.push(`<span class="mg-shut"><span class="mg-num">${descendants(n)}</span> hidden below</span>`);
    }

    el.innerHTML = parts.join("");
    return el;
  }

  function draw() {
    /* Rebuild from scratch. The tree is forty nodes at its widest, so keeping
       elements alive across a toggle buys nothing and costs a diff. */
    for (const el of S.canvas.querySelectorAll(".mg-node")) el.remove();
    S.recs.clear();
    S.order.length = 0;

    const build = (n, depth) => {
      const rec = { n, depth, el: nodeEl(n, depth), kids: [] };
      S.canvas.appendChild(rec.el);
      S.recs.set(n.id, rec);
      S.order.push(rec);
      if (isOpen(n)) for (const c of kids(n)) rec.kids.push(build(c, depth + 1));
      return rec;
    };
    const root = build(S.root, 0);

    /* Two passes. Read every height first, then write every top: interleaving
       them forces a reflow per node and the heights are content-driven, so
       guessing them would put the edges in the wrong place. */
    for (const rec of S.order) rec.h = rec.el.offsetHeight;

    let cursor = PAD;
    (function place(rec) {
      if (!rec.kids.length) {
        rec.y = cursor;
        cursor += rec.h + ROW_GAP;
      } else {
        rec.kids.forEach(place);
        const a = rec.kids[0], b = rec.kids[rec.kids.length - 1];
        rec.y = (a.y + a.h / 2 + b.y + b.h / 2) / 2 - rec.h / 2;
      }
      rec.x = COL_X[Math.min(rec.depth, COL_X.length - 1)];
      rec.w = COL_W[Math.min(rec.depth, COL_W.length - 1)];
      rec.el.style.top = rec.y + "px";
    })(root);

    /* A parent centred on its children can sit above the first row. Push the
       whole canvas down rather than let the root hang off the top edge. */
    let top = Infinity;
    for (const rec of S.order) top = Math.min(top, rec.y);
    if (top < PAD) {
      const shift = PAD - top;
      for (const rec of S.order) { rec.y += shift; rec.el.style.top = rec.y + "px"; }
      cursor += shift;
    }

    let right = 0;
    for (const rec of S.order) right = Math.max(right, rec.x + rec.w);
    S.canvas.style.width = (right + PAD) + "px";
    S.canvas.style.height = (cursor + PAD) + "px";

    drawEdges(root);
  }

  function drawEdges(root) {
    const w = parseFloat(S.canvas.style.width), h = parseFloat(S.canvas.style.height);
    S.edges.setAttribute("width", w);
    S.edges.setAttribute("height", h);
    S.edges.setAttribute("viewBox", `0 0 ${w} ${h}`);

    let d = "";
    (function walk(rec) {
      for (const c of rec.kids) {
        const x1 = rec.x + rec.w, y1 = rec.y + rec.h / 2;
        const x2 = c.x, y2 = c.y + c.h / 2;
        const m = (x2 - x1) * 0.55;
        const band = bandOf(c.n);
        const stroke = band ? bandVar(band.band) : "var(--rule)";
        d += `<path class="mg-edge" d="M ${x1} ${y1} C ${x1 + m} ${y1}, ${x2 - m} ${y2}, ${x2} ${y2}" ` +
             `style="stroke:${stroke}"/>`;
        walk(c);
      }
    })(root);
    S.edges.innerHTML = d;
  }

  /* ----------------------------------------------------------- pan and zoom */

  function apply() {
    S.canvas.style.transform = `translate(${S.px}px, ${S.py}px) scale(${S.z})`;
    const out = S.host.querySelector(".mg-zval");
    if (out) out.textContent = Math.round(S.z * 100) + "%";
  }

  function zoomAt(next, cx, cy) {
    const z = Math.max(ZMIN, Math.min(ZMAX, next));
    const r = S.vp.getBoundingClientRect();
    const x = cx - r.left, y = cy - r.top;
    S.px = x - (x - S.px) * z / S.z;
    S.py = y - (y - S.py) * z / S.z;
    S.z = z;
    apply();
  }

  function zoomCentre(factor) {
    const r = S.vp.getBoundingClientRect();
    zoomAt(S.z * factor, r.left + r.width / 2, r.top + r.height / 2);
  }

  /* `soft` is the first view. A phone is narrow enough that fitting the whole
     department puts the names at six pixels, which is a diagram of a tree and
     not a tree, so there we open at a size that can be read and anchor on the
     department instead. The fit control itself always does a true fit. */
  function fit(soft) {
    const r = S.vp.getBoundingClientRect();
    const cw = S.canvas.offsetWidth, ch = S.canvas.offsetHeight;
    if (!r.width || !cw) return;
    const m = 28;
    const whole = Math.min((r.width - m) / cw, (r.height - m) / ch, 1);

    if (soft && whole < READABLE) {
      const root = S.recs.get(S.root.id);
      S.z = 0.8;
      S.px = root ? 16 - root.x * S.z : 16;
      S.py = root ? r.height / 2 - (root.y + root.h / 2) * S.z : 20;
      apply();
      return;
    }

    S.z = Math.max(ZMIN, whole);
    S.px = (r.width - cw * S.z) / 2;
    const sh = ch * S.z;
    S.py = sh < r.height - m ? (r.height - sh) / 2 : 16;
    apply();
  }

  function centre(rec) {
    const r = S.vp.getBoundingClientRect();
    S.px = r.width / 2 - (rec.x + rec.w / 2) * S.z;
    S.py = r.height / 2 - (rec.y + rec.h / 2) * S.z;
    glide();
  }

  /* Keyboard travel must not leave the focused node off screen, but it should
     not recentre the whole canvas either — that loses the reader's place. Move
     the least amount that brings the node inside. */
  function ensureVisible(rec) {
    const r = S.vp.getBoundingClientRect(), m = 28;
    const x1 = rec.x * S.z + S.px, x2 = (rec.x + rec.w) * S.z + S.px;
    const y1 = rec.y * S.z + S.py, y2 = (rec.y + rec.h) * S.z + S.py;
    let dx = 0, dy = 0;
    if (x1 < m) dx = m - x1; else if (x2 > r.width - m) dx = r.width - m - x2;
    if (y1 < m) dy = m - y1; else if (y2 > r.height - m) dy = r.height - m - y2;
    if (!dx && !dy) return;
    S.px += dx; S.py += dy;
    glide();
  }

  /* On a desk the panel sits over the right of the canvas, and the node you
     just opened is often the node it covers. Slide the canvas out from under
     it so the gold selection stays in sight next to what it says. */
  function clearOfPanel(rec) {
    if (!rec || S.panel.hidden) return;
    const r = S.vp.getBoundingClientRect();
    const pw = S.panel.getBoundingClientRect().width;
    const covered = Math.max(0, r.right - (window.innerWidth - pw));
    if (covered > r.width - 120) return; /* a full sheet: there is nothing left to reveal */
    const limit = r.width - covered - 20;
    const x1 = rec.x * S.z + S.px, x2 = (rec.x + rec.w) * S.z + S.px;
    if (x2 > limit) { S.px += limit - x2; glide(); }
    else if (x1 < 20) { S.px += 20 - x1; glide(); }
  }

  function glide() {
    S.canvas.classList.add("mg-glide");
    apply();
    window.setTimeout(() => S.canvas.classList.remove("mg-glide"), 300);
  }

  /* --------------------------------------------------------------- the panel */

  function openPanel(node, opener) {
    const band = bandOf(node);
    const mgr = (() => { let c = node; while (c && c.kind !== "manager") c = S.parents.get(c.id); return c; })();
    const body = S.panel.querySelector(".mg-panel-body");
    const swatch = band ? `<span class="mg-swatch" style="--mg-band:${bandVar(band.band)}"></span>` : "";

    /* The band goes UNDER the name, not over it. An uppercase label above a
       heading is an eyebrow, and the build does not use them. */
    const where = (n) => `<p class="mg-p-band">${swatch}` +
      (n ? `<span>${S.esc(n)}</span><span class="mg-p-sep">·</span>` : "") +
      `<span>In ${S.esc(mgr ? mgr.name : "the department")}'s book</span></p>`;

    let h = "";
    if (node.kind === "engagement") {
      h += `<h2 class="mg-p-title">${S.esc(node.name)}</h2>`;
      h += where(band ? band.name : "");
      h += `<dl class="mg-facts">
              <div><dt>Phase</dt><dd>${S.esc(node.phase || "—")}</dd></div>
              <div><dt>Running</dt><dd><span class="mg-num">${node.days || 0}</span> days</dd></div>
              <div><dt>Owner</dt><dd>${S.esc(node.owner || "—")}</dd></div>
            </dl>`;
      if (node.why) h += `<section class="mg-sec"><h3>Why it sits here</h3><p class="mg-why">${S.esc(node.why)}</p></section>`;
      const ev = node.evidence || [];
      h += `<section class="mg-sec"><h3>What the record shows</h3>`;
      if (ev.length) {
        h += `<ul class="mg-ev">` + ev.map((e) => `
          <li>
            <p class="mg-ev-src"><span class="mg-num">${S.esc(e.source || "")}</span> · <span class="mg-num">${S.esc(e.when || "")}</span></p>
            <p class="mg-ev-text">${ticks(e.text || "")}</p>
          </li>`).join("") + `</ul>`;
      } else {
        h += `<p class="mg-empty">No evidence is attached to this engagement in the mock.</p>`;
      }
      h += `</section>`;
    } else {
      /* An empty band. Say what is missing rather than fill it. */
      h += `<h2 class="mg-p-title">${S.esc(node.name)}</h2>`;
      h += where(null); /* the heading is already the band name */
      h += `<dl class="mg-facts">
              <div><dt>Counted</dt><dd><span class="mg-num">${node.count || 0}</span> ${node.count === 1 ? "engagement" : "engagements"}</dd></div>
              <div><dt>Loaded</dt><dd>none</dd></div>
            </dl>`;
      h += `<section class="mg-sec"><h3>Nothing to open</h3>
              <p class="mg-empty">No engagements are loaded for
              ${S.esc(mgr ? mgr.name : "this manager")} in this mock. The count above is
              the shape of the book, not a list, so there is nothing behind it to read.
              Only ${S.esc(firstPopulated())} carries engagements here.</p>
            </section>`;
    }

    body.innerHTML = h;
    window.clearTimeout(S.panelTimer);
    S.panel.hidden = false;
    S.scrim.hidden = false;
    /* A frame between the two, because an element cannot transition out of
       display:none — it has to be laid out before the class lands. */
    window.requestAnimationFrame(() => S.panel.classList.add("mg-open"));
    S.returnFocus = opener || null;
    const close = S.panel.querySelector(".mg-close");
    if (close) close.focus();
  }

  function firstPopulated() {
    const m = kids(S.root).find((x) => x.populated);
    return m ? m.name : "one manager";
  }

  function closePanel() {
    if (S.panel.hidden) return;
    S.panel.classList.remove("mg-open");
    S.scrim.hidden = true;
    /* Hide it only after it has slid out. Setting hidden here would cut the
       transition off at the first frame. A re-open cancels this. */
    window.clearTimeout(S.panelTimer);
    S.panelTimer = window.setTimeout(() => {
      if (!S.panel.classList.contains("mg-open")) S.panel.hidden = true;
    }, 260);
    if (S.returnFocus && document.contains(S.returnFocus)) S.returnFocus.focus();
    S.returnFocus = null;
  }

  /* ------------------------------------------------------------ interaction */

  function activate(id) {
    const node = S.recs.has(id) ? S.recs.get(id).n : null;
    if (!node) return;
    S.focusId = id;
    if (hasKids(node)) {
      if (S.collapsed.has(id)) S.collapsed.delete(id); else S.collapsed.add(id);
      draw();
      focusNode(id);
      const rec = S.recs.get(id);
      if (rec) ensureVisible(rec);
      return;
    }
    /* A leaf is either an engagement or a band with nothing loaded. Both open
       the panel; only one of them has anything to say. */
    S.selectedId = id;
    draw();
    focusNode(id);
    const rec = S.recs.get(id);
    openPanel(node, rec ? rec.el : null);
    window.requestAnimationFrame(() => clearOfPanel(S.recs.get(id)));
  }

  function focusNode(id) {
    for (const rec of S.order) rec.el.tabIndex = rec.n.id === id ? 0 : -1;
    const rec = S.recs.get(id);
    if (rec) rec.el.focus({ preventScroll: true });
  }

  function move(id, key) {
    const i = S.order.findIndex((r) => r.n.id === id);
    if (i < 0) return;
    const rec = S.order[i], n = rec.n;
    let target = null;

    if (key === "ArrowDown") target = S.order[Math.min(i + 1, S.order.length - 1)];
    else if (key === "ArrowUp") target = S.order[Math.max(i - 1, 0)];
    else if (key === "Home") target = S.order[0];
    else if (key === "End") target = S.order[S.order.length - 1];
    else if (key === "ArrowRight") {
      if (hasKids(n) && S.collapsed.has(n.id)) { activate(n.id); return; }
      if (isOpen(n)) target = S.recs.get(kids(n)[0].id);
    } else if (key === "ArrowLeft") {
      if (isOpen(n)) { activate(n.id); return; }
      const p = S.parents.get(n.id);
      if (p) target = S.recs.get(p.id);
    }

    if (!target) return;
    S.focusId = target.n.id;
    focusNode(target.n.id);
    ensureVisible(target);
  }

  function bind() {
    on(S.host, "click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (btn) {
        const act = btn.getAttribute("data-act");
        if (act === "in") zoomCentre(1.25);
        else if (act === "out") zoomCentre(1 / 1.25);
        else if (act === "fit") fit();
        else if (act === "expand") { S.collapsed.clear(); draw(); fit(); }
        else if (act === "collapse") {
          S.collapsed.clear();
          for (const rec of S.order) if (rec.depth >= 1 && hasKids(rec.n)) S.collapsed.add(rec.n.id);
          draw(); fit();
        }
        return;
      }
      if (e.target.closest(".mg-close") || e.target.closest(".mg-scrim")) { closePanel(); return; }
      const node = e.target.closest(".mg-node");
      if (node && !S.moved) activate(node.dataset.id);
    });

    on(S.canvas, "keydown", (e) => {
      const node = e.target.closest(".mg-node");
      if (!node) return;
      /* A drag sets S.moved to swallow the click it produces. Clear it here so
         a keyboard activation right after a drag is not swallowed with it. */
      if (e.key === "Enter" || e.key === " ") { S.moved = false; return; }
      if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        move(node.dataset.id, e.key);
      }
    });

    on(S.vp, "wheel", (e) => {
      e.preventDefault();
      zoomAt(S.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY);
    }, { passive: false });

    /* Pointer events carry mouse, pen and touch on one path. Two live pointers
       is a pinch; one is a drag. touch-action:none on the viewport is what
       stops the browser taking the gesture for its own scroll first. */
    const pts = new Map();
    let dragging = false, lx = 0, ly = 0, pinch = 0;

    on(S.vp, "pointerdown", (e) => {
      pts.set(e.pointerId, e);
      dragging = true; S.moved = false;
      lx = e.clientX; ly = e.clientY;
      S.vp.classList.add("mg-drag");
    });

    const onMove = (e) => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, e);
      if (pts.size === 2) {
        dragging = false;
        const v = [...pts.values()];
        const d = Math.hypot(v[0].clientX - v[1].clientX, v[0].clientY - v[1].clientY);
        if (pinch) zoomAt(S.z * d / pinch, (v[0].clientX + v[1].clientX) / 2, (v[0].clientY + v[1].clientY) / 2);
        pinch = d;
        S.moved = true;
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      if (Math.abs(dx) + Math.abs(dy) > 3) S.moved = true;
      S.px += dx; S.py += dy; lx = e.clientX; ly = e.clientY;
      apply();
    };

    const onUp = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      dragging = false;
      S.vp.classList.remove("mg-drag");
    };

    /* On window, because a drag that leaves the viewport still has to end. */
    on(window, "pointermove", onMove);
    on(window, "pointerup", onUp);
    on(window, "pointercancel", onUp);

    on(document, "keydown", (e) => { if (e.key === "Escape") closePanel(); });
  }

  function teardown() {
    for (const off of S.off) { try { off(); } catch (_) { /* element already gone */ } }
    S.off.length = 0;
    window.clearTimeout(S.panelTimer);
    S.recs.clear();
    S.order.length = 0;
    S.parents.clear();
    S.levels.clear();
    S.returnFocus = null;
  }

  function index(n, parent, level) {
    if (parent) S.parents.set(n.id, parent);
    S.levels.set(n.id, level);
    for (const c of kids(n)) index(c, n, level + 1);
  }

  /* ------------------------------------------------------------------ entry */

  function render(host, rail, data) {
    teardown();
    if (!host || !data || !data.org) return;

    S.host = host;
    S.rail = rail || null;
    S.esc = typeof data.esc === "function" ? data.esc : (s) => String(s ?? "");
    S.root = data.org;
    S.bandColor = data.bandColor || {};
    S.demo = data.demo !== false;
    S.collapsed = new Set();
    S.selectedId = null;
    S.z = 1; S.px = 0; S.py = 0; S.moved = false;

    index(S.root, null, 1);
    S.focusId = S.root.id;

    /* The four managers with nothing loaded start closed. Opening them shows
       five bands and five dead ends, which is noise on first sight. */
    for (const m of kids(S.root)) if (!m.populated) S.collapsed.add(m.id);

    host.innerHTML = shell(data);
    S.vp = host.querySelector(".mg-vp");
    S.canvas = host.querySelector(".mg-canvas");
    S.edges = host.querySelector(".mg-edges");
    S.panel = host.querySelector(".mg-panel");
    S.scrim = host.querySelector(".mg-scrim");

    bind();
    drawRail();
    draw();

    /* The host may not have a width yet on the first paint of a route change.
       Fitting against a zero-width box would pin the zoom at the floor. */
    if (S.vp.getBoundingClientRect().width) fit(true);
    else window.requestAnimationFrame(() => fit(true));
  }

  return { render };
})();
