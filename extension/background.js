// Hermes Tabs: connects to the relay on its own and runs its commands only in shared tabs.
// Shared = shared by the user via the toolbar icon, or opened by Hermes itself. The list lives in
// storage.local: it survives an extension reload but is discarded on browser start (tab IDs are
// only valid for one browser session).

importScripts("page.js"); // HERMES_PAGE: runs in the page via Runtime.evaluate

const DEFAULTS = { relay: "ws://127.0.0.1:8766/ext", token: "" };
const GROUP_TITLE = "Hermes";
const VERSION = chrome.runtime.getManifest().version;
const msg = (key, ...subs) => chrome.i18n.getMessage(key, subs); // texts the user sees (_locales)

let ws = null;
const attached = new Set();
const tabState = new Map(); // tabId -> { console, network, origin, dialog, onDialog }

// ---------- Shared tabs ----------

// A single in-memory copy, changed without an await in between: parallel calls cannot overwrite
// each other (e.g. write back a share that was just revoked).
// storage.local persists it across service worker restarts and extension reloads.
let sharedCache = null;

// Tabs in the "Hermes" group were opened by Hermes: they are re-adopted on load so that no orphaned
// tabs remain after an extension reload or a browser start.
async function hermesGroupTabs() {
  try {
    const ids = [];
    for (const g of await chrome.tabGroups.query({ title: GROUP_TITLE })) {
      ids.push(...(await chrome.tabs.query({ groupId: g.id })).map((t) => t.id));
    }
    return ids;
  } catch {
    return [];
  }
}

async function getShared() {
  if (!sharedCache) {
    const { shared = {} } = await chrome.storage.local.get("shared");
    for (const id of await hermesGroupTabs()) shared[id] ??= "agent";
    sharedCache ??= shared;
  }
  return sharedCache; // tabId -> "user" | "agent"
}

chrome.runtime.onStartup.addListener(() => {
  sharedCache = null; // new browser session: drop old tab IDs, re-adopt the Hermes group
  chrome.storage.local.remove("shared");
});

async function setShared(tabId, owner) {
  const shared = await getShared();
  if (owner) shared[tabId] = owner;
  else delete shared[tabId];
  await chrome.storage.local.set({ shared: { ...shared } });
  await chrome.action.setBadgeText({ tabId, text: owner ? "✓" : "" }).catch(() => {});
}

// Normal web pages only. On file:, chrome-extension:, chrome: etc. Hermes would get access to local
// files or to the extension APIs themselves (token, all tabs), which defeats every tab boundary.
const SAFE_URL = /^(https?:|data:|about:blank$)/i;
// How Chrome reports the built-in PDF viewer (an extension of its own) and pages of other extensions.
const OTHER_EXT = /chrome-extension:\/\/ URL of different extension/;
const OTHER_EXT_HINT = "The tab shows a PDF in the browser's viewer or a page of another extension – Hermes cannot " +
  "access it. Leave with navigate (\"back\" or a URL); read PDF content with Hermes' own web tools using the PDF URL.";
const unsafeUrlError = (url) =>
  new Error(`Protected page (${String(url).split(":")[0]}:) – Hermes may only operate http(s) pages`);

// "Blocked sites": domain including subdomains; Hermes may do nothing there, not even read.
const hostBlocked = (url, list) => {
  let h;
  try { h = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return list.some((d) => h === d || h.endsWith("." + d));
};
async function assertNotBlocked(...urls) {
  const { blockedSites = [] } = await chrome.storage.local.get("blockedSites");
  for (const u of urls) {
    if (u && hostBlocked(u, blockedSites)) {
      throw new Error(`${new URL(u).hostname} is on the Blocked sites list – Hermes must not use this website`);
    }
  }
}

async function assertAllowed(tabId) {
  if (!Number.isInteger(tabId) || !Object.hasOwn(await getShared(), String(tabId))) {
    throw new Error(`Tab ${tabId} is not shared with Hermes`);
  }
}

// Additionally before every debugger command: where does the tab point right now (also mid-navigation)?
async function assertSafeTab(tabId) {
  const t = await chrome.tabs.get(tabId);
  for (const url of [t.url, t.pendingUrl]) if (url && !SAFE_URL.test(url)) throw unsafeUrlError(url);
  await assertNotBlocked(t.url, t.pendingUrl);
}

chrome.action.onClicked.addListener(async (tab) => {
  if ((await getShared())[tab.id]) {
    await setShared(tab.id, null);
    if (attached.has(tab.id)) await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
  } else {
    await setShared(tab.id, "user");
  }
});

// If a Hermes tab opens a new tab (link with target=_blank, window.open), Hermes owns it too –
// otherwise Hermes would lose the thread (e.g. shop listings). Not from tabs the user shared: the user clicks there too.
const childTabs = new Map(); // parent tab -> [{ id, t }]
// From a background tab, Chromium names the window's *active* tab as opener – so also match
// the page's own Page.windowOpen report by URL.
const windowOpens = []; // { parent, url, t }
async function openedByAgent(tab) {
  if ((await getShared())[tab.openerTabId] === "agent") return tab.openerTabId;
  for (let i = 0; i < 10; i++) { // URL and report may arrive just after the tab
    const t = await chrome.tabs.get(tab.id).catch(() => null);
    if (!t) return null;
    const k = windowOpens.findIndex((o) => Date.now() - o.t < 3000 && (o.url === t.pendingUrl || o.url === t.url));
    if (k >= 0) return windowOpens.splice(k, 1)[0].parent;
    await sleep(0.1);
  }
  return null;
}
chrome.tabs.onCreated.addListener(async (tab) => {
  const parent = await openedByAgent(tab);
  if (parent == null) return;
  await setShared(tab.id, "agent");
  await withTimeout(addToGroup(tab.id), 3000, "Grouping").catch(() => {});
  childTabs.set(parent, [...(childTabs.get(parent) ?? []), { id: tab.id, t: Date.now() }].slice(-5));
});
const newChildren = (tabId, since) => (childTabs.get(tabId) ?? []).filter((c) => c.t >= since).map((c) => c.id);

chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
  setShared(tabId, null);
});

// Visual: Hermes tabs in a group of their own. If the browser does not support it, the badge remains.
async function addToGroup(tabId) {
  try {
    const [group] = await chrome.tabGroups.query({ title: GROUP_TITLE });
    if (group) {
      await chrome.tabs.group({ groupId: group.id, tabIds: tabId });
    } else {
      const groupId = await chrome.tabs.group({ tabIds: tabId });
      await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color: "purple" });
    }
  } catch {}
}

// ---------- Debugger and event buffers ----------

