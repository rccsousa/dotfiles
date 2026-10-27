---
name: browser
description: >
  Drive a real Chrome browser via CDP using the `br` CLI — navigate, click, type,
  read page content, screenshot, and inspect console errors and fetch/XHR traffic.
  Use whenever you need to see or interact with a live page: verifying a UI change
  in the running app, reproducing a bug someone reported in the browser, checking
  why a request 404s or a button does nothing, scraping a page behind a login, or
  walking an end-to-end flow. Also use when the user says "open the app", "check
  the page", "click through", "screenshot it", or "what's the console saying".
  Prefer this over Playwright/Puppeteer MCP — it is faster and far cheaper in
  tokens. Not for fetching static pages or APIs: use WebFetch or curl for those.
---

# Browser (Chrome via CDP)

`br` drives a real Chrome over the DevTools Protocol. Chrome runs in its own
persistent profile at `~/.claude/chrome/profile` — logins survive restarts, so
sites the user has already signed into stay signed in.

**Headless by default.** No window, no cursor movement, nothing on the user's
screen — it never interrupts what they are doing. You therefore cannot see the
page: use `br shot` and read the image back. Cookies, logins and the profile are
identical to windowed mode.

`br` auto-starts Chrome when needed. Never launch Chrome yourself.

## Loop

Always `br act` before clicking or typing — it returns the refs the other
commands take, and refs go stale on any DOM change.

On SPAs, always `br wait --idle` between `br open` and `br act`. `br open`
returns on the load event, which fires *before* client-side auth checks and
route redirects resolve — act too early and you read the pre-redirect DOM, which
usually looks like an empty or broken page. If a page comes back with 0
actionable elements, that is the first thing to suspect, not a broken site.

```
br open localhost:3000/deposits   # http is inferred for local hosts
br act                            # [1] input:text "Amount"  [2] button "Confirm"
br type 1 "1500" --clear
br click 2                        # ref, CSS selector, or visible label text
br wait --idle                    # settles network + readyState
br read                           # visible text
```

## Diagnosing

After any interaction that misbehaves, check both — they are independent:

```
br console --errors       # uncaught exceptions, console.error
br net --fail             # only 4xx/5xx/network failures
br net -n 40              # recent fetch/XHR
```

The recorder only sees `fetch` and `XHR`. Images, CSS, and document loads are
invisible to it — do not conclude "no requests happened" from an empty `br net`.

## Native dialogs

`alert` / `confirm` / `prompt` block the whole renderer, so they are answered
automatically by whichever command triggered them, and reported:

```
br click "Re-open month"
  clicked button "Re-open month"
  dialog (confirm) dismissed: "Re-open this month? This invalidates the export."
    re-run with --accept to confirm it
```

**Dismiss is the default** — these dialogs usually guard a destructive action and
Cancel is the reversible answer. Say `--accept` when you actually mean to confirm,
and `--text "..."` to answer a prompt. `beforeunload` is always accepted, since
asking to navigate is asking to leave.

If a dialog is somehow already stuck open, every command fails with *"page is not
responding"* — clear it with `br dialog dismiss` or `br dialog accept`.

## Escape hatch

`br eval '<js>'` runs arbitrary JS in the page and prints the result. Use it
whenever the fixed commands do not cover the need — extracting structured data,
asserting state, poking at framework internals.

```
br eval '[...document.querySelectorAll("tr td:nth-child(2)")].map(e => e.innerText)'
```

## Reference

```
br open <url> [--new]      br tabs / br tab <n> / br close
br back / br forward       br reload [--hard]
br read [--links|--html] [--max N]
br act
br click <ref|selector|text> [--accept] [--text s]
br dialog <accept|dismiss> [--text s]
br hover <ref|selector|text>
br viewport <mobile|tablet|desktop|WxH|reset>
br select <ref|selector|text> <value|label>
br type <ref|selector> <text> [--clear] [--fast]
br key <enter|tab|escape|up|down|left|right|backspace>
br wait <selector|text|ms> | --idle [--timeout ms]
br eval '<js>'             br shot [path] [--full]
br net [-n 25] [--filter s] [--fail]
br console [-n 50] [--errors] [--level warn]
br status / br start / br stop
br seed [--profile Default]   # copy cookies from the real Chrome profile
```

## Gotchas

- Chrome ≥136 refuses `--remote-debugging-port` on the default profile — this is
  why a separate profile exists. Do not try to point it at the user's main Chrome.
- `br stop` closes gracefully via CDP; killing Chrome with `pkill` loses unflushed
  cookies and silently drops logins.
- `br click` refuses when something covers the target and names the blocker
  (`covered by div#overlay`) — dismiss the cookie banner or modal, don't work
  around it with `br eval`, because a real user would be blocked too.
- `br type --clear` is safe on React/Vue/Svelte controlled inputs. Do not clear a
  field by hand with `br eval 'el.value = ""'` — the framework's value tracker
  swallows it and the field reverts.
- Native dropdowns need `br select <ref> <value|label>` — clicking a `<select>`
  does nothing. A bad choice prints the available options.
- `br type` sends real per-char key events, so typeahead, char counters and
  key-filtered inputs behave as they would for a user. `--fast` swaps in a single
  bulk insert that fires no key events — only worth it for very long strings
  (~0.4ms/char otherwise).
- `br act` sees into iframes and marks those elements `(iframe)`; refs are one flat
  sequence, so `br click`/`type`/`select`/`hover` take them like any other. Works
  for same-origin, cross-origin and nested frames — embedded widgets and payment
  fields (Stripe) included. A frame it still cannot enter is printed as
  `! iframe not reachable`, never silently dropped.
- `br read` only reads the top document. For text inside a frame use `br act`, or
  `br eval` against that frame.
- `br viewport` persists across commands until `br viewport reset`. On a page with
  no `<meta name="viewport">` the mobile preset lays out at 980px and desktop media
  queries win — that is what a real phone does, not a bug. Touch-feature detection
  (`ontouchstart`) only appears after a `br reload`.
- Hover state survives until the next mouse move, so `br hover` then `br act` shows
  the revealed menu. `br click` moves the mouse and drops it.
- Input never steals OS focus: `click`/`type`/`key`/`hover` use focus emulation
  rather than raising a window, so this stays true even in `--window` mode.
- Screenshots go to a path you pass; read them back with the Read tool to actually
  look at them.
- If a site needs a login the profile does not have, say so and ask the user to run
  `br stop && br start --window`, sign in by hand in the Chrome window that appears,
  and tell you when done. Do not ask for credentials, and do not type them yourself.
  `--window` is one-shot — the next `br stop` returns to headless.
