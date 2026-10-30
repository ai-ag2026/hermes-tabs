# hermes-tabs plugin

Settings page and guard rails for [hermes-tabs](https://github.com/ai-ag2026/hermes-tabs), which lets Hermes work in individual tabs of your real, signed-in Chromium browser (Chrome, Vivaldi, Edge, Brave) through an extension and a small MCP relay.

**This plugin alone does nothing.** It needs the hermes-tabs relay and browser extension from the main repository, and the relay registered in Hermes as the MCP server `tabs`. Setup: see the [main README](https://github.com/ai-ag2026/hermes-tabs#quickstart).

## What it adds

- **Settings → Plugins → "Hermes in the Browser"** (desktop half, opt-in): which browser Hermes works in (when several are connected to the relay: show each one's settings, pick the one for Hermes), master switch, default for all websites (ask or allow all), temporary "allow all", allowed and blocked sites. The values live in the browser extension and are enforced there.
- **`pre_tool_call` hook:**
  - master switch off: `mcp__tabs__*` calls are rejected early;
  - blocked sites also apply to Hermes' own browser tools (`browser_exec`, `browser_cdp`) and `web_extract` when the domain appears in the arguments;
  - hosts listed in `HERMES_TABS_OWN_HOSTS` (the agent's own interface) are never operated, so the agent cannot grant itself permissions through the browser.

## Configuration

| Variable | Purpose |
|---|---|
| `HERMES_TABS_ADMIN_TOKEN` | required; admin token of the relay (read through Hermes' secret scope) |
| `HERMES_TABS_RELAY` | relay URL, default `http://127.0.0.1:8766` |
| `HERMES_TABS_OWN_HOSTS` | comma-separated hosts of the agent's own interface, default empty |

## Disclosure

- **Network:** HTTP requests only to the hermes-tabs relay you configure (`HERMES_TABS_RELAY`, default localhost), paths `/admin/settings` and `/admin/select`, authenticated with `HERMES_TABS_ADMIN_TOKEN`. No third-party services, no telemetry.
- **Files:** caches the last seen settings in `<HERMES_HOME>/plugin-data/hermes-tabs/settings.json`, of the browser Hermes works in, so the hook keeps working while the browser is closed. No other reads outside the plugin's own data.
- **No** shell commands, background processes, self-updates or stored credentials.

License: MIT