const MAX_BUFFER = 1000;
const state = (tabId) => {
  if (!tabState.has(tabId)) tabState.set(tabId, { console: [], network: new Map(), origin: "", dialog: null, onDialog: null });
  return tabState.get(tabId);
};
const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};
const push = (arr, item) => {
  arr.push(item);
  if (arr.length > MAX_BUFFER) arr.shift();
};

chrome.debugger.onDetach.addListener(({ tabId }) => attached.delete(tabId));

chrome.debugger.onEvent.addListener(({ tabId }, method, p) => {
  const st = state(tabId);
  switch (method) {
    case "Runtime.consoleAPICalled":
      push(st.console, {
        level: p.type, origin: st.origin,
        text: p.args.map((a) => a.value ?? a.unserializableValue ?? a.description ?? a.type).join(" "),
        source: p.stackTrace?.callFrames?.[0]?.url ?? "",
      });
      break;
    case "Runtime.exceptionThrown": {
      const d = p.exceptionDetails;
      push(st.console, { level: "exception", origin: st.origin, text: d.exception?.description ?? d.text, source: d.url ?? "" });
      break;
    }
    case "Log.entryAdded":
      push(st.console, { level: p.entry.level, origin: st.origin, text: p.entry.text, source: p.entry.url ?? "" });
      break;
    case "Network.requestWillBeSent":
      st.network.set(p.requestId, { url: p.request.url, method: p.request.method, type: p.type ?? "", status: "" });
      if (st.network.size > MAX_BUFFER) st.network.delete(st.network.keys().next().value);
      break;
    case "Network.responseReceived": {
      const r = st.network.get(p.requestId);
      if (r) Object.assign(r, { status: p.response.status, mime: p.response.mimeType, type: p.type ?? r.type });
      break;
    }
    case "Network.loadingFailed": {
      const r = st.network.get(p.requestId);
      if (r) r.status = `failed: ${p.errorText}`;
      break;
    }
    case "Runtime.bindingCalled":
      if (p.name === "__hermesTabs") onOverlayEvent(tabId, p.payload, p.executionContextId);
      break;
    case "Fetch.requestPaused": {
      // Write guard after javascript on a site without permission: read-only requests until the next document.
      const safe = ["GET", "HEAD", "OPTIONS"].includes(p.request.method);
      if (st.jsGuard && !safe) {
        st.blocked?.push(`${p.request.method} ${p.request.url.slice(0, 120)}`);
        chrome.debugger.sendCommand({ tabId }, "Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }).catch(() => {});
      } else {
        chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", { requestId: p.requestId }).catch(() => {});
      }
      break;
    }
    case "Runtime.executionContextDestroyed":
      if (p.executionContextId === st.worldCtx) st.worldCtx = null;
      break;
    case "Runtime.executionContextsCleared":
      st.worldCtx = null;
      break;
    case "Page.frameNavigated":
      if (!p.frame.parentId) {
        st.worldCtx = null;
        if (st.jsGuard) { st.jsGuard = false; send(tabId, "Fetch.disable").catch(() => {}); } // the old document's timers are gone
        const origin = originOf(p.frame.url);
        if (origin !== st.origin) st.network.clear(); // new domain, new list
        st.origin = origin;
        st.perfCutoff = undefined; // new document, new performance timeline
      }
      break;
    case "Page.javascriptDialogOpening":
      st.dialog = { type: p.type, message: p.message, defaultPrompt: p.defaultPrompt };
      st.onDialog?.();
      break;
    case "Page.javascriptDialogClosed":
      st.dialog = null;
      break;
    case "Page.windowOpen":
      getShared().then((s) => s[tabId] === "agent" && windowOpens.splice(0, windowOpens.length - 9, { parent: tabId, url: p.url, t: Date.now() }));
      break;
  }
});

const inflight = new Map(); // running debugger commands, for /admin/status
let inflightId = 0;
function send(tabId, method, params) {
  const id = ++inflightId;
  inflight.set(id, { tabId, method, since: Date.now() });
  return chrome.debugger.sendCommand({ tabId }, method, params).finally(() => inflight.delete(id));
}

const withTimeout = (promise, ms, what) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what}: no response after ${ms / 1000} s`)), ms))]);

async function attach(tabId) {
  if (attached.has(tabId)) return;
  try {
    await withTimeout(chrome.debugger.attach({ tabId }, "1.3"), 10000, "Attaching debugger");
  } catch (e) {
    if (!/already attached/i.test(e.message)) throw e;
  }
  attached.add(tabId);
  const st = state(tabId);
  st.origin ||= originOf((await chrome.tabs.get(tabId)).url);
  // Probe: a dialog that opened before attaching is never reported but blocks the page.
  // If the page does not respond, a dialog is presumed open – instead of every command running into timeouts.
  const responsive = await probe(tabId);
  if (!responsive) st.dialog ??= { type: "unknown", message: "", suspected: true };
  const setup = ["Runtime.enable", "Log.enable", "Network.enable", "Page.enable"].map((m) => withTimeout(send(tabId, m), 5000, m).catch(() => {}));
  // Background tabs otherwise count as invisible: mouse events then wait 5 s each for a frame.
  setup.push(withTimeout(send(tabId, "Emulation.setFocusEmulationEnabled", { enabled: true }), 5000, "Focus emulation").catch(() => {}));
  setup.push(withTimeout(send(tabId, "Runtime.addBinding", { name: "__hermesTabs", executionContextName: "hermes-tabs" }), 5000, "Binding").catch(() => {}));
  if (responsive) await Promise.all(setup); // don't wait on a blocked page; this completes after the dialog
}

const probe = (tabId) =>
  withTimeout(send(tabId, "Runtime.evaluate", { expression: "1" }), 1500, "Probe").then(() => true, () => false);

const DIALOG = Symbol("dialog");
const dialogError = (d) => new Error(d.suspected
  ? "The page is not responding – probably blocked by a dialog that opened before Hermes could attach. " +
    "Only the user can confirm it in the browser; for a tab Hermes opened itself, tabs_close helps."
  : `A ${d.type} dialog is open: "${d.message}". Accept or dismiss it with handle_dialog.`);

// Check, attach, check again: if the share was revoked while attaching,
// the debugger is detached again and no command is sent.
async function attachAllowed(tabId) {
  await assertAllowed(tabId);
  await assertSafeTab(tabId);
  await attach(tabId);
  if (!Object.hasOwn(await getShared(), String(tabId))) {
    await chrome.debugger.detach({ tabId }).catch(() => {});
    throw new Error(`Tab ${tabId} is no longer shared with Hermes`);
  }
}

async function cdp(tabId, method, params = {}) {
  await attachAllowed(tabId);
  await assertSafeTab(tabId);
  const st = state(tabId);
  if (st.dialog) throw dialogError(st.dialog);
  // If the page opens a dialog meanwhile, the command blocks – report it immediately.
  const opened = new Promise((resolve) => (st.onDialog = () => resolve(DIALOG)));
  const r = await Promise.race([withTimeout(send(tabId, method, params), 30000, method), opened]).catch((e) => {
    if (/navigated or closed|Cannot find context/i.test(e.message)) {
      throw new Error(`Page navigated or was closed during ${method} – result unknown, check the state`);
    }
    throw e;
  });
  if (r === DIALOG) throw dialogError(st.dialog);
  return r;
}

// HERMES_PAGE runs in an isolated world (like a content script): same DOM, but the page sees
// neither the reference table nor the helpers and cannot replace them.
async function worldContext(tabId) {
  const st = state(tabId);
  if (st.worldCtx) return st.worldCtx;
  const { frameTree } = await cdp(tabId, "Page.getFrameTree");
  const { executionContextId } = await cdp(tabId, "Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: "hermes-tabs" });
  return (st.worldCtx = executionContextId);
}

const SAFE_OPS = new Set(["read", "find", "center", "viewport", "focusInfo", "overlay", "scrollPos", "pageText"]);
async function page(tabId, op, arg = {}) {
  const expression = `(${HERMES_PAGE})(${JSON.stringify(op)}, ${JSON.stringify(arg)})`;
  for (let attempt = 0; ; attempt++) {
    const contextId = await worldContext(tabId);
    let r;
    try {
      r = await cdp(tabId, "Runtime.evaluate", { expression, contextId, returnByValue: true, awaitPromise: true });
    } catch (e) {
      // Page reloaded or is rebuilding: retry read-only operations once (never writes – result unknown).
      if (attempt === 0 && /context|navigated/i.test(e.message) && SAFE_OPS.has(op)) {
        state(tabId).worldCtx = null;
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      throw e;
    }
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] ?? r.exceptionDetails.text);
    return r.result.value;
  }
}

async function waitForLoad(tabId, ms = 20000) {
  await new Promise((r) => setTimeout(r, 300));
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const d = tabState.get(tabId)?.dialog; // e.g. beforeunload: the navigation waits for an answer
    if (d) throw dialogError(d);
    if ((await chrome.tabs.get(tabId)).status === "complete") return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

function normalizeUrl(url) {
  const full = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  if (!SAFE_URL.test(full)) throw unsafeUrlError(full);
  return full;
}

// Some apps (e.g. Discord) report "loaded" only after 20 s or more: Hermes should know that not everything is there yet.
const loadNote = async (info, tabId) =>
  (await chrome.tabs.get(tabId)).status === "complete" ? info : { ...info, loading: "Page still loading – read_page/screenshot show the current state, wait briefly if needed" };

const tabInfo = async (tabId) => {
  const t = await chrome.tabs.get(tabId);
  return { tabId: t.id, title: t.title, url: t.url };
};

// ---------- Mouse, keyboard, image ----------

const MODIFIERS = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, win: 4, windows: 4, super: 4, shift: 8 };
const modMask = (s) => (s ? s.split("+").reduce((m, p) => m | (MODIFIERS[p.trim().toLowerCase()] ?? 0), 0) : 0);

const mouse = (tabId, type, x, y, extra = {}) => cdp(tabId, "Input.dispatchMouseEvent", { type, x, y, ...extra });

async function click(tabId, x, y, { button = "left", count = 1, modifiers = 0 } = {}) {
  await mouse(tabId, "mouseMoved", x, y, { modifiers });
  for (let i = 1; i <= count; i++) {
    await mouse(tabId, "mousePressed", x, y, { button, clickCount: i, modifiers, buttons: button === "right" ? 2 : 1 });
    await mouse(tabId, "mouseReleased", x, y, { button, clickCount: i, modifiers });
  }
}

async function drag(tabId, [x0, y0], [x1, y1]) {
  // Intercept native HTML5 drag & drop and deliver it ourselves; otherwise mouse events suffice (sliders, canvas).
  const st = state(tabId);
  let dragData = null;
  st.onDrag = (data) => (dragData = data);
  await cdp(tabId, "Input.setInterceptDrags", { enabled: true });
  try {
    await mouse(tabId, "mouseMoved", x0, y0);
    await mouse(tabId, "mousePressed", x0, y0, { button: "left", clickCount: 1, buttons: 1 });
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await mouse(tabId, "mouseMoved", x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, { button: "left", buttons: 1 });
      if (dragData) break;
    }
    if (dragData) {
      for (const type of ["dragEnter", "dragOver", "drop"]) {
        await cdp(tabId, "Input.dispatchDragEvent", { type, x: x1, y: y1, data: dragData });
      }
    }
    await mouse(tabId, "mouseReleased", x1, y1, { button: "left", clickCount: 1 });
  } finally {
    st.onDrag = null;
    await cdp(tabId, "Input.setInterceptDrags", { enabled: false }).catch(() => {});
  }
  return dragData ? "dragged (HTML5 drag & drop)" : "dragged";
}
chrome.debugger.onEvent.addListener(({ tabId }, method, p) => {
  if (method === "Input.dragIntercepted") tabState.get(tabId)?.onDrag?.(p.data);
});

const KEYS = {
  enter: ["Enter", 13, "\r"], return: ["Enter", 13, "\r"], tab: ["Tab", 9], escape: ["Escape", 27], esc: ["Escape", 27],
  backspace: ["Backspace", 8], delete: ["Delete", 46], space: [" ", 32, " "], insert: ["Insert", 45],
  arrowup: ["ArrowUp", 38], up: ["ArrowUp", 38], arrowdown: ["ArrowDown", 40], down: ["ArrowDown", 40],
  arrowleft: ["ArrowLeft", 37], left: ["ArrowLeft", 37], arrowright: ["ArrowRight", 39], right: ["ArrowRight", 39],
  pageup: ["PageUp", 33], page_up: ["PageUp", 33], pagedown: ["PageDown", 34], page_down: ["PageDown", 34],
  home: ["Home", 36], end: ["End", 35],
};
for (let i = 1; i <= 12; i++) KEYS[`f${i}`] = [`F${i}`, 111 + i];
const CODES = { Enter: "Enter", Tab: "Tab", Escape: "Escape", Backspace: "Backspace", Delete: "Delete", " ": "Space" };
const EDIT_COMMANDS = { a: "selectAll", c: "copy", x: "cut", v: "paste", z: "undo", y: "redo" };

async function pressKey(tabId, combo) {
  const parts = combo.split("+");
  const raw = parts.pop() || "+";
  const modifiers = modMask(parts.join("+"));
  let [key, keyCode, text] = KEYS[raw.toLowerCase()] ?? [raw, raw.toUpperCase().charCodeAt(0), raw];
  if (raw.length === 1 && modifiers & 8) text = key = raw.toUpperCase();
  if (modifiers & 7) text = undefined; // no text input with Ctrl/Alt/Meta
  const code = CODES[key] ?? (/^[a-z]$/i.test(raw) ? `Key${raw.toUpperCase()}` : /^\d$/.test(raw) ? `Digit${raw}` : key);
  const base = { modifiers, windowsVirtualKeyCode: keyCode, key, code };
  const commands = modifiers & 6 && EDIT_COMMANDS[raw.toLowerCase()] ? [EDIT_COMMANDS[raw.toLowerCase()]] : undefined;
  await cdp(tabId, "Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", text, commands, ...base });
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

// Image in CSS pixels: screenshot coordinates map directly to clicks, even with display scaling.
async function capture(tabId, { region, scale = 1 } = {}) {
  await assertAllowed(tabId);
  const tab = await chrome.tabs.get(tabId);
  let back = null;
  if (!tab.active) {
    // Background tabs are not rendered, and no CDP call makes them paint: raise briefly, then give the user's tab back.
    [back] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    await chrome.tabs.update(tabId, { active: true });
    await new Promise((r) => setTimeout(r, 150));
  }
  await show(tabId, { hidden: true }); // Hermes should see the real page, not frame and pointer
  try {
    return await captureInner(tabId, { region, scale });
  } finally {
    // First give the user's tab back (only if they did not switch meanwhile): the overlay call can hang on a stuck page.
    if (back && (await chrome.tabs.get(tabId).catch(() => ({}))).active) await chrome.tabs.update(back.id, { active: true }).catch(() => {});
    await show(tabId, { hidden: false });
  }
}

async function captureInner(tabId, { region, scale = 1 }) {
  const { w, h, dpr } = await page(tabId, "viewport");
  const { cssVisualViewport: vv } = await cdp(tabId, "Page.getLayoutMetrics");
  let [x0, y0, x1, y1] = region ?? [0, 0, w, h];
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1);
  if (x1 <= x0 || y1 <= y0) throw new Error("Empty image region");
  // Zoom enlarges the region (up to 4x) so details become readable.
  const zoom = region ? Math.min(4, Math.max(1, 1200 / (x1 - x0))) : 1;
  const factor = (zoom * Math.min(1, Math.max(0.1, scale))) / dpr;
  // A fully covered or minimized window does not render on Windows – then there is no image.
  // Give up after 6 s instead of hanging 30 s; bringing the window to front would steal the user's focus.
  const { data } = await withTimeout(cdp(tabId, "Page.captureScreenshot", {
    format: "jpeg", quality: 80,
    clip: { x: vv.pageX + x0, y: vv.pageY + y0, width: x1 - x0, height: y1 - y0, scale: factor },
  }), 6000, "No image").catch((e) => {
    if (!String(e.message).startsWith("No image")) throw e;
    throw new Error("No image: this tab's browser window is covered or minimized and is not rendering right now. " +
      "read_page, find, get_page_text and clicks by ref keep working; screenshots need the window to be visible.");
  });
  if (data.length > 900000 && scale > 0.3) return captureInner(tabId, { region, scale: scale * 0.6 }); // transport limit ~1 MB
  return { data, width: Math.round((x1 - x0) * factor * dpr), height: Math.round((y1 - y0) * factor * dpr), viewport: [w, h] };
}

async function point(tabId, { ref, coordinate }) {
  if (ref != null) {
    const { x, y, covered, editable } = await page(tabId, "center", { ref });
    return Object.assign([x, y], { covered, editable });
  }
  if (!Array.isArray(coordinate) || coordinate.length !== 2 || !coordinate.every(Number.isFinite)) {
    throw new Error("Provide coordinate [x, y] or ref");
  }
  const { w, h } = await page(tabId, "viewport");
  const [x, y] = coordinate;
  if (x < 0 || y < 0 || x >= w || y >= h) throw new Error(`Coordinate (${x}, ${y}) is outside the viewport ${w}x${h}`);
  return coordinate;
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const OPAQUE_REFUSAL = "Focus is inside a cross-origin iframe (often login or payment) – Hermes does not type there, the user does that";
const PASSWORD_REFUSAL = "The focused field is a password field – Hermes does not enter credentials, the user does that";

async function computer(p) {
  const { tabId, action } = p;
  await assertAllowed(tabId); // also for wait: no success report for foreign or closed tabs
  switch (action) {
    case "left_click":
    case "right_click":
    case "double_click":
    case "triple_click": {
      const pt = await point(tabId, p);
      const [x, y] = pt;
      const count = { double_click: 2, triple_click: 3 }[action] ?? 1;
      await show(tabId, { active: true, x, y, label: p.summary || ACTION_LABELS[action], passthrough: true });
      await sleep(0.3); // let the pointer glide visibly
      const since = Date.now();
      try {
        await click(tabId, x, y, { button: action === "right_click" ? "right" : "left", count, modifiers: modMask(p.modifiers) });
      } finally {
        await show(tabId, { x, y, ripple: true, passthrough: false });
      }
      await sleep(0.4);
      const opened = newChildren(tabId, since);
      let note = opened.length ? ` – opened new tab ${opened.join(", ")} (owned by Hermes, continue there)` : "";
      // Feedback when the click missed its target – otherwise Hermes would type into nothing afterwards.
      if (pt.covered) note += ` – warning: the target was covered, the click hit ${pt.covered}`;
      if (pt.editable && action === "left_click" && !(await page(tabId, "focusInfo").catch(() => ({ editable: true }))).editable) {
        note += " – the field did not get focus (it may only open a search or menu first: run find/read_page again)";
      }
      return { text: `${action} at (${x}, ${y})${note}`, at: [x, y], opened };
    }
    case "hover": {
      const [x, y] = await point(tabId, p);
      await show(tabId, { active: true, x, y, label: p.summary || ACTION_LABELS.hover, passthrough: true });
      await mouse(tabId, "mouseMoved", x, y);
      await show(tabId, { passthrough: false });
      return { text: `mouse at (${x}, ${y})`, at: [x, y] };
    }
    case "left_click_drag": {
      if (!p.start_coordinate || !p.coordinate) throw new Error("Provide start_coordinate and coordinate");
      const [sx, sy] = p.start_coordinate, [ex, ey] = p.coordinate;
      await show(tabId, { active: true, x: sx, y: sy, label: p.summary || ACTION_LABELS.left_click_drag, passthrough: true });
      await sleep(0.3);
      try {
        return { text: await drag(tabId, p.start_coordinate, p.coordinate), from: p.start_coordinate, at: p.coordinate };
      } finally {
        await show(tabId, { x: ex, y: ey, ripple: true, passthrough: false });
      }
    }
    case "type": {
      const focus = await page(tabId, "focusInfo");
      if (focus.password) throw new Error(PASSWORD_REFUSAL);
      if (focus.opaque) throw new Error(OPAQUE_REFUSAL);
      // Without a focused input the text would go nowhere – Hermes should learn that instead of reading "typed".
      if (!focus.editable) {
        throw new Error(`No input field has focus (active: ${focus.tag ?? "nothing"}) – nothing typed. Click into the field first; ` +
          "if the click only opens a search/menu, run find/read_page again and click the new field.");
      }
      await show(tabId, { active: true, label: p.summary || `${ACTION_LABELS.type}: ${String(p.text ?? "").slice(0, 40)}` });
      await cdp(tabId, "Input.insertText", { text: p.text ?? "" });
      return { text: "typed" };
    }
    case "key": {
      const keys = (p.text ?? "").trim().split(/\s+/).filter(Boolean);
      if (!keys.length) throw new Error("Provide text with keys, e.g. \"Enter\" or \"ctrl+a\"");
      const repeat = Math.max(1, Math.min(100, Math.floor(p.repeat ?? 1)));
      // In a password field only leaving the field is allowed – otherwise e.g. ctrl+v (clipboard) or Enter (submit a saved password).
      if (keys.some((k) => !/^(shift\+)?tab$|^escape$/i.test(k))) {
        const focus = await page(tabId, "focusInfo");
        if (focus.password) throw new Error(PASSWORD_REFUSAL);
        if (focus.opaque && keys.some((k) => k.length === 1 || /^ctrl\+v$/i.test(k))) throw new Error(OPAQUE_REFUSAL);
      }
      await show(tabId, { active: true, label: p.summary || `${ACTION_LABELS.key}: ${p.text}` });
      for (let i = 0; i < repeat; i++) for (const k of keys) await pressKey(tabId, k);
      return { text: `keys: ${p.text}${repeat > 1 ? ` ×${repeat}` : ""}${p.repeat > 100 ? " (capped at 100)" : ""}` };
    }
    case "scroll": {
      const vp = await page(tabId, "viewport");
      const [x, y] = p.coordinate ?? (p.ref != null ? await point(tabId, p) : [vp.w / 2, vp.h / 2]);
      const step = 100 * (p.scroll_amount ?? 3);
      const [deltaX, deltaY] = { up: [0, -step], down: [0, step], left: [-step, 0], right: [step, 0] }[p.scroll_direction ?? "down"];
      await show(tabId, { active: true, x, y, label: p.summary || `${ACTION_LABELS.scroll} ${p.scroll_direction ?? "down"}`, passthrough: true });
      const where = { x, y, dx: deltaX, dy: deltaY };
      const before = JSON.stringify(await page(tabId, "scrollPos", where).catch(() => null));
      await mouse(tabId, "mouseWheel", x, y, { deltaX, deltaY });
      await show(tabId, { passthrough: false });
      // The wheel often scrolls animated: wait up to 1 s for movement, otherwise the fallback would scroll twice.
      let moved = before === "null";
      for (let i = 0; i < 10 && !moved; i++) {
        await sleep(0.1);
        moved = JSON.stringify(await page(tabId, "scrollPos", where).catch(() => null)) !== before;
      }
      if (moved) await sleep(0.3); // let the animation finish
      let how = "";
      if (!moved) {
        const after = JSON.stringify(await page(tabId, "scrollBy", where).catch(() => null));
        how = after === before ? " (area does not move – end reached?)" : " (via script, mouse wheel had no effect)";
      }
      return { text: `scrolled ${p.scroll_direction ?? "down"} at (${Math.round(x)}, ${Math.round(y)})${how}` };
    }
    case "scroll_to":
      if (p.ref == null) throw new Error("Provide ref");
      return { text: await page(tabId, "scrollTo", { ref: p.ref }) };
    case "wait": {
      const s = Math.min(10, Math.max(0, Number(p.duration) || 0));
      await sleep(s);
      return { text: `waited ${s} s${p.duration > 10 ? " (capped at 10 s)" : ""}` };
    }
    case "screenshot":
      return { image: await capture(tabId, { scale: p.scale }) };
    case "zoom":
      if (!p.region) throw new Error("Provide region [x0, y0, x1, y1]");
      return { image: await capture(tabId, { region: p.region, scale: p.scale }) };
    default:
      throw new Error(`Unknown action ${action}`);
  }
}

// ---------- Visibility, stop and site permissions ----------

// Overlay in the page (frame, pointer, label, stop, permission prompt). Must never make a command fail.
// The isolated world has no chrome.i18n, so the localized overlay texts travel along.
const OVERLAY_TEXT = Object.fromEntries(["overlayBar", "overlayStop", "askDeny", "askOnce", "askSession", "askAlways", "askAll1h"].map((k) => [k, msg(k)]));
const show = (tabId, o) => page(tabId, "overlay", { ...o, t: OVERLAY_TEXT }).catch(() => {});

const labels = (prefix, keys) => Object.fromEntries(keys.map((k) => [k, msg(prefix + k)]));
const LABELS = labels("label_", ["read_page", "get_page_text", "find", "javascript", "form_input", "file_upload", "navigate",
  "read_console_messages", "read_network_requests", "handle_dialog"]);
const ACTION_LABELS = labels("action_", ["left_click", "right_click", "double_click", "triple_click", "hover",
  "left_click_drag", "type", "key", "scroll", "scroll_to"]);

// Actions that can change something need the user's permission for the website (reading does not).
const ACTING = new Set(["left_click", "right_click", "double_click", "triple_click", "left_click_drag", "type", "key"]);
const isActing = (method, p) =>
  method === "computer" ? ACTING.has(p.action)
    : ["form_input", "file_upload", "drop_files"].includes(method) || (method === "handle_dialog" && !!p.accept);

const pendingAsks = new Map(); // tabId -> { origin, promise, notifId, resolve }
const onceAllowed = new Map(); // tabId -> origin ("once" holds until the tab changes website)

// May Hermes act on the tab's current website without asking?
// Permission levels: once (tab+site) · site for this session · site always ·
// all sites for a limited time (allowAllUntil) · all sites until browser restart · all sites always (siteMode "all").
// "Session" lives in storage.session and expires on browser restart (and on extension reload).
async function permissions() {
  const local = await chrome.storage.local.get(["enabled", "siteMode", "allowedSites", "allowAllUntil", "blockedSites"]);
  const session = await chrome.storage.session.get(["sessionSites", "allowAllSession"]);
  return { enabled: true, siteMode: "ask", allowedSites: {}, allowAllUntil: 0, blockedSites: [], sessionSites: {}, allowAllSession: false, ...local, ...session };
}

async function siteAllowed(tabId) {
  if ((await getShared())[tabId] === "user") return true; // tab shared by the user = explicit consent
  const { siteMode, allowedSites, allowAllUntil, sessionSites, allowAllSession } = await permissions();
  if (siteMode === "all" || allowAllSession || allowAllUntil > Date.now()) return true;
  const t = await chrome.tabs.get(tabId);
  // During a navigation the target (pendingUrl) counts too, otherwise a click lands on a site without permission.
  return [t.url, t.pendingUrl].filter((u) => u && /^https?:/i.test(u)).every((u) => {
    const { origin } = new URL(u);
    return !!allowedSites[origin] || !!sessionSites[origin] || onceAllowed.get(tabId) === origin;
  });
}

const HOUR = 3600e3;
async function applyDecision(decision, tabId, origin) {
  const add = async (area, key) => {
    const now = (await chrome.storage[area].get(key))[key] ?? {};
    await chrome.storage[area].set({ [key]: { ...now, [origin]: true } });
  };
  switch (decision) {
    case "once": onceAllowed.set(tabId, origin); return true;
    case "session": await add("session", "sessionSites"); return true;
    case "always": await add("local", "allowedSites"); return true;
    case "all1h": await chrome.storage.local.set({ allowAllUntil: Date.now() + HOUR }); return true;
    case "all8h": await chrome.storage.local.set({ allowAllUntil: Date.now() + 8 * HOUR }); return true;
    case "allSession": await chrome.storage.session.set({ allowAllSession: true }); return true;
    default: return false;
  }
}

async function assertSiteAllowed(tabId, summary) {
  await assertAllowed(tabId);
  if (await siteAllowed(tabId)) return;
  const { permTimeoutMs = 50000 } = await chrome.storage.local.get("permTimeoutMs");
  const t = await chrome.tabs.get(tabId);
  const { origin, host } = new URL(t.pendingUrl || t.url);
  const decision = await askPermission(tabId, origin, host, summary, permTimeoutMs);
  if (await applyDecision(decision, tabId, origin)) return;
  if (decision === "deny") throw new Error(`The user declined actions on ${host} – do not retry`);
  else throw new Error(`No permission for actions on ${host}: the user did not respond. Do not retry; ask the user instead.`);
}

function askPermission(tabId, origin, host, summary, timeoutMs) {
  const prev = pendingAsks.get(tabId);
  if (prev && prev.origin === origin) return prev.promise;
  const notifId = `hermes-perm-${tabId}-${Date.now()}`;
  let done;
  const entry = { origin, notifId, promise: new Promise((r) => (done = r)) };
  const timer = setTimeout(() => entry.resolve("timeout"), timeoutMs);
  entry.resolve = (decision) => {
    if (pendingAsks.get(tabId) !== entry) return;
    pendingAsks.delete(tabId);
    clearTimeout(timer);
    chrome.notifications.clear(notifId).catch?.(() => {});
    show(tabId, { ask: false });
    done(decision);
  };
  pendingAsks.set(tabId, entry);
  const text = msg("askText", host) + (summary ? `: ${summary}` : "");
  show(tabId, { active: true, ask: text });
  try {
    chrome.notifications.create(notifId, {
      type: "basic", iconUrl: "icon128.png", title: msg("notifTitle"), message: text, requireInteraction: true,
      buttons: [{ title: msg("notifSession") }, { title: msg("notifAll1h") }],
    }, () => void chrome.runtime.lastError);
  } catch {}
  return entry.promise;
}

chrome.notifications.onButtonClicked.addListener((id, index) => {
  for (const e of pendingAsks.values()) if (e.notifId === id) e.resolve(index === 0 ? "session" : "all1h");
});
chrome.notifications.onClosed.addListener((id, byUser) => {
  if (byUser) for (const e of pendingAsks.values()) if (e.notifId === id) e.resolve("deny");
});

// Stop in the tab: revoke the share, remove the tab from the Hermes group (else it would be re-adopted), detach the debugger.
async function stopTab(tabId) {
  pendingAsks.get(tabId)?.resolve("deny");
  await show(tabId, { remove: true });
  await setShared(tabId, null);
  await chrome.tabs.ungroup(tabId).catch(() => {});
  onceAllowed.delete(tabId);
  if (attached.has(tabId)) await chrome.debugger.detach({ tabId }).catch(() => {});
}

// Answers from the overlay arrive via the debugger binding, which exists only in the isolated world.
function onOverlayEvent(tabId, payload, contextId) {
  if (contextId !== tabState.get(tabId)?.worldCtx) return;
  let ev;
  try { ev = JSON.parse(payload); } catch { return; }
  if (ev.type === "stop") stopTab(tabId);
  if (ev.type === "permission") pendingAsks.get(tabId)?.resolve(ev.decision);
}

// ---------- Commands ----------

const handlers = {
  // Only from the relay via /admin/settings (separate admin token), not an MCP tool: Hermes cannot grant itself rights.
  async settings({ enabled, siteMode, allowAll, sites, blockedSites }) {
    if (enabled !== undefined) await chrome.storage.local.set({ enabled: !!enabled });
    if (blockedSites !== undefined) {
      if (!Array.isArray(blockedSites)) throw new Error("blockedSites: list of domains");
      const clean = [...new Set(blockedSites.map((d) => String(d).trim().toLowerCase()
        .replace(/^[a-z]+:\/\//, "").replace(/^\*\./, "").split(/[/:?#]/)[0]).filter(Boolean))];
      const bad = clean.find((d) => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d));
      if (bad) throw new Error(`Invalid domain ${bad} (e.g. example.com)`);
      await chrome.storage.local.set({ blockedSites: clean.sort() });
    }
    if (siteMode !== undefined) {
      if (!["ask", "all"].includes(siteMode)) throw new Error("siteMode: ask or all");
      await chrome.storage.local.set({ siteMode });
    }
    if (allowAll !== undefined) {
      const h = { "1h": 1, "8h": 8 }[allowAll];
      if (h) await chrome.storage.local.set({ allowAllUntil: Date.now() + h * HOUR });
      else if (allowAll === "session") await chrome.storage.session.set({ allowAllSession: true });
      else if (allowAll === "off") { await chrome.storage.local.set({ allowAllUntil: 0 }); await chrome.storage.session.set({ allowAllSession: false }); }
      else throw new Error("allowAll: 1h, 8h, session or off");
    }
    for (const [origin, level] of Object.entries(sites ?? {})) {
      if (!/^https?:\/\/[^/]+$/.test(origin)) throw new Error(`Invalid website ${origin} (e.g. https://example.com)`);
      const { allowedSites = {} } = await chrome.storage.local.get("allowedSites");
      const { sessionSites = {} } = await chrome.storage.session.get("sessionSites");
      delete allowedSites[origin]; delete sessionSites[origin];
      if (level === "always") allowedSites[origin] = true;
      else if (level === "session") sessionSites[origin] = true;
      else if (level !== null && level !== "off") throw new Error("Level: always, session or off");
      await chrome.storage.local.set({ allowedSites });
      await chrome.storage.session.set({ sessionSites });
    }
    const p = await permissions();
    return { ...p, allowAllUntil: p.allowAllUntil > Date.now() ? new Date(p.allowAllUntil).toISOString() : null };
  },

  status: async () => ({
    version: VERSION, shared: await getShared(), attached: [...attached],
    inflight: [...inflight.values()].map((c) => ({ ...c, age_s: Math.round((Date.now() - c.since) / 1000) })),
  }),

  reload() {
    setTimeout(() => chrome.runtime.reload(), 200); // reloads the files from disk
    return "reloading";
  },

  async tabs_context({ createIfEmpty }) {
    const shared = await getShared();
    if (createIfEmpty && !Object.values(shared).includes("agent")) await handlers.tabs_create({});
    const out = [];
    for (const [id, owner] of Object.entries(await getShared())) {
      try {
        const t = await chrome.tabs.get(+id);
        const w = await chrome.windows.get(t.windowId);
        out.push({ tabId: t.id, title: t.title, url: t.url, owner, active: t.active, windowId: t.windowId, window: w.state });
      } catch {
        await setShared(+id, null);
      }
    }
    return out;
  },

  async tabs_create({ url }) {
    // Directly with the target URL: in some Chromium browsers the debugger cannot take over an empty background tab.
    const target = url ? normalizeUrl(url) : "about:blank";
    await assertNotBlocked(target);
    const tab = await chrome.tabs.create({ url: target, active: false });
    await setShared(tab.id, "agent");
    await withTimeout(addToGroup(tab.id), 3000, "Grouping").catch(() => {});
    // Attach the debugger only after loading (on the first command): if it attaches earlier, some browsers
    // do not start the navigation of a background tab. Console/network are recorded from then on.
    if (url) await waitForLoad(tab.id);
    return loadNote(await tabInfo(tab.id), tab.id);
  },

  async tabs_close({ tabId }) {
    const shared = await getShared();
    const owner = Number.isInteger(tabId) && Object.hasOwn(shared, String(tabId)) ? shared[tabId] : undefined;
    if (owner !== "agent") throw new Error("Only tabs opened by Hermes itself may be closed");
    // A beforeunload handler would block closing forever. Hermes explicitly wants to close its own tab,
    // so confirm the dialog while doing so.
    const st = state(tabId);
    const confirm = () => attached.has(tabId) &&
      chrome.debugger.sendCommand({ tabId }, "Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    if (st.dialog) await confirm();
    st.onDialog = confirm;
    await withTimeout(chrome.tabs.remove(tabId), 10000, "Closing tab");
    return "closed";
  },

  async navigate({ tabId, url }) {
    await assertAllowed(tabId);
    // Hermes may always leave a protected page – just without debugger access to it.
    let safeNow = await assertSafeTab(tabId).then(() => true, () => false);
    // Browser PDF viewer (or another extension's page): no debugger possible, but Hermes may leave.
    let viewer = false;
    if (safeNow) await attachAllowed(tabId).catch((e) => { if (!OTHER_EXT.test(e.message)) throw e; viewer = true; });
    if (url === "back" || url === "forward") {
      if (viewer) {
        await (url === "back" ? chrome.tabs.goBack(tabId) : chrome.tabs.goForward(tabId));
        await waitForLoad(tabId);
        return loadNote(await tabInfo(tabId), tabId);
      }
      if (!safeNow) throw new Error("Leave a protected page only via navigate with an http(s) URL");
      // Via the debugger instead of chrome.tabs.goBack: that one skips entries without user interaction.
      const { currentIndex, entries } = await cdp(tabId, "Page.getNavigationHistory");
      const entry = entries[currentIndex + (url === "back" ? -1 : 1)];
      if (!entry) throw new Error(url === "back" ? "No previous entry in history" : "No next entry in history");
      if (!SAFE_URL.test(entry.url)) throw unsafeUrlError(entry.url);
      await cdp(tabId, "Page.navigateToHistoryEntry", { entryId: entry.id });
    } else {
      const target = normalizeUrl(url);
      await assertNotBlocked(target);
      // A dialog from before attaching also blocks navigation (verified in practice) – report immediately.
      if (state(tabId).dialog?.suspected) throw dialogError(state(tabId).dialog);
      await chrome.tabs.update(tabId, { url: target });
    }
    await waitForLoad(tabId);
    if (safeNow && !viewer && !(await probe(tabId))) state(tabId).dialog ??= { type: "unknown", message: "", suspected: true };
    return loadNote(await tabInfo(tabId), tabId);
  },

  read_page: ({ tabId, filter, ref_id, depth, max_chars }) =>
    page(tabId, "read", { filter, refId: ref_id, depth: depth ?? 15, maxChars: max_chars ?? 50000 }),
  find: ({ tabId, query }) => page(tabId, "find", { query }),
  form_input: ({ tabId, ref, value }) => page(tabId, "formInput", { ref, value }),
  get_page_text: ({ tabId, max_chars }) => page(tabId, "pageText", { maxChars: max_chars ?? 50000 }),
  file_upload: ({ tabId, ref, files }) => page(tabId, "upload", { ref, files }),
  drop_files: ({ tabId, coordinate, files }) => page(tabId, "drop", { x: coordinate[0], y: coordinate[1], files }),

  computer,

  // On sites without permission scripts may read but not change anything: from the call until the next document
  // the debugger blocks all requests except GET/HEAD/OPTIONS (including ones deferred via setTimeout).
  // Ordering, bidding, submitting then only works via visible clicks with the user's permission.
  // Guard rail, not a sandbox – the tab debugger does not see WebSocket messages or service worker requests.
  async javascript({ tabId, text }) {
    const st = state(tabId);
    if (!st.jsGuard && !(await siteAllowed(tabId))) {
      await cdp(tabId, "Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
      st.jsGuard = true;
    }
    st.blocked = [];
    // Without a user gesture the browser blocks popups – otherwise the script could send from a new window the tab debugger does not see.
    const r = await cdp(tabId, "Runtime.evaluate", { expression: text, replMode: true, awaitPromise: true, returnByValue: true, userGesture: !st.jsGuard });
    const note = st.blocked.length
      ? `\n(Write guard: ${st.blocked.length} modifying request(s) blocked, e.g. ${st.blocked[0]}. This website has ` +
        "no permission for actions – make changes only via computer/form_input, then the extension asks the user.)"
      : "";
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description ?? r.exceptionDetails.text) + note);
    const v = r.result;
    if (v.type === "undefined") return "undefined" + note;
    if ("value" in v) return (typeof v.value === "string" ? v.value : JSON.stringify(v.value, null, 1)) + note;
    return (v.description ?? v.type) + note;
  },

  async read_console_messages({ tabId, pattern, onlyErrors, clear, limit }) {
    await assertAllowed(tabId);
    await attach(tabId);
    const st = state(tabId);
    const re = pattern ? new RegExp(pattern, "i") : null;
    let msgs = st.console.filter((m) => m.origin === st.origin);
    if (onlyErrors) msgs = msgs.filter((m) => ["error", "exception", "assert"].includes(m.level));
    if (re) msgs = msgs.filter((m) => re.test(m.text));
    if (clear) st.console = [];
    return msgs.slice(-(limit ?? 100)).map((m) => `[${m.level}] ${m.text}${m.source ? `  (${m.source})` : ""}`).join("\n") || "no messages";
  },

  async read_network_requests({ tabId, urlPattern, clear, limit }) {
    await assertAllowed(tabId);
    await attach(tabId);
    const st = state(tabId);
    const redact = (u) => u.replace(/([?&](?:[^=&]*(?:token|key|auth|pass|secret|sig|session|code)[^=&]*)=)[^&#]*/gi, "$1REDACTED");
    let reqs = [...st.network.values()];
    // Requests from before the debugger attached (initial page load) come from the page's Performance API.
    const seen = new Set(reqs.map((r) => r.url));
    const { early = [], now = 0 } = await cdp(tabId, "Runtime.evaluate", {
      returnByValue: true,
      expression: `({ now: performance.now(), early: performance.getEntriesByType("navigation")
        .concat(performance.getEntriesByType("resource"))
        .map((e) => ({ url: e.name, type: e.initiatorType, status: e.responseStatus || "", t: e.startTime })) })`,
    }).then((r) => r.result.value ?? {}, () => ({}));
    // After clear only entries that started later (holds until the next navigation).
    const cutoff = st.perfCutoff ?? -1;
    reqs = early.filter((e) => e.t > cutoff && !seen.has(e.url)).map(({ t, ...e }) => ({ method: "GET?", ...e })).concat(reqs);
    if (clear) st.perfCutoff = now;
    reqs = reqs.map((r) => ({ ...r, url: redact(r.url) }));
    if (urlPattern) reqs = reqs.filter((r) => r.url.includes(urlPattern));
    if (clear) st.network.clear();
    return reqs.slice(-(limit ?? 100)).map((r) => `${r.method} ${r.status || "…"} ${r.type} ${r.url}`).join("\n") || "no requests";
  },

  async resize_window({ tabId, width, height }) {
    await assertAllowed(tabId);
    const { windowId } = await chrome.tabs.get(tabId);
    // Chrome rejects windows larger than the screen: clamp to the available area.
    const r = await cdp(tabId, "Runtime.evaluate", { expression: "[screen.availWidth, screen.availHeight]", returnByValue: true });
    const [sw, sh] = r.result.value;
    const w = Math.round(Math.min(width, sw)), h = Math.round(Math.min(height, sh));
    await chrome.windows.update(windowId, { state: "normal", width: w, height: h });
    return w === Math.round(width) && h === Math.round(height) ? `window ${w}x${h}` : `window ${w}x${h} (screen is only ${sw}x${sh})`;
  },

  async handle_dialog({ tabId, accept, promptText }) {
    await assertAllowed(tabId);
    await attach(tabId); // also detects dialogs that opened before attaching
    const st = state(tabId);
    const d = st.dialog;
    try {
      // Try even without a reported dialog: Chrome answers any open one, otherwise "No dialog is showing".
      await withTimeout(chrome.debugger.sendCommand({ tabId }, "Page.handleJavaScriptDialog", { accept: !!accept, promptText }), 5000, "handle_dialog");
    } catch (e) {
      if (!/no dialog/i.test(e.message)) throw e;
      // Dialogs that opened before attaching belong to the browser UI; the debugger cannot reach them.
      const responsive = await probe(tabId);
      st.dialog = responsive ? null : st.dialog;
      if (responsive) return "no dialog open";
      throw new Error("A dialog that opened before Hermes could attach can only be answered in the browser itself " +
        "(ask the user). For a tab Hermes opened itself, tabs_close helps; navigate works only after the dialog.");
    }
    st.dialog = null;
    return d && !d.suspected ? `${d.type} dialog "${d.message}" ${accept ? "accepted" : "dismissed"}` : `dialog ${accept ? "accepted" : "dismissed"}`;
  },

  async download({ tabId, dataUrl, filename }) {
    await assertAllowed(tabId);
    await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
    return `downloaded: ${filename}`;
  },
};

// ---------- Connection to the relay ----------

let connecting = false;

async function connect() {
  if (ws || connecting) return;
  connecting = true;
  const { relay, token } = await chrome.storage.local.get(DEFAULTS).finally(() => (connecting = false));
  if (!token) return setState(false);
  const sock = new WebSocket(`${relay}?token=${encodeURIComponent(token)}`);
  ws = sock;
  sock.onopen = () => setState(true);
  sock.onclose = () => {
    if (ws === sock) ws = null;
    setState(false);
    setTimeout(connect, 3000);
  };
  sock.onmessage = async (e) => {
    const { id, method, params } = JSON.parse(e.data);
    let reply;
    try {
      if (!handlers[method]) throw new Error(`Unknown command ${method} (extension ${VERSION})`);
      if (!["status", "settings", "reload"].includes(method) && (await chrome.storage.local.get("enabled")).enabled === false) {
        throw new Error("Hermes in the browser is turned off – the user can turn it on in the extension options or the Hermes plugin settings");
      }
      const p = params ?? {};
      if (p.tabId != null && isActing(method, p)) await assertSiteAllowed(p.tabId, p.summary);
      if (p.tabId != null && LABELS[method]) await show(p.tabId, { active: true, label: p.summary || LABELS[method] });
      reply = { id, result: await handlers[method](p) };
    } catch (err) {
      const msg = String(err?.message ?? err);
      reply = { id, error: OTHER_EXT.test(msg) ? OTHER_EXT_HINT : msg };
    }
    let out = JSON.stringify(reply);
    if (out.length > 8e6) {  // otherwise the WebSocket connection (16 MB) breaks along with all pending requests
      out = JSON.stringify({ id, error: `Result too large (${(out.length / 1e6).toFixed(1)} MB) – reduce max_chars or region` });
    }
    if (sock.readyState === WebSocket.OPEN) sock.send(out);
  };
}

function setState(online) {
  chrome.action.setBadgeText({ text: online ? "" : msg("badgeOff") });
  chrome.action.setBadgeBackgroundColor({ color: "#b00020" });
}

// The ping keeps the service worker alive (Chrome 116+); the alarm wakes it if it fell asleep anyway.
setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('{"ping":1}'), 20000);
chrome.alarms.create("keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(connect);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.relay || changes.token)) {
    const old = ws;
    ws = null;
    old?.close();
    connect();
  }
});
connect();
