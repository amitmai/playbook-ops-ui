/* The promptbook, wired to GitHub.
 *
 * Screens and GitHub calls live here. The playbook itself does not: which
 * outcomes a phase offers, where each routes, which are self-loops, the plan
 * text a CSM reads, all of it is read from dist/playbooks.json, compiled from
 * the YAML by the engine and checked for staleness in CI. There is one graph.
 *
 * Since 2026-08-11 this client PERFORMS the transition rather than waiting for
 * a workflow to do it. Doing it through Actions took 14 to 19 seconds, nearly
 * all of it spent booting a virtual machine to run a dictionary lookup. Here it
 * takes about a second, and the writes are attributed to the real person
 * instead of github-actions[bot].
 *
 * The Action still exists and still fires on the outcome label. It now finds
 * the work already done and stops, or finishes it if this browser died half
 * way. Applying a label by hand in GitHub therefore still works exactly as
 * before, which is the property that made this design worth having.
 *
 * The mechanics of a transition are in engine.js, which also explains what this
 * split costs.
 */

const API = "https://api.github.com";

const S = {
  repo: localStorage.getItem("repo") || "",
  token: localStorage.getItem("token") || "",
  user: null,
  pb: null,
};

const $ = (sel) => document.querySelector(sel);
const view = () => $("#view");
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

/* ----------------------------------------------------------------- GitHub */

async function api(path, opts = {}) {
  const res = await fetch(path.startsWith("http") ? path : API + path, {
    ...opts,
    // GitHub answers authenticated reads with `cache-control: private, max-age=60`.
    // Without no-store the browser serves its OWN cached copy for a full minute,
    // so a polling loop watching for an issue to close keeps re-reading the same
    // stale "open" for up to 60s after the engine already closed it. The engine
    // takes ~20s; this made every transition feel like a minute and sometimes
    // time out entirely, which read as the engine being stuck when it was done.
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${S.token}`,
      Accept: opts.accept || "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try { detail = JSON.parse(text).message || text; } catch {}
    const err = new Error(`${res.status} — ${detail}`);
    err.status = res.status;
    throw err;
  }
  return opts.accept && !opts.accept.includes("json") ? text : JSON.parse(text || "null");
}

const issues = (labels, state = "open") =>
  api(`/repos/${S.repo}/issues?labels=${encodeURIComponent(labels.join(","))}&state=${state}&per_page=100`)
    .then((list) => (list || []).filter((i) => !i.pull_request));

const issue = (n) => api(`/repos/${S.repo}/issues/${n}`);

const comment = (n, body) =>
  api(`/repos/${S.repo}/issues/${n}/comments`, { method: "POST", body: JSON.stringify({ body }) });

const addLabel = (n, label) =>
  api(`/repos/${S.repo}/issues/${n}/labels`, { method: "POST", body: JSON.stringify({ labels: [label] }) });

const addLabels = (n, labels) =>
  api(`/repos/${S.repo}/issues/${n}/labels`, { method: "POST", body: JSON.stringify({ labels }) });

// Replaces the whole set in one call. Two writes (remove then add) cost twice
// as long as one, and GitHub asks that mutating requests be made serially, so
// write COUNT is the thing that decides how long a transition feels.
const setLabels = (n, labels) =>
  api(`/repos/${S.repo}/issues/${n}/labels`, { method: "PUT", body: JSON.stringify({ labels }) });

const removeLabel = (n, label) =>
  api(`/repos/${S.repo}/issues/${n}/labels/${encodeURIComponent(label)}`, { method: "DELETE" })
    .catch((e) => { if (e.status !== 404) throw e; }); // already gone is the goal

const closeIssue = (n) =>
  api(`/repos/${S.repo}/issues/${n}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed", state_reason: "completed" }),
  });

// Labels can be set at creation even when they do not exist yet: GitHub creates
// them. That saves a round trip and removes the window in which the issue exists
// with no labels, which is the window a label query would miss it in.
const createIssue = ({ title, body, assignees, labels }) =>
  api(`/repos/${S.repo}/issues`, {
    method: "POST",
    body: JSON.stringify({ title, body, assignees: assignees || [], labels: labels || [] }),
  });

// Takes the child's `id`, not its number. A real trap: every other endpoint
// here takes numbers.
const addSubIssue = (parent, childId) =>
  api(`/repos/${S.repo}/issues/${parent}/sub_issues`, {
    method: "POST",
    body: JSON.stringify({ sub_issue_id: childId }),
  });

const renderMarkdown = (text) =>
  api("/markdown", {
    method: "POST",
    accept: "text/html",
    body: JSON.stringify({ text, mode: "gfm", context: S.repo }),
  });

async function loadPlaybooks() {
  const raw = await api(`/repos/${S.repo}/contents/dist/playbooks.json`, {
    accept: "application/vnd.github.raw",
  });
  S.pb = JSON.parse(raw);
}

/* ------------------------------------------------------------ issue state */

const labelsOf = (iss) => (iss.labels || []).map((l) => (typeof l === "string" ? l : l.name));

function stateOf(iss) {
  const out = { number: iss.number, attempt: 1, outcomes: [], client_name: "" };
  for (const l of labelsOf(iss)) {
    if (l.startsWith("kind:")) out.kind = l.slice(5);
    else if (l.startsWith("client:")) out.client = l.slice(7);
    else if (l.startsWith("playbook:")) out.playbook = l.slice(9);
    else if (l.startsWith("phase:")) out.phase = l.slice(6);
    else if (l.startsWith("attempt:")) out.attempt = parseInt(l.slice(8), 10) || 1;
    else if (l.startsWith("outcome:")) out.outcomes.push(l.slice(8));
    else if (l.startsWith("sla:")) out.sla = l.slice(4);
  }
  const m = /<!--\s*PLAYBOOK-STATE\s*(\{.*?\})\s*-->/s.exec(iss.body || "");
  if (m) {
    try {
      const blob = JSON.parse(m[1]);
      out.client_name = blob.client_name || out.client;
      out.due_at = blob.due_at;
      out.engagement = blob.engagement;
    } catch {}
  }
  if (!out.client_name) out.client_name = out.client || "";
  return out;
}

const stripState = (body) => (body || "").replace(/<!--\s*PLAYBOOK-STATE[\s\S]*?-->/g, "").trim();

/* ------------------------------------------------------------------ chrome */

const flashEl = () => document.getElementById("flash");
let flashTimer;
function flash(msg) {
  const el = flashEl();
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove("on"), 2600);
}

