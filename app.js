/* Thin client for the playbook engine.
 *
 * This file knows how to talk to GitHub and how to draw three screens. It does
 * NOT know the playbook: which outcomes a phase offers, where each one routes,
 * which are self-loops — all of that is read from dist/playbooks.json, compiled
 * from the YAML by the engine and checked for staleness in CI.
 *
 * That boundary is the point. Picking an outcome here does not compute anything;
 * it applies one label and waits. The Action does the routing, so a second UI,
 * an agent, or someone clicking the label by hand in GitHub all produce exactly
 * the same transition.
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

// Must match slugify() in engine/start.py, or the UI would look for an
// engagement under a different key than the one the engine created.
const slugify = (name) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) ||
  "client";

/* ----------------------------------------------------------------- GitHub */

async function api(path, opts = {}) {
  const res = await fetch(path.startsWith("http") ? path : API + path, {
    ...opts,
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

const dispatch = (workflow, inputs) =>
  api(`/repos/${S.repo}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: "main", inputs }),
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

function duePill(due) {
  if (!due) return "";
  const days = Math.round((new Date(due + "T00:00:00") - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (days < 0) return `<span class="pill over">${-days}d overdue</span>`;
  if (days === 0) return `<span class="pill due">due today</span>`;
  if (days <= 2) return `<span class="pill due">due in ${days}d</span>`;
  return `<span class="pill">due ${due}</span>`;
}

/* --------------------------------------------------------------- screens */

function chrome() {
  const who = S.user ? `@${S.user.login}` : "";
  $("#top").innerHTML = `
    <div class="wrap">
      <h1><a href="#/" style="color:inherit">Playbook Ops</a></h1>
      <span class="spacer"></span>
      <span class="dim mono">${esc(S.repo)}</span>
      <span class="dim">${esc(who)}</span>
      <a href="#/settings">settings</a>
    </div>`;
}

function settingsScreen() {
  view().innerHTML = `
    <h2>Connection</h2>
    <div class="card">
      <p class="meta">This page talks to the GitHub API directly from your browser, with
      <b>your</b> token — so every comment, label and transition is attributed to your
      account in the issue timeline, not to a shared bot.</p>
      <label for="repo">Engine repo</label>
      <input id="repo" placeholder="amitmai/causematch-cs-poc" value="${esc(S.repo)}">
      <label for="token">Fine-grained personal access token</label>
      <input id="token" type="password" placeholder="github_pat_..." value="${esc(S.token)}">
      <p class="meta dim" style="margin-top:8px">
        Create one at github.com/settings/personal-access-tokens — scope it to the engine
        repo only, with <b>Issues: read &amp; write</b>, <b>Contents: read</b> and
        <b>Actions: read &amp; write</b>. It is stored in this browser's localStorage and
        sent only to api.github.com.
      </p>
      <button class="primary" id="save">Save and connect</button>
      <div id="msg"></div>
    </div>`;

  $("#save").onclick = async () => {
    S.repo = $("#repo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
    S.token = $("#token").value.trim();
    localStorage.setItem("repo", S.repo);
    localStorage.setItem("token", S.token);
    $("#msg").innerHTML = `<p class="meta"><span class="spin"></span>Checking…</p>`;
    try {
      S.user = await api("/user");
      await loadPlaybooks();
      chrome();
      location.hash = "#/";
    } catch (e) {
      $("#msg").innerHTML = `<div class="banner err" style="margin-top:12px">${esc(e.message)}${
        e.status === 404
          ? "<br><br>A 404 here usually means the token cannot see the repo — check that it was scoped to this repository and that <b>Contents: read</b> is granted."
          : ""
      }</div>`;
    }
  };
}

async function boardScreen() {
  view().innerHTML = `<p class="meta"><span class="spin"></span>Loading…</p>`;
  const [engagements, tasks] = await Promise.all([
    issues(["kind:engagement"]),
    issues(["kind:phase"]),
  ]);

  const byClient = new Map();
  for (const t of tasks) {
    const s = stateOf(t);
    if (!byClient.has(s.client)) byClient.set(s.client, []);
    byClient.get(s.client).push({ t, s });
  }

  const mine = tasks.filter((t) => (t.assignees || []).some((a) => a.login === S.user?.login));

  const taskCard = (t, s) => {
    const ph = S.pb.phases[s.phase] || {};
    return `<a class="card" href="#/task/${t.number}">
      <h3>${esc(s.client_name)}</h3>
      <div class="meta"><b>${esc(ph.label || s.phase)}</b> · ${esc(ph.task_type || "")}
        ${s.attempt > 1 ? ` · attempt ${s.attempt}` : ""}</div>
      <div style="margin-top:8px">
        ${duePill(s.due_at)}
        <span class="pill mono">${esc(s.phase)}</span>
        <span class="pill">${esc(S.pb.playbooks[s.playbook]?.title || s.playbook)}</span>
        ${ph.stub ? `<span class="pill stub">stub</span>` : ""}
      </div>
    </a>`;
  };

  const sortByDue = (a, b) => (a.s.due_at || "9999").localeCompare(b.s.due_at || "9999");

  let html = `
    <div class="card">
      <h3>Start a client on a playbook</h3>
      <label for="cname">Client name</label>
      <input id="cname" placeholder="Acme Foundation">
      <label for="pbook">Playbook</label>
      <select id="pbook">
        ${Object.values(S.pb.playbooks)
          .filter((p) => p.entry && S.pb.phases[p.entry] && !S.pb.phases[p.entry].stub)
          .map((p) => `<option value="${esc(p.name)}">${esc(p.title)} — starts at ${esc(S.pb.phases[p.entry].label)}</option>`)
          .join("")}
      </select>
      <button class="primary" id="start">Open the first task</button>
      <div id="startmsg"></div>
    </div>`;

  if (mine.length) {
    html += `<h2>Your queue (${mine.length})</h2>` +
      mine.map((t) => ({ t, s: stateOf(t) })).sort(sortByDue).map(({ t, s }) => taskCard(t, s)).join("");
  }

  html += `<h2>Engagements in flight (${engagements.length})</h2>`;
  if (!engagements.length) {
    html += `<p class="empty">Nothing running. Start a client above.</p>`;
  } else {
    for (const e of engagements) {
      const s = stateOf(e);
      const open = (byClient.get(s.client) || []).sort(sortByDue);
      html += `<div class="card">
        <h3>${esc(s.client_name)}</h3>
        <div class="meta">${esc(S.pb.playbooks[s.playbook]?.title || s.playbook)} ·
          now at <b>${esc(S.pb.phases[s.phase]?.label || s.phase)}</b> ·
          <a href="https://github.com/${S.repo}/issues/${e.number}" target="_blank" rel="noopener">#${e.number}</a>
        </div>
        ${open.length
          ? `<div style="margin-top:10px">${open.map(({ t, s: ts }) =>
              `<a href="#/task/${t.number}" class="pill" style="color:var(--accent);border-color:var(--accent)">${esc(
                S.pb.phases[ts.phase]?.label || ts.phase
              )} →</a>`).join("")}</div>`
          : `<p class="meta dim" style="margin-top:8px">No open task — the engine may still be creating it.</p>`}
      </div>`;
    }
  }

  view().innerHTML = html;

  $("#start").onclick = async () => {
    const name = $("#cname").value.trim();
    const playbook = $("#pbook").value;
    if (!name) return;
    const btn = $("#start");
    btn.disabled = true;
    $("#startmsg").innerHTML = `<p class="meta" style="margin-top:10px"><span class="spin"></span>Asking the engine to open the engagement…</p>`;
    try {
      await dispatch("start.yml", { client_name: name, playbook, assignee: S.user.login });
      const slug = slugify(name);
      const found = await pollFor(
        () => issues(["kind:phase", `client:${slug}`]),
        (list) => list.length > 0,
        30
      );
      if (found) {
        location.hash = `#/task/${found[0].number}`;
      } else {
        $("#startmsg").innerHTML = `<div class="banner warn" style="margin-top:10px">
          The workflow was dispatched but no task has appeared yet.
          <a href="https://github.com/${S.repo}/actions/workflows/start.yml" target="_blank" rel="noopener">Check the run</a>,
          then reload.</div>`;
      }
    } catch (e) {
      $("#startmsg").innerHTML = `<div class="banner err" style="margin-top:10px">${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  };
}

async function pollFor(fetcher, done, tries = 20, waitMs = 2500) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, waitMs));
    try {
      const result = await fetcher();
      if (done(result)) return result;
    } catch {}
  }
  return null;
}

async function taskScreen(number) {
  view().innerHTML = `<p class="meta"><span class="spin"></span>Loading task…</p>`;
  const iss = await issue(number);
  const s = stateOf(iss);
  const ph = S.pb.phases[s.phase];

  if (!ph) {
    view().innerHTML = `<div class="banner err">This issue carries phase <code>${esc(
      s.phase || "(none)"
    )}</code>, which is not in the compiled playbook.</div>`;
    return;
  }

  const closed = iss.state === "closed";
  const bodyHtml = await renderMarkdown(stripState(iss.body)).catch(() => null);

  const atLimit = ph.max_attempts && s.attempt >= ph.max_attempts;

  view().innerHTML = `
    <p class="meta"><a href="#/">← board</a></p>
    <div class="card">
      <h3>${esc(s.client_name)}</h3>
      <div class="meta"><b>${esc(ph.label)}</b> · ${esc(ph.task_type)} · owner ${esc(ph.owner)}</div>
      <div style="margin-top:8px">
        ${duePill(s.due_at)}
        <span class="pill mono">${esc(ph.id)}</span>
        <span class="pill">${esc(S.pb.playbooks[ph.playbook]?.title || ph.playbook)}</span>
        ${ph.max_attempts ? `<span class="pill ${atLimit ? "over" : ""}">attempt ${s.attempt} of ${ph.max_attempts}</span>` : ""}
        <a class="pill" href="https://github.com/${S.repo}/issues/${iss.number}" target="_blank" rel="noopener">#${iss.number} on GitHub</a>
      </div>
      ${atLimit && ph.on_exhausted
        ? `<div class="banner warn" style="margin-top:12px">Last attempt. Repeating this phase again routes to
           <b>${esc(S.pb.phases[ph.on_exhausted]?.label || ph.on_exhausted)}</b> instead of looping.</div>`
        : ""}
      ${ph.stub
        ? `<div class="banner warn" style="margin-top:12px">This phase is a declared stub — the playbook routes here,
           but this branch was not compiled into the POC. Nothing follows it.</div>`
        : ""}
      ${bodyHtml ? `<div class="body-md">${bodyHtml}</div>` : ""}
    </div>

    ${closed
      ? `<div class="banner ok">Closed${s.outcomes.length ? ` — outcome <b>${esc(s.outcomes[0])}</b>` : ""}.
          This task is done; its transition is recorded on the engagement.</div>`
      : ph.terminal
      ? `<div class="banner ok">Terminal state. The engagement is complete.</div>`
      : `<div class="card">
          <label for="note">What happened</label>
          <textarea id="note" placeholder="Notes for this step — posted as a comment before the transition is recorded."></textarea>

          <h2 style="margin-top:20px">Then pick the outcome</h2>
          <p class="meta dim" style="margin-top:-4px">Each one is a declared route in the playbook. Picking it closes this task and opens the next.</p>
          <div class="outcomes">
            ${ph.outcomes
              .map(
                (o) => `<button class="outcome${o.self_loop ? " loop" : ""}" data-slug="${esc(o.slug)}">
                  <span class="oid">${esc(o.id)}</span>
                  <span class="omeans">${esc(o.means)}</span>
                  <span class="onext">→ ${
                    o.self_loop
                      ? `repeat ${esc(ph.label)}${
                          ph.max_attempts && s.attempt >= ph.max_attempts
                            ? ` — limit reached, goes to ${esc(S.pb.phases[ph.on_exhausted]?.label || ph.on_exhausted)}`
                            : ` (attempt ${s.attempt + 1}${ph.max_attempts ? ` of ${ph.max_attempts}` : ""})`
                        }`
                      : esc(o.next_label)
                  }</span>
                </button>`
              )
              .join("")}
          </div>
          <div id="pickmsg"></div>
        </div>`}
  `;

  view().querySelectorAll("button.outcome").forEach((btn) => {
    btn.onclick = () => pick(iss, s, ph, btn.dataset.slug);
  });
}

async function pick(iss, s, ph, slug) {
  const outcome = ph.outcomes.find((o) => o.slug === slug);
  const note = $("#note")?.value.trim();
  view().querySelectorAll("button.outcome").forEach((b) => (b.disabled = true));
  const msg = $("#pickmsg");
  msg.innerHTML = `<p class="meta" style="margin-top:12px"><span class="spin"></span>Recording <b>${esc(outcome.id)}</b>…</p>`;

  try {
    // Notes first, so the reasoning is already on the issue when the engine
    // appends the transition record underneath it.
    if (note) await comment(iss.number, note);

    // The transition itself is one label. Everything after this happens in the
    // Action — which is why clicking the same label directly in GitHub does the
    // same thing.
    await addLabel(iss.number, `outcome:${slug}`);

    msg.innerHTML = `<p class="meta" style="margin-top:12px"><span class="spin"></span>Label applied. Waiting for the engine to route it…</p>`;

    const closed = await pollFor(() => issue(iss.number), (i) => i.state === "closed", 24, 2500);
    if (!closed) {
      msg.innerHTML = `<div class="banner warn" style="margin-top:12px">
        The label is on, but the task has not closed yet.
        <a href="https://github.com/${S.repo}/actions/workflows/advance.yml" target="_blank" rel="noopener">Check the run</a> —
        if it was rejected, the reason is a comment on the issue.</div>`;
      return;
    }

    const next = await pollFor(
      () => issues(["kind:phase", `client:${s.client}`]),
      (list) => list.length > 0,
      12,
      2000
    );
    if (next && next.length) {
      location.hash = `#/task/${next[0].number}`;
    } else {
      msg.innerHTML = `<div class="banner ok" style="margin-top:12px">Recorded. No open task follows —
        this branch has reached a terminal state. <a href="#/">Back to the board</a>.</div>`;
    }
  } catch (e) {
    msg.innerHTML = `<div class="banner err" style="margin-top:12px">${esc(e.message)}</div>`;
    view().querySelectorAll("button.outcome").forEach((b) => (b.disabled = false));
  }
}

/* ---------------------------------------------------------------- routing */

async function route() {
  const hash = location.hash || "#/";

  if (!S.repo || !S.token) return settingsScreen();

  if (!S.user || !S.pb) {
    view().innerHTML = `<p class="meta"><span class="spin"></span>Connecting…</p>`;
    try {
      S.user = await api("/user");
      await loadPlaybooks();
      chrome();
    } catch (e) {
      view().innerHTML = `<div class="banner err">${esc(e.message)}</div>
        <p class="meta"><a href="#/settings">Check the connection settings</a></p>`;
      return;
    }
  }

  try {
    if (hash === "#/settings") return settingsScreen();
    const task = /^#\/task\/(\d+)/.exec(hash);
    if (task) return await taskScreen(Number(task[1]));
    return await boardScreen();
  } catch (e) {
    view().innerHTML = `<div class="banner err">${esc(e.message)}</div>`;
  }
}

window.addEventListener("hashchange", route);
chrome();
route();
