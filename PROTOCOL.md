# Relay ↔ extension protocol and internals

Technical reference for the message format between relay and extension, and for how permissions, overlay, stop and settings work. For usage see [README.md](README.md).

## Connection

- The extension opens `ws://<relay>:8766/ext?token=<TOKEN>&device=<deviceId>&name=<name>&platform=<platform>` (`wss://` behind a TLS proxy). `deviceId` is a random UUID created once per browser profile (`storage.local`); `name` comes from the options (default: a star name plus a number, e.g. "Vega 42", created once; the relay falls back to `Browser <first 4 characters of the deviceId>` if no name arrives). Extensions before 0.7 send no deviceId and count as device `default`.
- The relay accepts the connection only if the token matches and the `Origin` starts with `chrome-extension://`. Otherwise it closes with code 1008.
- The relay keeps one connection per deviceId. A new connection with the same deviceId (the same browser after a network change) replaces the old one: the relay swaps first without interruption and closes the old one afterwards with code 1012. If the old connection drops later, the new one stays.
- Commands go to the selected browser only, never to another one as a fallback (tab IDs overlap between browsers). The selection starts empty; the first browser that connects while it is empty and no other browser is connected becomes the selection (also on the first command, if the selection is empty and exactly one browser is connected). `select_browser` sets it, `switch_browser` sends `pair` to every browser (a notification with "Connect", up to 120 s) and selects the first one that answers `true`; the others get `pair_cancel`, which removes their notification. A browser that connects later does not change the selection. If the selected browser is not connected, calls fail with an error naming it. The selection lives in the relay's memory and applies to all agent sessions (the relay is stateless and does not know them); after a relay restart it starts empty again.
- A tool call resolves its browser once, on its first command, and keeps it for all further commands of that call (also every step of `browser_batch`), so a selection change in between cannot split one call across two browsers.
- `/admin/status` reports all browsers without changing the selection. `/admin/settings` and `/admin/reload` (both admin token) take an optional `?device=<deviceId>`; without it they act on the browser in use, which the agent can change (a GET without device falls back to the first browser, so a settings page can still list them). `/admin/settings` answers with `browser` (`deviceId`, `name`, `inUse`) and `browsers` (all connected ones); `/admin/select` (POST `{"deviceId"}`, admin token) lets the user pick the browser for the agent; tab IDs the agent still holds then belong to the other browser, and the extension rejects them as not shared. Errors such as "several browsers, none selected" come back as 409 with `error` and `browsers`.
- The deviceId is not a secret and not authenticated: anyone with the token can connect under any deviceId and thereby replace that browser, or answer `pair` at once. That grants nothing beyond what the token already allows (MCP access), but the token, not the deviceId, is the security boundary. Extensions before 0.7 all share the device `default` and still replace each other.
- Every open request is bound to its connection. Replies count only on that connection. When it ends (dropped or replaced), exactly its requests fail immediately with "result unknown". The relay never retries by itself.
- The extension sends `{"ping":1}` every 20 s. This keeps the service worker alive; the relay ignores the message. An alarm every 30 s reconnects if the worker has been asleep.

## Requests (relay → extension)

```json
{"id": 17, "method": "computer", "params": {"tabId": 892915280, "action": "left_click", "ref": "ref_4521003"}}
```

- `id`: a counter in the relay process, unique across all connections. A late reply can therefore only match its own, long-finished request and is discarded.
- `method`: the name of a handler in `extension/background.js`. These are the MCP tools from `relay.py` plus the internal commands `status`, `reload`, `settings`, `pair`, `pair_cancel`, `drop_files` and `download`.
- Parameters with the value `null` are omitted by the relay.

## Replies (extension → relay)

```json
{"id": 17, "result": {"text": "left_click at (812, 440)", "at": [812, 440]}}
{"id": 17, "error": "Tab 892915280 is not shared"}
```

The relay turns `error` into an MCP error (`isError: true`). If no reply arrives within 60 s, the result is also an error ("result unknown").

A reply may carry `"sensitive": true` (next to `result` or `error`): the request's text was meant for a password field, or for a cross-origin iframe whose field type is unknown. See [Audit log](#audit-log).

## Access check

Every handler that touches a tab goes through `assertAllowed(tabId)`, directly or via `cdp()` / `page()`.

