/* Thin client for the playbook engine.
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

const removeLabel = (n, label) =>
  api(`/repos/${S.repo}/issues/${n}/labels/${encodeURIComponent(label)}`, { method: "DELETE" })
    .catch((e) => { if (e.status !== 404) throw e; }); // already gone is the goal

const closeIssue = (n) =>
  api(`/repos/${S.repo}/issues/${n}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed", state_reason: "completed" }),
  });

const createIssue = ({ title, body, assignees }) =>
  api(`/repos/${S.repo}/issues`, {
    method: "POST",
    body: JSON.stringify({ title, body, assignees: assignees || [] }),
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
    const out = $("#startmsg");
    const say = (m) =>
      (out.innerHTML = `<p class="meta" style="margin-top:10px"><span class="spin"></span>${m}</p>`);

    try {
      const slug = PBE.slugify(name);
      const pbook = S.pb.playbooks[playbook];
      const entry = S.pb.phases[pbook.entry];

      // One open engagement per client, full stop. Two would mean two live
      // answers to "where is this client".
      const open = await issues(["kind:engagement", `client:${slug}`]);
      if (open.length) {
        out.innerHTML = `<div class="banner warn" style="margin-top:10px">
          ${esc(name)} already has an open engagement,
          <a href="#/task/${open[0].number}">#${open[0].number}</a>. Not starting a second one.</div>`;
        return;
      }

      say(`Opening the engagement…`);
      const engState = {
        client: slug, client_name: name, playbook, phase: entry.id,
        attempt: 1, playbook_version: pbook.version,
      };
      const engagement = await createIssue({
        title: PBE.engagementTitle(engState, S.pb),
        body: PBE.renderEngagementBody(engState, S.pb),
        assignees: [S.user.login],
      });
      await addLabels(engagement.number, [
        "kind:engagement", `client:${slug}`, `playbook:${playbook}`, `phase:${entry.id}`,
      ]);

      say(`Opening <b>${esc(PBE.label(entry))}</b>…`);
      const taskState = {
        client: slug, client_name: name, playbook: entry.playbook, phase: entry.id,
        attempt: 1, engagement: engagement.number, due_at: PBE.dueDate(entry),
        playbook_version: pbook.version,
      };
      const first = await createIssue({
        title: PBE.phaseTitle(entry, taskState),
        body: PBE.renderPhaseBody(entry, taskState, S.pb),
        assignees: [S.user.login],
      });
      await addLabels(first.number, PBE.phaseLabels(taskState));

      await comment(
        engagement.number,
        `Engagement opened by @${S.user.login} on **${pbook.title}** (v${pbook.version}).\n\n` +
          `First task: #${first.number} — **${PBE.label(entry)}**`
      );
      addSubIssue(engagement.number, first.id).catch(() => {});

      location.hash = `#/task/${first.number}`;
    } catch (e) {
      out.innerHTML = `<div class="banner err" style="margin-top:10px">${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  };
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
  const note = $("#note")?.value.trim();
  view().querySelectorAll("button.outcome").forEach((b) => (b.disabled = true));
  const msg = $("#pickmsg");
  const t0 = Date.now();
  const say = (m) =>
    (msg.innerHTML = `<p class="meta" style="margin-top:12px"><span class="spin"></span>${m}</p>`);

  try {
    // Routing decided locally, from the same compiled graph the Python engine
    // reads. An outcome that is not a declared edge throws here and nothing is
    // written, which is the same reject-by-default rule the Action applies.
    const step = PBE.step(S.pb, ph.id, slug, s.attempt);
    const outcome = step.outcome;
    const nextPhase = S.pb.phases[step.nextPhase];
    const version = (S.pb.playbooks[ph.playbook] || {}).version || 1;

    const record = PBE.transitionRecord({
      fromPhase: ph, outcome, toPhase: nextPhase, actor: S.user.login,
      attempt: s.attempt, version, exhausted: step.exhausted, pb: S.pb,
    });

    say(`Recording <b>${esc(outcome.id)}</b>…`);
    if (note) await comment(iss.number, note);
    await comment(iss.number, record);

    // Close BEFORE labelling. The Action fires on the outcome label; by then
    // the task is already closed, so it checks whether a successor exists
    // instead of transitioning again. If this browser dies after this point,
    // that same Action finishes the job.
    await closeIssue(iss.number);
    await addLabel(iss.number, `outcome:${slug}`);

    say(`Opening <b>${esc(PBE.label(nextPhase))}</b>…`);

    const engagement = (await issues(["kind:engagement", `client:${s.client}`]))[0];

    // Never open a second copy of a task that already exists. Excludes the
    // issue we just closed, which on a self-loop IS the next phase.
    const already = (
      await issues(["kind:phase", `client:${s.client}`, `phase:${nextPhase.id}`])
    ).filter((i) => i.number !== iss.number);

    let next = already[0];
    if (!next) {
      const st = {
        client: s.client, client_name: s.client_name || s.client,
        playbook: nextPhase.playbook, phase: nextPhase.id,
        attempt: step.nextAttempt, engagement: engagement && engagement.number,
        due_at: PBE.dueDate(nextPhase),
        playbook_version: (S.pb.playbooks[nextPhase.playbook] || {}).version || 1,
      };
      const assignees = (iss.assignees || []).map((a) => a.login);
      // Created without labels, then labelled: applying a label that does not
      // exist yet creates it, whereas creating an issue with an unknown label
      // is rejected. A new client always brings a new client: label.
      next = await createIssue({
        title: PBE.phaseTitle(nextPhase, st),
        body: PBE.renderPhaseBody(nextPhase, st, S.pb),
        assignees: assignees.length ? assignees : [S.user.login],
      });
      const labels = PBE.phaseLabels(st);
      if (nextPhase.terminal) labels.push("state:terminal");
      await addLabels(next.number, labels);
      await comment(
        next.number,
        `Created from #${iss.number} (\`${ph.id}\` → outcome **${outcome.id}** → \`${nextPhase.id}\`).`
      );
    }

    // Move the engagement pointer and log the transition on the spine.
    if (engagement) {
      await removeLabel(engagement.number, `phase:${s.phase}`);
      const add = [`phase:${nextPhase.id}`];
      if (nextPhase.playbook !== ph.playbook) {
        await removeLabel(engagement.number, `playbook:${ph.playbook}`);
        add.push(`playbook:${nextPhase.playbook}`);
      }
      await addLabels(engagement.number, add);
      await comment(
        engagement.number,
        `${record}\n\n- **Task closed:** #${iss.number}\n- **Task opened:** #${next.number}`
      );
      if (nextPhase.terminal && !nextPhase.stub) {
        await addLabels(engagement.number, [`state:${nextPhase.id.toLowerCase()}`]);
        await closeIssue(engagement.number);
      }
      // Last, because it is the only step whose failure costs nothing: the
      // engagement timeline is the spine, the hierarchy is a convenience.
      addSubIssue(engagement.number, next.id).catch(() => {});
    }

    console.log(`transition took ${Math.round((Date.now() - t0) / 1000 * 10) / 10}s`);
    location.hash = `#/task/${next.number}`;
  } catch (e) {
    msg.innerHTML = `<div class="banner err" style="margin-top:12px">${esc(e.message)}
      <br><br>Nothing further was written. If the task is already closed, the
      backstop workflow will finish the transition within about a minute.</div>`;
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
