"""hermes-tabs plugin - browser permission settings for the Hermes agent.

The settings belong to the browser extension (chrome.storage in the user's browser). The relay passes them
through via ``/admin/settings`` (``/admin/select`` picks the browser Hermes works in when several are connected);
both need ``HERMES_TABS_ADMIN_TOKEN`` (e.g. in ``~/.hermes/.env``). The hook judges by the browser Hermes works in.
The extension enforces everything itself (it sees the real tab URL, including after redirects).

This hook complements that for Hermes' other tools:

* Master switch off -> ``mcp__tabs__*`` is rejected (saves the round trip to the browser).
* Blocked sites -> ``browser_exec``/``browser_cdp`` (Hermes' own browser) and ``web_extract`` also reject
  calls whose arguments contain a blocked domain. Limit: ``browser_exec`` is free-form code - assembled URLs
  or clicks on links are not detected by the hook.
* Hermes never operates its own settings pages (web UI, dashboard), otherwise it could grant itself rights.
  List the hosts of those pages in ``HERMES_TABS_OWN_HOSTS`` (comma-separated, e.g. ``hermes.example.org,10.0.0.5``).

If the browser is closed, the last seen state applies (``plugin-data/hermes-tabs/settings.json``).

Environment: ``HERMES_TABS_RELAY`` (default ``http://127.0.0.1:8766``), ``HERMES_TABS_ADMIN_TOKEN``,
``HERMES_TABS_OWN_HOSTS`` (default empty).
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

try:
    from agent.secret_scope import get_secret_str  # honours the active Hermes profile
except ImportError:  # outside Hermes (self-test)
    def get_secret_str(name: str, default: str = "") -> str:
        return os.environ.get(name, default)

logger = logging.getLogger(__name__)

RELAY = os.environ.get("HERMES_TABS_RELAY", "http://127.0.0.1:8766").rstrip("/")
CACHE = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")) / "plugin-data" / "hermes-tabs" / "settings.json"
# Own user interfaces: Hermes must not grant itself rights through the browser.
OWN_HOSTS = tuple(h.strip().lower() for h in os.environ.get("HERMES_TABS_OWN_HOSTS", "").split(",") if h.strip())
BROWSER_TOOLS = ("browser_exec", "browser_cdp", "web_extract")
URL_RE = re.compile(r"(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?=[:/\s\"'?#]|$)", re.I)

# Settings the settings page may write (the extension decides which changes need the human's confirmation).
KEYS = {"enabled", "siteMode", "allowAll", "sites", "blockedSites", "safety"}

_cache: Dict[str, Any] = {"at": 0.0, "settings": None}


def relay(method: str = "GET", body: Optional[dict] = None, timeout: float = 5, device: Optional[str] = None,
          path: str = "/admin/settings") -> dict:
    """Read/write the settings via the relay (admin token from the environment). Several browsers can be
    connected: device picks one, without it the relay answers for the browser the agent's calls go to."""
    token = get_secret_str("HERMES_TABS_ADMIN_TOKEN")
    if not token:
        raise RuntimeError("HERMES_TABS_ADMIN_TOKEN is missing (e.g. in ~/.hermes/.env)")
    query = "?" + urllib.parse.urlencode({"device": device}) if device else ""
    req = urllib.request.Request(f"{RELAY}{path}{query}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        settings = json.load(r)
    if path == "/admin/settings" and settings.get("browser", {}).get("inUse", True):
        _remember(settings)  # the hook judges by the browser the agent's calls go to
    return settings


def _remember(settings: dict) -> None:
    _cache.update(at=time.time(), settings=settings)
    try:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(settings))
    except OSError:
        pass


def settings() -> dict:
    """Current state, at most 15 s old; without a browser, the last seen one."""
    if _cache["settings"] is not None and time.time() - _cache["at"] < 15:
        return _cache["settings"]
    try:
        s = relay(timeout=3)
        if s.get("browser", {}).get("inUse", True) is False:  # no browser in use (the relay answered for another one)
            raise RuntimeError("no browser in use")
        return s
    except Exception as exc:
        logger.debug("hermes-tabs: relay not reachable (%s), using last known state", exc)
        if _cache["settings"] is None and CACHE.exists():
            _cache["settings"] = json.loads(CACHE.read_text())
        _cache["at"] = time.time()  # do not retry on every call
        return _cache["settings"] or {}


def _hosts(value: Any):
    if isinstance(value, str):
        for m in URL_RE.finditer(value):
            yield m.group(1).lower()
    elif isinstance(value, dict):
        for v in value.values():
            yield from _hosts(v)
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from _hosts(v)


def _matches(host: str, domains) -> Optional[str]:
    return next((d for d in domains if host == d or host.endswith("." + d)), None)


def decide(tool_name: str, args: Any, current: dict) -> Optional[Dict[str, str]]:
    is_tabs = tool_name.startswith("mcp__tabs__")
    if not (is_tabs or tool_name in BROWSER_TOOLS):
        return None
    if is_tabs and current.get("enabled") is False:
        return {"action": "block", "message": "Hermes in the browser is turned off (Settings -> Plugins -> Hermes in the browser). "
                                               "Do not work around it; ask the user."}
    hosts = set(_hosts(args))
    for h in hosts:
        if _matches(h, OWN_HOSTS):
            return {"action": "block", "message": f"{h} is Hermes' own interface - Hermes does not operate it itself."}
        d = _matches(h, current.get("blockedSites") or [])
        if d:
            return {"action": "block", "message": f"{d} is on the \"Blocked sites\" list (Hermes in the browser) - do not use it, "
                                                   "not even through other tools."}
    return None


def _on_pre_tool_call(tool_name: str = "", args: Any = None, **_: Any) -> Optional[Dict[str, str]]:
    if not tool_name or not (tool_name.startswith("mcp__tabs__") or tool_name in BROWSER_TOOLS):
        return None
    try:
        return decide(tool_name, args, settings())
    except Exception as exc:  # the extension enforces on its own; a broken hook must not block everything
        logger.warning("hermes-tabs: error in hook for %s: %s", tool_name, exc)
        return None


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", _on_pre_tool_call)


if __name__ == "__main__":  # self-test without Hermes or network
    s = {"enabled": True, "blockedSites": ["linkedin.com"]}
    assert decide("terminal", {"cmd": "curl linkedin.com"}, s) is None
    assert decide("mcp__tabs__navigate", {"url": "https://www.linkedin.com/feed"}, s)["action"] == "block"
    assert decide("browser_exec", {"code": "page.goto('https://de.linkedin.com/x')"}, s)["action"] == "block"
    assert decide("mcp__tabs__navigate", {"url": "https://example.com"}, s) is None
    assert decide("mcp__tabs__navigate", {"url": "https://notlinkedin.com"}, s) is None
    assert decide("browser_exec", {"code": "goto('https://hermes.example.org/settings')"}, s) is None  # OWN_HOSTS empty by default
    OWN_HOSTS = ("hermes.example.org", "10.0.0.5")
    assert "own interface" in decide("browser_exec", {"code": "goto('https://hermes.example.org/settings')"}, s)["message"]
    assert "own interface" in decide("browser_exec", {"code": "goto('http://10.0.0.5:9119/')"}, s)["message"]
    assert "turned off" in decide("mcp__tabs__read_page", {"tabId": 1}, {"enabled": False})["message"]
    assert decide("browser_exec", {"code": "x"}, {"enabled": False}) is None  # the switch only concerns the extension
    print("ok")
