/* demo.js — the sample book.
 *
 * WHY THIS EXISTS. The tool needs a repository and a token before it shows
 * anything, which makes it impossible to look at the interface without first
 * being granted access to real client data. So: with no token, the app runs on
 * this file instead, and says so on every screen.
 *
 * WHAT IS REAL AND WHAT IS NOT. The SHAPES here are real — issues carry the
 * same labels and the same PLAYBOOK-STATE block the engine writes, so every
 * screen renders demo and live data through identical code. The CONTENT is
 * invented: five fictional nonprofits, invented CS managers, invented plan
 * text. No CauseMatch client, employee or number appears in this file.
 *
 * THREE THINGS THE APP READS FROM HERE
 *   DEMO.playbooks — the same shape as dist/playbooks.json
 *   DEMO.issues    — the same shape as the GitHub issues API
 *   DEMO.timelines — engagement history, keyed by engagement number
 *   DEMO.org       — the manager's tree. Mock only, wired to nothing.
 */

const DEMO = (() => {
  "use strict";

  /* Dates are relative to the day you open it, so the queue always has
     something late and something due today.
     Built from LOCAL date parts on purpose. toISOString() converts to UTC
     first, so east of Greenwich local midnight lands on the previous day and
     every due date in here silently shifted by one — a task set four days ago
     read as five days late. */
  const D = (offset) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const T = (offset, hour = 10) => {
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d.toISOString();
  };

  /* --------------------------------------------------------- the playbooks */

  const phase = (o) => ({
    task_type: "Call",
    owner: "CSM",
    outcomes: [],
    terminal: false,
    stub: false,
    ...o,
  });

  const phases = {};
  const add = (p) => (phases[p.id] = phase(p));

  /* Renewal — the long spine. */
  add({
    id: "R11", number: "1.1", title: "Renewal Outreach", playbook: "renewal",
    task_type: "Call", owner: "CSM", due_in_days: 3,
    todo: "Call the client and open the renewal conversation.",
    plan_text:
      "Goal: get the renewal conversation open, and get a date in the diary.\n\n" +
      "Call the primary contact. Do not lead with the contract. Lead with what " +
      "last year's campaign did and what they said they wanted next.\n\n" +
      "Ask for the planning meeting before the call ends. A date agreed on the " +
      "phone is worth three emails.\n\n" +
      "If they do not pick up, leave a voice message and send one short email " +
      "the same day. Two channels, one attempt.",
    outcomes: [
      { id: "Reached them", slug: "reached", means: "The contact answered and is willing to talk renewal.", next: "R21" },
      { id: "No answer", slug: "no-answer", means: "No answer, message left.", next: "R11", self_loop: true },
      { id: "Not renewing", slug: "not-renewing", means: "They said outright they are not renewing.", next: "C11" },
    ],
    max_attempts: 3, on_exhausted: "R31",
  });

  add({
    id: "R21", number: "2.1", title: "Planning Meeting", playbook: "renewal",
    task_type: "Meeting", owner: "CSM", due_in_days: 5,
    todo: "Run the planning meeting and agree the shape of the campaign.",
    plan_text:
      "Goal: leave the meeting with an agreed campaign shape — dates, target, " +
      "and who owns the matcher.\n\n" +
      "Walk their own numbers back to them first. Last campaign's total, donor " +
      "count, and the one thing that clearly worked.\n\n" +
      "Then the three decisions: when they want to run, what they want to raise, " +
      "and whether the matching pool is already committed.\n\n" +
      "If the matching pool is not committed, that is the risk. Say so in the " +
      "meeting rather than in the notes.",
    outcomes: [
      { id: "Plan agreed", slug: "plan-agreed", means: "Dates, target and matcher owner are all agreed.", next: "R42" },
      { id: "Needs another meeting", slug: "needs-another", means: "Useful, but a decision is still open.", next: "R21", self_loop: true },
      { id: "Wants to stop", slug: "wants-to-stop", means: "They raised leaving during the meeting.", next: "C11" },
    ],
    max_attempts: 3, on_exhausted: "R31",
  });

  add({
    id: "R42", number: "4.2", title: "Understanding Call", playbook: "renewal",
    task_type: "Call", owner: "CSM", due_in_days: 4,
    todo: "Run the understanding call before anything is priced.",
    plan_text:
      "Goal: understand what this year has to do that last year did not, in " +
      "their words, before a number is put on anything.\n\n" +
      "Four questions, in this order. What changed in the organisation this " +
      "year. What the board is asking for. Who on their side will actually run " +
      "the campaign day to day. What would make them call this a failure.\n\n" +
      "Do not price in this call. If they ask for a number, say the proposal " +
      "follows within the week and that you would rather price the right thing.",
    outcomes: [
      { id: "Understood", slug: "understood", means: "You can write the proposal from what they told you.", next: "R51" },
      { id: "Still unclear", slug: "unclear", means: "The decision maker was not on the call.", next: "R42", self_loop: true },
      { id: "Wants to stop", slug: "wants-to-stop", means: "They raised leaving on the call.", next: "C11" },
    ],
    max_attempts: 2, on_exhausted: "R31",
  });

  add({
    id: "R51", number: "5.1", title: "Proposal and Pricing", playbook: "renewal",
    task_type: "Prep", owner: "CSM", due_in_days: 3,
    todo: "Write and send the renewal proposal.",
    plan_text:
      "Goal: one proposal, sent, that answers what they said on the " +
      "understanding call.\n\n" +
      "Open with their words, not the product. The first line should be the " +
      "thing they said they need.\n\n" +
      "One price. Options invite negotiation about the wrong thing; if there is " +
      "genuinely a choice, make it a choice of scope, never of price.\n\n" +
      "Send it with a date attached: when you will call about it.",
    outcomes: [
      { id: "Proposal sent", slug: "proposal-sent", means: "It is with them, and a follow-up date is set.", next: "R61" },
      { id: "Needs more time", slug: "more-time", means: "Something is missing before it can go.", next: "R51", self_loop: true },
    ],
    max_attempts: 3, on_exhausted: "R31",
  });

  add({
    id: "R61", number: "6.1", title: "Contract Sent", playbook: "renewal",
    task_type: "Admin", owner: "Finance", due_in_days: 2,
    todo: "Send the contract and confirm it arrived.",
    plan_text:
      "Goal: the contract is with the person who signs it, and you know it " +
      "arrived.\n\n" +
      "Confirm the signatory by name before sending. A contract sent to the " +
      "programme lead rather than the director is the most common cause of a " +
      "three-week delay.\n\n" +
      "Send, then confirm receipt the same day by message. Do not wait for the " +
      "signature to find out it went to the wrong inbox.",
    outcomes: [
      { id: "Signed", slug: "signed", means: "Signed and returned.", next: "R71" },
      { id: "Not signed yet", slug: "unsigned", means: "Sent, receipt confirmed, no signature.", next: "R62" },
    ],
  });

  add({
    id: "R62", number: "6.2", title: "Contract Chase", playbook: "renewal",
    task_type: "Follow-up", owner: "CSM", due_in_days: 3,
    todo: "Chase the signature.",
    plan_text:
      "Goal: a signature, or a straight answer about what is blocking it.\n\n" +
      "Each chase asks a question rather than repeating the request. Who else " +
      "needs to see it. Is there a board date it waits for. Is there a clause " +
      "someone objected to.\n\n" +
      "Three attempts is the limit, and it is a limit on purpose. After the " +
      "third, this stops being a chase and becomes a flag, because a contract " +
      "that will not sign after three asks is telling you something.",
    outcomes: [
      { id: "Signed", slug: "signed", means: "Signed and returned.", next: "R71" },
      { id: "No reply", slug: "no-reply", means: "Chased, nothing back.", next: "R62", self_loop: true },
      { id: "Withdrew", slug: "withdrew", means: "They have pulled out of the renewal.", next: "C11" },
    ],
    max_attempts: 3, on_exhausted: "R31",
  });

  add({
    id: "R71", number: "7.1", title: "Campaign Onboarding", playbook: "renewal",
    task_type: "Meeting", owner: "TCS", due_in_days: 5,
    todo: "Hand the client over to the campaign team.",
    plan_text:
      "Goal: the campaign team can run this without asking you anything that " +
      "was already said.\n\n" +
      "Hand over in writing and in a call. The written note carries the target, " +
      "the dates, the matcher, and the one sentence about what would make them " +
      "call this a failure. The call carries everything you cannot write down.\n\n" +
      "Introduce the campaign lead to the client by name in the same week. A " +
      "handover the client did not witness is not a handover.",
    outcomes: [
      { id: "Onboarded", slug: "onboarded", means: "The campaign team has it and the client has met them.", next: "WON" },
      { id: "Delayed", slug: "delayed", means: "The handover slipped.", next: "R71", self_loop: true },
    ],
    max_attempts: 2, on_exhausted: "R31",
  });

  add({
    id: "R31", number: "3.1", title: "Flag and Follow-up", playbook: "renewal",
    task_type: "Follow-up", owner: "CSM", due_in_days: 2,
    todo: "Flag this client and decide what happens next.",
    plan_text:
      "Goal: a decision, made by a person, about a client the playbook could " +
      "not move.\n\n" +
      "This phase exists because attempts ran out. Something is not working, " +
      "and another attempt at the same thing is not the answer.\n\n" +
      "Raise it with your manager with three facts: what was tried, how many " +
      "times, and what the client last actually said. Then pick: go back in " +
      "with a different approach, or move them to the save play.",
    outcomes: [
      { id: "Recovered", slug: "recovered", means: "Contact re-established, back to planning.", next: "R21" },
      { id: "Still dark", slug: "still-dark", means: "Still nothing.", next: "R31", self_loop: true },
      { id: "Confirmed out", slug: "confirmed-out", means: "They confirmed they are leaving.", next: "C11" },
    ],
    max_attempts: 2, on_exhausted: "C11",
  });

  add({
    id: "WON", number: "8.1", title: "Won", playbook: "renewal",
    task_type: "—", owner: "CSM", terminal: true, due_in_days: null,
    todo: "Renewed.",
    plan_text: "The client renewed and the campaign team has them. The engagement closes here.",
  });

  /* Cancel — the save play. Short on purpose. */
  add({
    id: "C11", number: "C.1", title: "Save Call", playbook: "cancel",
    task_type: "Call", owner: "CSM", due_in_days: 2,
    todo: "Make the save call.",
    plan_text:
      "Goal: find out the real reason, which is almost never the stated reason.\n\n" +
      "Call within two days. A save call that arrives a week later reads as " +
      "process rather than care.\n\n" +
      "Do not open with an offer. Open with the question: what changed. Let " +
      "them talk past the first answer — budget is the stated reason far more " +
      "often than it is the real one.\n\n" +
      "Only if they are open to staying does an offer belong in the " +
      "conversation, and it belongs in the next call, not this one.",
    outcomes: [
      { id: "Open to staying", slug: "open-to-stay", means: "There is a version of this where they stay.", next: "C21" },
      { id: "Firm", slug: "firm", means: "The decision is made and it is not moving.", next: "CHURN" },
      { id: "No answer", slug: "no-answer", means: "Could not reach them.", next: "C11", self_loop: true },
    ],
    max_attempts: 2, on_exhausted: "CHURN",
  });

  add({
    id: "C21", number: "C.2", title: "Win-back Offer", playbook: "cancel",
    task_type: "Prep", owner: "CSM", due_in_days: 4,
    todo: "Put the win-back offer in front of them.",
    plan_text:
      "Goal: one offer, built on the reason they actually gave, put in front of " +
      "the person who can accept it.\n\n" +
      "The offer answers the reason. If the reason was capacity, the offer is " +
      "help, not discount. If the reason was a bad campaign, the offer is a " +
      "different team, not a cheaper one.\n\n" +
      "Discount last, and never alone. A price cut against a service complaint " +
      "confirms the complaint.",
    outcomes: [
      { id: "Accepted", slug: "accepted", means: "They are staying. Back to planning.", next: "R21" },
      { id: "Declined", slug: "declined", means: "The offer did not change it.", next: "CHURN" },
      { id: "Thinking", slug: "thinking", means: "It is with them.", next: "C21", self_loop: true },
    ],
    max_attempts: 2, on_exhausted: "CHURN",
  });

  add({
    id: "CHURN", number: "C.3", title: "Churned", playbook: "cancel",
    task_type: "—", owner: "CSM", terminal: true, due_in_days: null,
    todo: "Closed out.",
    plan_text: "The client has left. Write the reason down in the engagement before closing it.",
  });

  /* Expansion — declared, not compiled. It exists so the graph is honest about
     where it stops. */
  add({
    id: "X11", number: "9.1", title: "Expansion Scoping", playbook: "expansion",
    task_type: "—", owner: "CSM", terminal: true, stub: true, due_in_days: null,
    todo: "Not built.",
    plan_text: "Declared in the playbook, not compiled into this slice.",
  });

  const playbooks = {
    renewal:   { name: "renewal",   title: "Renewal",         version: 4, entry: "R11" },
    cancel:    { name: "cancel",    title: "Cancel and save", version: 2, entry: "C11" },
    expansion: { name: "expansion", title: "Expansion",       version: 1, entry: "X11" },
  };

  /* ------------------------------------------------------------ the clients */

  const CSM = "tamar-belsky";

  /* Builds an issue in exactly the shape the GitHub API returns, including the
     PLAYBOOK-STATE block, so nothing downstream can tell demo from live. */
  let nextId = 9000;
  function mkIssue({ number, title, labels, state = "open", body = "", assignee = CSM, created, closed }) {
    return {
      number,
      id: nextId++,
      title,
      body,
      state,
      created_at: created || T(-30),
      closed_at: closed || null,
      assignees: [{ login: assignee }],
      labels: labels.map((name) => ({ name })),
      html_url: `https://example.invalid/demo/issues/${number}`,
    };
  }

  const stateBlock = (st) => `<!-- PLAYBOOK-STATE ${JSON.stringify(st)} -->`;

  function cue({ number, client, client_name, phaseId, attempt = 1, engagement, due, created, assignee }) {
    const ph = phases[phaseId];
    const st = {
      client, client_name, playbook: ph.playbook, phase: phaseId,
      attempt, engagement, due_at: due,
      playbook_version: playbooks[ph.playbook].version,
    };
    const labels = ["kind:phase", `client:${client}`, `playbook:${ph.playbook}`, `phase:${phaseId}`];
    if (attempt > 1) labels.push(`attempt:${attempt}`);
    return mkIssue({
      number, assignee, created,
      title: `[${client_name}] ${ph.number} ${ph.title}${attempt > 1 ? ` (attempt ${attempt})` : ""}`,
      labels,
      body: stateBlock(st),
    });
  }

  /* An ad-hoc follow-up. Not a playbook cue: it carries no routing, it is
     something a CSM wrote down. It sits in the same queue because the queue is
     "what do I owe today", and the CSM does not sort their day by which system
     created the task. */
  function todo({ number, client, client_name, engagement, title, due, note, assignee, created }) {
    const st = { client, client_name, engagement, due_at: due, todo_note: note };
    return mkIssue({
      number, assignee, created, title,
      labels: ["kind:todo", `client:${client}`],
      body: stateBlock(st),
    });
  }

  const clients = [
    { slug: "beit-aharon",     name: "Beit Aharon Center",       eng: 101 },
    { slug: "keren-or",        name: "Keren Or Community Fund",  eng: 102 },
    { slug: "migdal-trust",    name: "Migdal Educational Trust", eng: 103 },
    { slug: "nachalat",        name: "Nachalat Yisrael Society", eng: 104 },
    { slug: "shaarei-chesed",  name: "Shaarei Chesed Relief",    eng: 105 },
  ];

  function engagement({ number, client, client_name, playbook, phaseId, state = "open", created, closed, endLabel }) {
    const st = { client, client_name, playbook, phase: phaseId, attempt: 1,
                 playbook_version: playbooks[playbook].version };
    const labels = ["kind:engagement", `client:${client}`, `playbook:${playbook}`, `phase:${phaseId}`];
    if (endLabel) labels.push(`state:${endLabel}`);
    return mkIssue({
      number, state, created, closed,
      title: `[${client_name}] ${playbooks[playbook].title} engagement`,
      labels, body: stateBlock(st),
    });
  }

  const issues = [
    /* --- engagements ------------------------------------------------------ */
    engagement({ number: 101, client: "beit-aharon", client_name: "Beit Aharon Center",
                 playbook: "renewal", phaseId: "R62", created: T(-58) }),
    engagement({ number: 102, client: "keren-or", client_name: "Keren Or Community Fund",
                 playbook: "renewal", phaseId: "R42", created: T(-31) }),
    engagement({ number: 103, client: "migdal-trust", client_name: "Migdal Educational Trust",
                 playbook: "cancel", phaseId: "C11", created: T(-74) }),
    engagement({ number: 104, client: "nachalat", client_name: "Nachalat Yisrael Society",
                 playbook: "renewal", phaseId: "R71", created: T(-86) }),
    engagement({ number: 105, client: "shaarei-chesed", client_name: "Shaarei Chesed Relief",
                 playbook: "cancel", phaseId: "CHURN", state: "closed",
                 created: T(-119), closed: T(-9), endLabel: "churn" }),

    /* --- the playbook cues that are open right now ------------------------ */
    cue({ number: 231, client: "beit-aharon", client_name: "Beit Aharon Center",
          phaseId: "R62", attempt: 2, engagement: 101, due: D(-4), created: T(-11) }),
    cue({ number: 244, client: "keren-or", client_name: "Keren Or Community Fund",
          phaseId: "R42", engagement: 102, due: D(0), created: T(-4) }),
    cue({ number: 250, client: "migdal-trust", client_name: "Migdal Educational Trust",
          phaseId: "C11", engagement: 103, due: D(2), created: T(-1) }),
    cue({ number: 252, client: "nachalat", client_name: "Nachalat Yisrael Society",
          phaseId: "R71", engagement: 104, due: D(5), created: T(-2), assignee: "yonatan-adler" }),

    /* --- the follow-ups a CSM wrote down themselves ----------------------- */
    todo({ number: 233, client: "beit-aharon", client_name: "Beit Aharon Center", engagement: 101,
           title: "Get the name of whoever signs on their side", due: D(-2), created: T(-9),
           note: "Two chases have gone to the programme lead. Find out who actually signs " +
                 "before the third one goes out, or the third chase is wasted too." }),
    todo({ number: 236, client: "beit-aharon", client_name: "Beit Aharon Center", engagement: 101,
           title: "Send the revised matching-pool sheet", due: D(1), created: T(-6),
           note: "They asked for it split by donor tier. The version from last year is " +
                 "in the shared folder and needs the new tiers." }),
    todo({ number: 246, client: "keren-or", client_name: "Keren Or Community Fund", engagement: 102,
           title: "Confirm the board meeting date", due: D(0), created: T(-3),
           note: "The proposal cannot be approved before the board sits. Everything after " +
                 "the understanding call depends on that date." }),
    todo({ number: 247, client: "keren-or", client_name: "Keren Or Community Fund", engagement: 102,
           title: "Introduce them to the campaign lead", due: D(3), created: T(-3),
           note: "They asked to meet whoever will run the campaign before they commit." }),
    todo({ number: 251, client: "migdal-trust", client_name: "Migdal Educational Trust", engagement: 103,
           title: "Read the two campaign reports before the save call", due: D(1), created: T(-1),
           note: "Their complaint was about the campaign, not the price. Going into a save " +
                 "call without having read what happened would confirm the complaint." }),
    todo({ number: 254, client: "nachalat", client_name: "Nachalat Yisrael Society", engagement: 104,
           title: "Write the handover note", due: D(4), created: T(-2), assignee: "yonatan-adler",
           note: "Target, dates, matcher owner, and the sentence about what would make " +
                 "them call this a failure." }),
    todo({ number: 255, client: "nachalat", client_name: "Nachalat Yisrael Society", engagement: 104,
           title: "Ask about the second campaign in the spring", due: D(12), created: T(-2),
           note: "The director mentioned it twice. Expansion is not built yet, so this is " +
                 "a note to self rather than a phase." }),
    todo({ number: 258, client: "shaarei-chesed", client_name: "Shaarei Chesed Relief", engagement: 105,
           title: "Write up why Shaarei Chesed left", due: D(-1), created: T(-8),
           note: "The engagement closed nine days ago and the reason is still only in " +
                 "the call notes. It belongs on the engagement." }),
  ];

  /* --------------------------------------------------------- the timelines */

  /* One entry per engagement. `bars` are stretches of time the client spent in
     a phase; `bubbles` are the moments worth pointing at. Both carry a date, so
     the timeline can be drawn from one axis.
     bar.state:    'done' | 'current' | 'exhausted'
     bubble.kind:  'win' | 'risk' | 'money' | 'handoff' | 'cross' | 'silence' | 'note' */
  const timelines = {
    101: {
      engagement: 101, client: "beit-aharon", client_name: "Beit Aharon Center",
      owner: "Tamar Belsky", playbook: "renewal", state: "live",
      start: D(-58), end: null,
      headline: "Fifty-eight days in, and the whole engagement is now waiting on one signature.",
      bars: [
        { phase: "R11", label: "1.1 Renewal Outreach",   playbook: "renewal", from: D(-58), to: D(-52), attempts: 2, outcome: "Reached them", state: "done" },
        { phase: "R21", label: "2.1 Planning Meeting",   playbook: "renewal", from: D(-52), to: D(-41), attempts: 2, outcome: "Plan agreed", state: "done" },
        { phase: "R42", label: "4.2 Understanding Call", playbook: "renewal", from: D(-41), to: D(-34), attempts: 1, outcome: "Understood", state: "done" },
        { phase: "R51", label: "5.1 Proposal and Pricing", playbook: "renewal", from: D(-34), to: D(-24), attempts: 2, outcome: "Proposal sent", state: "done" },
        { phase: "R61", label: "6.1 Contract Sent",      playbook: "renewal", from: D(-24), to: D(-18), attempts: 1, outcome: "Not signed yet", state: "done" },
        { phase: "R62", label: "6.2 Contract Chase",     playbook: "renewal", from: D(-18), to: null,   attempts: 2, outcome: null, state: "current" },
      ],
      bubbles: [
        { date: D(-52), kind: "win",     title: "Answered on the second try", detail: "The director called back the same afternoon and asked for the planning meeting themselves." },
        { date: D(-41), kind: "note",    title: "Two planning meetings, not one", detail: "The first meeting ended without a matcher owner, so the playbook kept them in 2.1 for a second visit." },
        { date: D(-34), kind: "money",   title: "Target set at double last year", detail: "Agreed on the understanding call. The matching pool behind it was described as \"nearly committed\", which is not the same as committed." },
        { date: D(-24), kind: "money",   title: "Proposal sent — one price, scope choice", detail: "Second draft. The first was priced before the board's new programme was known." },
        { date: D(-18), kind: "risk",    title: "Contract went to the programme lead", detail: "Not to a signatory. This is the most common cause of a three-week delay, and it is what happened." },
        { date: D(-11), kind: "silence", title: "Chase 1 — no reply", detail: "Asked who else needs to see it. Nothing back in seven days." },
        { date: D(-4),  kind: "risk",    title: "Chase 2 is late", detail: "One attempt left. After the third, the playbook routes them to 3.1 Flag and Follow-up rather than chasing a fourth time." },
      ],
    },

    102: {
      engagement: 102, client: "keren-or", client_name: "Keren Or Community Fund",
      owner: "Tamar Belsky", playbook: "renewal", state: "live",
      start: D(-31), end: null,
      headline: "Moving at the pace the playbook expects. Everything now waits on a board date.",
      bars: [
        { phase: "R11", label: "1.1 Renewal Outreach",   playbook: "renewal", from: D(-31), to: D(-27), attempts: 1, outcome: "Reached them", state: "done" },
        { phase: "R21", label: "2.1 Planning Meeting",   playbook: "renewal", from: D(-27), to: D(-4),  attempts: 1, outcome: "Plan agreed", state: "done" },
        { phase: "R42", label: "4.2 Understanding Call", playbook: "renewal", from: D(-4),  to: null,   attempts: 1, outcome: null, state: "current" },
      ],
      bubbles: [
        { date: D(-31), kind: "win",   title: "Reached on the first attempt", detail: "They were already expecting the call. Last year's campaign beat its target." },
        { date: D(-27), kind: "win",   title: "Plan agreed in one meeting", detail: "Dates, target and matcher owner all settled in a single sitting." },
        { date: D(-14), kind: "note",  title: "New development director started", detail: "The contact who agreed the plan has moved on. The replacement has been briefed but has not committed to anything." },
        { date: D(-4),  kind: "risk",  title: "Board sits before anything can be signed", detail: "The date is not confirmed yet, which puts a hard limit on how fast this can move whatever anyone does." },
      ],
    },

    103: {
      engagement: 103, client: "migdal-trust", client_name: "Migdal Educational Trust",
      owner: "Tamar Belsky", playbook: "cancel", state: "live",
      start: D(-74), end: null,
      headline: "Crossed from renewal into the save play. The stated reason is budget; the record says it is the campaign.",
      bars: [
        { phase: "R11", label: "1.1 Renewal Outreach",  playbook: "renewal", from: D(-74), to: D(-66), attempts: 1, outcome: "Reached them", state: "done" },
        { phase: "R21", label: "2.1 Planning Meeting",  playbook: "renewal", from: D(-66), to: D(-48), attempts: 3, outcome: "Wants to stop", state: "exhausted" },
        { phase: "R31", label: "3.1 Flag and Follow-up", playbook: "renewal", from: D(-48), to: D(-12), attempts: 2, outcome: "Confirmed out", state: "done" },
        { phase: "C11", label: "C.1 Save Call",         playbook: "cancel",  from: D(-12), to: null,   attempts: 1, outcome: null, state: "current" },
      ],
      bubbles: [
        { date: D(-66), kind: "risk",  title: "Third planning meeting with no decision", detail: "Attempts ran out at 2.1. The playbook flagged it rather than booking a fourth." },
        { date: D(-48), kind: "cross", title: "Handed to Flag and Follow-up", detail: "A person, not the machine, decided what happened next. That is what 3.1 is for." },
        { date: D(-30), kind: "silence", title: "Three weeks with no contact", detail: "Two follow-ups, no reply from either the director or the programme lead." },
        { date: D(-12), kind: "cross", title: "Crossed into the save play", detail: "They confirmed they are leaving. Renewal handed to Cancel, and the engagement kept its history." },
        { date: D(-12), kind: "money", title: "Stated reason: budget", detail: "Said in one line by email. The two campaign reports in the record tell a different story, which is why the save call reads them first." },
      ],
    },

    104: {
      engagement: 104, client: "nachalat", client_name: "Nachalat Yisrael Society",
      owner: "Yonatan Adler", playbook: "renewal", state: "live",
      start: D(-86), end: null,
      headline: "Signed. One handover away from a closed renewal, and already asking about a second campaign.",
      bars: [
        { phase: "R11", label: "1.1 Renewal Outreach",     playbook: "renewal", from: D(-86), to: D(-80), attempts: 1, outcome: "Reached them", state: "done" },
        { phase: "R21", label: "2.1 Planning Meeting",     playbook: "renewal", from: D(-80), to: D(-69), attempts: 1, outcome: "Plan agreed", state: "done" },
        { phase: "R42", label: "4.2 Understanding Call",   playbook: "renewal", from: D(-69), to: D(-55), attempts: 2, outcome: "Understood", state: "done" },
        { phase: "R51", label: "5.1 Proposal and Pricing", playbook: "renewal", from: D(-55), to: D(-40), attempts: 1, outcome: "Proposal sent", state: "done" },
        { phase: "R61", label: "6.1 Contract Sent",        playbook: "renewal", from: D(-40), to: D(-33), attempts: 1, outcome: "Not signed yet", state: "done" },
        { phase: "R62", label: "6.2 Contract Chase",       playbook: "renewal", from: D(-33), to: D(-14), attempts: 2, outcome: "Signed", state: "done" },
        { phase: "R71", label: "7.1 Campaign Onboarding",  playbook: "renewal", from: D(-14), to: null,   attempts: 1, outcome: null, state: "current" },
      ],
      bubbles: [
        { date: D(-69), kind: "note",    title: "First understanding call had no decision maker", detail: "The playbook kept them in 4.2 for a second attempt rather than pricing on half the picture." },
        { date: D(-55), kind: "money",   title: "Priced against capacity, not scale", detail: "What they said they needed was help running it, so that is what the proposal answered." },
        { date: D(-14), kind: "win",     title: "Signed on the second chase", detail: "The first chase found the actual signatory. The second got the signature." },
        { date: D(-14), kind: "handoff", title: "Handed to the campaign team", detail: "Written note and a call. The client has not yet met the campaign lead, and that is what closes 7.1." },
        { date: D(-2),  kind: "note",    title: "Asked about a spring campaign", detail: "Mentioned twice by the director. Expansion is a declared stub, so there is nowhere for this to go except a note." },
      ],
    },

    105: {
      engagement: 105, client: "shaarei-chesed", client_name: "Shaarei Chesed Relief",
      owner: "Tamar Belsky", playbook: "cancel", state: "churned",
      start: D(-119), end: D(-9),
      headline: "Churned after three contract chases. The record shows the decision was made long before the save call.",
      bars: [
        { phase: "R11", label: "1.1 Renewal Outreach",  playbook: "renewal", from: D(-119), to: D(-110), attempts: 3, outcome: "No answer", state: "exhausted" },
        { phase: "R31", label: "3.1 Flag and Follow-up", playbook: "renewal", from: D(-110), to: D(-92), attempts: 1, outcome: "Recovered", state: "done" },
        { phase: "R21", label: "2.1 Planning Meeting",  playbook: "renewal", from: D(-92),  to: D(-78), attempts: 1, outcome: "Plan agreed", state: "done" },
        { phase: "R51", label: "5.1 Proposal and Pricing", playbook: "renewal", from: D(-78), to: D(-64), attempts: 1, outcome: "Proposal sent", state: "done" },
        { phase: "R61", label: "6.1 Contract Sent",     playbook: "renewal", from: D(-64),  to: D(-58), attempts: 1, outcome: "Not signed yet", state: "done" },
        { phase: "R62", label: "6.2 Contract Chase",    playbook: "renewal", from: D(-58),  to: D(-31), attempts: 3, outcome: "No reply", state: "exhausted" },
        { phase: "C11", label: "C.1 Save Call",         playbook: "cancel",  from: D(-31),  to: D(-22), attempts: 2, outcome: "Open to staying", state: "done" },
        { phase: "C21", label: "C.2 Win-back Offer",    playbook: "cancel",  from: D(-22),  to: D(-9),  attempts: 1, outcome: "Declined", state: "done" },
        { phase: "CHURN", label: "C.3 Churned",         playbook: "cancel",  from: D(-9),   to: D(-9),  attempts: 1, outcome: null, state: "done" },
      ],
      bubbles: [
        { date: D(-119), kind: "risk",    title: "Three attempts to make first contact", detail: "The engagement started with the client already hard to reach. That was the first signal and it was nine days in." },
        { date: D(-64),  kind: "money",   title: "Contract sent, never opened", detail: "Receipt was never confirmed, so nobody knew for three weeks whether it had arrived." },
        { date: D(-31),  kind: "cross",   title: "Attempts ran out, moved to the save play", detail: "Three chases without a reply. The playbook stopped chasing, which is the behaviour it is designed for." },
        { date: D(-22),  kind: "note",    title: "Save call found a real reason", detail: "Not budget. The campaign had been run by three different people in one season." },
        { date: D(-9),   kind: "risk",    title: "Win-back declined", detail: "The offer was a discount. The reason was service. A price cut against a service complaint confirms the complaint." },
      ],
    },
  };

  /* ---------------------------------------------------- the manager's tree */

  /* MOCK ONLY. Nothing here is derived from the issues above, and the app does
     not pretend otherwise: the manager's view carries a banner saying so.
     Populated for one manager, one engagement per category, one piece of
     evidence each — enough to show the shape and no more. */
  const org = {
    id: "cs", kind: "root", name: "Customer Success",
    note: "The whole department. Every engagement sits under exactly one manager and one likelihood band.",
    children: [
      {
        id: "m-belsky", kind: "manager", name: "Tamar Belsky", book: 34, populated: true,
        note: "Book of 34 engagements. The only manager with data loaded in this mock.",
        children: [
          {
            id: "m-belsky-won", kind: "band", band: "won", name: "Won", count: 9,
            children: [{
              id: "e-nachalat", kind: "engagement", name: "Nachalat Yisrael Society",
              phase: "7.1 Campaign Onboarding", days: 86, owner: "Yonatan Adler",
              why: "Signed on the second chase, and the second chase only worked because the first one found the actual signatory.",
              evidence: [
                { source: "issue #104", when: "14 days ago", text: "Outcome `signed` recorded on 6.2 Contract Chase at attempt 2 of 3." },
              ],
            }],
          },
          {
            id: "m-belsky-high", kind: "band", band: "high", name: "High likelihood", count: 11,
            children: [{
              id: "e-keren-or", kind: "engagement", name: "Keren Or Community Fund",
              phase: "4.2 Understanding Call", days: 31, owner: "Tamar Belsky",
              why: "Every phase so far cleared on the first attempt, and last year's campaign beat its target. Nothing in the record has needed a second try.",
              evidence: [
                { source: "issue #102", when: "27 days ago", text: "2.1 Planning Meeting closed at attempt 1 with outcome `plan-agreed`. Dates, target and matcher owner all settled in one sitting." },
              ],
            }],
          },
          {
            id: "m-belsky-med", kind: "band", band: "medium", name: "Medium likelihood", count: 8,
            children: [{
              id: "e-beit-aharon", kind: "engagement", name: "Beit Aharon Center",
              phase: "6.2 Contract Chase", days: 58, owner: "Tamar Belsky",
              why: "The work is done and the client has not said no. What is missing is a signature, and one of three attempts is left.",
              evidence: [
                { source: "issue #231", when: "4 days late", text: "Attempt 2 of 3 on 6.2 Contract Chase, past its due date. The `attempt:2` label is what puts this in medium rather than high." },
              ],
            }],
          },
          {
            id: "m-belsky-low", kind: "band", band: "low", name: "Low likelihood", count: 4,
            children: [{
              id: "e-migdal", kind: "engagement", name: "Migdal Educational Trust",
              phase: "C.1 Save Call", days: 74, owner: "Tamar Belsky",
              why: "Already crossed out of renewal into the save play, after attempts ran out at planning and three weeks of silence.",
              evidence: [
                { source: "issue #103", when: "12 days ago", text: "Playbook label changed from `playbook:renewal` to `playbook:cancel` after outcome `confirmed-out` on 3.1 Flag and Follow-up." },
              ],
            }],
          },
          {
            id: "m-belsky-churn", kind: "band", band: "churned", name: "Churned", count: 2,
            children: [{
              id: "e-shaarei", kind: "engagement", name: "Shaarei Chesed Relief",
              phase: "C.3 Churned", days: 110, owner: "Tamar Belsky",
              why: "Left after three unanswered contract chases and a win-back offer that answered the wrong problem.",
              evidence: [
                { source: "issue #105", when: "9 days ago", text: "Outcome `declined` on C.2 Win-back Offer. The offer was a discount; the save call had recorded the reason as service, not price." },
              ],
            }],
          },
        ],
      },
      { id: "m-adler",   kind: "manager", name: "Yonatan Adler",  book: 29, populated: false, children: bands(29) },
      { id: "m-mendel",  kind: "manager", name: "Rivka Mendel",   book: 41, populated: false, children: bands(41) },
      { id: "m-farkash", kind: "manager", name: "Daniel Farkash", book: 22, populated: false, children: bands(22) },
      { id: "m-benami",  kind: "manager", name: "Shira Ben-Ami",  book: 37, populated: false, children: bands(37) },
    ],
  };

  /* Empty bands for the four managers with no data loaded. They exist so the
     tree shows its real shape; opening one says it is empty rather than
     inventing an engagement. */
  function bands(book) {
    const split = [0.26, 0.31, 0.23, 0.13, 0.07];
    const defs = [
      ["won", "Won"], ["high", "High likelihood"], ["medium", "Medium likelihood"],
      ["low", "Low likelihood"], ["churned", "Churned"],
    ];
    return defs.map(([band, name], i) => ({
      id: `b-${band}-${book}-${i}`, kind: "band", band, name,
      count: Math.round(book * split[i]), children: [],
    }));
  }

  const BAND_COLOR = {
    won:     "var(--good)",
    high:    "var(--blue)",
    medium:  "var(--gold)",
    low:     "var(--warn)",
    churned: "var(--late)",
  };

  return { playbooks: { playbooks, phases }, issues, timelines, org, clients, BAND_COLOR, D, T, CSM };
})();
