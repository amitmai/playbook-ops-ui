/* The app: chrome, the queue, and the open task.
 *
 * Screens and GitHub calls live here. The playbook itself does not: which
 * outcomes a phase offers, where each routes, which are self-loops, the advice
 * a CSM reads, all of it is read from dist/playbooks.json, compiled from the
 * YAML by the engine and checked for staleness in CI. There is one graph.
 *
 * Since 2026-08-11 this client PERFORMS the transition rather than waiting for
 * a workflow to do it. Doing it through Actions took 14 to 19 seconds, nearly
 * all of it spent booting a virtual machine to run a dictionary lookup. Here it
 * takes about a second, and the writes are attributed to the real person
 * instead of github-actions[bot]. The Action still fires on the outcome label,
 * finds the work already done and stops, or finishes it if this browser died
 * half way. Applying a label by hand in GitHub therefore still works.
 *
 * Since 2026-08-12 there are four surfaces rather than one, and the app runs
 * without a token at all:
 *
 *   #/            the queue — what you owe, TASK first and client second
 *   #/task/N      one task: what to do, what the playbook advises, the outcome
 *   #/engagements the engagement as time (engagements.js)
 *   #/manager     the department as a tree (manager.js, mock only)
 *
 * DEMO MODE. With no repository and token saved, S.demo is true and every read
 * is served from demo.js instead of GitHub. The demo data is shaped exactly
 * like the API's, so the screens below cannot tell the difference and there is
 * no second rendering path to keep in step. Writes are refused in demo, which
 * is the point: a demo that quietly does nothing is worse than one that says so.
 */

const API = "https://api.github.com";

const S = {
  repo: localStorage.getItem("repo") || "",
  token: localStorage.getItem("token") || "",
  user: null,
  pb: null,
  demo: false,
};
S.demo = !(S.repo && S.token);

const $ = (sel) => document.querySelector(sel);
const view = () => $("#view");
const railEl = () => document.getElementById("rail");
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
    // stale "open" for up to 60s after the engine already closed it.
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

/* The demo store answers the same two questions the API does: give me the
   issues carrying these labels, and give me issue N. Everything downstream is
   the live code path. */
const demoQuery = (labels, state) =>
  DEMO.issues.filter(
    (i) =>
      (state === "all" || i.state === state) &&
      labels.every((l) => (i.labels || []).some((x) => x.name === l))
  );

const issues = (labels, state = "open") =>
  S.demo
    ? Promise.resolve(demoQuery(labels, state))
    : api(`/repos/${S.repo}/issues?labels=${encodeURIComponent(labels.join(","))}&state=${state}&per_page=100`)
        .then((list) => (list || []).filter((i) => !i.pull_request));

const issue = (n) =>
  S.demo
    ? Promise.resolve(DEMO.issues.find((i) => i.number === n) || Promise.reject(new Error(`No demo issue #${n}`)))
    : api(`/repos/${S.repo}/issues/${n}`);

/* Rejects rather than throws. Several callers are fire-and-forget chains ending
   in .catch(), and a synchronous throw escapes those entirely — it would take
   down the caller instead of being swallowed where the code plainly expects a
   failure to be survivable. */
const refuseInDemo = () =>
  Promise.reject(new Error("This is the sample book. Nothing is written to GitHub from here."));

const comment = (n, body) =>
  S.demo ? refuseInDemo()
    : api(`/repos/${S.repo}/issues/${n}/comments`, { method: "POST", body: JSON.stringify({ body }) });

const addLabel = (n, label) =>
  api(`/repos/${S.repo}/issues/${n}/labels`, { method: "POST", body: JSON.stringify({ labels: [label] }) });

// Replaces the whole set in one call. Two writes (remove then add) cost twice
// as long as one, and GitHub asks that mutating requests be made serially, so
// write COUNT is the thing that decides how long a transition feels.
const setLabels = (n, labels) =>
  api(`/repos/${S.repo}/issues/${n}/labels`, { method: "PUT", body: JSON.stringify({ labels }) });

