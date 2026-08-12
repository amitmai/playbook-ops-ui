# Playbook Ops — a thin UI

Four static screens over the [playbook engine](https://github.com/amitmai/causematch-cs-poc).
No build step, no server, no framework, no third-party request.

| Route | Screen |
|---|---|
| `#/` | **The queue** — everything you owe, in urgency order, task first |
| `#/task/N` | **One task** — what to do, how the playbook says to do it, the result, the outcome |
| `#/engagements` | **Engagements** — one client's whole history drawn as time |
| `#/manager` | **Manager** — the department as a zoomable tree. Mock only |
| `#/settings` | **Connection** — repository and token |

`#/cue/N` still resolves to `#/task/N`, so older links land.

## Look at it without a token

With no repository and token saved the app runs on `demo.js`: five invented
nonprofits, twelve open tasks, five engagements with full histories, and an
invented CS department. Every screen carries a banner saying so, and every
write is refused rather than silently skipped.

The demo data is shaped exactly like the GitHub API's — same labels, same
`PLAYBOOK-STATE` block — so the screens cannot tell demo from live and there is
no second rendering path to keep in step.

Nothing in `demo.js` is a real client, a real colleague or a real number.

## What is wired and what is drawn

Wired against a real repository: the queue, the task page, recording an
outcome, and starting a client on a playbook.

**Drawn but not built** — pressing one says so plainly:

- Postpone by a day, postpone by three days
- Marking an ad-hoc follow-up done
- The manager's view, in every mode. It is a mock of a shape, not a query.
- Engagement timelines outside demo mode. The history is not compiled yet, so
  a connected repository shows the engagement and says the timeline is not
  available rather than inventing one.

## The boundary that matters

This UI holds **no playbook knowledge**. It does not know which outcomes a
phase offers, where any of them route, which are self-loops, or what the
attempt limits are. All of that is read at load time from `dist/playbooks.json`
in the engine repo — compiled from the YAML, and checked for staleness by the
engine's CI.

Picking an outcome does not compute anything. It posts your result as a comment
and applies one label. Everything after that also happens in a GitHub Action,
which means clicking the same label by hand in the GitHub UI produces exactly
the same transition — and a second UI, or an agent, can do the same thing
without reimplementing any routing.

That is what makes "many UIs on top" cheap.

## Files

| File | Holds |
|---|---|
| `theme.css` | Every colour, face and token. Nothing else declares a colour |
| `styles.css` | Chrome, the queue, the open task |
| `app.js` | Routing, the GitHub calls, the demo data layer, the queue, the task |
| `engine.js` | The browser-side state machine. Pure functions, no network |
| `demo.js` | The sample book |
| `engagements.js` / `.css` | The engagement timeline. Classes prefixed `eng-` |
| `manager.js` / `.css` | The manager's tree. Classes prefixed `mg-` |

## Auth

The page talks to `api.github.com` directly from your browser using **your**
fine-grained token, so every comment, label and transition is attributed to
your account in the issue timeline rather than to a shared bot.

Create a token at github.com/settings/personal-access-tokens, scoped to the
engine repo only:

| Permission | Why |
|---|---|
| Issues: read & write | read tasks, post results, apply the outcome label |
| Contents: read | read `dist/playbooks.json` |
| Actions: read & write | dispatch the `start-client` workflow |

It is kept in this browser's `localStorage` and sent only to `api.github.com`.

**Why a pasted token and not a sign-in button.** A static page cannot complete
an OAuth handshake: `github.com/login/oauth/*` returns no CORS headers, so the
browser cannot exchange a code for a token without a server in the middle.
`api.github.com` does send `Access-Control-Allow-Origin: *`, which is why every
other call works fine from here. To get one-click sign-in, add a ~30-line proxy
(a Cloudflare Worker will do) that fronts the device-flow endpoints; only
`api()` in `app.js` needs to change, and the attribution model stays as it is.

## Run it

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

It opens on the sample book. Add a repository and token under Connection to
point it at real work.

Or serve it from GitHub Pages on this repo — Settings → Pages → deploy from
`main` / root. This repo is public and contains code only; no client data ever
lands here.
