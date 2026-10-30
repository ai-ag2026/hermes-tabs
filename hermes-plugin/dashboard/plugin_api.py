"""Backend of the settings page: passes reads/writes through to the relay (/api/plugins/hermes-tabs/settings)."""

import importlib.util
import urllib.error
from pathlib import Path

from fastapi import APIRouter, HTTPException

_spec = importlib.util.spec_from_file_location("hermes_tabs_plugin", Path(__file__).resolve().parent.parent / "__init__.py")
_plugin = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_plugin)

router = APIRouter()
KEYS = _plugin.KEYS
OWN = {"guardOtherTools"}  # settings of the plugin itself, kept on the Hermes side (not in the browser)
# Loosening needs the human's confirmation in the browser: the extension waits 120 s, the relay 130 s, we a little longer.
CONFIRM_TIMEOUT = 140


def _call(method, body=None, **kw):
    try:
        return _plugin.relay(method, body, **kw)
    except Exception as exc:  # browser closed, relay gone, token missing, extension rejects
        detail = getattr(exc, "read", lambda: b"")().decode(errors="replace") or str(exc)
        # Relay 4xx (e.g. 409: another change is waiting for confirmation, invalid safety value) goes through with its
        # status and text; 401 stays 502 (it would mean a wrong admin token, not an answer for the user).
        code = exc.code if isinstance(exc, urllib.error.HTTPError) and 400 <= exc.code < 500 and exc.code != 401 else 502
        raise HTTPException(status_code=code, detail=detail if code != 502 else f"Browser not reachable or value rejected: {detail}")


@router.get("/settings")
def get_settings(device: str | None = None):  # sync: FastAPI runs this in the thread pool, so blocking urllib is fine
    return {**_call("GET", device=device), "guardOtherTools": _plugin.options().get("guardOtherTools") is True}


@router.post("/settings")
def set_settings(body: dict, device: str | None = None):
    unknown = set(body) - KEYS - OWN
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown setting: {', '.join(sorted(unknown))}")
    own = {k: body.pop(k) is True for k in OWN & set(body)}
    if own:
        _plugin.set_options(own)
    result = _call("POST", body, device=device, timeout=CONFIRM_TIMEOUT) if body else _call("GET", device=device)
    return {**result, "guardOtherTools": _plugin.options().get("guardOtherTools") is True}


@router.post("/select")
def select_browser(body: dict):
    """The user picks the browser Hermes works in."""
    return _call("POST", {"deviceId": str(body.get("deviceId", ""))}, path="/admin/select")