const closeIssue = (n) =>
  api(`/repos/${S.repo}/issues/${n}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed", state_reason: "completed" }),
  });

// Labels can be set at creation even when they do not exist yet: GitHub creates
// them. That saves a round trip and removes the window in which the issue exists
// with no labels, which is the window a label query would miss it in.
const createIssue = ({ title, body, assignees, labels }) =>
  S.demo ? refuseInDemo()
    : api(`/repos/${S.repo}/issues`, {
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

async function loadPlaybooks() {
  if (S.demo) { S.pb = DEMO.playbooks; return; }
  const raw = await api(`/repos/${S.repo}/contents/dist/playbooks.json`, {
    accept: "application/vnd.github.raw",
  });
  S.pb = JSON.parse(raw);
}

const whoami = () => (S.demo ? Promise.resolve({ login: DEMO.CSM }) : api("/user"));

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
      out.todo_note = blob.todo_note;
    } catch {}
  }
  if (!out.client_name) out.client_name = out.client || "";
  return out;
}

/* ------------------------------------------------------------------ chrome */

let flashTimer;
function flash(msg) {
  const el = document.getElementById("flash");
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove("on"), 2800);
}

/* Drawn, one stroke weight, square caps. No glyphs standing in for icons. */
const ICON = {
  next: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><path d="M2 8h11M9.5 4.5 13 8l-3.5 3.5"/></svg>`,
  back: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><path d="M14 8H3M6.5 4.5 3 8l3.5 3.5"/></svg>`,
  plus: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><path d="M8 3v10M3 8h10"/></svg>`,
  loop: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><path d="M3 8a5 5 0 0 1 8.5-3.5M13 8a5 5 0 0 1-8.5 3.5"/><path d="M11.5 2v2.8h-2.8M4.5 14v-2.8h2.8"/></svg>`,
  end: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><path d="M3 8.5 6.5 12 13 4.5"/></svg>`,
  clock: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.4 1.6"/></svg>`,
  seal: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><path d="M8 1.6 9.9 5l3.7.6-2.7 2.7.6 3.8L8 10.3 4.5 12.1l.6-3.8L2.4 5.6 6.1 5z"/></svg>`,
};

const PB_CLASS = { renewal: "", cancel: "cancel", expansion: "expansion" };

const today = () => new Date().setHours(0, 0, 0, 0);

/* Urgency is a word AND a position AND a rule weight, never colour alone. */
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

const byUrgency = (a, b) => {
  const da = dueInfo(a.s.due_at), db = dueInfo(b.s.due_at);
  if (da.order !== db.order) return da.order - db.order;
  return (a.s.due_at || "9999").localeCompare(b.s.due_at || "9999");
};

/* What this task actually asks you to do. A phase carries its own line; an
   ad-hoc follow-up carries the title the CSM wrote. Where a compiled playbook
   has no `todo` line yet, the phase title is the honest fallback — it is the
   playbook's own words either way, never a paraphrase.
   The trailing full stop goes: a card title is a label, not a sentence, and
   half the queue having one looked like a mistake rather than a choice. */
function taskName(iss, s) {
  const raw =
    s.kind === "todo" ? iss.title : ((S.pb.phases || {})[s.phase] || {}).todo || ((S.pb.phases || {})[s.phase] || {}).title || iss.title;
  return String(raw).replace(/\.$/, "");
}

/* A follow-up carries no playbook label of its own, so the engagement it hangs
   off is where its playbook comes from. Without this the card said the bare
   word "engagement", which tells the CSM nothing they did not already know. */
let ENG_INDEX = {};
function engagementTitleFor(s) {
  const playbook = s.playbook || (ENG_INDEX[s.engagement] || {}).playbook;
  const pb = S.pb.playbooks[playbook];
  return pb ? `${pb.title} engagement` : "engagement";
}

/* The card leads with the TASK. Amit, 2026-08-12: a queue is answered
   task-first, and the client answers "for whom", which is the second question
   and therefore the second line. */
function taskCard(iss, s, { current = false } = {}) {
  const d = dueInfo(s.due_at);
  const ph = (S.pb.phases || {})[s.phase];
  const meta =
    s.kind === "todo"
      ? "Follow-up"
      : ph
      ? `${esc(PBE.label(ph))}${s.attempt > 1 ? ` · attempt ${s.attempt}${ph.max_attempts ? ` of ${ph.max_attempts}` : ""}` : ""} · ${esc(ph.owner)}`
      : esc(s.phase || "");

  return `<button class="task ${d.late ? "is-late" : ""} ${current ? "current" : ""}"
      data-go="#/task/${iss.number}"
      aria-label="${esc(taskName(iss, s))}, for ${esc(s.client_name)}, ${esc(d.word)}">
    <span class="name">${esc(taskName(iss, s))}</span>
    <span class="when">${esc(d.word)}</span>
    <span class="for">
      <span class="client">${esc(s.client_name)}</span>
      <span class="sep">·</span>
      <span>${esc(engagementTitleFor(s))}</span>
      ${s.engagement ? `<span class="eng">#${s.engagement}</span>` : ""}
    </span>
    <span class="meta">${meta}</span>
  </button>`;
}

function renderNav(active) {
  const items = [
    ["#/", "Tasks"],
    ["#/engagements", "Engagements"],
    ["#/manager", "Manager"],
    ["#/settings", S.demo ? "Connect" : "Connection"],
  ];
  document.getElementById("nav").innerHTML = items
    .map(([href, label]) => `<a href="${href}" class="${href === active ? "on" : ""}">${label}</a>`)
    .join("");
}

function renderBanner() {
  const host = document.getElementById("banner");
  if (!S.demo) { host.innerHTML = ""; return; }
  host.innerHTML = `<div class="demo-banner"><div class="in">
    <span class="seal">${ICON.seal}</span>
    <span><b>The sample book.</b> Five invented nonprofits, invented managers, invented
    plan text. No real client appears here and nothing is written to GitHub.</span>
    <a href="#/settings">Connect a repository</a>
  </div></div>`;
}

/* Settles the layout BEFORE anything renders into it.
   This used to run the other way round for the timeline and the tree: render
   first, then add the rail column if the module had put something in it. Both
   of those measure the viewport to fit their canvas, and they measured it 350px
   too wide, so the tree fitted to a width it then never had and hung off the
   right edge. The grid has to be final before a module reads it. */
function setLayout({ rail = true, wide = false } = {}) {
  document.getElementById("app").classList.toggle("norail", !rail);
  view().className = "stage" + (wide ? " wide" : "") + (rail ? "" : " solo");
  railEl().innerHTML = "";
}

/* ------------------------------------------------------------------ the queue */

/* Everything a CSM owes: playbook cues AND the follow-ups they wrote down.
   They are read in one place because a CSM's day is not sorted by which system
   created the task. The engagements come along in the same wave — reads are
   effectively free in parallel (measured: five together cost 318ms, one costs
   330ms), and a card cannot name its engagement without them. */
async function openWork() {
  const [phaseTasks, todos, engs] = await Promise.all([
    issues(["kind:phase"]),
    issues(["kind:todo"]),
    issues(["kind:engagement"], "all"),
  ]);
  ENG_INDEX = {};
  for (const e of engs) ENG_INDEX[e.number] = stateOf(e);
  return phaseTasks.concat(todos);
}

function renderRail(work, currentNumber) {
  const rail = railEl();
  if (!rail) return;
  const rows = work
    .map((t) => ({ t, s: stateOf(t) }))
    .sort(byUrgency)
    .map(({ t, s }) => taskCard(t, s, { current: t.number === currentNumber }))
    .join("");
  rail.innerHTML = `
    <div class="masthead"><div>
      <a href="#/" class="sheet-title" style="text-decoration:none;color:inherit;font-size:20px">The queue</a>
      <div class="who">${work.length} open</div>
    </div></div>
    <div class="tasks">${rows}</div>`;
  wireGo();
}

async function queueScreen() {
  setLayout({ rail: false });
  view().innerHTML = `<div class="masthead"><div><h1 class="sheet-title">The queue</h1>
    <div class="who">reading the book…</div></div></div>`;

  const work = await openWork();

  const mineOnly = localStorage.getItem("mine") !== "0";
  const rows = work
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
          <h2>${GROUP_LABEL[g]}</h2><span class="count">${buckets[g].length}</span>
        </div>
        <div class="tasks">${buckets[g].map(({ t, s }) => taskCard(t, s)).join("")}</div>`
    )
    .join("");

  view().innerHTML = `
    <div class="masthead">
      <div>
        <h1 class="sheet-title">The queue</h1>
        <div class="who">${esc(dateLine)} · ${rows.length} task${rows.length === 1 ? "" : "s"}${
          mineOnly ? " on you" : " across the team"
        }</div>
      </div>
      <div class="acts">
        <div class="seg" role="group" aria-label="Whose tasks">
          <button data-mine="1" aria-pressed="${mineOnly}">Mine</button>
          <button data-mine="0" aria-pressed="${!mineOnly}">All</button>
        </div>
        ${S.demo ? "" : `<button class="btn quiet" id="newclient">${ICON.plus} Client</button>`}
      </div>
    </div>
    <div id="startpanel"></div>
    ${
      rows.length
        ? sheet
        : `<div class="empty"><h2>Nothing is owed</h2>
             <p>${
               mineOnly && work.length
                 ? "There are open tasks, but none are on you. Switch to All to see the team's book."
                 : "No client is on a playbook yet. Put one on and the first task appears here."
             }</p></div>`
    }`;

  view().querySelectorAll("[data-mine]").forEach((b) => {
    b.onclick = () => { localStorage.setItem("mine", b.dataset.mine); queueScreen().then(wireGo); };
  });
  const nc = $("#newclient");
  if (nc) nc.onclick = () => startPanel();
  wireGo();
}

