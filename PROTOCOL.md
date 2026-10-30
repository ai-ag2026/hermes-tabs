# Relay ↔ extension protocol and internals

Technical reference for the message format between relay and extension, and for how permissions, overlay, stop and settings work. For usage see [README.md](README.md).

## Connection

- The extension opens `ws://<relay>:8766/ext?token=<TOKEN>&device=<deviceId>&name=<name>&platform=<platform>` (`wss://` behind a TLS proxy). `deviceId` is a random UUID created once per browser profile (`storage.local`); `name` comes from the options (default: platform plus the first characters of the deviceId). Extensions before 0.7 send no deviceId and count as device `default`.
- The relay accepts the connection only if the token matches and the `Origin` starts with `chrome-extension://`. Otherwise it closes with code 1008.
- The relay keeps one connection per deviceId. A new connection with the same deviceId (the same browser after a network change) replaces the old one: the relay swaps first without interruption and closes the old one afterwards with code 1012. If the old connection drops later, the new one stays.
- Commands go to the selected browser only, never to another one as a fallback (tab IDs overlap between browsers). The selection starts empty; the first browser that connects while it is empty and no other browser is connected becomes the selection (also on the first command, if the selection is empty and exactly one browser is connected). `select_browser` sets it, `switch_browser` sends `pair` to every browser (a notification with "Connect", up to 120 s) and selects the first one that answers `true`; the others get `pair_cancel`, which removes their notification. A browser that connects later does not change the selection. If the selected browser is not connected, calls fail with an error naming it. The selection lives in the relay's memory and applies to all agent sessions (the relay is stateless and does not know them); after a relay restart it starts empty again.
- A tool call resolves its browser once, on its first command, and keeps it for all further commands of that call (also every step of `browser_batch`), so a selection change in between cannot split one call across two browsers.
- `/admin/status` reports all browsers without changing the selection. `/admin/settings` and `/admin/reload` take an optional `?device=<deviceId>`; without it they act on the browser in use, which the agent can change (a GET without device falls back to the first browser, so a settings page can still list them). `/admin/settings` answers with `browser` (`deviceId`, `name`, `inUse`) and `browsers` (all connected ones); `/admin/select` (POST `{"deviceId"}`, admin token) lets the user pick the browser for the agent; tab IDs the agent still holds then belong to the other browser, and the extension rejects them as not shared. Errors such as "several browsers, none selected" come back as 409 with `error` and `browsers`.
- The deviceId is not a secret and not authenticated: anyone with the token can connect under any deviceId and thereby replace that browser, or answer `pair` at once. That grants nothing beyond what the token already allows (MCP access), but the token, not the deviceId, is the security boundary. Extensions before 0.7 all share the device `default` and still replace each other.
- Every open request is bound to its connection. Replies count only on that connection. When it ends (dropped or replaced), exactly its requests fail immediately with "result unknown". The relay never retries by itself.
- The extension sends `{"ping":1}` every 20 s. This keeps the service worker alive; the relay ignores the message. An alarm every 30 s reconnects if the worker has been asleep.

## Requests (relay → extension)

```json
{"id": 17, "method": "computer", "params": {"tabId": 892915280, "action": "left_click", "ref": "ref_4521003"}}
```

- `id`: a counter in the relay process, unique across all connections. A late reply can therefore only match its own, long-finished request and is discarded.
- `method`: the name of a handler in `extension/background.js`. These are the MCP tools from `relay.py` plus the internal commands `status`, `reload`, `settings`, `drop_files` and `download`.
- Parameters with the value `null` are omitted by the relay.

## Replies (extension → relay)

```json
{"id": 17, "result": {"text": "left_click at (812, 440)", "at": [812, 440]}}
{"id": 17, "error": "Tab 892915280 is not shared"}
```

The relay turns `error` into an MCP error (`isError: true`). If no reply arrives within 60 s, the result is also an error ("result unknown").

## Access check

Every handler that touches a tab goes through `assertAllowed(tabId)`, directly or via `cdp()` / `page()`.

- A tab is shared if it is in the shared list (kept in `storage.local.shared`), as `"user"` (toolbar icon click) or `"agent"` (opened by the agent).
- `tabs_close` additionally requires `"agent"`.
- Shared tabs are kept in `storage.local`. They survive reloading the extension and are discarded at browser start, because tab IDs are valid for one browser session only. Tabs in the "Hermes" group are adopted again as `"agent"` on load, so no orphaned agent tabs remain that the agent could no longer close.
- Every debugger command checks before attaching and once more afterwards. If the permission is withdrawn during attaching, the debugger is detached again.
- The set of shared tabs is a list in the service worker's memory, modified without interruption. `storage.local` only backs it up.
- `browser_batch` first validates all steps (tool name, input) and only then executes. Each step re-checks permission. If a step fails, the call returns an error (`isError`) with the results of the steps before it.

