# Playbook Ops — a thin UI

One static page over the [playbook engine](https://github.com/amitmai/causematch-cs-poc).
No build step, no server, no framework.

Three screens: start a client on a playbook, see what is in flight, open a task
and pick what happened.

## The boundary that matters

This UI holds **no playbook knowledge**. It does not know which outcomes a phase
offers, where any of them route, which are self-loops, or what the attempt limits
are. All of that is read at load time from `dist/playbooks.json` in the engine
repo — compiled from the YAML, and checked for staleness by the engine's CI.

Picking an outcome does not compute anything. It posts your notes as a comment and
applies one label. Everything after that happens in a GitHub Action, which means
clicking the same label by hand in the GitHub UI produces exactly the same
transition — and a second UI, or an agent, can do the same thing without
reimplementing any routing.

That is what makes "many UIs on top" cheap.

## Auth

The page talks to `api.github.com` directly from your browser using **your**
fine-grained token, so every comment, label and transition is attributed to your
account in the issue timeline rather than to a shared bot.

Create a token at github.com/settings/personal-access-tokens, scoped to the engine
repo only:

| Permission | Why |
|---|---|
| Issues: read & write | read tasks, post notes, apply the outcome label |
| Contents: read | read `dist/playbooks.json` |
| Actions: read & write | dispatch the `start-client` workflow |

It is kept in this browser's `localStorage` and sent only to `api.github.com`.

**Why a pasted token and not a sign-in button.** A static page cannot complete an
OAuth handshake: `github.com/login/oauth/*` returns no CORS headers, so the
browser cannot exchange a code for a token without a server in the middle.
`api.github.com` does send `Access-Control-Allow-Origin: *`, which is why every
other call works fine from here. To get one-click sign-in, add a ~30-line proxy
(a Cloudflare Worker will do) that fronts the device-flow endpoints; only `api()`
in `app.js` needs to change, and the attribution model stays exactly as it is.

## Run it

Locally:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Or serve it from GitHub Pages on this repo — Settings → Pages → deploy from
`main` / root. This repo is public and contains code only; no client data ever
lands here.