function wireGo() {
  document.querySelectorAll("[data-go]").forEach((el) => {
    el.onclick = () => { location.hash = el.dataset.go; };
  });
}

/* Setting a hash that is already set fires no hashchange, so connecting from
   the queue would leave the old screen up; setting one that differs fires it,
   so calling route() as well would render twice and, connected, fetch twice.
   One of the two, never both. */
function goHome() {
  if (location.hash && location.hash !== "#/") location.hash = "#/";
  else route().then(wireGo);
}

/* ------------------------------------------------------------- new client */

function startPanel() {
  const host = $("#startpanel");
  if (!host || host.dataset.open === "1") return;
  host.dataset.open = "1";
  host.innerHTML = `
    <div class="panel">
      <h2>Put a client on a playbook</h2>
      <p class="lede">This opens their engagement and creates the first task.</p>
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
        <button class="btn solid" id="start">Open the first task</button>
        <button class="btn quiet" id="cancelstart">Cancel</button>
      </div>
      <div id="startmsg" role="status" aria-live="polite"></div>
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

    say(`Opening ${PBE.label(entry)}`);
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
        `First task: #${first.number} — **${PBE.label(entry)}**`
    ).catch(() => {});
    addSubIssue(engagement.number, first.id).catch(() => {});

    flash(`${name} is on ${pbook.title}`);
    location.hash = `#/task/${first.number}`;
  } catch (e) {
    out.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

/* -------------------------------------------------------------- the open task */

async function taskScreen(number) {
  setLayout({ rail: true });
  view().innerHTML = `<div class="page-head"><div class="standby"><span class="dot"></span>Finding the task</div></div>`;

  const [iss, work] = await Promise.all([issue(number), openWork()]);
  const s = stateOf(iss);
  renderRail(work, number);

  if (s.kind === "todo") return followUpPage(iss, s);

  const ph = (S.pb.phases || {})[s.phase];
  if (!ph) {
    view().innerHTML = `<div class="page-head"><a class="backlink" href="#/">${ICON.back} The queue</a>
      <div class="note bad">This issue is at phase <b>${esc(s.phase || "(none)")}</b>,
      which is not in the playbook. Nothing can be recorded from here.</div></div>`;
    return;
  }

  const closed = iss.state === "closed";
  const pbTitle = (S.pb.playbooks[ph.playbook] || {}).title || ph.playbook;
  const atLimit = ph.max_attempts && s.attempt >= ph.max_attempts;
  const d = dueInfo(s.due_at);
  const brief = briefOf(ph);

  const strip = [
    `<span><b>${esc(ph.id)}</b> ${esc(PBE.label(ph))}</span>`,
    `<span>${esc(ph.task_type)}</span>`,
    `<span>${esc(ph.owner)}</span>`,
    s.due_at ? `<span class="${d.late ? "late" : ""}">due ${esc(s.due_at)}${d.late ? ` · ${esc(d.word)}` : ""}</span>` : "",
    ph.max_attempts ? `<span>attempt ${s.attempt} of ${ph.max_attempts}</span>` : "",
  ].filter(Boolean).join("");

  view().innerHTML = `
    <div class="page-head">
      <a class="backlink" href="#/">${ICON.back} The queue</a>
      <h1 class="task-title">${esc(taskName(iss, s))}</h1>
      <div class="task-client">
        <b>${esc(s.client_name)}</b> · ${esc(pbTitle)} engagement
        ${s.engagement ? `<span class="eng">#${s.engagement}</span>` : ""}
      </div>
      <div class="flags">
        <span class="band ${PB_CLASS[ph.playbook] || ""}">${esc(pbTitle)}</span>
        ${d.late ? `<span class="stamp late">${esc(d.word)}</span>` : ""}
        ${atLimit && ph.on_exhausted ? `<span class="stamp hold">last attempt</span>` : ""}
        ${ph.stub ? `<span class="stamp hold">not built</span>` : ""}
        ${closed ? `<span class="stamp done">recorded</span>` : ""}
      </div>
      <div class="trail" id="trail"></div>
    </div>

    <section class="brief">
      <div class="doing">${esc(brief.doing)}</div>
      <div class="seam" aria-hidden="true"></div>
      <div class="advice-head">How the playbook says to do it</div>
      <div class="advice${brief.advice ? "" : " none"}">${
        brief.advice ? esc(brief.advice) : "No plan text for this phase yet."
      }</div>
      <div class="strip">${strip}</div>
    </section>

    ${
      closed
        ? `<div class="note good">This task was recorded${
            s.outcomes.length ? ` — <b>${esc(s.outcomes[0])}</b>` : ""
          }. Its transition is on the engagement.</div>`
        : ph.terminal
        ? `<div class="note good">End of the playbook. ${
            ph.stub ? "This branch was not compiled into the POC." : "The engagement is complete."
          }</div>`
        : `
      <div class="section-head"><h2>Result</h2>
        <span class="hint">what happened, in your words</span></div>
      <textarea id="note" placeholder="What happened on the call. This is posted to the task before the outcome is recorded."></textarea>

      <div class="section-head"><h2>Outcome</h2>
        <span class="hint">what each one causes</span></div>
      ${ph.outcomes.map((o, i) => callRow(o, i, ph, s)).join("")}
      <div id="pickmsg" role="status" aria-live="polite"></div>

      ${postponeBlock()}`
    }

    ${
      S.demo
        ? ""
        : `<div style="margin-top:26px">
             <a class="btn quiet" href="https://github.com/${S.repo}/issues/${iss.number}" target="_blank" rel="noopener">
               Open #${iss.number} on GitHub</a>
           </div>`
    }`;

  view().querySelectorAll("[data-slug]").forEach((btn) => {
    btn.onclick = () => pick(iss, s, ph, btn.dataset.slug, btn);
  });
  wirePostpone();
  loadTrail(s, ph);
}

/* An ad-hoc follow-up. It carries no routing, so there are no outcomes to
   show — only what the CSM wrote, and the two ways to move it. */
function followUpPage(iss, s) {
  const d = dueInfo(s.due_at);
  view().innerHTML = `
    <div class="page-head">
      <a class="backlink" href="#/">${ICON.back} The queue</a>
      <h1 class="task-title">${esc(iss.title)}</h1>
      <div class="task-client">
        <b>${esc(s.client_name)}</b> · ${esc(engagementTitleFor(s))}
        ${s.engagement ? `<span class="eng">#${s.engagement}</span>` : ""}
      </div>
      <div class="flags">
        <span class="band todo">Follow-up</span>
        ${d.late ? `<span class="stamp late">${esc(d.word)}</span>` : ""}
      </div>
    </div>

    <section class="brief">
      <div class="advice-head" style="padding-top:22px">Why you wrote it down</div>
      <div class="doing" style="padding-top:6px">${
        s.todo_note ? esc(s.todo_note) : "No note was left with this follow-up."
      }</div>
      <div class="strip">
        <span><b>Follow-up</b> — not a playbook phase, so it routes nowhere</span>
        ${s.due_at ? `<span class="${d.late ? "late" : ""}">due ${esc(s.due_at)}</span>` : ""}
      </div>
    </section>

    <div class="section-head"><h2>Result</h2>
      <span class="hint">what happened, in your words</span></div>
    <textarea id="note" placeholder="What happened."></textarea>

    <div class="section-head"><h2>Outcome</h2></div>
    <button class="call" data-mock="Marking a follow-up done">
      <span class="n">1</span>
      <span>
        <span class="name">Done</span>
        <span class="means">The follow-up is finished and closes.</span>
        <span class="then">${ICON.end}closes this follow-up — the engagement is untouched</span>
      </span>
    </button>
    <div id="pickmsg" role="status" aria-live="polite"></div>
    ${postponeBlock()}`;
  wirePostpone();
}

/* Splits the phase into the two registers the open page shows: the one thing
   to do, large, and how to do it, quieter.
   The sheet writes a goal line first, and that goal line IS the one thing to
   do — in the playbook's own words rather than a paraphrase of them. Lifting
   it means the big line and the advice never say the same sentence twice,
   which is what the first draft did. Where a phase has no goal line, the
   phase's own todo line stands in. */
function briefOf(ph) {
  const text = (ph.plan_text || "").trim();
  const m = /^Goal:[ \t]*(.+)$/m.exec(text);
  if (!m) return { doing: ph.todo || ph.title, advice: text };
  const goal = m[1].trim();
  return {
    doing: goal.charAt(0).toUpperCase() + goal.slice(1),
    advice: text.replace(m[0], "").trim(),
  };
}

/* Postponing is not an outcome, and the layout says so: it sits below the
   outcomes, under a dashed rule, in the quiet button. Nothing here is built —
   pressing one says that plainly rather than pretending. */
function postponeBlock() {
  return `<div class="postpone">
    <p class="lede">Not done yet? Move it, and say nothing about the outcome.</p>
    <div class="row">
      <button class="btn quiet" data-mock="Postponing by a day">${ICON.clock} Postpone by a day</button>
      <button class="btn quiet" data-mock="Postponing by three days">${ICON.clock} Postpone by three days</button>
    </div>
    <div id="mockmsg" role="status" aria-live="polite"></div>
  </div>`;
}

function wirePostpone() {
  view().querySelectorAll("[data-mock]").forEach((b) => {
    b.onclick = () => {
      const host = $("#mockmsg") || $("#pickmsg");
      host.innerHTML = `<div class="mocknote">${ICON.seal}
        <span><b>${esc(b.dataset.mock)} has not been activated yet.</b>
        The control is drawn so the shape of the screen is right. It writes nothing,
        moves no due date, and records nothing on the engagement.</span></div>`;
      host.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
  });
}

function callRow(o, i, ph, s) {
  const target = S.pb.phases[o.next];
  const atLimit = ph.max_attempts && s.attempt >= ph.max_attempts;
  let cls = "", icon = ICON.next, then;

  if (o.self_loop && atLimit && ph.on_exhausted) {
    cls = "exhausts";
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
    const seen = [];
    if (S.demo) {
      const tl = DEMO.timelines[s.engagement];
      if (!tl) return;
      for (const b of tl.bars) seen.push({ label: b.label, now: b.state === "current" });
    } else {
      const subs = await api(`/repos/${S.repo}/issues/${s.engagement}/sub_issues`);
      for (const sub of subs || []) {
        const st = stateOf(sub);
        const p = (S.pb.phases || {})[st.phase];
        if (!p) continue;
        if (seen.length && seen[seen.length - 1].id === p.id) continue;
        seen.push({ id: p.id, label: PBE.label(p), now: sub.state === "open" && st.phase === s.phase });
      }
    }
    if (seen.length < 2) return;
    host.innerHTML = seen
      .map((x) => `<span class="t ${x.now ? "now" : ""}">${esc(x.label)}</span>`)
      .join(`<span class="sep">${ICON.next}</span>`);
  } catch {}
}

/* ------------------------------------------------------------------ recording */

async function pick(iss, s, ph, slug, btn) {
  const msg = $("#pickmsg");

  if (S.demo) {
    msg.innerHTML = `<div class="mocknote">${ICON.seal}
      <span><b>Recording an outcome has not been activated in the sample book.</b>
      In a connected repository this posts your result, closes this task, applies
      the outcome label and opens whatever the playbook routes to next. Here it
      writes nothing.</span></div>`;
    msg.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }

  const note = $("#note")?.value.trim();
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

    say(`Recording <b>${esc(outcome.id)}</b>`);

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

    // WAVE 2: close the old task and open the new one.
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
        comment(next.number, `Opened from #${iss.number} (\`${ph.id}\` → **${outcome.id}** → \`${nextPhase.id}\`).`)
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
        comment(engagement.number, `${record}\n\n- **Task closed:** #${iss.number}\n- **Task opened:** #${next.number}`)
      );
      addSubIssue(engagement.number, next.id).catch(() => {});
    }
    Promise.all(tail).catch((e) => console.warn("engagement bookkeeping failed:", e.message));

    console.log(`recorded in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
    flash(
      nextPhase.terminal && !nextPhase.stub
        ? `${s.client_name}: ${PBE.label(nextPhase)}`
        : `Next — ${PBE.label(nextPhase)}`
    );
    location.hash = `#/task/${next.number}`;
  } catch (e) {
    btn.classList.remove("calling");
    msg.innerHTML = `<div class="note bad">${esc(e.message)}
      <br><br>Nothing else was written. If this task is already closed, the backstop
      finishes the transition within about a minute.</div>`;
    view().querySelectorAll(".call").forEach((b) => (b.disabled = false));
  }
}

