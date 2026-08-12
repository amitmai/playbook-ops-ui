/* engagements.js — the engagement, drawn as time.
 *
 * WHY A GANTT AND NOT A LIST OF STEPS. A phase list answers "what happened".
 * It cannot answer the question a manager actually asks, which is "where did
 * this go slow, and how long has it been stuck". Duration is the information,
 * so duration has to be the geometry: one axis, real dates, bars whose WIDTH is
 * the time the client spent in that phase. Evenly spaced boxes would look like
 * a timeline and lie.
 *
 * WHY THE LEDGER UNDER THE PLOT. A three-day phase is a sliver at any honest
 * scale, and no label fits in a sliver. Rather than stretch short bars into a
 * lie, the sliver stays a sliver and the same record is repeated below as text.
 * The plot carries shape; the ledger carries fact. Neither is decoration.
 *
 * WHY ONE GOLD THING. The theme reserves gold for the live line. Here that is
 * the bar with `to: null` — the phase the client is in right now — and nothing
 * else on the screen. Playbook identity is carried by the band colours, so the
 * live bar keeps its playbook colour on its left edge and takes gold everywhere
 * else. That way the two facts do not compete for the same channel.
 *
 * WHY THE SCREEN HOLDS ITS OWN PHONE STATE. The host re-renders whenever the
 * route changes, and on a phone the list and the detail are the same column.
 * `showList` remembers which of the two the reader asked for, so pressing Back
 * does not need a route with no engagement in it.
 *
 * Everything lives inside one closure. These files are plain scripts sharing a
 * global scope, and a second top-level `const ICON` anywhere would be a syntax
 * error in the whole page.
 */

