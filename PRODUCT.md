# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: a CauseMatch Customer Success Manager (CSM).** They carry a book of
nonprofit clients through defined playbooks: renewal, the cancel save play, and
later expansion, nurture and active campaign.

They work in two genuinely different situations, confirmed by Amit 2026-08-11,
and both are first-class:

- **On a phone, between calls.** Standing up, one hand, immediately after a
  client conversation, recording what happened while it is fresh.
- **At a desk, working a list.** A planning or catch-up session, moving through
  many clients in one sitting.

**A normal queue is 20 to 40 open tasks.** That is past the point where a flat
list works: urgency has to separate itself without the CSM applying a filter.

**Secondary: a CS manager.** They do not work the queue. They ask which
engagements are going to close, which are drifting, and what the evidence for
that is. Added 2026-08-12; served today by a mock, because the query behind it
does not exist yet.

Also secondary: Amit and a few colleagues evaluating whether this way of
running playbooks is worth adopting.

## Product Purpose

Make the playbook the thing that runs, rather than the thing someone has to
remember. A client is put on a playbook, a task appears, the CSM does the work
and records what happened, and the next task appears because the playbook says
so.

Success is a CSM opening this and knowing, without hunting: which client they
are on, what the playbook says to do, and what each possible answer will cause.

## Positioning

The routing is deterministic and lives in version control. Every task exists
because a declared transition created it, so "why does this task exist" has an
exact answer, and changing how clients are handled is a reviewed change to a
file rather than a conversation.

The work runs on GitHub Issues, so the record, the audit trail and the
permissions are ordinary infrastructure rather than a vendor's database.

## Operating Context

- A **phase task** is one visit to one playbook phase. It opens, someone owes
  it, and it closes when an outcome is recorded.
- An **engagement** is the spine: one per client, open for as long as they are
  in a playbook, carrying the transition log.
- Phases hand between five roles in practice: CSM, coach, TCS, finance, sales.
- Plan text comes verbatim from CauseMatch's own playbook sheet.
- Some phases repeat (chasing a contract). Repeats are counted, and running out
  of attempts routes the client somewhere else rather than looping forever.
- Clients cross between playbooks mid-engagement; renewal hands to cancel from
  four different phases.
- **A CSM also owes work the playbook never created** — send the sheet, find
  out who signs, read the reports before the call. These are ad-hoc follow-ups.
  They carry no routing and they sit in the same queue, because a CSM's day is
  not sorted by which system made the task.
- **An engagement is also a history.** The transition log answers "why does
  this task exist"; drawn as time it answers "what happened to this client",
  which is the question asked before a save call and in every review.

## Capabilities and Constraints

- Static site, no server and no build step. Vanilla JS, plain CSS, deployed to
  GitHub Pages today and portable to Cloudflare Pages.
- Talks to the GitHub REST API directly from the browser with the CSM's own
  fine-grained token, so every action is attributed to the real person.
- Routing, phase metadata and plan text are read from one compiled artifact,
  `dist/playbooks.json`. **The UI never decides routing**; it displays it.
- A transition is about 3 seconds of waiting. That is a real constraint: the
  interface has to make that wait legible rather than pretend it is instant.
- Currently loaded: 24 phases, 60 transitions, across renewal, cancel and two
  declared expansion stubs.
- **Nothing reads client replies.** Any future outcome suggestion would be a
  structural guess, not evidence. Confirmed with Amit: the interface should show
  the CONSEQUENCE of each choice rather than recommend one.
- **It runs with no token at all.** With nothing saved it serves a sample book
  of five invented nonprofits, shaped exactly like the API's data so there is
  one rendering path rather than two. Every screen says it is the sample, and
  every write is refused rather than silently skipped.
- **Some controls are drawn and not built**, and say so when pressed: postpone
  by a day, postpone by three days, closing an ad-hoc follow-up, and the whole
  manager's view. Engagement timelines exist in the sample only; a connected
  repository says the history is not compiled yet rather than inventing one.

## Brand Commitments

No logo and no brand palette were supplied, and this is an internal operating
tool rather than a CauseMatch-facing surface. One direction is set, by Amit on
2026-08-12: **white, light blue, a little gold, and Jewish.** Built as a tallit
and an illuminated page — see DESIGN.md. Not a symbol applied to a tool.

## Evidence on Hand

- Real playbook content: 24 phases with plan text extracted verbatim from the
  CS sheet, and 60 declared transitions with their meanings.
- A live repository with worked examples, including a client who churned after
  three contract chases and one who crossed from cancel back into renewal.
- No client-facing copy, no testimonials, no metrics. Do not fabricate any.

## Product Principles

1. **The queue is the product, and it leads with the task.** A CSM's day is
   "what do I owe today". The task name is the answer; the client answers "for
   whom", which is the second question and therefore the second line. Changed
   by Amit 2026-08-12, reversing the first build's client-first card.
2. **Show consequence, never advice.** For each possible outcome, show where the
   client lands. Do not recommend one; the CSM decides and the click is the
   record.
3. **The playbook's own words win.** Plan text is quoted from the sheet, not
   paraphrased.
4. **Two real usage scenes, not one stretched.** Thumb-first after a call,
   dense and keyboard-friendly at a desk.
5. **Never let a wait look like a failure.** Actions take seconds; the interface
   says what is happening and what already succeeded.
6. **A control that is not built says so.** Drawing the shape of a screen
   before the wiring exists is legitimate and useful. Letting a person press it
   and guess whether anything happened is not.

## Accessibility & Inclusion

No product-specific standard established. Baseline expectations apply: real
focus states, keyboard operability for the desk scene, motion respecting
`prefers-reduced-motion`, and colour never the sole carrier of urgency.