/* --------------------------------------------------------------- engagements */

async function engagementsScreen(selected) {
  setLayout({ rail: true, wide: true });
  view().innerHTML = `<div style="padding:26px 20px"><div class="standby"><span class="dot"></span>Reading the engagements</div></div>`;

  const engagements = await issues(["kind:engagement"], "all");
  const list = engagements.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  /* Opening one for you is right at a desk, where the list stays beside it and
     picking another is one click. On a phone the detail REPLACES the list, so
     the same helpfulness lands you inside one client's history having never
     been shown the other four, with only a back link out. The two scenes are
     first-class in this product, so the route answers "nothing selected"
     differently in each. */
  const desk = window.matchMedia("(min-width: 900px)").matches;
  const pick = selected || (desk && list[0] ? list[0].number : null);

  ENGAGEMENTS.render(view(), railEl(), {
    engagements: list,
    // In a connected repository the timeline is not compiled yet, so this
    // returns null and the screen says so rather than inventing a history.
    timelineFor: (n) => (S.demo ? DEMO.timelines[n] || null : null),
    playbooks: S.pb,
    demo: S.demo,
    esc,
    stateOf,
    label: PBE.label,
    selected: pick,
    onSelect: (n) => { location.hash = `#/engagements/${n}`; },
  });

  /* The phone's back link returns the pane to the list on its own, but it does
     not own the URL, so the hash stayed on the engagement you had just left.
     Reloading or sharing that address reopened the detail you had backed out
     of. Putting the hash back in step re-renders through the same route, which
     lands on the list because nothing is selected. */
  const back = view().querySelector(".eng-back");
  if (back) back.addEventListener("click", () => { location.hash = "#/engagements"; });

  wireGo();
}

