"""Backend of the settings page: passes reads/writes through to the relay (/api/plugins/hermes-tabs/settings)."""

import importlib.util
from pathlib import Path

from fastapi import APIRouter, HTTPException

_spec = importlib.util.spec_from_file_location("hermes_tabs_plugin", Path(__file__).resolve().parent.parent / "__init__.py")
_plugin = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_plugin)

router = APIRouter()
KEYS = {"enabled", "siteMode", "allowAll", "sites", "blockedSites"}


def _call(method, body=None):
    try:
        return _plugin.relay(method, body)
    except Exception as exc:  # browser closed, relay gone, token missing, extension rejects
        detail = getattr(exc, "read", lambda: b"")().decode(errors="replace") or str(exc)
        raise HTTPException(status_code=502, detail=f"Browser not reachable or value rejected: {detail}")


@router.get("/settings")
def get_settings():  # sync: FastAPI runs this in the thread pool, so blocking urllib is fine
    return _call("GET")


@router.post("/settings")
def set_settings(body: dict):
    unknown = set(body) - KEYS
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown setting: {', '.join(sorted(unknown))}")
    return _call("POST", body)