- A tab is shared if it is in the shared list (kept in `storage.local.shared`), as `"user"` (toolbar icon click) or `"agent"` (opened by the agent).
- `tabs_close` additionally requires `"agent"`, or `"user"` with the safety switch `closeShared`. A tab the user shared is never closed over a `beforeunload` dialog: the extension dismisses the dialog and fails with "unsaved changes" (agent tabs: the dialog is accepted).
- For a `"user"` tab the extension also stores the origin it showed when it was shared (`storage.local.shareOrigins`, tabId → origin; shares from before 0.9 take the tab's current URL on load). That origin counts as approved, see below.
- Shared tabs are kept in `storage.local`. They survive reloading the extension and are discarded at browser start, because tab IDs are valid for one browser session only. Tabs in the "Hermes" group are adopted again as `"agent"` on load, so no orphaned agent tabs remain that the agent could no longer close. The criterion is only the group title: a user's own group named "Hermes" is adopted too.
- Every debugger command checks before attaching and once more afterwards. If the permission is withdrawn during attaching, the debugger is detached again.
- The set of shared tabs is a list in the service worker's memory, modified without interruption. `storage.local` only backs it up.
- `browser_batch` first validates all steps (tool name, input) and only then executes. Each step re-checks permission. If a step fails, the call returns an error (`isError`) with the results of the steps before it.

## Permissions, overlay, stop

- Before the handler runs, the extension checks whether a request acts: `computer` with a click, drag, type or key action, `form_input`, `file_upload`, `drop_files`, `handle_dialog` with `accept: true`. The website must then be approved, by one of:
  - `storage.local.allowedSites[origin]` ("always"),
  - "once" for tab + origin (in memory only),
  - owner `user` (tab shared by the user), but only for the origin the tab showed when it was shared (other pages of that origin too; on another origin the tab stays shared for reading and the normal question applies),
  - `siteMode: "all"` or an active `allowAll` window.

  `data:` and `about:blank` have no origin to approve: acting there is refused in every case ("not a website"), reading works. During a navigation the target (`pendingUrl`) must be approved too. Otherwise the extension asks through the overlay and `chrome.notifications` and waits `permTimeoutMs` (default 50 s). No answer or a dismissed notification counts as "no".
- Approval levels: once (tab + origin), origin until browser restart (`storage.session`), origin always (`storage.local`), all websites for 1 h or 8 h, all websites until restart, all websites always.
- `params.summary` (set by the relay from `action_summary`) is shown in the overlay label. In the permission prompt and its notification it is set apart from the question as "Hermes says: …", cut to 120 characters. A new question for the same tab (it moved to another origin) answers the old one with "no" and removes its notification.
- The overlay is a closed shadow DOM in an isolated world. Its buttons report through the debugger binding `__hermesTabs` (`Runtime.addBinding` with `executionContextName: "hermes-tabs"`). The page does not see the binding. The extension evaluates only calls from its own isolated world and only real clicks (`isTrusted`). While the agent is clicking, the overlay lets clicks through, so the agent cannot hit Stop or an approval button.
- The overlay (frame, pointer, ring, label, stop bar) disappears after 6 s of inactivity. Screenshots returned to the agent hide it.
- The host element `<hermes-tabs-overlay>` lives in the page's DOM, so the page can detect it while it is there and remove it or overwrite its inline style. Every overlay call re-attaches it and sets the style again; a `MutationObserver` in the isolated world does the same at once, at most 10 times per second. Beyond that it gives up for this document: the tab's badge shows "!", a notification (`hermes-tamper-*`) tells the user, and every answer for the tab carries a warning for the agent (string results get a line appended, objects a `warning` field) until the next main-frame navigation. The page still cannot press the buttons; the desktop notification is the second channel for approvals.
- Stop withdraws the tab's permission, removes it from the "Hermes" tab group (otherwise it would be adopted again) and detaches the debugger.
- Write protection: `javascript` on a website without approval (or anywhere while the safety switch `act` is off, unless `scriptWrites` is on and `act` too) enables `Fetch.enable`, blocks every method other than GET/HEAD/OPTIONS with `BlockedByClient`, and runs without a user gesture (so popups fail). On `data:` and `about:blank` it is always on (also with `scriptWrites`). It is switched off at the next main-frame `Page.frameNavigated`; in a tab the user shared already 3 s (`GUARD_TAIL_MS`) after the `javascript` call, so the user's own requests in the tab are not blocked (a script that defers a request longer gets through there). This is a guard rail, not a sandbox: it does not cover WebSocket messages, service workers, or GET requests with side effects. Its state lives in the service worker's memory: if the browser restarts the service worker while a guard is on, the guard is lost.

## Safety settings

`storage.local.safety` decides which capabilities the agent has at all; the site permissions above then decide where it may act. Missing (installations before 0.9) means `standard`, which is exactly the behaviour of 0.8.

```json
{"tier": "standard", "act": true, "js": true, "navigate": true, "upload": true, "download": true, "devtools": true,
 "scriptWrites": false, "frameTyping": false, "passwords": false, "closeShared": false}
```

| Switch | Covers | read | standard | extended | full |
|---|---|---|---|---|---|
| `act` | `computer` clicks, drag, `type`, `key`; `form_input`; `handle_dialog` with `accept: true` | – | ✓ | ✓ | ✓ |
| `js` | `javascript` | – | ✓ | ✓ | ✓ |
| `navigate` | `tabs_create` (also `tabs_context(createIfEmpty)`), `navigate` | – | ✓ | ✓ | ✓ |
| `upload` | `file_upload`, `upload_image`, GIF drop | – | ✓ | ✓ | ✓ |
| `download` | `gif_creator(download=true)`: the browser download only; recording and export on the relay machine stay free | – | ✓ | ✓ | ✓ |
| `devtools` | `read_console_messages`, `read_network_requests` | ✓ | ✓ | ✓ | ✓ |
| `scriptWrites` | write protection off for `javascript` on websites without approval (popups too) | – | – | ✓ | ✓ |
| `frameTyping` | typing into cross-origin iframes | – | – | ✓ | ✓ |
| `passwords` | `type`, `key` and `form_input` into password fields | – | – | – | ✓ |
| `closeShared` | `tabs_close` also for tabs the user shared | – | – | ✓ | ✓ |

- `tier` follows from the switches (`tierOf`): a combination that matches no tier is `custom`. Entering `full` also sets `siteMode: "all"`; leaving it does not reset `siteMode`.
- Always allowed, in every tier: `tabs_context`, `read_page`, `find`, `get_page_text`, `computer` `screenshot`/`zoom`/`scroll`/`scroll_to`/`hover`/`wait`, `handle_dialog` with `accept: false`, `resize_window`, `tabs_close` of the agent's own tabs. Scrolling and hovering stay in `read` because they change nothing on the site (they never needed a site permission either) and are needed to see a page.
- With `act` off, `javascript` runs under the write protection everywhere (no non-GET requests, no popups), so it cannot stand in for clicks that submit something. It can still change the page's DOM (e.g. `element.click()` on a link or a script-only button); that is a documented limit of the guard rail.
- Not switchable: the tab boundary (shared or own tabs), protected pages, overlay and stop with buttons that react only to real clicks, the isolated world, upload roots and the 10 MB limit in the relay, the audit log, blocked sites and the master switch.
- Every handler checks its switch before the site question (`assertCapability`) and fails with "Turned off in the hermes-tabs safety settings (tier …): …". The existing refusals (password field, cross-origin iframe, closing shared tabs) name the safety settings too.
- The password detection (also `autocomplete=…password`) stays the same; only whether it refuses depends on `passwords`. In a password field `key` may only leave it (Tab, Shift+Tab, Escape). Keys that produce text are characters (also with Shift), Space, Enter, and the paste keys Ctrl/Cmd+V (also with Shift) and Shift+Insert; they count for the cross-origin iframe check (`frameTyping`). After a key that may move the focus (anything but a text key, and Enter) the focus is checked again before the next key, so "Tab" from the user name into the password field stops the sequence there.
- Without `passwords`, arrow and page keys (ArrowUp/Down, PageUp/Down) are refused while the focus is in a sign-in field (`autocomplete` username/email, or a form that contains a password field): they could pick a saved login from the browser's autofill. Native autofill popups are not fully controllable.
- Limit: `passwords` does not cover `javascript`. On an approved website a script can set a password field and submit the form; the relay's MCP instructions forbid it, and the script source (first 80 characters) lands in the audit log, password included.
- The stop bar shows "Full rights" while the tier is `full`, and "May enter passwords" while `passwords` is on.
- On the options page, choosing a looser tier, or turning on `passwords`, `scriptWrites` or `frameTyping`, asks first (`confirm()`); for `passwords` the warning says that Hermes can then enter credentials it has in the chat or its context.
- The relay does not filter the MCP tool list by these switches. Hermes caches tool schemas (also on disk) and a stateless server cannot announce `tools/list_changed`, so after a loosening the agent would keep missing tools; the refusal in the extension is the enforcement.

## Settings

- `settings` is reachable only through `GET/POST /admin/settings` on the relay (authenticated with `HERMES_TABS_ADMIN_TOKEN`), not through MCP. Without an admin token configured, the endpoint always answers 401.
- Keys:
  - `enabled`: master switch. When off, every command except status, settings, reload and pair_cancel fails.
  - `siteMode`: `ask` or `all`.
  - `allowAll`: `1h`, `8h`, `session` or `off`.
  - `sites`: `{origin: "always" | "session" | "off"}`.
  - `blockedSites`: list of domains, subdomains included.
  - `safety`: `{"tier": "read" | "standard" | "extended" | "full" | "custom", <switch>: true | false, ...}`. A tier sets its preset, switches given alongside override it, switches alone change the current state. Unknown switches or non-boolean values are refused.
- The body is validated completely before anything is stored.
- **Tightening applies at once, loosening only after the user confirms it in the browser.** The admin token sits in the agent's environment (the Hermes plugin needs it), so the agent could read it and try to grant itself rights. Loosening is: `enabled: true` while off, `siteMode: "all"` while not, `allowAll` other than `off`, a site raised to `session` or `always`, a domain removed from `blockedSites`, a safety switch turned on (entering `full` also counts `siteMode: "all"`). One POST asks once: a notification with "Allow" / "Decline" and a short summary; clicking the notification body opens the options page, which shows the same request with both buttons (for systems that show no notification buttons). Closing the notification means no; after 120 s (`storage.local.confirmTimeoutMs`, at most 120000) the request expires. Only one request waits at a time; another loosening POST meanwhile fails with 409.
- The tightening parts of a mixed POST apply at once (switches turned off, sites lowered, domains added to `blockedSites`, `enabled: false`, `allowAll: "off"`, `siteMode: "ask"`); the loosening parts after "Allow", applied to the state at that moment (a later "Allow" does not undo what was tightened meanwhile).
- Stored in `chrome.storage.local`; session values in `chrome.storage.session`. The reply is the complete current state, including `safety` (resolved, with `tier`). A POST answers only when the confirmation is settled (up to about 2 minutes; the relay waits 130 s) and adds:
  - `confirmation`: `not_needed` (nothing loosened), `confirmed`, `declined` or `expired`. All with status 200; the state in the reply shows what applies.
  - `loosening`: what needed confirmation, e.g. `["enabled", "siteMode:all", "allowAll:1h", "sites:https://example.com:always", "blockedSites:-bank.example", "safety.passwords"]`.
- Blocked sites are checked by `assertSafeTab` before every debugger command (URL and `pendingUrl`), and by `tabs_create` and `navigate` before opening.
- Tabs opened by an agent tab (for example links with `target=_blank`) belong to the agent and join the group. The click result reports their ID. Detection uses `openerTabId` and, because Chromium names the window's active tab as opener when the click happens in a background tab, also the agent page's `Page.windowOpen` event, matched by URL within 3 s.

## Protected pages

The agent operates only `http:`, `https:`, `data:` and `about:blank`.

- `tabs_create` and `navigate` reject other targets, including `file:`, `chrome-extension:` and `chrome:` (and browser-specific schemes such as `vivaldi:` or `edge:`).
- In addition, every debugger command checks the tab's current and currently loading URL.

Through the extension's own options page the agent would otherwise reach the extension APIs: the token, all tabs, the debugger on other tabs. Through `file:` it could read local files. Navigating away from a blocked page still works (`navigate` with an http(s) URL).

## Page script in an isolated world

`read_page`, `find`, `form_input` and the upload helpers run in an isolated world (`Page.createIsolatedWorld`, like a content script). The DOM is the same, but the page sees neither the reference table nor the helper functions and cannot replace them. Only the `javascript` tool runs, on purpose, in the page's own context.

## Dialogs

- Dialogs that open after attaching are reported by the debugger. `handle_dialog` answers them.
- A dialog that opened earlier (for example an `alert` during load) is never reported. A probe right after attaching detects it: if the page does not respond within 1.5 s, all commands report "probably blocked by a dialog" immediately.
- Such a dialog can only be confirmed in the browser itself. A navigation also waits for it. For the agent's own tab, `tabs_close` helps.
- Each debugger command has a timeout; `/admin/status` lists the running ones.

## References

`read_page` and `find` assign `ref_N`. The mapping lives in a table in the main window (`WeakRef` to the element), not in the DOM. Copies of an element (`cloneNode`, templates) therefore do not inherit the reference, and a removed element reports "not found".

- Each page gets a random number range of its own (multiples of 10,000 starting at 10^10). A reference from an earlier page therefore matches no element of the new page and reports "not found".
- On a return from the bfcache it is the same page: references stay valid and match the same elements.
- Searched are the main document, open shadow DOMs and same-origin iframes. Cross-origin iframes are separate targets and are not covered. This is a documented limit.

## Coordinates

- Screenshots are taken with `clip.scale = zoom * scale / devicePixelRatio`. At `scale` 1, one image pixel equals one CSS pixel of the viewport.
- `Input.dispatchMouseEvent` expects CSS pixels. Coordinates taken from a screenshot therefore match directly, also with display scaling or browser zoom.
- At `scale` < 1, the reply states the viewport frame in which the coordinates apply.
- Screenshots need a painted tab. Background tabs are not rendered, and neither `Page.captureScreenshot` variants nor `Page.startScreencast` change that. The extension therefore raises the tab within its window for the capture and then re-activates the tab that was active before, unless the user switched tabs meanwhile. If nothing is painted within 6 s, the call fails with "no image".

## Audit log

- The relay prints every browser call to stdout (journal): tool and parameters, strings cut to 80 characters, never file contents or images.
- `computer` with `text` and `form_input` with `value` are printed only after the browser's reply. If the reply says `sensitive` (password field, or a cross-origin iframe whose field type is unknown), or no reply comes (timeout, connection lost), the value is printed as `[hidden: password field]`. A refused attempt to type into a password field is hidden too.
- The value is not echoed back to the agent either: `type` answers "typed", `form_input` "set", `key` in a password field "keys: ••••". The overlay label shows "••••" instead of the text, and GIF frames of such steps do not draw it.
- Not covered: the source of `javascript` calls (the agent writes it itself; a password a script fills in would appear there) and `action_summary`.
- `read_network_requests` replaces credentials in URLs with `REDACTED`: user info (`user:password@`) and query parameters whose name contains token, key, auth, pass, secret, sig, session or code.

## HTTP side (agent → relay)

- `/mcp`: streamable HTTP (MCP), stateless with JSON responses instead of server-sent events. A relay restart therefore does not break MCP sessions, and the event size limits of some clients (1 MB) do not apply. `/admin/status` and `/admin/reload` are for maintenance, `/admin/settings` for settings.
- All HTTP paths, including GET, SSE and DELETE requests to `/mcp`, require `Authorization: Bearer <TOKEN>`. `/admin/settings`, `/admin/select` and `/admin/reload` require the admin token instead (the agent must not reload the extension, which would also drop the shares); `/admin/status` stays with the agent's token. Invalid JSON in a POST to `/admin/settings` gives 400.
- Requests with an `Origin` header are rejected with 403. An MCP client sends none, a browser does (protection against DNS rebinding).
- The relay listens on `HERMES_TABS_HOST` (default `127.0.0.1`), port `HERMES_TABS_PORT` (default 8766). For access over a network, terminate TLS in a reverse proxy.

## File uploads

- `file_upload(paths=…)` reads files on the relay machine, only below `HERMES_TABS_UPLOAD_ROOTS`.
- The file is opened first (`O_NONBLOCK`, so a FIFO does not block). The real path of the open descriptor (`/proc/self/fd`) is then checked, and data is read from exactly that descriptor. Only regular files are allowed.
- One shared limit of 10 MB applies to `paths` and directly passed `files` together, checked before reading. Files travel base64-encoded over the WebSocket; the extension puts them into the file input with `DataTransfer`.
- The GIF export writes files to `HERMES_TABS_GIF_DIR`. The directory must belong to the relay user and must not be writable by others. Files are created exclusively (`O_EXCL|O_NOFOLLOW`), existing files are never overwritten, and a name clash gets a `-1` suffix and so on.
- Nothing is written on the browser machine. The only exception is `gif_creator(download=true)`, which saves to the browser's download folder through `chrome.downloads`.
