# Design

<!-- impeccable:design-schema 1 -->

Recorded from the built world on 2026-08-11, not from intention.

## The world: a stage manager's promptbook

A stage manager calls a show from a ring-bound script: cues numbered down the
margin, the live line under a highlighter, called cues struck through, coloured
tape flagging the acts. That is the same job a CSM does with a playbook, so the
interface is that book rather than a task app.

**What it refuses.** The SaaS task app: a grid of same-size cards, a sidebar of
icons, a blue primary button, a status pill per row. Chosen against three other
derived worlds (a dispatch strip rack, a charge-nurse ward board, and the
category standard) by the user.

## Light, and why

A real promptbook is read in the wings under a hooded lamp, which argues for
dark. The scene decides instead: this one is read in a corridor right after a
client call and at an office desk in daylight. Light ground, ink text.

## Colour

Restrained: a bone ground, graphite ink, and **one** highlighter yellow that
means "this is the live line". Red is functional only, for lateness.

| Token | Value | Role |
|---|---|---|
| `--paper` | `#F5F1E6` | the page stock, the whole ground |
| `--page` | `#FCFAF4` | the script leaf and inputs, one step brighter |
| `--ink` | `#17161A` | text, group rules, the solid button |
| `--ink-2` | `#3B3830` | script body |
| `--pencil` | `#6E6A61` | margin notes, secondary text |
| `--faint` | `#97928A` | trail, placeholders |
| `--rule` / `--rule-soft` | `#D8D1BE` / `#E9E3D4` | hairlines, cue separators |
| `--mark` / `--mark-soft` | `#FFE24A` / `#FFF3B0` | the highlighter: current row, hover |
| `--late` | `#A82018` | grease-pencil red, lateness only |
| `--cleared` | `#2E6A4E` | an ended engagement |
| tape flags | `#CBDDE8` `#F0DCC4` `#DCD6EC` | playbook identity, paper tape not buttons |

**Colour is never the sole carrier.** Lateness is simultaneously a red rule, the
word "Late" as a group header, a stamped label, and first position in the sheet.

## Type

Both self-hosted under OFL. No third-party font requests: this tool runs with a
token that reads a private repository.

- **Archivo** (400/500/600/700) — the call sheet. A grotesque drawn for
  headlines and small print, which is what a running order is.
- **Courier Prime** (400/700/400i) — the script. Theatre and film scripts are
  typed in Courier, so this is the world's own material rather than monospace
  worn as a technical costume. It carries the plan text, cue numbers, due dates
  and the margin block, and nothing else.

Client name is always the heaviest thing on screen: `clamp(29px, 8vw, 42px)` at
700 on the open page, 17.5px at 600 in the running order.

## Composition

**Running order (home).** A cue sheet. Ruled group headers in urgency order,
Late / Today / This week / Later / No date, each with a count. A row is: cue
number in a bordered margin box, client name, phase beneath in pencil, lateness
at the right. The row itself is the action; there is no separate button.

**The open page (a task).** Back link, client name, phase and cue number, tape
flag for the playbook, stamps for late or last-attempt, then the trail of phases
this client has already passed. The script leaf holds a margin strip of
metadata over the plan text verbatim from the sheet. Then margin notes, then
**Call the cue**: every outcome numbered, with what it means and what it causes.

**The desk (≥900px).** Two columns. The running order becomes a persistent left
rail with a single vertical rule as the book's bound edge; the open page sits
right. The queue never disappears while working a task.

## Motion

One authored moment: calling a cue. The chosen row's name and meaning fade back
and a rule is drawn through it left to right over 340ms on an exponential
ease-out, the way a called cue is struck out in the book. Everything else is a
highlighter fading in under a hovered row. All of it is disabled under
`prefers-reduced-motion`.

## Rules the build holds to

- One elevation, and it is a border. No shadows anywhere.
- Card radius 13px; pills only for small controls.
- Icons are drawn SVG at 1.6 stroke with square caps. No emoji, no glyphs.
- Section numbers exist only where the sequence is information: cue numbers are
  the GitHub issue numbers, and outcome numbers are how a cue is called.
- No eyebrow or kicker above any heading.
- Focus is a real 2px ink outline, on every interactive element.
- Waiting says "Standby" with a pulsing mark, never a bare spinner, because a
  transition takes about three seconds and silence reads as breakage.

## Language

The product's own words, from the promptbook: *running order*, *cue*, *call the
cue*, *notes in the margin*, *standby*. Plan text is never paraphrased. Outcome
consequences are stated as what will happen: "opens 4.2 Understanding Call",
"stays here, attempt 2 of 3", "attempts run out, goes to 3.1 Flag + Follow-up".
