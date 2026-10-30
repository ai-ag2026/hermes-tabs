"""Takes the README screenshots with the real extension in headless Chromium (needs internet for Wikipedia).

    uv run python docs/screenshots.py

Writes docs/options-<lang>.png and docs/consent-<lang>.png for en and de; docs/plugin-en.png is a manual screenshot of
the Hermes settings page. The consent picture is staged: the overlay is shown through the extension's own functions on
a Wikipedia article, no click is sent.
"""
import asyncio
import base64
import itertools
import json
import os
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

import websockets

HERE = Path(__file__).parent
EXT = HERE.parent / "extension"
PORT = int(os.environ.get("SHOTS_CDP_PORT", 9381))
ARTICLE = {"en": "https://en.wikipedia.org/wiki/Hermes?banner=none", "de": "https://de.wikipedia.org/wiki/Hermes?banner=none"}
ASK = {"en": "Open the section “Etymology”", "de": "Abschnitt „Etymologie“ öffnen"}


def targets():
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))


async def cdp(target, method, **params):
    async with websockets.connect(target["webSocketDebuggerUrl"], max_size=None) as ws:
        n = itertools.count(1)
        i = next(n)
        await ws.send(json.dumps({"id": i, "method": method, "params": params}))
        while (m := json.loads(await ws.recv())).get("id") != i:
            pass
        assert "error" not in m, m
        return m["result"]


async def sw_eval(expr):
    sw = next(t for t in targets() if t["type"] == "service_worker")
    r = await cdp(sw, "Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
    return r["result"].get("value")


async def shoot(url_part, path, full=False):
    t = next(t for t in targets() if t["type"] == "page" and url_part in t["url"])
    await cdp(t, "Page.bringToFront")
    await asyncio.sleep(0.5)
    path.write_bytes(base64.b64decode((await cdp(t, "Page.captureScreenshot", captureBeyondViewport=full))["data"]))
    print(path)


async def take(lang):
    prof = tempfile.mkdtemp(prefix="shots-")
    proc = subprocess.Popen([shutil.which("chromium") or "google-chrome", "--headless=new", "--no-first-run", f"--lang={lang}",
                             f"--user-data-dir={prof}", f"--remote-debugging-port={PORT}", f"--load-extension={EXT}",
                             f"--disable-extensions-except={EXT}", "--disable-features=DisableLoadExtensionCommandLineSwitch",
                             "--window-size=1100,760", "about:blank"], stderr=subprocess.DEVNULL,
                            env={**os.environ, "LANGUAGE": lang, "LANG": f"{lang}.UTF-8"})
    try:
        for _ in range(50):
            try:
                if any(t["type"] == "service_worker" for t in targets()):
                    break
            except Exception:
                pass
            await asyncio.sleep(0.2)
        await asyncio.sleep(1)
        await sw_eval("chrome.storage.local.set({token: 'demo', relay: 'ws://hermes.example:8766/ext', browserName: 'Vega 42', "
                      "allowedSites: {'https://github.com': true}, blockedSites: ['bank.example']})"
                      ".then(() => chrome.tabs.create({url: chrome.runtime.getURL('options.html')})).then(() => 1)")
        await asyncio.sleep(1.5)
        await shoot("options.html", HERE / f"options-{lang}.png", full=True)
        summary = json.dumps(ASK[lang])
        print(await sw_eval(f"chrome.tabs.create({{url: {json.dumps(ARTICLE[lang])}}}).then(async (t) => {{"
                            " await new Promise((r) => setTimeout(r, 4000)); await setShared(t.id, 'user');"
                            " await page(t.id, 'overlay', {active: true, x: 330, y: 300, label: ACTION_LABELS.left_click, t: OVERLAY_TEXT, logo: await LOGO});"
                            f" await show(t.id, {{ask: msg('askText', new URL(t.pendingUrl || t.url).host) + ': ' + {summary}}}); return t.id; }}).catch(String)"))
        await asyncio.sleep(1)
        await shoot("wikipedia.org", HERE / f"consent-{lang}.png")
    finally:
        proc.terminate()
        proc.wait(10)
        shutil.rmtree(prof, ignore_errors=True)


if __name__ == "__main__":
    for lang in ARTICLE:
        asyncio.run(take(lang))
