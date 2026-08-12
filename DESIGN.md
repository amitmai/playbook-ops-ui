# Design

<!-- impeccable:design-schema 1 -->

Recorded from the built world on 2026-08-12, not from intention. It replaces
the promptbook world recorded on 2026-08-11; what changed and why is at the
bottom.

## The world: a tallit, and an illuminated page

A tallit is white cloth with techelet stripes. A Jewish illuminated page adds
gold leaf, sparingly, only where it means something. Those two objects are the
whole world: white ground, one blue, and gold used once per screen on the thing
that is live.

The tool is for CauseMatch's CS team, who carry Jewish nonprofits through
renewal. The reference is the cloth and the page rather than a symbol, because a
symbol applied to an operating tool is a costume. A stripe woven into the
chrome is not.

**What it refuses.** The SaaS task app: a grid of same-size cards with a status
pill per row, a sidebar of icons, a blue primary button doing every job. It also
refuses the obvious kitsch — no Star of David used as a bullet, no menorah, no
parchment texture.

## Light, and why

Read in a corridor right after a client call, and at an office desk in
daylight. Light ground, ink text. White is the page; `--wash` is the room the
page sits in.

## Colour

| Token | Value | Role |
|---|---|---|
| `--paper` | `#FFFFFF` | the page: cards, the rail, inputs |
| `--wash` / `--wash-2` | `#F3F8FC` / `#E8F1F8` | the ground behind the page |
| `--ink` | `#0F2231` | text. Navy, not black, so it sits with the blue |
| `--ink-2` | `#2C4557` | the advice, body prose |
| `--quill` | `#5C7688` | secondary text |
| `--faint` | `#93A9B8` | placeholders, trails |
| `--rule` / `--rule-soft` | `#D3E2ED` / `#E7F0F7` | hairlines |
| `--blue` | `#1B6FA8` | **techelet.** The one blue, and the primary |
| `--blue-deep` / `--blue-lit` | `#10496F` / `#4699D2` | its two other weights |
| `--blue-wash` / `--blue-mist` | `#DCEBF7` / `#EFF7FD` | fills |
| `--gold` … `--gold-mist` | `#A9801F` … `#FDF9EF` | **gold leaf.** Accent only |
| `--late` | `#A5322B` | lateness only |
| `--good` | `#2C6A50` | an ended engagement, a completed thing |
| `--warn` | `#9A6510` | a repeat, a limit approaching |
| `--band-*` | | playbook identity: renewal, cancel, expansion, nurture |

**The gold rule.** If gold is carrying more than one meaning on a screen, it is
overused. It marks the live thing and nothing else: the current phase on a
timeline, the current task in the rail, the seam between the instruction and
the advice, the demo seal.

**Colour is never the sole carrier.** Lateness is simultaneously a red left
edge, the word "4 days late", a group header reading LATE, and first position
in the queue. A playbook crossing on the timeline is a change of colour AND a
flag naming both playbooks.

**The tallit stripe** appears exactly once, under the top bar: two weights of
techelet on white, in the rhythm the cloth is actually woven. It is the only
ornament in the build.

## Type

Three faces, three jobs. All self-hosted under OFL. No third-party font
request: this tool runs with a token that reads a private repository.

- **Frank Ruhl Libre** (400/500/700, Latin + Hebrew) — **the voice.** Drawn in
  1908 and redrawn for Haaretz; the first Hebrew serif of the modern era. It
  carries headings, client names, the one thing to do, and the playbook's
  advice. The Hebrew subset is loaded, so a Hebrew client name sets correctly
  rather than falling back.
- **Archivo** (400–700) — **the chrome.** Labels, buttons, small print, section
  rules.
- **Courier Prime** (400/700/400i) — **the record.** Dates, counts, issue
  numbers, attempt counts. A record of what happened is typed, not set.

The task name is the heaviest thing in the queue: `19px/600` on a card,
`clamp(28px, 7.5vw, 40px)/700` on the open page.

## Composition

