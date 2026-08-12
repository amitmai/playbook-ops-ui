/* engine.js — the browser-side engine. Pure functions, no network.
 *
 * WHY THIS FILE EXISTS, AND WHAT IT COSTS
 *
 * The engine also exists in Python, in the repo, and runs in GitHub Actions.
 * That version took 14 to 19 seconds per transition, almost all of it spent
 * booting a virtual machine to perform a dictionary lookup. For a POC that
 * people are meant to play with, that is the difference between a tool and a
 * demo of a tool.
 *
 * So the browser does the transition itself, in about a second, using the
 * CSM's own token. A side benefit: every write is attributed to the real
 * person in the issue timeline rather than to github-actions[bot].
 *
 * The cost is honest and worth stating plainly: rendering an issue body now
 * exists twice, here and in engine/state.py, and two implementations drift.
 * Three things keep that survivable:
 *
 *   1. ROUTING does not duplicate. Where an outcome goes is data, read from
 *      dist/playbooks.json, which the Python engine also reads. There is one
 *      graph, not two.
 *   2. The PLAN TEXT does not duplicate either. It is compiled into the same
 *      artifact from templates/, so the words a CSM reads have one source.
 *   3. Only the machine-readable block MUST match byte for byte, because the
 *      Python side parses it. engine/state.py's read_state prefers labels over
 *      that block precisely so a small drift cannot change routing.
 *
 * The Action still fires on the outcome label, finds the work already done and
 * no-ops. If the browser died half way, it finishes the job instead.
 */

