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

Secondary, today: Amit and a few colleagues evaluating whether this way of
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

## Brand Commitments

None binding. This is an internal operating tool, not a CauseMatch-branded
surface. No logo, no brand palette supplied.

## Evidence on Hand

- Real playbook content: 24 phases with plan text extracted verbatim from the
  CS sheet, and 60 declared transitions with their meanings.
- A live repository with worked examples, including a client who churned after
  three contract chases and one who crossed from cancel back into renewal.
- No client-facing copy, no testimonials, no metrics. Do not fabricate any.

## Product Principles

1. **The queue is the product.** A CSM's day is "what do I owe today", and
   everything else is in service of that.
2. **Show consequence, never advice.** For each possible outcome, show where the
   client lands. Do not recommend one; the CSM decides and the click is the
   record.
3. **The playbook's own words win.** Plan text is quoted from the sheet, not
   paraphrased.
4. **Two real usage scenes, not one stretched.** Thumb-first after a call,
   dense and keyboard-friendly at a desk.
5. **Never let a wait look like a failure.** Actions take seconds; the interface
   says what is happening and what already succeeded.

## Accessibility & Inclusion

No product-specific standard established. Baseline expectations apply: real
focus states, keyboard operability for the desk scene, motion respecting
`prefers-reduced-motion`, and colour never the sole carrier of urgency.