/* Drawn, one stroke weight, square caps. No glyphs standing in for icons. */
const ICON = {
  next: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><path d="M2 8h11M9.5 4.5 13 8l-3.5 3.5"/></svg>`,
  back: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><path d="M14 8H3M6.5 4.5 3 8l3.5 3.5"/></svg>`,
  plus: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><path d="M8 3v10M3 8h10"/></svg>`,
  loop: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><path d="M3 8a5 5 0 0 1 8.5-3.5M13 8a5 5 0 0 1-8.5 3.5"/><path d="M11.5 2v2.8h-2.8M4.5 14v-2.8h2.8"/></svg>`,
  end: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><path d="M3 8.5 6.5 12 13 4.5"/></svg>`,
};

const TAPE = ["a", "b", "c"];
const tapeFor = (playbook) => {
  const names = Object.keys(S.pb ? S.pb.playbooks : {}).sort();
  const i = names.indexOf(playbook);
  return TAPE[i < 0 ? 0 : i % TAPE.length];
};

const today = () => new Date().setHours(0, 0, 0, 0);

/* Urgency is a word AND a rule weight AND a position, never colour alone. */
function dueInfo(due) {
  if (!due) return { key: "undated", label: "No date", word: "no date", order: 4, late: false };
  const days = Math.round((new Date(due + "T00:00:00") - today()) / 86400000);
  if (days < 0)
    return { key: "late", label: "Late", word: `${-days} day${-days === 1 ? "" : "s"} late`, order: 0, late: true };
  if (days === 0) return { key: "today", label: "Today", word: "due today", order: 1, late: false };
  if (days <= 7)
    return { key: "week", label: "This week", word: `in ${days} day${days === 1 ? "" : "s"}`, order: 2, late: false };
  return { key: "later", label: "Later", word: `${due}`, order: 3, late: false };
}

const GROUPS = ["late", "today", "week", "later", "undated"];
const GROUP_LABEL = { late: "Late", today: "Today", week: "This week", later: "Later", undated: "No date" };

function cueRow(t, s, { compact = false, current = false } = {}) {
  const ph = (S.pb.phases || {})[s.phase] || {};
  const d = dueInfo(s.due_at);
  return `<button class="cue ${d.late ? "is-late" : ""} ${current ? "current" : ""}"
      data-go="#/cue/${t.number}" aria-label="${esc(s.client_name)}, ${esc(ph.label || s.phase)}, ${esc(d.word)}">
    <span class="no">${t.number}</span>
    <span>
      <span class="client">${esc(s.client_name)}</span>
      <span class="phase">${esc(ph.label || s.phase)}${
        s.attempt > 1 ? ` · attempt ${s.attempt}${ph.max_attempts ? ` of ${ph.max_attempts}` : ""}` : ""
      }</span>
      ${compact ? `<span class="when">${esc(d.word)}</span>` : ""}
    </span>
    ${compact ? "" : `<span class="when">${esc(d.word)}</span>`}
  </button>`;
}

function renderRail(tasks, currentNumber) {
  const rail = document.getElementById("rail");
  if (!rail) return;
  const rows = tasks
    .map((t) => ({ t, s: stateOf(t) }))
    .sort(byUrgency)
    .map(({ t, s }) => cueRow(t, s, { compact: true, current: t.number === currentNumber }))
    .join("");
  rail.innerHTML = `
    <div class="masthead">
      <div>
        <a href="#/" class="sheet-title" style="text-decoration:none;color:inherit;font-size:19px">Running order</a>
        <div class="who">${tasks.length} open</div>
      </div>
    </div>
    <div class="cues">${rows}</div>`;
}

const byUrgency = (a, b) => {
  const da = dueInfo(a.s.due_at), db = dueInfo(b.s.due_at);
  if (da.order !== db.order) return da.order - db.order;
  return (a.s.due_at || "9999").localeCompare(b.s.due_at || "9999");
};

/* ------------------------------------------------------------ running order */

async function runningOrder() {
  view().className = "stage solo";
  const rail = document.getElementById("rail");
  if (rail) rail.innerHTML = "";

  view().innerHTML = `<div class="masthead"><div><h1 class="sheet-title">Running order</h1>
    <div class="who">reading the book…</div></div></div>`;

  const [tasks, engagements] = await Promise.all([
    issues(["kind:phase"]),
    issues(["kind:engagement"]),
  ]);

  const mineOnly = localStorage.getItem("mine") !== "0";
  const rows = tasks
    .map((t) => ({ t, s: stateOf(t) }))
    .filter(({ t }) => !mineOnly || (t.assignees || []).some((a) => a.login === S.user.login))
    .sort(byUrgency);

  const buckets = {};
  for (const r of rows) (buckets[dueInfo(r.s.due_at).key] ||= []).push(r);

  const dateLine = new Date().toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long",
  });

  const sheet = GROUPS.filter((g) => buckets[g] && buckets[g].length)
    .map(
      (g) => `<div class="group ${g === "late" ? "is-late" : ""}">
          <h2>${GROUP_LABEL[g]}</h2>
          <span class="count">${buckets[g].length}</span>
        </div>
        <div class="cues">${buckets[g].map(({ t, s }) => cueRow(t, s)).join("")}</div>`
    )
    .join("");

  view().innerHTML = `
    <div class="masthead">
      <div>
        <h1 class="sheet-title">Running order</h1>
        <div class="who">${esc(dateLine)} · ${rows.length} cue${rows.length === 1 ? "" : "s"}${
          mineOnly ? " assigned to you" : " across the team"
        }</div>
      </div>
      <div class="acts">
        <div class="seg" role="group" aria-label="Whose cues">
          <button data-mine="1" aria-pressed="${mineOnly}">Mine</button>
          <button data-mine="0" aria-pressed="${!mineOnly}">All</button>
        </div>
        <button class="btn quiet" id="newclient">${ICON.plus} Client</button>
      </div>
    </div>
    <div id="startpanel"></div>
    ${
      rows.length
        ? sheet
        : `<div class="empty"><h2>Nothing is called</h2>
             <p>${
               mineOnly && tasks.length
                 ? "There are open cues, but none are assigned to you. Switch to All to see the team's book."
                 : "No client is on a playbook yet. Put one on and the first cue appears here."
             }</p></div>`
    }
    ${
      engagements.length
        ? `<div class="group"><h2>Engagements</h2><span class="count">${engagements.length}</span></div>
           <div class="cues">${engagements
             .map((e) => {
               const s = stateOf(e);
               const ph = (S.pb.phases || {})[s.phase] || {};
               return `<a class="cue" href="https://github.com/${S.repo}/issues/${e.number}" target="_blank" rel="noopener">
                 <span class="no">${e.number}</span>
                 <span><span class="client">${esc(s.client_name)}</span>
                 <span class="phase">now at ${esc(ph.label || s.phase)}</span></span>
                 <span class="when">${esc((S.pb.playbooks[s.playbook] || {}).title || s.playbook)}</span>
               </a>`;
             })
             .join("")}</div>`
        : ""
    }`;

  view().querySelectorAll("[data-mine]").forEach((b) => {
    b.onclick = () => { localStorage.setItem("mine", b.dataset.mine); runningOrder(); };
  });
  $("#newclient").onclick = () => startPanel();
  wireGo();
}

function wireGo() {
  document.querySelectorAll("[data-go]").forEach((el) => {
    el.onclick = () => { location.hash = el.dataset.go; };
  });
}

/* ------------------------------------------------------------- new client */

function startPanel() {
  const host = $("#startpanel");
  if (!host || host.dataset.open === "1") return;
  host.dataset.open = "1";
  host.innerHTML = `
    <div class="panel">
      <h2>Put a client on a playbook</h2>
      <p class="lede">This opens their engagement and calls the first cue.</p>
      <label for="cname">Client</label>
      <input id="cname" type="text" placeholder="Acme Foundation" autocomplete="off">
      <label for="pbook">Playbook</label>
      <select id="pbook">
        ${Object.values(S.pb.playbooks)
          .filter((p) => p.entry && S.pb.phases[p.entry] && !S.pb.phases[p.entry].stub)
          .map((p) => `<option value="${esc(p.name)}">${esc(p.title)} — opens at ${esc(PBE.label(S.pb.phases[p.entry]))}</option>`)
          .join("")}
      </select>
      <div style="display:flex;gap:8px;margin-top:18px">
        <button class="btn solid" id="start">Open the first cue</button>
        <button class="btn quiet" id="cancelstart">Cancel</button>
      </div>
      <div id="startmsg"></div>
    </div>`;
  $("#cname").focus();
  $("#cancelstart").onclick = () => { host.dataset.open = "0"; host.innerHTML = ""; };
  $("#start").onclick = startClient;
}

async function startClient() {
  const name = $("#cname").value.trim();
  const playbook = $("#pbook").value;
  if (!name) { $("#cname").focus(); return; }
  const btn = $("#start");
  btn.disabled = true;
  const out = $("#startmsg");
  const say = (m) => (out.innerHTML = `<div class="standby"><span class="dot"></span>${m}</div>`);

  try {
    const slug = PBE.slugify(name);
    const pbook = S.pb.playbooks[playbook];
    const entry = S.pb.phases[pbook.entry];

    const open = await issues(["kind:engagement", `client:${slug}`]);
    if (open.length) {
      out.innerHTML = `<div class="note warn">${esc(name)} is already on a playbook,
        engagement #${open[0].number}. A client runs one playbook at a time.</div>`;
      return;
    }

    say("Opening the engagement");
    const engState = {
      client: slug, client_name: name, playbook, phase: entry.id,
      attempt: 1, playbook_version: pbook.version,
    };
    const engagement = await createIssue({
      title: PBE.engagementTitle(engState, S.pb),
      body: PBE.renderEngagementBody(engState, S.pb),
      assignees: [S.user.login],
      labels: ["kind:engagement", `client:${slug}`, `playbook:${playbook}`, `phase:${entry.id}`],
    });

    say(`Calling ${PBE.label(entry)}`);
    const taskState = {
      client: slug, client_name: name, playbook: entry.playbook, phase: entry.id,
      attempt: 1, engagement: engagement.number, due_at: PBE.dueDate(entry),
      playbook_version: pbook.version,
    };
    const first = await createIssue({
      title: PBE.phaseTitle(entry, taskState),
      body: PBE.renderPhaseBody(entry, taskState, S.pb),
      assignees: [S.user.login],
      labels: PBE.phaseLabels(taskState),
    });

    comment(
      engagement.number,
      `Engagement opened by @${S.user.login} on **${pbook.title}** (v${pbook.version}).\n\n` +
        `First cue: #${first.number} — **${PBE.label(entry)}**`
    ).catch(() => {});
    addSubIssue(engagement.number, first.id).catch(() => {});

    flash(`${name} is on ${pbook.title}`);
    location.hash = `#/cue/${first.number}`;
  } catch (e) {
    out.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

/* -------------------------------------------------------------- the open page */

async function openPage(number) {
  view().className = "stage";
  view().innerHTML = `<div class="page-head"><div class="standby"><span class="dot"></span>Finding the page</div></div>`;

  const [iss, tasks] = await Promise.all([issue(number), issues(["kind:phase"])]);
  const s = stateOf(iss);
  const ph = (S.pb.phases || {})[s.phase];
  renderRail(tasks, number);

  if (!ph) {
    view().innerHTML = `<div class="page-head"><a class="backlink" href="#/">${ICON.back} Running order</a>
      <div class="note bad">This issue is at phase <b>${esc(s.phase || "(none)")}</b>,
      which is not in the playbook. Nothing can be called from here.</div></div>`;
    return;
  }

  const closed = iss.state === "closed";
  const pbTitle = (S.pb.playbooks[ph.playbook] || {}).title || ph.playbook;
  const atLimit = ph.max_attempts && s.attempt >= ph.max_attempts;
  const d = dueInfo(s.due_at);

  const margin = [
    `<span><b>${esc(ph.id)}</b></span>`,
    `<span>${esc(ph.task_type)}</span>`,
    `<span>${esc(ph.owner)}</span>`,
    s.due_at ? `<span${d.late ? ' style="color:var(--late)"' : ""}>due ${esc(s.due_at)}${d.late ? ` · ${esc(d.word)}` : ""}</span>` : "",
    ph.max_attempts ? `<span>attempt ${s.attempt} of ${ph.max_attempts}</span>` : "",
  ].filter(Boolean).join("");

  view().innerHTML = `
    <div class="page-head">
      <a class="backlink" href="#/">${ICON.back} Running order</a>
      <h1 class="client-name">${esc(s.client_name)}</h1>
      <div class="client-sub">${esc(PBE.label(ph))} · cue ${iss.number}</div>
      <div class="flags">
        <span class="flag ${tapeFor(ph.playbook)}">${esc(pbTitle)}</span>
        ${d.late ? `<span class="stamp late">${esc(d.word)}</span>` : ""}
        ${atLimit && ph.on_exhausted ? `<span class="stamp hold">last attempt</span>` : ""}
        ${ph.stub ? `<span class="stamp hold">not built</span>` : ""}
        ${closed ? `<span class="stamp done">called</span>` : ""}
      </div>
      <div class="trail" id="trail"></div>
    </div>

    <section class="script-page">
      <div class="script-margin">${margin}</div>
      <div class="script-body">${scriptHtml(ph)}</div>
    </section>

    ${
      closed
        ? `<div class="note good">This cue was called${
            s.outcomes.length ? ` — <b>${esc(s.outcomes[0])}</b>` : ""
          }. Its transition is recorded on the engagement.</div>`
        : ph.terminal
        ? `<div class="note good">End of the book. ${
            ph.stub ? "This branch was not compiled into the POC." : "The engagement is complete."
          }</div>`
        : `
      <div class="margin-notes">
        <label for="note">Notes in the margin</label>
        <textarea id="note" placeholder="What happened on the call, in your words."></textarea>
      </div>

      <section class="calls">
        <div class="calls-head">
          <h2>Call the cue</h2>
          <span class="hint">what each one causes</span>
        </div>
        ${ph.outcomes.map((o, i) => callRow(o, i, ph, s)).join("")}
      </section>
      <div id="pickmsg"></div>`
    }

    <div style="margin-top:26px">
      <a class="btn quiet" href="https://github.com/${S.repo}/issues/${iss.number}" target="_blank" rel="noopener">
        Open #${iss.number} on GitHub
      </a>
    </div>`;

  view().querySelectorAll("[data-slug]").forEach((btn) => {
    btn.onclick = () => pick(iss, s, ph, btn.dataset.slug, btn);
  });
  loadTrail(s, ph);
}

/* The plan, as the script. The sheet writes a goal line first, so lift it. */
function scriptHtml(ph) {
  const text = (ph.plan_text || "").trim();
  if (!text) return `<span class="pencil">No plan text for this phase yet.</span>`;
  return esc(text).replace(/^(Goal:.*)$/m, '<span class="goal">$1</span>');
}

function callRow(o, i, ph, s) {
  const target = S.pb.phases[o.next];
  const atLimit = ph.max_attempts && s.attempt >= ph.max_attempts;
  let cls = "", icon = ICON.next, then;

  if (o.self_loop && atLimit && ph.on_exhausted) {
    cls = "exhausts"; icon = ICON.next;
    const ex = S.pb.phases[ph.on_exhausted];
    then = `attempts run out — goes to ${PBE.label(ex || { title: ph.on_exhausted, number: "" })}`;
  } else if (o.self_loop) {
    cls = "loop"; icon = ICON.loop;
    then = `stays here — attempt ${s.attempt + 1}${ph.max_attempts ? ` of ${ph.max_attempts}` : ""}`;
  } else if (target && target.terminal) {
    cls = "ends"; icon = ICON.end;
    then = `ends the engagement — ${PBE.label(target)}`;
  } else {
    then = `opens ${target ? PBE.label(target) : o.next}`;
    if (target && target.playbook !== ph.playbook) {
      then += ` — moves to ${(S.pb.playbooks[target.playbook] || {}).title || target.playbook}`;
    }
  }

  return `<button class="call ${cls}" data-slug="${esc(o.slug)}">
    <span class="n">${i + 1}</span>
    <span>
      <span class="name">${esc(o.id)}</span>
      <span class="means">${esc(o.means)}</span>
      <span class="then">${icon}${esc(then)}</span>
    </span>
  </button>`;
}

/* Where this client has already been. Loaded after paint: it is orientation,
   never something the CSM should wait on. */
async function loadTrail(s, ph) {
  const host = $("#trail");
  if (!host || !s.engagement) return;
  try {
    const subs = await api(`/repos/${S.repo}/issues/${s.engagement}/sub_issues`);
    const seen = [];
    for (const sub of subs || []) {
      const st = stateOf(sub);
      const p = (S.pb.phases || {})[st.phase];
      if (!p) continue;
      if (seen.length && seen[seen.length - 1].id === p.id) continue;
      seen.push({ id: p.id, label: PBE.label(p), now: sub.state === "open" && st.phase === s.phase });
    }
    if (seen.length < 2) return;
    host.innerHTML = seen
      .map((x) => `<span class="t ${x.now ? "now" : ""}">${esc(x.label)}</span>`)
      .join(`<span class="sep">${ICON.next}</span>`);
  } catch {}
}

/* ------------------------------------------------------------------ calling */

async function pick(iss, s, ph, slug, btn) {
  const note = $("#note")?.value.trim();
  const msg = $("#pickmsg");
  const t0 = Date.now();
  view().querySelectorAll(".call").forEach((b) => (b.disabled = true));
  btn.classList.add("calling");
  const say = (m) => (msg.innerHTML = `<div class="standby"><span class="dot"></span>${m}</div>`);

  try {
    const step = PBE.step(S.pb, ph.id, slug, s.attempt);
    const outcome = step.outcome;
    const nextPhase = S.pb.phases[step.nextPhase];
    const version = (S.pb.playbooks[ph.playbook] || {}).version || 1;
    const record = PBE.transitionRecord({
      fromPhase: ph, outcome, toPhase: nextPhase, actor: S.user.login,
      attempt: s.attempt, version, exhausted: step.exhausted, pb: S.pb,
    });

    say(`Calling <b>${esc(outcome.id)}</b>`);

    // WAVE 1: write the narrative, and look up what we need to decide.
    const [, engagement, already] = await Promise.all([
      (async () => {
        if (note) await comment(iss.number, note);
        await comment(iss.number, record);
      })(),
      s.engagement
        ? issue(s.engagement).catch(() => null)
        : issues(["kind:engagement", `client:${s.client}`]).then((l) => l[0]),
      issues(["kind:phase", `client:${s.client}`, `phase:${nextPhase.id}`]).then((l) =>
        l.filter((i) => i.number !== iss.number)
      ),
    ]);

    say(`Standby — ${esc(PBE.label(nextPhase))}`);

    // WAVE 2: close the old cue and open the new one.
    const isNew = !already.length;
    const taskState = {
      client: s.client, client_name: s.client_name || s.client,
      playbook: nextPhase.playbook, phase: nextPhase.id,
      attempt: step.nextAttempt, engagement: engagement && engagement.number,
      due_at: PBE.dueDate(nextPhase),
      playbook_version: (S.pb.playbooks[nextPhase.playbook] || {}).version || 1,
    };
    const labels = PBE.phaseLabels(taskState);
    if (nextPhase.terminal) labels.push("state:terminal");
    const assignees = (iss.assignees || []).map((a) => a.login);

    const [, next] = await Promise.all([
      closeIssue(iss.number).then(() => addLabel(iss.number, `outcome:${slug}`)),
      isNew
        ? createIssue({
            title: PBE.phaseTitle(nextPhase, taskState),
            body: PBE.renderPhaseBody(nextPhase, taskState, S.pb),
            assignees: assignees.length ? assignees : [S.user.login],
            labels,
          })
        : Promise.resolve(already[0]),
    ]);

    // WAVE 3: bookkeeping, in the background. The outcome label is already on,
    // so the backstop can finish or reconcile whatever this does not.
    const tail = [];
    if (isNew) {
      tail.push(
        comment(next.number, `Called from #${iss.number} (\`${ph.id}\` → **${outcome.id}** → \`${nextPhase.id}\`).`)
      );
    }
    if (engagement) {
      const crossing = nextPhase.playbook !== ph.playbook;
      const keep = labelsOf(engagement).filter(
        (l) => !l.startsWith("phase:") && !(crossing && l.startsWith("playbook:"))
      );
      keep.push(`phase:${nextPhase.id}`);
      if (crossing) keep.push(`playbook:${nextPhase.playbook}`);
      const ending = nextPhase.terminal && !nextPhase.stub;
      if (ending) keep.push(`state:${nextPhase.id.toLowerCase()}`);
      tail.push(setLabels(engagement.number, keep).then(() => (ending ? closeIssue(engagement.number) : null)));
      tail.push(
        comment(
          engagement.number,
          `${record}\n\n- **Cue called:** #${iss.number}\n- **Cue opened:** #${next.number}`
        )
      );
      addSubIssue(engagement.number, next.id).catch(() => {});
    }
    Promise.all(tail).catch((e) => console.warn("engagement bookkeeping failed:", e.message));

    console.log(`called in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
    flash(
      nextPhase.terminal && !nextPhase.stub
        ? `${s.client_name}: ${PBE.label(nextPhase)}`
        : `Next — ${PBE.label(nextPhase)}`
    );
    location.hash = `#/cue/${next.number}`;
  } catch (e) {
    btn.classList.remove("calling");
    msg.innerHTML = `<div class="note bad">${esc(e.message)}
      <br><br>Nothing else was written. If this cue is already closed, the backstop
      finishes the transition within about a minute.</div>`;
    view().querySelectorAll(".call").forEach((b) => (b.disabled = false));
  }
}

/* ----------------------------------------------------------------- settings */

function settingsScreen() {
  view().className = "stage solo";
  const rail = document.getElementById("rail");
  if (rail) rail.innerHTML = "";
  view().innerHTML = `
    <div class="masthead"><div><h1 class="sheet-title">Connection</h1>
      <div class="who">where the book is kept</div></div></div>
    <div class="panel">
      <p class="lede">This page talks to GitHub from your browser with <b>your</b> token, so
      every note and every called cue is attributed to you rather than to a shared bot.</p>
      <label for="repo">Engine repository</label>
      <input id="repo" type="text" placeholder="amitmai/causematch-cs-poc" value="${esc(S.repo)}" autocomplete="off">
      <label for="token">Personal access token</label>
      <input id="token" type="password" placeholder="github_pat_…" value="${esc(S.token)}" autocomplete="off">
      <p class="lede" style="margin-top:10px">
        Fine-grained, scoped to that repository only, with Issues read and write plus
        Contents read. It is kept in this browser and sent only to api.github.com.
      </p>
      <button class="btn solid wide" id="save">Save and open the book</button>
      <div id="msg"></div>
    </div>`;

  $("#save").onclick = async () => {
    S.repo = $("#repo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
    S.token = $("#token").value.trim();
    localStorage.setItem("repo", S.repo);
    localStorage.setItem("token", S.token);
    $("#msg").innerHTML = `<div class="standby"><span class="dot"></span>Checking</div>`;
    try {
      S.user = await api("/user");
      await loadPlaybooks();
      flash(`Signed in as @${S.user.login}`);
      location.hash = "#/";
    } catch (e) {
      $("#msg").innerHTML = `<div class="note bad">${esc(e.message)}${
        e.status === 404
          ? "<br><br>A 404 here almost always means the token cannot see the repository. Check it was scoped to this one, and that Contents is set to read."
          : ""
      }</div>`;
    }
  };
}

/* ------------------------------------------------------------------ routing */

async function route() {
  const hash = location.hash || "#/";
  if (!S.repo || !S.token) return settingsScreen();

  if (!S.user || !S.pb) {
    view().innerHTML = `<div class="masthead"><div class="standby"><span class="dot"></span>Opening the book</div></div>`;
    try {
      S.user = await api("/user");
      await loadPlaybooks();
    } catch (e) {
      view().innerHTML = `<div class="note bad">${esc(e.message)}</div>
        <p style="margin-top:14px"><a class="btn quiet" href="#/settings">Check the connection</a></p>`;
      return;
    }
  }

  try {
    if (hash === "#/settings") return settingsScreen();
    const cue = /^#\/cue\/(\d+)/.exec(hash);
    if (cue) return await openPage(Number(cue[1]));
    return await runningOrder();
  } catch (e) {
    view().innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
  }
}

window.addEventListener("hashchange", () => { route().then(wireGo); });
route().then(wireGo);