const PBE = (() => {
  "use strict";

  /* Must match slugify() in engine/start.py. If these disagree, the UI looks
     for an engagement under a key the engine never created. */
  const slugify = (name) =>
    name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) ||
    "client";

  const label = (ph) =>
    ph.number && ph.number !== "—" ? `${ph.number} ${ph.title}` : ph.title;

  /* The whole state machine, and the only part that must agree with Python.
     It is the same shape as Registry.step(): a self-loop is not an edge back to
     the same phase, it is the same phase one attempt later, and when the
     attempts run out it leaves via on_exhausted rather than spinning. */
  function step(pb, phaseId, outcomeSlug, attempt = 1) {
    const phase = pb.phases[phaseId];
    if (!phase) throw new Error(`unknown phase ${phaseId}`);
    const outcome = (phase.outcomes || []).find((o) => o.slug === outcomeSlug);
    if (!outcome) {
      const legal = (phase.outcomes || []).map((o) => o.slug).join(", ") || "(none, terminal)";
      throw new Error(
        `${outcomeSlug} is not a legal outcome of ${phaseId} (${label(phase)}). Legal: ${legal}`
      );
    }
    if (!outcome.self_loop) {
      return { outcome, nextPhase: outcome.next, nextAttempt: 1, exhausted: false };
    }
    const nextAttempt = attempt + 1;
    if (phase.max_attempts && nextAttempt > phase.max_attempts) {
      return {
        outcome,
        nextPhase: phase.on_exhausted || outcome.next,
        nextAttempt: 1,
        exhausted: true,
      };
    }
    return { outcome, nextPhase: phase.id, nextAttempt, exhausted: false };
  }

  /* Built from LOCAL date parts. toISOString() converts to UTC first, so for a
     CSM east of Greenwich every task created between local midnight and the
     offset — 00:00 to 03:00 in Israel — was stamped due a day EARLY, and read
     as late a day before it was. The same mistake was found and fixed in the
     sample data on 2026-08-12; this is the copy on the real write path, so it
     was putting wrong dates into actual issues.
     The Python engine in the engine repo does the same date arithmetic and has
     not been checked. It runs on a UTC runner, so it does not have this bug —
     but the two sides can now disagree by a day for a 00:00-03:00 local
     creation, and only the backstop path uses the Python value. */
  const dueDate = (phase) => {
    if (phase.due_in_days === null || phase.due_in_days === undefined) return null;
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + phase.due_in_days);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  /* Mirrors state.machine_block: same keys, same order, null values dropped. */
  function machineBlock(st) {
    const payload = {
      client: st.client,
      client_name: st.client_name,
      playbook: st.playbook,
      phase: st.phase,
      attempt: st.attempt,
      engagement: st.engagement,
      due_at: st.due_at,
      playbook_version: st.playbook_version,
    };
    const clean = {};
    for (const k of Object.keys(payload)) {
      if (payload[k] !== null && payload[k] !== undefined) clean[k] = payload[k];
    }
    return `<!-- PLAYBOOK-STATE ${JSON.stringify(clean)} -->`;
  }

  /* Mirrors state.phase_labels. Labels are the authoritative state carrier, so
     this is the part that actually decides how the Python side reads an issue. */
  function phaseLabels(st) {
    const out = [
      "kind:phase",
      `client:${st.client}`,
      `playbook:${st.playbook}`,
      `phase:${st.phase}`,
    ];
    if (st.attempt > 1) out.push(`attempt:${st.attempt}`);
    return out;
  }

  const phaseTitle = (phase, st) =>
    `[${st.client_name}] ${label(phase)}${st.attempt > 1 ? ` (attempt ${st.attempt})` : ""}`;

  function renderPhaseBody(phase, st, pb) {
    const L = [];
    L.push(
      [
        `**Client:** ${st.client_name}`,
        `**Playbook:** ${(pb.playbooks[phase.playbook] || {}).title || phase.playbook}`,
        `**Phase:** \`${phase.id}\` — ${label(phase)}`,
      ].join(" · ")
    );
    const meta = [`**Task type:** ${phase.task_type}`, `**Owner:** ${phase.owner}`];
    if (st.due_at) meta.push(`**Due:** ${st.due_at}`);
    L.push(meta.join(" · "));
    if (st.engagement) L.push(`**Engagement:** #${st.engagement}`);

    if (phase.max_attempts && st.attempt > 1) {
      L.push(
        `> ⚠️ Attempt **${st.attempt} of ${phase.max_attempts}**. ` +
          `After ${phase.max_attempts}, this routes to \`${phase.on_exhausted}\` automatically.`
      );
    }
    if (phase.stub) {
      L.push(
        "> 🚧 **Stub phase.** The playbook routes here, but this part of the " +
          "graph was not compiled into the POC slice. Nothing follows this task."
      );
    }

    L.push("", "---", "");
    L.push((phase.plan_text || "").trim() || "_No plan text for this phase yet._");

    if ((phase.outcomes || []).length) {
      L.push("", "---", "", "### What happens next", "");
      L.push(
        "Pick one outcome in the UI, or apply its label directly. " +
          "This table is rendered from the playbook — it is a display of the " +
          "routing, never the source of it."
      );
      L.push("", "| Outcome | Means | Goes to |", "|---|---|---|");
      for (const o of phase.outcomes) {
        const t = pb.phases[o.next];
        const dest = t ? `\`${o.next}\` ${label(t)}` : `\`${o.next}\` ⚠️ undefined`;
        L.push(`| **${o.id}** | ${o.means} | ${dest} |`);
      }
      L.push("");
      L.push("<sub>Labels: " + phase.outcomes.map((o) => `\`outcome:${o.slug}\``).join(", ") + "</sub>");
    } else if (phase.terminal && !phase.stub) {
      L.push("", "---", "", "### Terminal", "");
      L.push("This is an end state. Closing it closes the engagement.");
    }

    L.push("", machineBlock(st));
    return L.join("\n");
  }

  const engagementTitle = (st, pb) =>
    `[${st.client_name}] ${(pb.playbooks[st.playbook] || {}).title || st.playbook} engagement`;

  function renderEngagementBody(st, pb) {
    const p = pb.playbooks[st.playbook] || {};
    return [
      `**Client:** ${st.client_name}`,
      `**Playbook:** ${p.title || st.playbook} (v${p.version || "?"})`,
      "",
      "This issue is the spine of the engagement. It stays open for as long as " +
        "the client is in a playbook, and every phase task is a sub-issue of it. " +
        "One open engagement issue = one client in flight.",
      "",
      "The transition log below is appended on every transition, recording the " +
        "phase, the outcome picked, who picked it and when. That log is the answer " +
        'to "why does this task exist".',
      "",
      machineBlock(st),
    ].join("\n");
  }

  /* Mirrors advance.transition_record. */
  function transitionRecord({ fromPhase, outcome, toPhase, actor, attempt, version, exhausted, pb }) {
    const stamp = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
    const L = [
      "**Transition**",
      "",
      `- **From:** \`${fromPhase.id}\` ${label(fromPhase)}`,
      `- **Outcome:** ${outcome.id} (\`${outcome.slug}\`)`,
      `- **To:** \`${toPhase.id}\` ${label(toPhase)}`,
      `- **Picked by:** @${actor}`,
      `- **When:** ${stamp}`,
      `- **Playbook:** ${fromPhase.playbook} v${version}, attempt ${attempt}`,
      "- **Recorded by:** the browser, directly",
    ];
    if (exhausted) {
      L.push(
        `- **Attempt limit reached** — ${fromPhase.max_attempts} attempts at ` +
          `\`${fromPhase.id}\` without progress, so the playbook's \`on_exhausted\` ` +
          `route to \`${fromPhase.on_exhausted}\` fired instead of another loop.`
      );
    }
    return L.join("\n");
  }

  return {
    slugify, label, step, dueDate, machineBlock, phaseLabels, phaseTitle,
    renderPhaseBody, engagementTitle, renderEngagementBody, transitionRecord,
  };
})();