**The queue (home).** Cards in urgency order, grouped Late / Today / This week
/ Later / No date, each ruled in techelet with a count. A card is: the task
name, then the client and which engagement it belongs to, then the phase and
whose job it is, with lateness at the right. The card is the action.

**The open task.** Back link, the task as the heading, client and engagement
beneath, bands and stamps, then the trail of phases this client has passed.
Then **the brief**: the one thing to do, large, in the serif — lifted verbatim
from the playbook's own `Goal:` line — a gold seam, and beneath it how the
playbook says to do it, smaller and quieter in the same serif. A ledger strip
closes the card with phase, type, owner, due date and attempt. Then **Result**
(what happened, in your words), then **Outcome** (each one numbered, with what
it means and what it causes), then **Postpone**, under a dashed rule, in the
quiet button, because postponing is not an outcome.

**Engagements.** A list on the left, and on the right the engagement drawn as
time: a real axis, one bar per phase visited, coloured by playbook, with the
running phase in gold and open at its right end. Bubbles pin the moments worth
pointing at. A ledger below repeats every bar as text, so nothing lives only in
a bar too narrow to label.

**The manager's tree.** A zoomable, pannable canvas: department, five managers,
five likelihood bands each, engagements under a band. Opening an engagement
gives the reason it sits in that band and the evidence from the record. Marked
as a mock on the screen itself.

**The desk (≥900px).** Two columns: a persistent rail holding the queue, and
the work on the right. The queue never disappears while a task is open. The
timeline and the tree take the full width instead.

**"Nothing selected" means different things in the two scenes.** On the desk,
Engagements opens the first one for you: the list stays beside it, so picking
another is one click. On a phone the detail replaces the list, so the same
helpfulness would drop the CSM inside one client's history having never been
shown the others — there, it opens on the list. A screen that is genuinely two
scenes has to answer an empty state twice.

## Motion

Restrained. Hover and selection are a border and a wash changing. Waiting says
"Standby" with a pulsing gold mark, never a bare spinner, because a transition
takes about three seconds and silence reads as breakage. All motion is disabled
under `prefers-reduced-motion`.

## Rules the build holds to

- One elevation, and it is a border plus `--lift`, a 1px hairline shadow. No
  stacked shadows.
- No colour is declared outside `theme.css`. A hex literal in any other file is
  a bug.
- Card radius 14px; pills only for small controls.
- Icons are drawn SVG at 1.6 stroke with square caps. No emoji, no glyphs
  standing in for icons, anywhere.
- Numbers appear only where the sequence is information: task numbers are the
  GitHub issue numbers, and outcome numbers are how an outcome is picked.
- No eyebrow or kicker above any heading.
- Focus is a real 2px outline in `--blue-deep`, on every interactive element.
- Per-surface stylesheets namespace themselves: `eng-`, `mg-`.

## Language

*The queue. The task. The brief. Result. Outcome. Postpone. Standby. The
sample book.* Plan text is never paraphrased. Outcome consequences are stated
as what will happen: "opens 7.1 Campaign Onboarding", "stays here — attempt 3
of 3", "attempts run out — goes to 3.1 Flag and Follow-up".

A control that is drawn but not built says so in its own words when pressed. It
never fails silently and never pretends.

## What changed on 2026-08-12, and why

1. **The world.** From a stage manager's promptbook (bone stock, graphite,
   highlighter yellow) to the tallit and the illuminated page. Amit's call. The
   promptbook was a good metaphor for calling cues and a poor one for a Jewish
   fundraising company's internal tool.
2. **The card leads with the TASK, not the client.** The first build made the
   client name the heaviest thing on every screen. A queue is answered
   task-first — "what do I owe" — and the client answers "for whom", which is
   the second question and now the second line. Amit's call.
3. **The brief split into two registers.** The one thing to do is lifted from
   the playbook's `Goal:` line and set large; the rest of the plan text sits
   under it, smaller. Before, the heading and the plan text said the same
   sentence twice.
4. **Four surfaces, not one.** The queue was the whole product; the engagement
   as time and the department as a tree are new, and each owns its own layout.
5. **It runs with no token.** Five invented nonprofits, and a banner on every
   screen saying so.
