"""End-to-end test: relay + extension in headless Chromium + MCP client.

    uv run python smoke_test.py

Checks all tools against a test page with iframe, shadow DOM, dialog, drag & drop etc.,
once at scale factor 1 and once at 2. Starts everything itself and cleans up afterwards.
"""

import asyncio
import itertools
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import base64
import io

import websockets
from mcp import ClientSession
from PIL import Image as PILImage
from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client

HERE = Path(__file__).parent
TOKEN = secrets.token_urlsafe(24)
ADMIN = secrets.token_urlsafe(16)
# Ports can be changed via environment so several test runs can run in parallel
RELAY_PORT = int(os.environ.get("SMOKE_RELAY_PORT", 8799))
PAGE_PORT = int(os.environ.get("SMOKE_PAGE_PORT", 8798))
CDP_PORT = int(os.environ.get("SMOKE_CDP_PORT", 9333))

PAGE = """<!doctype html><meta charset=utf-8><title>Test page</title>
<style>body{font:16px sans-serif} .box{display:inline-block;padding:10px;margin:4px;border:1px solid #888}</style>
<h1>Hermes test</h1>
<form id=f><label>Searchterm <input name=q></label><button type=button id=b>Greet</button></form>
<select id=sort aria-label=Sorting><option value=a>Best results<option value=p>Price ascending</select>
<label><input type=checkbox id=agb> Accept terms</label>
<div id=ed contenteditable=true aria-label=Note style="border:1px solid #ccc;min-height:20px">Note</div>
<input id=react placeholder=Reactive>
<input id=k placeholder=Keytest value="old text">
<div class=box id=hov>Hover me</div>
<div class=box id=dbl>Doubleclick</div>
<div class=box id=ctx>Rightclick</div>
<p id=tri>Triple mark</p>
<div class=box id=drag draggable=true>Drag me</div><div class=box id=zone style="width:120px;height:40px">Drop zone</div>
<input type=range id=slider min=0 max=100 value=0 style="width:200px">
<input type=file id=up multiple>
<button id=conf>Delete?</button>
<iframe id=fr style="width:300px;height:60px" srcdoc="<button id=fb onclick=&quot;parent.document.getElementById('out').textContent='Frame clicked'&quot;>In frame</button>"></iframe>
<x-host id=host></x-host>
<p>Output: <span id=out></span></p><ul id=log></ul>
<button id=orig>Original</button>
<button id=aria role=checkbox aria-checked=true>Newsletter</button>
<input id=ro readonly value=fixed aria-label=Fixed><input id=dis disabled value=off aria-label=Locked>
<select id=sel2 aria-label=Choice2><option>A<option disabled>C</select>
<div style="height:3000px"></div><button id=ende>End of page</button>
<iframe id=fr2 style="width:300px;height:60px" srcdoc="<button onclick=&quot;parent.log('Deep frame')&quot;>Deep in frame</button>"></iframe>
<script>
const log = window.log = (s) => { const li = document.createElement('li'); li.textContent = s; document.getElementById('log').append(li); };
orig.onclick = () => log('Original clicked');
aria.onclick = () => { aria.setAttribute('aria-checked', aria.getAttribute('aria-checked') !== 'true'); log('ARIA toggled'); };
b.onclick = () => log('Hello ' + f.q.value);
f.onsubmit = (e) => { e.preventDefault(); log('Submitted ' + f.q.value); };
sort.onchange = () => log('Sorted ' + sort.value);
agb.onchange = () => log('Terms ' + agb.checked);
ed.oninput = () => log('Note ' + ed.textContent);
react.addEventListener('input', (e) => log('Reactive ' + e.target.value));
hov.onmouseenter = () => log('Hover');
dbl.ondblclick = () => log('Doubleclick');
ctx.oncontextmenu = (e) => { e.preventDefault(); log('Context menu'); };
drag.ondragstart = (e) => e.dataTransfer.setData('text/plain', 'parcel');
zone.ondragover = (e) => e.preventDefault();
zone.ondrop = (e) => { e.preventDefault(); log('Dropped ' + e.dataTransfer.getData('text/plain')); };
up.onchange = () => log('Files ' + [...up.files].map(f => f.name + ':' + f.size).join(','));
conf.onclick = () => log('Answer ' + confirm('Really delete?'));
ende.onclick = () => log('End clicked');
customElements.define('x-host', class extends HTMLElement { connectedCallback() {
  const r = this.attachShadow({mode: 'open'}); r.innerHTML = '<button>In shadow</button>';
  r.querySelector('button').onclick = () => log('Shadow clicked'); } });
console.log('hello-console'); console.error('broken-error');
fetch('/api/test?token=secret123').catch(() => {});
</script>"""

PAGE2 = "<!doctype html><meta charset=utf-8><title>Page two</title><p>two</p>"


EXT_ID = ""


class T:
    def __init__(self, s):
        self.s = s

    async def raw(self, name, **args):
        return await self.s.call_tool(name, args)

    async def __call__(self, name, **args):
        r = await self.raw(name, **args)
        assert not r.is_error, f"{name}: {r.content[0].text}"
        return "\n".join(c.text for c in r.content if c.type == "text")


def ref(page_text, pattern):
    line = next((l for l in page_text.splitlines() if re.search(pattern, l)), None)
    assert line, f"no element for {pattern!r} in:\n{page_text[:3000]}"
    return re.search(r"\[(ref_\d+)\]", line).group(1)


def center_js(sel):
    return f"(() => {{ const r = document.querySelector('{sel}').getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; }})()"