const ENGAGEMENTS = (() => {
  "use strict";

  const DAY = 86400000;

  /* ------------------------------------------------------------------ marks */

  /* Drawn, 1.6 stroke, square caps, to match ICON in app.js. A bubble kind is a
     shape first and a colour second, because seven kinds is more than colour can
     carry and some readers get no colour at all. */
  const MARK = {
    win: `<path d="M3 8.6 6.4 12 13 4.6"/>`,
    risk: `<path d="M8 2.6 14.6 13.4H1.4Z"/><path d="M8 6.4v3.4M8 11.6v.4"/>`,
    money: `<path d="M2 4.2h12v7.6H2z"/><path d="M8 6.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 1 1 0-3.2"/>`,
    handoff: `<path d="M1.8 8h8.4M7.6 5.2 10.4 8l-2.8 2.8"/><path d="M13.4 2.8v10.4"/>`,
    cross: `<path d="M1.6 4.4h3.6l5.2 7.2h4"/><path d="M1.6 11.6h3.6l5.2-7.2h4"/>`,
    silence: `<path d="M2.4 3.4h11.2v7.4H8.2L4.8 13.6v-2.8H2.4z"/><path d="M3.4 12.6 12.6 3.4"/>`,
    note: `<path d="M3.6 2.4h8.8v11.2H3.6z"/><path d="M5.9 5.8h4.2M5.9 8.4h4.2M5.9 11h2.6"/>`,
  };
  const svg = (d, size) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
    `stroke-width="1.6" stroke-linecap="square" aria-hidden="true">${d}</svg>`;

  const ARROW = svg(`<path d="M2 8h11M9.5 4.5 13 8l-3.5 3.5"/>`, 12);
  const BACK = svg(`<path d="M14 8H3M6.5 4.5 3 8l3.5 3.5"/>`, 13);
  const SIDEWAYS = svg(`<path d="M2 8h12M11 5l3 3-3 3M5 5 2 8l3 3"/>`, 13);

  /* The word for a kind. Colour is never on its own: every bubble says its kind
     in the record it opens and in its accessible name. */
  const KIND_WORD = {
    win: "win", risk: "risk", money: "money", handoff: "handoff",
    cross: "crossing", silence: "silence", note: "note",
  };

  /* Playbook name to band token. `expansion` and `--band-expand` do not share a
     spelling, so the mapping is explicit rather than derived. */
  const BAND = { renewal: "renewal", cancel: "cancel", expansion: "expand", nurture: "nurture" };
  const bandOf = (p) => BAND[p] || "renewal";

  /* ------------------------------------------------------------------ dates */

  /* Bars carry `YYYY-MM-DD`, issues carry a full ISO stamp. Both are read as
     local midnight, because the reader compares them against their own today. */
  function day(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(str || ""));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function today() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const span = (a, b) => Math.round((b - a) / DAY);
  const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);
  const dayWord = (n) => `${n} day${n === 1 ? "" : "s"}`;

  const fmtDay = (d) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const fmtMonth = (d) =>
    d.toLocaleDateString(undefined, { month: "short" }) +
    (d.getMonth() === 0 ? ` ’${String(d.getFullYear()).slice(2)}` : "");

  /* ------------------------------------------------------------------ lanes */

  /* Two moments on the same date would draw on top of each other, so anything
     closer than `gap` moves down a row. Beyond the last row it wraps rather than
     growing without limit: a plot taller than the screen is its own failure. */
  function lanes(points, gap, max) {
    const last = [];
    return points.map((p, i) => {
      for (let l = 0; l < max; l++) {
        if (last[l] === undefined || p - last[l] >= gap) {
          last[l] = p;
          return l;
        }
      }
      return i % max;
    });
  }

  /* ------------------------------------------------------------- the screen */

  let mount = null;      // { host, rail, data } from the last render
  let showList = true;   // phone only: is the reader on the list or the detail
  let seen = null;       // the selection the last render was drawn for

  function render(host, rail, data) {
    mount = { host, rail, data };
    if (seen !== data.selected) {
      showList = data.selected === null || data.selected === undefined;
      seen = data.selected;
    }
    draw();
  }

  function draw() {
    const { host, rail, data } = mount;
    const rows = ordered(data);
    const list = listHtml(rows, data);

    rail.innerHTML = `<div class="eng-rail">${list}</div>`;
    host.innerHTML = `
      <div class="eng-wrap ${showList ? "eng-is-list" : "eng-is-detail"}">
        <section class="eng-listpane">${list}</section>
        <section class="eng-detailpane">${detailHtml(rows, data)}</section>
      </div>`;

    wire(rail, data);
    wire(host, data);
    requestAnimationFrame(() => fitBars(true));
  }

  function wire(root, data) {
    root.querySelectorAll("[data-eng]").forEach((el) => {
      el.onclick = () => {
        showList = false;
        seen = Number(el.dataset.eng);
        data.onSelect(seen);
      };
    });
    root.querySelectorAll("[data-back]").forEach((el) => {
      el.onclick = () => { showList = true; draw(); };
    });
    root.querySelectorAll("[data-open]").forEach((el) => {
      el.onclick = () => reveal(root, el.dataset.open);
    });
  }

  /* ------------------------------------------------------------- the list */

  /* One row per engagement, open ones first and the longest-running at the top
     of each group. A renewal that has been going 86 days is the one somebody has
     to look at; a closed one is history and can wait. */
  function ordered(data) {
    return (data.engagements || [])
      .map((iss) => {
        const s = data.stateOf(iss);
        const tl = data.timelineFor(iss.number);
        const ph = (data.playbooks.phases || {})[s.phase];
        /* When the engagement knows when it opened, believe THAT over the
           issue's timestamps. An issue's created_at is when the row was
           written, which for a seeded history is the moment it was seeded —
           every engagement then reads as "0 days" while its own timeline says
           93. The engagement's own opened_at, and the timeline derived from
           its transition log, are the record; created_at is the filing date.
           Real engagements carry no opened_at and fall back to it, which is
           correct for them. */
        // Through day() in every case: these are Date objects downstream, and
        // span() subtracts them. A raw "2026-05-04" reads fine and arrives as
        // NaN days.
        const started = day(s.opened_at) || (tl && day(tl.start)) || day(iss.created_at) || today();
        const ended = day(s.ended_at) || (tl && day(tl.end)) || (iss.closed_at ? day(iss.closed_at) : null);
        return {
          iss, s, tl, ph, started, ended,
          days: span(started, ended || today()),
          live: iss.state !== "closed",
          state: endState(iss, s, tl, data),
          book: (data.playbooks.playbooks || {})[s.playbook],
        };
      })
      .sort((a, b) => (a.live === b.live ? b.days - a.days : a.live ? -1 : 1));
  }

  /* Live, won or churned. The timeline says so when there is one; otherwise the
     `state:` label the engine writes on close does; otherwise the terminal phase
     the engagement stopped on. Nothing is guessed past that. */
  function endState(iss, s, tl, data) {
    if (iss.state !== "closed") return "live";
    if (tl && tl.state && tl.state !== "live") return tl.state;
    for (const l of iss.labels || []) {
      const name = String(typeof l === "string" ? l : l.name || "");
      if (!name.startsWith("state:")) continue;
      const v = name.slice(6).toLowerCase();
      if (v.includes("churn")) return "churned";
      if (v.includes("won")) return "won";
    }
    const ph = (data.playbooks.phases || {})[s.phase];
    if (ph && ph.terminal) return ph.playbook === "cancel" ? "churned" : "won";
    return "closed";
  }

  const STATE_WORD = { live: "Live", won: "Won", churned: "Churned", closed: "Closed" };

  function listHtml(rows, data) {
    const e = data.esc;
    if (!rows.length) {
      return `<div class="eng-empty">
        <h2>No engagement is open</h2>
        <p>An engagement opens when a client is put on a playbook. Nothing is on one yet.</p>
      </div>`;
    }
    const items = rows
      .map((r) => {
        const where = r.ph ? data.label(r.ph) : r.s.phase || "unknown phase";
        const book = r.book ? r.book.title : r.s.playbook || "";
        const on = r.iss.number === data.selected;
        return `<button class="eng-row${on ? " eng-is-on" : ""}" data-eng="${e(r.iss.number)}"
            aria-current="${on ? "true" : "false"}"
            aria-label="${e(r.s.client_name)}, ${e(book)}, now at ${e(where)}, ${e(dayWord(r.days))}, ${e(STATE_WORD[r.state])}">
          <span class="eng-row-no">${e(r.iss.number)}</span>
          <span class="eng-row-body">
            <span class="eng-row-client">${e(r.s.client_name)}</span>
            <span class="eng-row-phase">${e(book)} · ${e(where)}</span>
          </span>
          <span class="eng-row-side">
            <span class="eng-chip eng-chip--${e(r.state)}">${e(STATE_WORD[r.state])}</span>
            <span class="eng-row-days">${e(dayWord(r.days))}</span>
          </span>
        </button>`;
      })
      .join("");

    return `
      <header class="eng-listhead">
        <h1 class="eng-listtitle">Engagements</h1>
        <p class="eng-listsub">${e(rows.length)} in the book${data.demo ? " · sample book" : ""}</p>
      </header>
      <div class="eng-rows">${items}</div>`;
  }

  /* ------------------------------------------------------------- the detail */

  function detailHtml(rows, data) {
    const e = data.esc;
    const row = rows.find((r) => r.iss.number === data.selected);

    if (!row) {
      return `<div class="eng-empty eng-empty--pick">
        <h2>Choose an engagement</h2>
        <p>Its whole history draws here as one timeline: every phase it sat in, how
        long each took, and the moments worth pointing at.</p>
      </div>`;
    }

    const head = headHtml(row, data);

    /* Live mode compiles no history, so `timelineFor` returns null for real
       engagements. Say that plainly. Drawing a plausible bar from the issue's
       open and close dates would be an invention wearing a chart's authority. */
    if (!row.tl) {
      return `${backHtml()}${head}
        <div class="eng-empty eng-empty--none">
          <h2>No timeline for this engagement</h2>
          <p>The engagement is real and open. Its phase history is not available to
          this screen, so there is nothing to draw. Nothing here is inferred from
          the dates on the issue.</p>
          ${data.demo ? "" : `<p class="eng-empty-more"><a class="eng-link" href="${e(row.iss.html_url)}"
            target="_blank" rel="noopener">Read the record on GitHub</a></p>`}
        </div>`;
    }

    return `${backHtml()}${head}${plotHtml(row, data)}${revealHtml()}${ledgerHtml(row, data)}${legendHtml(data)}`;
  }

  const backHtml = () =>
    `<button class="eng-back" data-back="1">${BACK} All engagements</button>`;

  function headHtml(row, data) {
    const e = data.esc;
    const tl = row.tl;
    const book = row.book ? row.book.title : row.s.playbook || "";
    const owner = tl && tl.owner ? tl.owner : (row.iss.assignees || []).map((a) => a.login).join(", ");
    const facts = [
      ["Playbook", book],
      owner ? ["Owner", owner] : null,
      ["Running", dayWord(row.days)],
      ["Engagement", `#${row.iss.number}`],
    ].filter(Boolean);

    return `
      <header class="eng-head">
        <h1 class="eng-client">${e(row.s.client_name)}</h1>
        ${tl && tl.headline ? `<p class="eng-headline">${e(tl.headline)}</p>` : ""}
        <div class="eng-facts">
          ${facts
            .map(
              ([k, v]) => `<span class="eng-fact"><span class="eng-fact-k">${e(k)}</span>
              <span class="eng-fact-v">${e(v)}</span></span>`
            )
            .join("")}
          <span class="eng-chip eng-chip--${e(row.state)}">${e(STATE_WORD[row.state])}</span>
        </div>
      </header>`;
  }

  /* ------------------------------------------------------------- the plot */

  function plotHtml(row, data) {
    const e = data.esc;
    const tl = row.tl;
    const bars = tl.bars || [];
    const start = day(tl.start) || row.started;
    const end = day(tl.end) || today();
    const total = Math.max(1, span(start, end));
    const pos = (d) => clamp(((d - start) / DAY / total) * 100, 0, 100);

    /* THE SCALE. Seven pixels a day is the phone: a thumb-wide viewport can
       only carry the shape, and the ledger underneath carries the words. A desk
       has room for the words, and a phase whose name will not fit reads as part
       of the bar before it, which turns six activities into one block. So the
       desk starts at twenty pixels a day and `fitBars` measures whether that was
       enough. The floor is a readable minimum, never a ceiling: the plot is a
       plain block and fills whatever column it is given. */
    const desk = window.matchMedia("(min-width: 900px)").matches;
    const width = Math.max(660, total * (desk ? 20 : 7) + 32);
    const gapPct = (46 / (width - 32)) * 100;

    /* --- axis ------------------------------------------------------------ */
    const marks = [{ at: start, label: fmtDay(start), cls: "eng-is-first" }];
    if (total <= 45) {
      for (let d = 7; d < total - 3; d += 7) {
        marks.push({ at: new Date(start.getTime() + d * DAY), label: fmtDay(new Date(start.getTime() + d * DAY)) });
      }
    } else {
      const c = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      while (c < end) {
        if (span(start, c) > 4 && span(c, end) > 4) marks.push({ at: new Date(c), label: fmtMonth(c) });
        c.setMonth(c.getMonth() + 1);
      }
    }
    marks.push({
      at: end,
      label: tl.end ? fmtDay(end) : "today",
      cls: "eng-is-last" + (tl.end ? "" : " eng-is-now"),
    });

    const axis = marks
      .map(
        (m) => `<span class="eng-tick ${m.cls || ""}" style="left:${pos(m.at).toFixed(3)}%">
          <span class="eng-tick-rule"></span><span class="eng-tick-label">${e(m.label)}</span>
        </span>`
      )
      .join("");

    /* --- crossings ------------------------------------------------------- */
    /* A client moving from renewal into the save play is the single most
       important event in this data, so it gets a colour change AND a flag that
       names both playbooks. */
    const crossings = [];
    for (let i = 1; i < bars.length; i++) {
      if (bars[i].playbook === bars[i - 1].playbook) continue;
      const at = day(bars[i].from);
      if (!at) continue;
      crossings.push({
        p: pos(at),
        from: titleOf(bars[i - 1].playbook, data),
        to: titleOf(bars[i].playbook, data),
      });
    }
    const xLanes = lanes(crossings.map((c) => c.p), gapPct * 3, 2);
    const xRows = crossings.length ? Math.max(...xLanes) + 1 : 0;
    const crossHtml = crossings
      .map(
        /* Past two thirds along, the flag reads back towards the start. Left of
           the stem it stays inside the plot; right of it, it would be clipped by
           the scrolling box or push the scroll wider than the axis. */
        (c, i) => `<span class="eng-cross${c.p > 62 ? " eng-is-endside" : ""}"
        style="left:${c.p.toFixed(3)}%;--lane:${xLanes[i]}">
        <span class="eng-cross-flag">${e(c.from)} ${ARROW} ${e(c.to)}</span>
        <span class="eng-cross-stem"></span>
      </span>`
      )
      .join("");

    /* --- bars ------------------------------------------------------------ */
    const barHtml = bars
      .map((b, i) => {
        const from = day(b.from);
        const to = day(b.to) || end;
        if (!from) return "";
        const left = pos(from);
        const w = Math.max(0, pos(to) - left);
        const st = b.state === "current" ? "now" : b.state === "exhausted" ? "out" : "done";
        const sub = subLine(b, data, from, to);
        return `<button class="eng-bar eng-pb-${e(bandOf(b.playbook))} eng-bar--${st}"
            style="left:${left.toFixed(3)}%;width:${w.toFixed(3)}%"
            data-days="${e(span(from, to))}"
            data-open="bar:${e(i)}" title="${e(barSentence(b, data, from, to))}"
            aria-label="${e(barSentence(b, data, from, to))}">
          <span class="eng-bar-text">
            <span class="eng-bar-name">${e(b.label || b.phase)}</span>
            <span class="eng-bar-sub">${e(sub)}</span>
          </span>
        </button>`;
      })
      .join("");

    /* --- bubbles --------------------------------------------------------- */
    const bubbles = (tl.bubbles || [])
      .map((b, i) => ({ b, i, p: pos(day(b.date) || start) }))
      .sort((a, z) => a.p - z.p);
    const bLanes = lanes(bubbles.map((x) => x.p), gapPct, 3);
    const bRows = bubbles.length ? Math.max(...bLanes) + 1 : 0;
    const bubHtml = bubbles
      .map(
        (x, n) => `<button class="eng-bub eng-bub--${e(x.b.kind)}"
        style="left:${x.p.toFixed(3)}%;--lane:${bLanes[n]}"
        data-open="bub:${e(x.i)}" title="${e(x.b.title)} — ${e(x.b.detail)}"
        aria-label="${e(KIND_WORD[x.b.kind] || x.b.kind)}, ${e(fmtDay(day(x.b.date) || start))}: ${e(x.b.title)}">
        <span class="eng-bub-stem"></span>
        <span class="eng-bub-mark">${svg(MARK[x.b.kind] || MARK.note, 14)}</span>
      </button>`
      )
      .join("");

    return `
      <div class="eng-tl">
        <div class="eng-tl-head">
          <h2 class="eng-h2">The timeline</h2>
          <span class="eng-tl-range">${e(fmtDay(start))} ${ARROW} ${e(tl.end ? fmtDay(end) : "today")} · ${e(dayWord(total))}</span>
        </div>
        <p class="eng-swipe">${SIDEWAYS} Scroll sideways to read the whole engagement.</p>
        <div class="eng-scroll" tabindex="0" role="group"
             aria-label="Timeline for ${e(row.s.client_name)}, ${e(fmtDay(start))} to ${e(tl.end ? fmtDay(end) : "today")}">
          <div class="eng-plot" style="min-width:${width}px" data-days="${e(total)}" data-base="${e(width)}">
            <div class="eng-axis">${axis}</div>
            <div class="eng-crossrow" style="height:${xRows ? xRows * 24 + 6 : 0}px">${crossHtml}</div>
            <div class="eng-barrow">${barHtml}</div>
            <div class="eng-bubrow" style="height:${bRows ? bRows * 30 + 12 : 0}px">${bubHtml}</div>
            ${tl.end ? "" : `<span class="eng-nowline" aria-hidden="true"></span>`}
          </div>
        </div>
      </div>`;
  }

  const titleOf = (name, data) => {
    const p = (data.playbooks.playbooks || {})[name];
    return p ? p.title : name || "";
  };

  /* Attempts are read against the phase's own limit, because "attempt 3" only
     means something next to the 3 the playbook allows. */
  function attemptWord(b, data) {
    const ph = (data.playbooks.phases || {})[b.phase];
    const max = ph && ph.max_attempts;
    if (!b.attempts) return "";
    if (max) return `attempt ${b.attempts} of ${max}`;
    return b.attempts === 1 ? "1 attempt" : `${b.attempts} attempts`;
  }

  function subLine(b, data, from, to) {
    if (b.state === "current") return `running · day ${span(from, to) + 1}`;
    const bits = [b.outcome, attemptWord(b, data)].filter(Boolean);
    return bits.join(" · ");
  }

  function barSentence(b, data, from, to) {
    const len = span(from, to);
    const when = b.to
      ? `${fmtDay(from)} to ${fmtDay(to)}, ${len === 0 ? "same day" : dayWord(len)}`
      : `from ${fmtDay(from)}, day ${len + 1} and still running`;
    const bits = [
      b.label || b.phase,
      titleOf(b.playbook, data),
      when,
      attemptWord(b, data),
      b.state === "exhausted" ? "attempts ran out" : "",
      b.outcome ? `outcome: ${b.outcome}` : "",
    ].filter(Boolean);
    return bits.join(" · ");
  }

  /* ------------------------------------------------------------- the record */

  /* One live region, written surgically. Re-drawing the whole screen to show a
     bubble would throw away the reader's scroll position in the plot, which is
     the one thing they had to work for on a phone. */
  function revealHtml() {
    return `<div class="eng-reveal" id="eng-reveal" role="status" aria-live="polite">
      <p class="eng-reveal-hint">Select a phase or a moment to read what is on the record.</p>
    </div>`;
  }

  function reveal(root, key) {
    const { data } = mount;
    const e = data.esc;
    const box = document.getElementById("eng-reveal");
    if (!box) return;
    const row = ordered(data).find((r) => r.iss.number === data.selected);
    if (!row || !row.tl) return;

    const [kind, nStr] = key.split(":");
    const n = Number(nStr);
    let html = "";

    if (kind === "bar") {
      const b = (row.tl.bars || [])[n];
      if (!b) return;
      const start = day(row.tl.start) || row.started;
      const from = day(b.from) || start;
      const to = day(b.to) || day(row.tl.end) || today();
      const len = span(from, to);
      const state =
        b.state === "current" ? "This is where the client is now."
        : b.state === "exhausted" ? "Attempts ran out here, so the playbook routed them out rather than trying again."
        : "Completed.";
      html = `
        <p class="eng-reveal-kicker">Phase · ${e(titleOf(b.playbook, data))}</p>
        <h3 class="eng-reveal-title">${e(b.label || b.phase)}</h3>
        <p class="eng-reveal-when">${e(fmtDay(from))} ${ARROW} ${e(b.to ? fmtDay(to) : "today")} ·
          ${e(len === 0 ? "same day" : dayWord(len))}${attemptWord(b, data) ? ` · ${e(attemptWord(b, data))}` : ""}</p>
        <p class="eng-reveal-detail">${e(state)}${b.outcome ? ` Outcome recorded: ${e(b.outcome)}.` : ""}</p>`;
    } else {
      const b = (row.tl.bubbles || [])[n];
      if (!b) return;
      html = `
        <p class="eng-reveal-kicker eng-k-${e(b.kind)}">${svg(MARK[b.kind] || MARK.note, 13)}
          ${e(KIND_WORD[b.kind] || b.kind)}</p>
        <h3 class="eng-reveal-title">${e(b.title)}</h3>
        <p class="eng-reveal-when">${e(fmtDay(day(b.date) || today()))}</p>
        <p class="eng-reveal-detail">${e(b.detail)}</p>`;
    }

    box.innerHTML = html;
    root.querySelectorAll("[data-open]").forEach((el) => {
      el.classList.toggle("eng-is-open", el.dataset.open === key);
    });
  }

  /* ------------------------------------------------------------- the ledger */

  /* The same bars as text. A two-day phase cannot hold a label at any honest
     scale, so the label lives here instead of the bar being widened to fit it. */
  function ledgerHtml(row, data) {
    const e = data.esc;
    const bars = row.tl.bars || [];
    if (!bars.length) return "";
    const end = day(row.tl.end) || today();

    const items = bars
      .map((b, i) => {
        const from = day(b.from);
        const to = day(b.to) || end;
        if (!from) return "";
        const len = span(from, to);
        const st = b.state === "current" ? "now" : b.state === "exhausted" ? "out" : "done";
        const word =
          b.state === "current" ? "running" : b.state === "exhausted" ? "attempts out" : "done";
        return `<button class="eng-led eng-pb-${e(bandOf(b.playbook))} eng-led--${st}"
            data-open="bar:${e(i)}">
          <span class="eng-led-when">${e(fmtDay(from))} ${ARROW} ${e(b.to ? fmtDay(to) : "today")}</span>
          <span class="eng-led-body">
            <span class="eng-led-name">${e(b.label || b.phase)}</span>
            <span class="eng-led-meta">${e(titleOf(b.playbook, data))}${
              attemptWord(b, data) ? ` · ${e(attemptWord(b, data))}` : ""
            }${b.outcome ? ` · ${e(b.outcome)}` : ""}</span>
          </span>
          <span class="eng-led-side">
            <span class="eng-led-len">${e(len === 0 ? "same day" : dayWord(len))}</span>
            <span class="eng-led-state">${e(word)}</span>
          </span>
        </button>`;
      })
      .join("");

    return `<section class="eng-ledger">
      <div class="eng-tl-head"><h2 class="eng-h2">Every phase, in order</h2></div>
      <div class="eng-leds">${items}</div>
    </section>`;
  }

  /* ------------------------------------------------------------- the legend */

  function legendHtml(data) {
    const e = data.esc;
    const books = Object.keys(data.playbooks.playbooks || {});
    const swatches = books
      .map(
        (n) => `<span class="eng-key eng-pb-${e(bandOf(n))}"><span class="eng-key-swatch"></span>${e(
          titleOf(n, data)
        )}</span>`
      )
      .join("");
    return `<section class="eng-legend">
      <span class="eng-legend-h">Reading it</span>
      ${swatches}
      <span class="eng-key eng-key--now"><span class="eng-key-swatch"></span>the phase running now</span>
      <span class="eng-key eng-key--out"><span class="eng-key-swatch"></span>attempts ran out</span>
    </section>`;
  }

  /* ------------------------------------------------------------- bar labels */

  /* Measured, not guessed. A percentage width says nothing about whether "5.1
     Proposal and Pricing" fits, and a clipped half-word is worse than no word:
     the tooltip, the accessible name and the ledger all still carry it. */
  function measure() {
    document.querySelectorAll(".eng-bar").forEach((bar) => {
      /* Read the label while it is still on. A muted bar hides its text, and
         the width of a hidden element is zero, which would tell the correction
         pass below that a bar with no room needs no room. */
      bar.classList.remove("eng-bar--tight", "eng-bar--mute");
      const name = bar.querySelector(".eng-bar-name");
      if (!name) return;
      const wants = name.scrollWidth;
      bar.dataset.wants = String(wants);
      if (wants > bar.clientWidth - 16) bar.classList.add("eng-bar--mute");
      else if (bar.clientWidth < 168) bar.classList.add("eng-bar--tight");
    });
  }

  /* One correction, after the first measurement. A fixed pixels-per-day cannot
     know how wide "4.2 Understanding Call" is in the reader's font at their text
     size, so the scale is not guessed either: if a phase of real length lost its
     label, the plot is widened until it holds, and the bars are measured again.
     Two rules keep this from running away. Phases under four days are left out,
     because a sliver stays a sliver at any honest scale and the ledger is what
     carries it. And the scale stops at 34 a day, past which a long engagement
     becomes more scrolling than the picture is worth. */
  const GROW_CAP = 34;

  function fitBars(grow) {
    const plot = document.querySelector(".eng-plot");
    if (grow && plot && plot.dataset.base) plot.style.minWidth = `${plot.dataset.base}px`;
    measure();
    if (!grow || !plot) return;
    if (!window.matchMedia("(min-width: 900px)").matches) return;

    const total = Number(plot.dataset.days);
    if (!total) return;
    let want = 0;
    plot.querySelectorAll(".eng-bar--mute").forEach((bar) => {
      const days = Number(bar.dataset.days);
      const wants = Number(bar.dataset.wants);
      if (!wants || !(days >= 4)) return;
      /* 16px of padding and 5px of border sit between the label and the bar's
         own width, so that is what the day has to pay for on top of the text. */
      want = Math.max(want, (wants + 22) / days);
    });
    if (!want) return;

    /* The plot has 16px of padding each side and the percentages are measured
       against the content box, so the padding is added back on. */
    const next = Math.round(total * Math.min(GROW_CAP, want)) + 32;
    if (next <= plot.clientWidth) return;
    plot.style.minWidth = `${next}px`;
    measure();
  }

  let fitTimer;
  window.addEventListener("resize", () => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => fitBars(true), 120);
  });

  /* Archivo is loaded with `font-display: swap`, so the first frame is measured
     in whatever the system supplies and Archivo arrives after it. Measuring once
     would size every bar against the wrong font and drop labels that fit, or
     keep labels that do not. Measure again when the real font is in. */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => fitBars(true)).catch(() => {});
  }

  return { render };
})();