/* ------------------------------------------------------------------- manager */

/* Mock in every mode, connected or not. It shows the shape a manager needs
   before anyone builds the query that would fill it. */
function managerScreen() {
  setLayout({ rail: true, wide: true });
  MANAGER.render(view(), railEl(), {
    org: DEMO.org,
    bandColor: DEMO.BAND_COLOR,
    esc,
    demo: S.demo,
  });
}

/* ----------------------------------------------------------------- settings */

function settingsScreen() {
  setLayout({ rail: false });
  view().innerHTML = `
    <div class="masthead"><div><h1 class="sheet-title">Connection</h1>
      <div class="who">${S.demo ? "running on the sample book" : `connected to ${esc(S.repo)}`}</div></div></div>
    <div class="panel">
      <p class="lede">This page talks to GitHub from your browser with <b>your</b> token, so
      every result and every recorded outcome is attributed to you rather than to a shared bot.</p>
      <label for="repo">Engine repository</label>
      <input id="repo" type="text" placeholder="amitmai/causematch-cs-poc" value="${esc(S.repo)}" autocomplete="off">
      <label for="token">Personal access token</label>
      <input id="token" type="password" placeholder="github_pat_…" value="${esc(S.token)}" autocomplete="off">
      <p class="lede" style="margin-top:10px">
        Fine-grained, scoped to that repository only, with Issues read and write plus
        Contents read. It is kept in this browser and sent only to api.github.com.
      </p>
      <button class="btn solid wide" id="save">Save and open the book</button>
      <div id="msg" role="status" aria-live="polite"></div>
    </div>
    ${
      S.demo
        ? `<div class="note"><b>Or look without connecting.</b> With no token saved the app
             runs on the sample book: five invented nonprofits, their engagements, and a
             queue you can move through. Reading works everywhere; nothing writes.
             <div style="margin-top:12px"><a class="btn quiet" href="#/">Open the sample book</a></div>
           </div>`
        : `<div class="note"><b>Disconnect</b> to go back to the sample book. Your token is
             removed from this browser.
             <div style="margin-top:12px"><button class="btn quiet" id="forget">Disconnect</button></div>
           </div>`
    }`;

  const forget = $("#forget");
  if (forget) forget.onclick = () => {
    localStorage.removeItem("token"); localStorage.removeItem("repo");
    S.token = ""; S.repo = ""; S.demo = true; S.user = null; S.pb = null;
    flash("Disconnected — back on the sample book");
    goHome();
  };

  $("#save").onclick = async () => {
    S.repo = $("#repo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
    S.token = $("#token").value.trim();
    if (!S.repo || !S.token) {
      $("#msg").innerHTML = `<div class="note warn">Both a repository and a token are needed.</div>`;
      return;
    }
    S.demo = false;
    $("#msg").innerHTML = `<div class="standby"><span class="dot"></span>Checking</div>`;
    try {
      S.user = await whoami();
      await loadPlaybooks();
      localStorage.setItem("repo", S.repo);
      localStorage.setItem("token", S.token);
      flash(`Signed in as @${S.user.login}`);
      goHome();
    } catch (e) {
      S.demo = true;
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
  const section = hash.startsWith("#/engagements") ? "#/engagements"
    : hash.startsWith("#/manager") ? "#/manager"
    : hash.startsWith("#/settings") ? "#/settings"
    : "#/";
  renderBanner();
  renderNav(section);

  if (hash.startsWith("#/settings")) return settingsScreen();

  if (!S.user || !S.pb) {
    view().innerHTML = `<div class="masthead"><div class="standby"><span class="dot"></span>Opening the book</div></div>`;
    try {
      S.user = await whoami();
      await loadPlaybooks();
    } catch (e) {
      view().innerHTML = `<div class="note bad">${esc(e.message)}</div>
        <p style="margin-top:14px"><a class="btn quiet" href="#/settings">Check the connection</a></p>`;
      return;
    }
  }

  try {
    if (hash.startsWith("#/manager")) return managerScreen();
    const eng = /^#\/engagements(?:\/(\d+))?/.exec(hash);
    if (eng) return await engagementsScreen(eng[1] ? Number(eng[1]) : null);
    // #/cue/N is the old name for a task. Kept so existing links still land.
    const task = /^#\/(?:task|cue)\/(\d+)/.exec(hash);
    if (task) return await taskScreen(Number(task[1]));
    return await queueScreen();
  } catch (e) {
    /* A bad or stale address used to dead-end on a bare error line with no way
       out — a link to a task that has since been deleted, or a number typed by
       hand, left you on a page with nothing on it. Say what was asked for, say
       the likeliest reason, and always leave the door open. */
    setLayout({ rail: false });
    const missing = e.status === 404 || /^No demo issue/.test(e.message);
    view().innerHTML = `
      <div class="masthead"><div><h1 class="sheet-title">Not here</h1>
        <div class="who">${esc(location.hash)}</div></div></div>
      <div class="note ${missing ? "" : "bad"}">
        ${missing
          ? `Nothing at this address.${
              S.demo
                ? " The sample book holds five engagements and twelve tasks, and this is not one of them."
                : " The issue may have been deleted, or your token may not be able to see it."
            }`
          : esc(e.message)}
      </div>
      <p style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn solid" href="#/">${ICON.back} The queue</a>
        <a class="btn quiet" href="#/engagements">Engagements</a>
        ${S.demo ? "" : `<a class="btn quiet" href="#/settings">Check the connection</a>`}
      </p>`;
  }
}

window.addEventListener("hashchange", () => { route().then(wireGo); });
route().then(wireGo);