async def set_extension_config():
    for _ in range(50):
        try:
            targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json"))
            sw = next(t for t in targets if t["type"] == "service_worker" and t["url"].endswith("background.js"))
            break
        except Exception:
            await asyncio.sleep(0.2)
    else:
        raise RuntimeError("extension service worker not found")
    global EXT_ID
    EXT_ID = sw["url"].split("/")[2]
    async with websockets.connect(sw["webSocketDebuggerUrl"], max_size=None) as cdp:
        cfg = {"relay": f"ws://127.0.0.1:{RELAY_PORT}/ext", "token": TOKEN, "siteMode": "all"}  # permissions() covers site permissions
        await cdp.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {
            "expression": f"chrome.storage.local.set({json.dumps(cfg)})", "awaitPromise": True}}))
        while json.loads(await cdp.recv()).get("id") != 1:
            pass


async def sw_eval(expression):
    """Evaluates in the extension service worker (e.g. simulates the user clicking the toolbar icon)."""
    targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json"))
    sw = next(t for t in targets if t["type"] == "service_worker" and t["url"].endswith("background.js"))
    async with websockets.connect(sw["webSocketDebuggerUrl"], max_size=None) as cdp:
        await cdp.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {
            "expression": expression, "awaitPromise": True, "returnByValue": True}}))
        while (m := json.loads(await cdp.recv())).get("id") != 1:
            pass
    return m["result"].get("result", {}).get("value")