## Permissions, overlay, stop

- Before the handler runs, the extension checks whether a request acts: `computer` with a click, drag, type or key action, `form_input`, `file_upload`, `drop_files`, `handle_dialog` with `accept: true`. The website must then be approved, by one of:
  - `storage.local.allowedSites[origin]` ("always"),
  - "once" for tab + origin (in memory only),
  - owner `user` (tab shared by the user),
  - `siteMode: "all"` or an active `allowAll` window.

  During a navigation the target (`pendingUrl`) must be approved too. Otherwise the extension asks through the overlay and `chrome.notifications` and waits `permTimeoutMs` (default 50 s). No answer or a dismissed notification counts as "no".
- Approval levels: once (tab + origin), origin until browser restart (`storage.session`), origin always (`storage.local`), all websites for 1 h or 8 h, all websites until restart, all websites always.
- `params.summary` (set by the relay from `action_summary`) is shown in the overlay label.
- The overlay is a closed shadow DOM in an isolated world. Its buttons report through the debugger binding `__hermesTabs` (`Runtime.addBinding` with `executionContextName: "hermes-tabs"`). The page does not see the binding. The extension evaluates only calls from its own isolated world and only real clicks (`isTrusted`). While the agent is clicking, the overlay lets clicks through, so the agent cannot hit Stop or an approval button.
- The overlay (frame, pointer, ring, label, stop bar) disappears after 6 s of inactivity. Screenshots returned to the agent hide it.
- Stop withdraws the tab's permission, removes it from the "Hermes" tab group (otherwise it would be adopted again) and detaches the debugger.
- Write protection: `javascript` on a website without approval enables `Fetch.enable`, blocks every method other than GET/HEAD/OPTIONS with `BlockedByClient`, and runs without a user gesture (so popups fail). It is switched off at the next main-frame `Page.frameNavigated`. This is a guard rail, not a sandbox: it does not cover WebSocket messages, service workers, or GET requests with side effects.

## Settings

- `settings` is reachable only through `GET/POST /admin/settings` on the relay (authenticated with `HERMES_TABS_ADMIN_TOKEN`), not through MCP. Without an admin token configured, the endpoint always answers 401.
- Keys:
  - `enabled`: master switch. When off, every command except status, settings and reload fails.
  - `siteMode`: `ask` or `all`.
  - `allowAll`: `1h`, `8h`, `session` or `off`.
  - `sites`: `{origin: "always" | "session" | "off"}`.
  - `blockedSites`: list of domains, subdomains included.
- Stored in `chrome.storage.local`; session values in `chrome.storage.session`. The reply is the complete current state.
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

## HTTP side (agent → relay)

- `/mcp`: streamable HTTP (MCP), stateless with JSON responses instead of server-sent events. A relay restart therefore does not break MCP sessions, and the event size limits of some clients (1 MB) do not apply. `/admin/status` and `/admin/reload` are for maintenance, `/admin/settings` for settings.
- All HTTP paths, including GET, SSE and DELETE requests to `/mcp`, require `Authorization: Bearer <TOKEN>`. `/admin/settings` requires the admin token instead.
- Requests with an `Origin` header are rejected with 403. An MCP client sends none, a browser does (protection against DNS rebinding).
- The relay listens on `HERMES_TABS_HOST` (default `127.0.0.1`), port `HERMES_TABS_PORT` (default 8766). For access over a network, terminate TLS in a reverse proxy.

## File uploads

- `file_upload(paths=…)` reads files on the relay machine, only below `HERMES_TABS_UPLOAD_ROOTS`.
- The file is opened first (`O_NONBLOCK`, so a FIFO does not block). The real path of the open descriptor (`/proc/self/fd`) is then checked, and data is read from exactly that descriptor. Only regular files are allowed.
- One shared limit of 10 MB applies to `paths` and directly passed `files` together, checked before reading. Files travel base64-encoded over the WebSocket; the extension puts them into the file input with `DataTransfer`.
- The GIF export writes files to `HERMES_TABS_GIF_DIR`. The directory must belong to the relay user and must not be writable by others. Files are created exclusively (`O_EXCL|O_NOFOLLOW`), existing files are never overwritten, and a name clash gets a `-1` suffix and so on.
- Nothing is written on the browser machine. The only exception is `gif_creator(download=true)`, which saves to the browser's download folder through `chrome.downloads`.