async def user_click(url_part, selector=None, shot=None):
    """Clicks as the user (own debugger, real mouse event) on an element in the closed overlay.
    shot: save a screenshot including the overlay instead (the extension's screenshot hides it)."""
    targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json"))
    target = next(t for t in targets if t["type"] == "page" and url_part in t["url"])
    async with websockets.connect(target["webSocketDebuggerUrl"], max_size=None) as cdp:
        n = itertools.count(1)

        async def send(method, **params):
            i = next(n)
            await cdp.send(json.dumps({"id": i, "method": method, "params": params}))
            while (m := json.loads(await cdp.recv())).get("id") != i:
                pass
            assert "error" not in m, m
            return m["result"]

        if shot:
            await send("Page.bringToFront")  # headless does not paint background tabs -> screenshot would hang
            Path(shot).write_bytes(base64.b64decode((await send("Page.captureScreenshot"))["data"]))
            return
        doc = await send("DOM.getDocument", depth=-1, pierce=True)
        host = (await send("DOM.querySelector", nodeId=doc["root"]["nodeId"], selector="hermes-tabs-overlay"))["nodeId"]
        assert host, "no overlay"
        desc = await send("DOM.describeNode", nodeId=host, depth=1, pierce=True)
        shadow = desc["node"]["shadowRoots"][0]["backendNodeId"]
        node = (await send("DOM.pushNodesByBackendIdsToFrontend", backendNodeIds=[shadow]))["nodeIds"][0]
        el = (await send("DOM.querySelector", nodeId=node, selector=selector))["nodeId"]
        q = (await send("DOM.getBoxModel", nodeId=el))["model"]["content"]
        x, y = (q[0] + q[4]) / 2, (q[1] + q[5]) / 2
        for kind in ("mousePressed", "mouseReleased"):
            await send("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=1)


async def page_eval(url_part, expression):
    targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json"))
    target = next(t for t in targets if t["type"] == "page" and url_part in t["url"])
    async with websockets.connect(target["webSocketDebuggerUrl"], max_size=None) as cdp:
        await cdp.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": expression, "returnByValue": True}}))
        while (m := json.loads(await cdp.recv())).get("id") != 1:
            pass
    return m["result"]["result"].get("value")


async def permissions(t: T, base: str):
    """Visible, stoppable, actions only with per-site permission, no passwords, scripts read-only."""
    await sw_eval("chrome.storage.local.set({siteMode: 'ask', permTimeoutMs: 4000, allowedSites: {}}).then(() => 1)")
    tid = json.loads(await t("tabs_create", url=f"{base}/two.html"))["tabId"]
    js = lambda code: t("javascript", tabId=tid, text=code)
    await js("document.body.insertAdjacentHTML('beforeend', '<input type=password id=pw><button id=b onclick=\"window.n=(window.n||0)+1\">B</button>'); 1")

    # Reading is free; scripts on a site without permission: modifying requests blocked, deferred ones too
    out = await js("await fetch('/two.html', {method: 'POST'}).then(r => 'passed ' + r.status, () => 'blocked')")
    assert out.startswith("blocked") and "Write guard" in out, out
    await js("setTimeout(() => fetch('/two.html', {method: 'PUT'}).then(() => window.late = 'passed', () => window.late = 'blocked'), 300); 1")
    await asyncio.sleep(1)
    assert (await js("window.late")).startswith("blocked")
    assert (await js("await fetch('/two.html').then(r => r.status)")).startswith("200")
    assert await js("typeof __hermesTabs") == "undefined"  # the page cannot fake a permission answer
    out = await js("const w = window.open('/two.html'); await new Promise(r => setTimeout(r, 800)); "
                   "w ? await w.fetch('/two.html', {method: 'POST'}).then(r => 'passed', () => 'blocked') : 'no window'")
    assert out.startswith("no window"), "popup bypasses write guard: " + out
    out = await js("await new Promise(r => { const w = new Worker(URL.createObjectURL(new Blob(["
                   "\"fetch('/two.html', {method: 'POST'}).then(() => postMessage('passed'), () => postMessage('blocked'))\"]))); "
                   "w.onmessage = (e) => r(e.data); setTimeout(() => r('timeout'), 3000); })")
    assert out.startswith("blocked"), "worker bypasses write guard: " + out

    # Click without permission: overlay asks, no answer -> refused without a click
    t0 = time.time()
    r = await t.raw("computer", tabId=tid, action="left_click", coordinate=[5, 5], action_summary="Test click")
    assert r.is_error and "did not respond" in r.content[0].text and time.time() - t0 < 8, r.content[0].text
    # User clicks "No"
    task = asyncio.create_task(t.raw("computer", tabId=tid, action="left_click", coordinate=[5, 5]))
    await asyncio.sleep(1)
    await user_click("two.html", ".deny")
    r = await task
    assert r.is_error and "declined" in r.content[0].text, r.content[0].text
    # User clicks "Once": click runs, follow-up action without a new prompt
    pos = json.loads(await js(center_js("#b")))
    task = asyncio.create_task(t.raw("computer", tabId=tid, action="left_click", coordinate=pos))
    await asyncio.sleep(1)
    await user_click("two.html", ".once")
    r = await task
    assert not r.is_error, r.content[0].text
    await t("computer", tabId=tid, action="left_click", coordinate=pos)
    assert await js("window.n") == "2"
    if os.environ.get("SMOKE_SHOTS"):  # for viewing: frame, pointer, label, stop bar
        await t("computer", tabId=tid, action="left_click", coordinate=pos, action_summary="Click on B")
        await asyncio.sleep(0.4)
        await user_click("two.html", shot=Path(os.environ["SMOKE_SHOTS"]) / "overlay.png")
        await asyncio.sleep(7)  # after 6 s idle everything must be gone
        await user_click("two.html", shot=Path(os.environ["SMOKE_SHOTS"]) / "overlay-idle.png")
    # Overlay is visible, but not in the screenshot
    assert await js("!!document.querySelector('hermes-tabs-overlay')") == "true"
    await t("computer", tabId=tid, action="screenshot")
    assert await js("document.querySelector('hermes-tabs-overlay').style.visibility") == "visible"

    # No passwords: neither form_input nor typing
    pw = ref(await t("find", tabId=tid, query="password"), "password|textbox")
    r = await t.raw("form_input", tabId=tid, ref=pw, value="secret")
    assert r.is_error and "password field" in r.content[0].text, r.content[0].text
    await t("computer", tabId=tid, action="left_click", ref=pw)
    r = await t.raw("computer", tabId=tid, action="type", text="secret")
    assert r.is_error and "password field" in r.content[0].text, r.content[0].text
    for keys in ("ctrl+v", "Enter", "a"):
        r = await t.raw("computer", tabId=tid, action="key", text=keys)
        assert r.is_error and "password field" in r.content[0].text, (keys, r.content[0].text)
    await t("computer", tabId=tid, action="key", text="Tab")  # leaving the field works
    await js("pw.type = 'text'; pw.autocomplete = 'current-password'; 1")  # "show password"
    r = await t.raw("form_input", tabId=tid, ref=pw, value="secret")
    assert r.is_error and "password field" in r.content[0].text, r.content[0].text
    assert await js("pw.value") == ""
    # Focus in a cross-origin iframe (login/payment widgets): field type unknown -> no typing
    await js("document.body.insertAdjacentHTML('beforeend', '<iframe id=fx style=\"width:200px;height:40px;border:0\" "
             "src=\"data:text/html,<body style=margin:0><input style=width:100%;height:40px></body>\"></iframe>'); 1")
    await asyncio.sleep(0.5)
    await t("computer", tabId=tid, action="left_click", coordinate=json.loads(await js(center_js("#fx"))))
    r = await t.raw("computer", tabId=tid, action="type", text="1234")
    assert r.is_error and "cross-origin iframe" in r.content[0].text, r.content[0].text

    # Stop in the tab: share revoked, Hermes has no more access
    await user_click("two.html", ".stop")
    await asyncio.sleep(0.5)
    assert tid not in {x["tabId"] for x in json.loads(await t("tabs_context"))}
    r = await t.raw("read_page", tabId=tid)
    assert r.is_error and "not shared with Hermes" in r.content[0].text, r.content[0].text
    await sw_eval(f"chrome.tabs.remove({tid}).then(() => 1)")

    # "Always": stored, no further prompt, visible and revocable in the options
    tid = json.loads(await t("tabs_create", url=f"{base}/two.html"))["tabId"]
    task = asyncio.create_task(t.raw("computer", tabId=tid, action="left_click", coordinate=[5, 5]))
    await asyncio.sleep(1)
    await user_click("two.html", ".always")
    assert not (await task).is_error
    await t("computer", tabId=tid, action="left_click", coordinate=[5, 5])
    await sw_eval(f"chrome.tabs.create({{url: chrome.runtime.getURL('options.html')}}).then(() => 1)")
    await asyncio.sleep(1)
    assert base in await page_eval("options.html", "document.getElementById('sites').textContent")
    await page_eval("options.html", "document.querySelector('#sites button').click()")
    await asyncio.sleep(0.5)
    assert await sw_eval("chrome.storage.local.get('allowedSites').then((x) => Object.keys(x.allowedSites).length)") == 0
    # "Site: until restart" lands in storage.session
    task = asyncio.create_task(t.raw("computer", tabId=tid, action="left_click", coordinate=[5, 5]))
    await asyncio.sleep(1)
    await user_click("two.html", ".session")
    assert not (await task).is_error
    assert await sw_eval("chrome.storage.session.get('sessionSites').then((x) => Object.keys(x.sessionSites))") == [base]
    await sw_eval("chrome.storage.session.set({sessionSites: {}}).then(() => 1)")
    # Time window from the options: all sites 1 hour, then no prompt; "End" asks again
    await page_eval("options.html", "document.querySelector('button[data-t=all1h]').click()")
    await asyncio.sleep(0.5)
    t0 = time.time()
    assert not (await t.raw("computer", tabId=tid, action="left_click", coordinate=[5, 5])).is_error and time.time() - t0 < 3
    await page_eval("options.html", "document.querySelector('button[data-t=off]').click()")
    await asyncio.sleep(0.5)
    r = await t.raw("computer", tabId=tid, action="left_click", coordinate=[5, 5])
    assert r.is_error and "did not respond" in r.content[0].text, r.content[0].text
    # Settings via the relay only with the admin token (Hermes' token is not enough)
    def admin(token, body=None):
        req = urllib.request.Request(f"http://127.0.0.1:{RELAY_PORT}/admin/settings", method="POST" if body else "GET",
                                     data=json.dumps(body).encode() if body else None,
                                     headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        return json.load(urllib.request.urlopen(req))
    try:
        admin(TOKEN, {"allowAll": "1h"}); raise AssertionError("Hermes token may set permissions")
    except urllib.error.HTTPError as e:
        assert e.code == 401
    assert admin(ADMIN, {"allowAll": "1h"})["allowAllUntil"]
    t0 = time.time()
    assert not (await t.raw("computer", tabId=tid, action="left_click", coordinate=[5, 5])).is_error and time.time() - t0 < 3
    st = admin(ADMIN, {"allowAll": "off", "sites": {base: "session"}})
    assert st["allowAllUntil"] is None and st["sessionSites"] == {base: True}, st
    admin(ADMIN, {"sites": {base: "off"}})
    # Blocked sites: nothing works, not even reading or opening; master switch off: everything refused
    assert admin(ADMIN, {"blockedSites": ["http://127.0.0.1/x"]})["blockedSites"] == ["127.0.0.1"]
    for r in (await t.raw("read_page", tabId=tid), await t.raw("tabs_create", url=f"{base}/two.html")):
        assert r.is_error and "Blocked sites" in r.content[0].text, r.content[0].text
    admin(ADMIN, {"blockedSites": [], "enabled": False})
    r = await t.raw("tabs_context")
    assert r.is_error and "turned off" in r.content[0].text, r.content[0].text
    assert admin(ADMIN, {"enabled": True})["enabled"] is True
    assert "two" in await t("get_page_text", tabId=tid)
    await t("tabs_close", tabId=tid)
    await sw_eval("chrome.tabs.query({}).then(async (ts) => { for (const x of ts) if (x.url.includes('options.html')) await chrome.tabs.remove(x.id); "
                  "await chrome.storage.local.set({siteMode: 'all'}); return 1; })")


async def wait_connected():
    status = urllib.request.Request(f"http://127.0.0.1:{RELAY_PORT}/admin/status", headers={"Authorization": f"Bearer {TOKEN}"})
    for _ in range(100):  # 20 s: under load the browser takes longer to start
        if json.load(urllib.request.urlopen(status)).get("connected"):
            return
        await asyncio.sleep(0.2)
    raise AssertionError("extension does not connect (20 s)")


async def scenario(t: T, tmp: Path):
    base = f"http://127.0.0.1:{PAGE_PORT}"
    assert json.loads(await t("tabs_context")) == []
    tab = json.loads(await t("tabs_create", url=f"{base}/index.html"))
    tid = tab["tabId"]
    assert tab["title"] == "Test page", tab
    js = lambda code: t("javascript", tabId=tid, text=code)

    page = await t("read_page", tabId=tid)
    assert "In frame" in page and "In shadow" in page, "iframe/shadow DOM missing in read_page"

    # Typing, clicking, Enter, form values
    await t("computer", tabId=tid, action="left_click", ref=ref(page, r'textbox "Search'))
    await t("computer", tabId=tid, action="type", text="world")
    await js("document.activeElement.blur(); 1")  # no focus: typing reports it instead of silently doing nothing
    r = await t.raw("computer", tabId=tid, action="type", text="x")
    assert r.is_error and "No input field" in r.content[0].text, r.content[0].text
    await t("computer", tabId=tid, action="left_click", ref=ref(page, r'textbox "Search'))
    await t("computer", tabId=tid, action="left_click", ref=ref(page, r'button "Greet"'))
    await t("computer", tabId=tid, action="left_click", ref=ref(page, r'textbox "Search'))
    await t("computer", tabId=tid, action="key", text="Enter")
    await t("form_input", tabId=tid, ref=ref(page, r'combobox "Sorting"'), value="Price ascending")
    await t("form_input", tabId=tid, ref=ref(page, r'checkbox "Accept terms'), value=True)
    await t("form_input", tabId=tid, ref=ref(page, r'textbox "Note'), value="New")
    await t("form_input", tabId=tid, ref=ref(page, r'textbox "Reactive'), value="ok")
    # ARIA checkbox on a button: already on -> no click; then off
    await t("form_input", tabId=tid, ref=ref(page, r'checkbox "Newsletter'), value=True)
    await t("form_input", tabId=tid, ref=ref(page, r'checkbox "Newsletter'), value=False)
    assert await js("aria.getAttribute('aria-checked')") == "false"
    # Shortcuts: select all and replace, repeat
    await t("computer", tabId=tid, action="left_click", ref=ref(page, r'textbox "Keytest'))
    await t("computer", tabId=tid, action="key", text="ctrl+a Backspace")
    await t("computer", tabId=tid, action="type", text="new")
    assert await js("k.value") == "new", await js("k.value")
    await t("computer", tabId=tid, action="key", text="Backspace", repeat=2)
    assert await js("k.value") == "n", await js("k.value")

    # find + mouse
    hits = await t("find", tabId=tid, query="Hover me")
    await t("computer", tabId=tid, action="hover", ref=ref(hits, "Hover me"))
    await t("computer", tabId=tid, action="double_click", ref=ref(await t("find", tabId=tid, query="Doubleclick"), "Doubleclick"))
    await t("computer", tabId=tid, action="right_click", ref=ref(await t("find", tabId=tid, query="Rightclick"), "Rightclick"))
    await t("computer", tabId=tid, action="triple_click", ref=ref(await t("find", tabId=tid, query="Triple mark"), "Triple"))
    assert "Triple mark" in await js("getSelection().toString()")
    # German query on purpose: exercises the German role/search synonyms
    assert "Search" in await t("find", tabId=tid, query="Suchfeld")
    # shop pattern: a select with "search" in its name must not outrank the real search field ("find")
    # (the form label "Searchterm" matches only as a word prefix, like German "Suche" for "such")
    await js("document.body.insertAdjacentHTML('afterbegin', '<div id=eb><select aria-label=\"Select a category for your search\"><option>All</option></select>"
             "<input role=combobox aria-label=\"Find in shop\"></div>'); 1")
    first = (await t("find", tabId=tid, query="Suchfeld")).splitlines()[0]
    assert "Find in shop" in first, first
    await js("eb.remove(); 1")

    # A copy of an element does not inherit the reference: the click hits the original, not the copy inserted before it
    await js("orig.before(orig.cloneNode(true)); 1")
    await t("computer", tabId=tid, action="left_click", ref=ref(page, r'button "Original"'))
    # The page replaces the reference table (invisible to it): the click still hits the original
    await js("window.__hermesRefs = { get: () => ({ deref: () => document.getElementById('conf') }), set() {} }; window.__hermesRef = 0; 1")
    await t("computer", tabId=tid, action="left_click", ref=ref(page, r'button "Original"'))
    # Disabled fields, read-only fields and disabled options cannot be set
    for pat, val, want in ((r'textbox "Fixed"', "x", "read-only"), (r'textbox "Locked"', "x", "disabled"),
                           (r'combobox "Choice2"', "C", "disabled")):
        r = await t.raw("form_input", tabId=tid, ref=ref(page, pat), value=val)
        assert r.is_error and want in r.content[0].text, (pat, r.content[0].text)
    assert await js("ro.value + dis.value + sel2.value") == "fixedoffA"
    # Coordinates outside, wait on a foreign tab, long find query
    for c in ([-5, 10], [100000, 10]):
        r = await t.raw("computer", tabId=tid, action="left_click", coordinate=c)
        assert r.is_error and "outside" in r.content[0].text, r.content[0].text
    r = await t.raw("computer", tabId=tid + 1000, action="wait", duration=0.1)
    assert r.is_error, r.content[0].text
    await t("find", tabId=tid, query="(" * 5000 + "Greet")

    # iframe at the very bottom: scroll the iframe into view first, then the button
    await js("scrollTo(0, 0)")
    await t("computer", tabId=tid, action="left_click", ref=ref(page, r'button "Deep in frame"'))
    await js("scrollTo(0, 0)")

    # iframe and shadow DOM by ref
    await t("computer", tabId=tid, action="left_click", ref=ref(page, r'button "In frame"'))
    assert await js("out.textContent") == "Frame clicked"
    await t("computer", tabId=tid, action="left_click", ref=ref(page, r'button "In shadow"'))

    # Screenshot coordinates match clicks (also at scale factor 2)
    await js("scrollTo(0, 0)")
    shot = await t.raw("computer", tabId=tid, action="screenshot")
    note = shot.content[0].text
    m = re.search(r"(\d+)x(\d+) px.*\((\d+)x(\d+)\)", note)
    assert m and m.group(1) == m.group(3), f"screenshot not in CSS pixels: {note}"
    image_id = re.search(r"Image (img_\d+)", note).group(1)
    # Pixel matches the CSS coordinate: red marker at (100..120, 100..120)
    await js("document.body.insertAdjacentHTML('beforeend', '<div id=mark style=\"position:fixed;left:100px;top:100px;width:20px;height:20px;background:#f00;z-index:9999\"></div>'); 1")
    marked = await t.raw("computer", tabId=tid, action="screenshot")
    px = PILImage.open(io.BytesIO(base64.b64decode(marked.content[1].data))).convert("RGB").getpixel((110, 110))
    assert px[0] > 200 and px[1] < 60 and px[2] < 60, f"pixel (110,110) is {px}, expected red"
    await js("mark.remove(); 1")
    await t("computer", tabId=tid, action="double_click", coordinate=json.loads(await js(center_js("#dbl"))))
    zoom = await t.raw("computer", tabId=tid, action="zoom", region=[0, 0, 200, 100])
    assert zoom.content[1].type == "image"

    # Drag & drop (HTML5) and slider (mouse)
    await t("computer", tabId=tid, action="scroll_to", ref=ref(await t("find", tabId=tid, query="Drag me"), "Drag me"))
    a, z = json.loads(await js(center_js("#drag"))), json.loads(await js(center_js("#zone")))
    await t("computer", tabId=tid, action="left_click_drag", start_coordinate=a, coordinate=z)
    s = json.loads(await js("(() => { const r = slider.getBoundingClientRect(); return [r.x + 3, r.y + r.height/2, r.right - 3]; })()"))
    await t("computer", tabId=tid, action="left_click_drag", start_coordinate=s[:2], coordinate=[s[2], s[1]])
    assert int(await js("slider.value")) > 80, await js("slider.value")

    # Files: path on the relay host and own screenshot
    (tmp / "hello.txt").write_text("hello world")
    up = ref(page, r"^\s*file")
    await t("file_upload", tabId=tid, ref=up, paths=[str(tmp / "hello.txt")])
    await t("upload_image", tabId=tid, imageId=image_id, ref=up, filename="image.png")
    bad = await t.raw("file_upload", tabId=tid, ref=up, paths=["/etc/hostname"])
    assert bad.is_error and "outside" in bad.content[0].text, bad.content[0].text
    (tmp / "big.bin").write_bytes(b"\0" * (11 * 2**20))
    bad = await t.raw("file_upload", tabId=tid, ref=up, paths=[str(tmp / "big.bin")])
    assert bad.is_error and "10 MB" in bad.content[0].text, bad.content[0].text
    os.mkfifo(tmp / "fifo")  # must not block the relay
    bad = await t.raw("file_upload", tabId=tid, ref=up, paths=[str(tmp / "fifo")])
    assert bad.is_error and "not a regular file" in bad.content[0].text, bad.content[0].text
    (tmp / "link.txt").symlink_to("/etc/hostname")  # symlink inside the allowed folder, target outside
    bad = await t.raw("file_upload", tabId=tid, ref=up, paths=[str(tmp / "link.txt")])
    assert bad.is_error and "outside" in bad.content[0].text, bad.content[0].text

    # Dialog
    r = await t.raw("computer", tabId=tid, action="left_click", ref=ref(page, r'button "Delete\?"'))
    assert r.is_error and "dialog is open" in r.content[0].text, r.content[0].text
    await t("handle_dialog", tabId=tid, accept=True)

    # Scrolling
    before = float(await js("scrollY"))
    await t("computer", tabId=tid, action="scroll", scroll_direction="down", scroll_amount=5)
    assert float(await js("scrollY")) > before
    await t("computer", tabId=tid, action="left_click", ref=ref(page, r'button "End of page"'))

    entries = json.loads(await js("[...document.querySelectorAll('#log li')].map(l => l.textContent)"))
    for want in ["Hello world", "Submitted world", "Sorted p", "Terms true", "Note New", "Reactive ok", "Hover",
                 "Doubleclick", "Context menu", "Shadow clicked", "Dropped parcel", "Files hello.txt:11",
                 "Files image.png:", "Answer true", "End clicked", "Deep frame"]:
        assert any(e.startswith(want) for e in entries), f"missing: {want}\n{entries}"
    assert entries.count("Doubleclick") == 2, entries  # by ref and by coordinate
    assert entries.count("Original clicked") == 2, entries

    # Console, network, text, wait
    con = await t("read_console_messages", tabId=tid, pattern="hello|broken")
    assert "hello-console" in con and "broken-error" in con, con
    assert "hello-console" not in await t("read_console_messages", tabId=tid, pattern=".", onlyErrors=True)
    net = await t("read_network_requests", tabId=tid, urlPattern="/api/")
    assert "token=REDACTED" in net and "404" in net, net
    await t("read_network_requests", tabId=tid, urlPattern="/api/", clear=True)
    assert "no requests" in await t("read_network_requests", tabId=tid, urlPattern="/api/")
    assert "Output" in await t("get_page_text", tabId=tid)
    await t("computer", tabId=tid, action="wait", duration=0.2)

    # Subtree, navigation, window, batch, GIF
    sub = await t("read_page", tabId=tid, ref_id=ref(page, r"^\s*form"))
    assert "Greet" in sub and "Sorting" not in sub, sub
    assert json.loads(await t("navigate", tabId=tid, url=f"{base}/two.html"))["title"] == "Page two"
    assert json.loads(await t("navigate", tabId=tid, url="back"))["title"] == "Test page"
    # After reloading, an old reference must hit nothing
    await t("navigate", tabId=tid, url=f"{base}/index.html?new")
    stale = await t.raw("computer", tabId=tid, action="left_click", ref=ref(page, r'button "Greet"'))
    assert stale.is_error and "not found" in stale.content[0].text, stale.content[0].text
    await t("resize_window", tabId=tid, width=1100, height=800)
    batch = await t.raw("browser_batch", actions=[
        {"name": "navigate", "input": {"tabId": tid, "url": f"{base}/two.html"}},
        {"name": "get_page_text", "input": {"tabId": tid}},
        {"name": "computer", "input": {"tabId": tid, "action": "screenshot", "scale": 0.5}},
    ])
    texts = [c.text for c in batch.content if c.type == "text"]
    assert any("two" in x for x in texts) and any(c.type == "image" for c in batch.content), texts
    await t("gif_creator", tabId=tid, action="start_recording")
    await t("computer", tabId=tid, action="screenshot", scale=0.5)
    await t("navigate", tabId=tid, url="back")
    await t("computer", tabId=tid, action="left_click", coordinate=[50, 50])
    await t("computer", tabId=tid, action="screenshot", scale=0.5)
    await t("gif_creator", tabId=tid, action="stop_recording")
    out = await t("gif_creator", tabId=tid, action="export", filename="smoke.gif")
    assert (tmp / "smoke.gif").read_bytes()[:6] == b"GIF89a", out
    (tmp / "sentinel").write_text("stays")  # a planted symlink must not be overwritten
    (tmp / "evil.gif").symlink_to(tmp / "sentinel")
    out = await t("gif_creator", tabId=tid, action="export", filename="evil.gif")
    assert (tmp / "sentinel").read_text() == "stays" and "evil-1.gif" in out, out
    r = await t.raw("gif_creator", tabId=tid, action="export", filename="a\0b.gif")
    assert r.is_error and "filename" in r.content[0].text, r.content[0].text
    # Large results: truncated or cleanly refused, connection stays up
    big = await t("javascript", tabId=tid, text="'x'.repeat(2e6)")
    assert len(big) < 900_000 and "truncated" in big, len(big)
    r = await t.raw("javascript", tabId=tid, text="'x'.repeat(2e7)")
    assert r.is_error and "too large" in r.content[0].text, r.content[0].text[:200]
    assert await t("javascript", tabId=tid, text="1 + 1") == "2"
    failed = await t.raw("browser_batch", actions=[
        {"name": "get_page_text", "input": {"tabId": tid}},
        {"name": "read_page", "input": {"tabId": tid + 1000}},
    ])
    assert failed.is_error and "Step 2" in failed.content[0].text and "steps before" in failed.content[0].text

    # Covered target (like collapsed search fields): the click reports what it really hit and that no focus arrived
    await js("document.body.insertAdjacentHTML('afterbegin', '<div id=cv style=\"position:relative\"><input id=hid aria-label=Hidden>"
             "<button id=cover style=\"position:absolute;inset:0;width:100%\">Lid</button></div>'); 1")
    out = await t("computer", tabId=tid, action="left_click", ref=ref(await t("find", tabId=tid, query="Hidden"), "Hidden"))
    assert "covered" in out and "Lid" in out and "did not get focus" in out, out
    assert "(covered" in await t("find", tabId=tid, query="Hidden field")
    await js("cv.remove(); 1")

    # Link with target=_blank: the new tab belongs to Hermes and is reported
    await js("document.body.insertAdjacentHTML('afterbegin', '<a id=nb href=\"/two.html\" target=_blank>New tab</a>'); 1")
    out = await t("computer", tabId=tid, action="left_click", ref=ref(await t("find", tabId=tid, query="New tab"), "New tab"))
    m = re.search(r"opened new tab (\d+)", out)
    assert m, out
    ctx = {x["tabId"]: x["owner"] for x in json.loads(await t("tabs_context"))}
    assert ctx.get(int(m[1])) == "agent", ctx
    await t("tabs_close", tabId=int(m[1]))
    await js("nb.remove(); 1")

    # A new extension connection replaces the old one: its pending request fails immediately, not after 60 s
    pending = asyncio.create_task(t.raw("computer", tabId=tid, action="wait", duration=8))
    await asyncio.sleep(0.5)
    async with websockets.connect(f"ws://127.0.0.1:{RELAY_PORT}/ext?token={TOKEN}", origin="chrome-extension://test"):
        t0 = time.time()
        r = await pending
        assert r.is_error and "aborted" in r.content[0].text and time.time() - t0 < 3, r.content[0].text
    await wait_connected()  # the real extension reconnects on its own

    # (Extension reload is covered by a live test in a real browser: headless, reload() removes an extension loaded via command line.)

    # Protected pages: no local files, no extension pages (otherwise token and all tabs exposed)
    for url in ("file:///etc/passwd", f"chrome-extension://{EXT_ID}/options.html", "chrome://version"):
        r = await t.raw("tabs_create", url=url)
        assert r.is_error and "Protected page" in r.content[0].text, (url, r.content[0].text)
        r = await t.raw("navigate", tabId=tid, url=url)
        assert r.is_error and "Protected page" in r.content[0].text, (url, r.content[0].text)
    await js(f"location.href = 'chrome-extension://{EXT_ID}/options.html'; 1")  # the page tries it itself
    await asyncio.sleep(1)
    r = await t.raw("javascript", tabId=tid, text="typeof chrome.storage")
    assert r.is_error or r.content[0].text == "undefined", r.content[0].text
    for bad in ("__proto__", "constructor", 1.5):
        r = await t.raw("browser_batch", actions=[{"name": "handle_dialog", "input": {"tabId": bad, "accept": True}}])
        assert r.is_error, (bad, r.content[0].text)
    await t("navigate", tabId=tid, url=f"{base}/two.html")

    # beforeunload: navigate reports the dialog immediately instead of waiting 20 s
    await js("addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; }); 1")
    await t("computer", tabId=tid, action="left_click", coordinate=[5, 5])  # user activation required
    t0 = time.time()
    r = await t.raw("navigate", tabId=tid, url=f"{base}/two.html")
    assert r.is_error and "beforeunload" in r.content[0].text and time.time() - t0 < 5, (r.content[0].text, time.time() - t0)
    await t("handle_dialog", tabId=tid, accept=False)  # page stays; tabs_close at the end must close despite the handler

    # Tab shared by the user (icon click simulated): reading yes, closing no, revoking works
    utid = await sw_eval(f"chrome.tabs.create({{url: '{base}/two.html', active: false}})"
                         ".then(async (t) => {{ await setShared(t.id, 'user'); return t.id; }})")
    await asyncio.sleep(1)
    ctx = {x["tabId"]: x["owner"] for x in json.loads(await t("tabs_context"))}
    assert ctx.get(utid) == "user", ctx
    assert "two" in await t("get_page_text", tabId=utid)
    r = await t.raw("tabs_close", tabId=utid)
    assert r.is_error and "opened by Hermes itself" in r.content[0].text, r.content[0].text
    await sw_eval(f"setShared({utid}, null).then(() => 1)")
    r = await t.raw("get_page_text", tabId=utid)
    assert r.is_error and "not shared with Hermes" in r.content[0].text, r.content[0].text
    # a user-shared tab on a local file stays locked
    ftid = await sw_eval("chrome.tabs.create({url: 'file:///etc/hostname', active: false})"
                         ".then(async (t) => { await setShared(t.id, 'user'); return t.id; }, () => null)")
    if ftid:
        await asyncio.sleep(1)
        r = await t.raw("get_page_text", tabId=ftid)
        assert r.is_error and "Protected page" in r.content[0].text, r.content[0].text
        await sw_eval(f"setShared({ftid}, null).then(() => chrome.tabs.remove({ftid}))")
    await sw_eval(f"chrome.tabs.remove({utid}).then(() => 1)")

    # PDF in the browser viewer: clear message, and Hermes can leave via navigate
    ptid = json.loads(await t("tabs_create", url=f"{base}/two.html"))["tabId"]
    await t("navigate", tabId=ptid, url=f"{base}/doc.pdf")
    r = await t.raw("read_page", tabId=ptid)
    if r.is_error and "PDF" in r.content[0].text:
        assert "two" in json.loads(await t("navigate", tabId=ptid, url="back"))["url"]
    else:
        print("Note: headless does not show the PDF in the PDF viewer –", (r.content[0].text if r.content else "")[:80])
    await t("tabs_close", tabId=ptid)

    await permissions(t, base)

    # Limits and cleanup
    denied = await t.raw("read_page", tabId=tid + 1000)
    assert denied.is_error and "not shared with Hermes" in denied.content[0].text
    await t("tabs_close", tabId=tid)
    assert json.loads(await t("tabs_context")) == []
    created = json.loads((await t("navigate", url=f"{base}/two.html")).split("\n\nTabs:")[0])
    assert created["title"] == "Page two"
    await t("tabs_close", tabId=created["tabId"])


async def run(scale: int):
    tmp = Path(tempfile.mkdtemp(prefix="hermes-tabs-"))
    (tmp / "index.html").write_text(PAGE)
    (tmp / "two.html").write_text(PAGE2)
    PILImage.new("RGB", (60, 40), "white").save(tmp / "doc.pdf")
    env = {**os.environ, "HERMES_TABS_TOKEN": TOKEN, "HERMES_TABS_ADMIN_TOKEN": ADMIN, "HERMES_TABS_PORT": str(RELAY_PORT), "HERMES_TABS_GIF_DIR": str(tmp)}
    procs = [
        subprocess.Popen([sys.executable, HERE / "relay.py"], env=env),
        subprocess.Popen([sys.executable, "-m", "http.server", str(PAGE_PORT), "-b", "127.0.0.1", "-d", tmp],
                         stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL),
        subprocess.Popen([
            shutil.which("chromium") or "google-chrome", "--headless=new", "--no-first-run",
            f"--user-data-dir={tmp / 'profile'}", f"--remote-debugging-port={CDP_PORT}",
            f"--load-extension={HERE / 'extension'}", f"--disable-extensions-except={HERE / 'extension'}",
            "--disable-features=DisableLoadExtensionCommandLineSwitch", f"--force-device-scale-factor={scale}",
            "--window-size=1280,900", "about:blank",
        ], stderr=subprocess.DEVNULL),
    ]
    try:
        for _ in range(50):  # relay must be listening before the extension gets its config
            try:
                await asyncio.open_connection("127.0.0.1", RELAY_PORT)
                break
            except OSError:
                await asyncio.sleep(0.2)
        await set_extension_config()
        await wait_connected()
        http = create_mcp_http_client(headers={"Authorization": f"Bearer {TOKEN}"})
        async with http, streamable_http_client(f"http://127.0.0.1:{RELAY_PORT}/mcp", http_client=http) as streams:
            async with ClientSession(streams[0], streams[1]) as s:
                await s.initialize()
                await scenario(T(s), tmp)
        try:
            urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{RELAY_PORT}/mcp", method="POST"))
            raise AssertionError("relay reachable without token")
        except urllib.error.HTTPError as e:
            assert e.code == 401
        try:  # browser request (Origin set) is refused despite the token
            urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{RELAY_PORT}/admin/status", headers={
                "Authorization": f"Bearer {TOKEN}", "Origin": "http://evil.example"}))
            raise AssertionError("relay accepts browser requests")
        except urllib.error.HTTPError as e:
            assert e.code == 403
        for method in ("GET", "DELETE"):  # all HTTP methods require the token
            try:
                urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{RELAY_PORT}/mcp", method=method))
                raise AssertionError(f"{method} /mcp reachable without token")
            except urllib.error.HTTPError as e:
                assert e.code == 401
        try:  # with token: GET has no event stream -> immediate 405 (otherwise clients like Hermes wait ~5 s)
            urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{RELAY_PORT}/mcp", headers={
                "Authorization": f"Bearer {TOKEN}", "Accept": "text/event-stream"}), timeout=5)
            raise AssertionError("GET /mcp does not return 405")
        except urllib.error.HTTPError as e:
            assert e.code == 405, e.code
        try:  # right origin, wrong token
            async with websockets.connect(f"ws://127.0.0.1:{RELAY_PORT}/ext?token=wrong", origin="chrome-extension://x") as w:
                await w.recv()
            raise AssertionError("/ext accepts a wrong token")
        except (websockets.ConnectionClosed, websockets.InvalidStatus):
            pass
        for origin in ("http://evil.example", None):  # /ext only for the extension
            try:
                async with websockets.connect(f"ws://127.0.0.1:{RELAY_PORT}/ext?token={TOKEN}", origin=origin) as w:
                    await w.recv()
                raise AssertionError(f"/ext accepts origin {origin}")
            except (websockets.ConnectionClosed, websockets.InvalidStatus):
                pass
        print(f"OK (scale {scale})")
    finally:
        for p in procs:
            p.terminate()
        for p in procs:
            p.wait(10)
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    for scale in (1, 2):
        asyncio.run(run(scale))
