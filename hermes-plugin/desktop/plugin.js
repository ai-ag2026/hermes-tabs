// Hermes in the browser - settings page (Settings -> Plugins -> Hermes in the browser).
// The values belong to the browser extension; the backend (dashboard/plugin_api.py) passes them through the relay.
import {
  atom, Button, Input, ListRow, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, ToggleRow, useValue
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const muted = 'text-(--ui-text-tertiary)'

// English is the default; German is picked when the browser language starts with "de".
const de = typeof navigator !== 'undefined' && navigator.language?.startsWith('de')
const STR = {
  en: {
    name: 'Hermes in the browser',
    remove: 'Remove',
    unreachable: e => `Browser not reachable: ${e}. Is the browser open with the extension?`,
    loading: 'Loading …',
    untilRestart: 'until the browser restarts',
    untilTime: t => `until ${t}`,
    enable: 'Enable Hermes in the browser',
    enableDesc: 'Hermes operates tabs in your browser through the hermes-tabs extension. Off: Hermes cannot do anything there.',
    permissions: 'Website permissions',
    permissionsDesc: 'These apply to the extension; blocked sites also apply to Hermes’ own browser. Reading is always free on allowed sites, clicking and typing need approval.',
    defaultAll: 'Default for all websites',
    defaultAllOn: 'Hermes acts everywhere except on blocked sites.',
    defaultAllAsk: 'Hermes asks before the first click on a website (in the tab and via notification).',
    optAll: 'Allow all websites',
    optAsk: 'Ask for each website',
    tempAll: 'Temporarily allow all websites',
    tempActive: u => `Active ${u}.`,
    tempOff: 'Off.',
    h1: '1 hr', h8: '8 hrs', session: 'Until restart', stop: 'Stop',
    allowedSites: 'Allowed sites',
    always: 'always',
    untilRestartShort: 'until restart',
    allowedEmpty: 'None yet. Approval is given in the tab (“Website: always” / “until restart”).',
    blockedSites: 'Blocked sites',
    blockedDesc: 'Hermes cannot be used on these websites (subdomains included) - not even for reading.',
    add: '+ Add website',
    blockedEmpty: 'No websites added yet.',
    browser: 'Browser',
    inUse: n => `Hermes works in “${n}”. The settings below belong to the browser chosen here.`,
    noneInUse: 'No browser is chosen for Hermes right now (or the chosen one is not connected).',
    hermesHere: 'Hermes works here',
    useTitle: n => `Use “${n}” for Hermes`,
    useDesc: 'Hermes’ browser calls then go to this browser.',
    use: 'Use'
  },
  de: {
    name: 'Hermes im Browser',
    remove: 'Entfernen',
    unreachable: e => `Browser nicht erreichbar: ${e}. Ist der Browser mit der Extension offen?`,
    loading: 'Lade …',
    untilRestart: 'bis zum Browser-Neustart',
    untilTime: t => `bis ${t} Uhr`,
    enable: 'Hermes im Browser aktivieren',
    enableDesc: 'Hermes bedient Tabs in deinem Browser über die Hermes-Tabs-Extension. Aus: Hermes kann dort gar nichts tun.',
    permissions: 'Website-Berechtigungen',
    permissionsDesc: 'Gelten für die Extension; blockierte Seiten auch für Hermes’ eigenen Browser. Lesen ist auf erlaubten Seiten immer frei, Klicken und Tippen braucht die Freigabe.',
    defaultAll: 'Standard für alle Websites',
    defaultAllOn: 'Hermes handelt überall, außer auf blockierten Seiten.',
    defaultAllAsk: 'Hermes fragt vor dem ersten Klick auf einer Website (im Tab und per Benachrichtigung).',
    optAll: 'Alle Websites erlauben',
    optAsk: 'Bei jeder Website fragen',
    tempAll: 'Vorübergehend alle Websites erlauben',
    tempActive: u => `Aktiv ${u}.`,
    tempOff: 'Aus.',
    h1: '1 Std.', h8: '8 Std.', session: 'Bis Neustart', stop: 'Beenden',
    allowedSites: 'Erlaubte Seiten',
    always: 'immer',
    untilRestartShort: 'bis Neustart',
    allowedEmpty: 'Noch keine. Erlaubt wird im Tab („Website: immer“ / „bis Neustart“).',
    blockedSites: 'Blockierte Seiten',
    blockedDesc: 'Hermes kann auf diesen Websites nicht verwendet werden (Subdomains eingeschlossen) – auch nicht lesen.',
    add: '+ Website hinzufügen',
    blockedEmpty: 'Noch keine Websites hinzugefügt.',
    browser: 'Browser',
    inUse: n => `Hermes arbeitet in „${n}“. Die Einstellungen unten gehören zum hier gewählten Browser.`,
    noneInUse: 'Für Hermes ist gerade kein Browser gewählt (oder der gewählte ist nicht verbunden).',
    hermesHere: 'Hermes arbeitet hier',
    useTitle: n => `„${n}“ für Hermes verwenden`,
    useDesc: 'Hermes’ Browser-Aufrufe gehen dann an diesen Browser.',
    use: 'Verwenden'
  }
}
const t = STR[de ? 'de' : 'en']

export default {
  id: 'hermes-tabs',
  name: t.name,
  register(ctx) {
    // Several browsers can be connected to the relay. The page always shows and saves exactly the browser that
    // the displayed settings belong to (s.browser); without one, the relay answers for the browser Hermes uses.
    const state = atom({ s: null, error: null })
    const qs = device => (device ? `?device=${encodeURIComponent(device)}` : '')
    const shown = () => state.get().s?.browser?.deviceId
    const fail = e => state.set({ ...state.get(), error: String(e?.message ?? e) })
    let seq = 0 // only the newest request may change the page (an older interval load must not switch back)

    const load = (device = shown()) => {
      const n = ++seq
      return ctx.rest(`/settings${qs(device)}`).then(
        s => n === seq && state.set({ s, error: null }),
        e => n !== seq ? null : device ? load(null) : fail(e) // that browser is gone: show the one Hermes uses
      )
    }
    const save = body => {
      const n = ++seq
      return ctx.rest(`/settings${qs(shown())}`, { method: 'POST', body }).then(s => n === seq && state.set({ s, error: null }), fail)
    }
    const use = deviceId => ctx.rest('/select', { method: 'POST', body: { deviceId } }).then(() => load(deviceId), fail)
    load()
    ctx.setInterval(() => load(), 30000)

    function SiteList({ entries, onRemove, empty }) {
      if (!entries.length) return jsx('div', { className: `py-2 text-xs ${muted}`, children: empty })
      return jsx('div', {
        children: entries.map(([label, key]) =>
          jsx(ListRow, {
            title: label,
            action: jsx(Button, { size: 'xs', variant: 'outline', onClick: () => onRemove(key), children: t.remove })
          }, key)
        )
      })
    }

    function Page() {
      const { s, error } = useValue(state)
      if (!s) {
        return jsx('div', {
          className: `p-3 text-sm ${muted}`,
          children: error ? t.unreachable(error) : t.loading
        })
      }
      const until = s.allowAllSession ? t.untilRestart
        : s.allowAllUntil ? t.untilTime(new Date(s.allowAllUntil).toLocaleTimeString(de ? 'de-DE' : undefined, { hour: '2-digit', minute: '2-digit' })) : null
      const allowed = [
        ...Object.keys(s.allowedSites ?? {}).map(o => [`${o} · ${t.always}`, ['always', o]]),
        ...Object.keys(s.sessionSites ?? {}).map(o => [`${o} · ${t.untilRestartShort}`, ['session', o]])
      ]
      return jsxs('div', {
        className: 'flex flex-col gap-1',
        children: [
          error ? jsx('div', { className: 'text-xs text-red-500', children: error }) : null,
          jsx(Browsers, { s }),
          jsx(ToggleRow, {
            checked: s.enabled !== false,
            label: t.enable,
            description: t.enableDesc,
            onChange: on => save({ enabled: on })
          }),
          jsx('h3', { className: 'mt-4 text-sm font-medium', children: t.permissions }),
          jsx('div', { className: `text-xs ${muted}`, children: t.permissionsDesc }),
          jsx(ListRow, {
            title: t.defaultAll,
            description: s.siteMode === 'all' ? t.defaultAllOn : t.defaultAllAsk,
            action: jsxs(Select, {
              value: s.siteMode ?? 'ask',
              onValueChange: v => save({ siteMode: v }),
              children: [
                jsx(SelectTrigger, { className: 'w-56', children: jsx(SelectValue, {}) }),
                jsxs(SelectContent, {
                  children: [
                    jsx(SelectItem, { value: 'all', children: t.optAll }),
                    jsx(SelectItem, { value: 'ask', children: t.optAsk })
                  ]
                })
              ]
            })
          }),
          s.siteMode !== 'all' ? jsx(ListRow, {
            title: t.tempAll,
            description: until ? t.tempActive(until) : t.tempOff,
            action: jsxs('div', {
              className: 'flex flex-wrap gap-1',
              children: [
                ['1h', t.h1], ['8h', t.h8], ['session', t.session], ['off', t.stop]
              ].map(([v, label]) => jsx(Button, { size: 'xs', variant: 'outline', onClick: () => save({ allowAll: v }), children: label }, v))
            })
          }) : null,
          jsx('h3', { className: 'mt-4 text-sm font-medium', children: t.allowedSites }),
          jsx(SiteList, {
            entries: allowed,
            empty: t.allowedEmpty,
            onRemove: ([, origin]) => save({ sites: { [origin]: 'off' } })
          }),
          jsx(BlockedSites, { s })
        ]
      })
    }

    function Browsers({ s }) {
      const list = s.browsers ?? []
      if (!s.browser || !list.length) return null
      const inUse = list.find(b => b.inUse)
      return jsxs('div', {
        children: [
          jsx(ListRow, {
            title: t.browser,
            description: inUse ? t.inUse(inUse.name) : t.noneInUse,
            action: jsxs(Select, {
              value: s.browser.deviceId,
              onValueChange: d => load(d),
              children: [
                jsx(SelectTrigger, { className: 'w-56', children: jsx(SelectValue, {}) }),
                jsx(SelectContent, {
                  children: list.map(b => jsx(SelectItem, { value: b.deviceId, children: b.inUse ? `${b.name} · ${t.hermesHere}` : b.name }, b.deviceId))
                })
              ]
            })
          }),
          s.browser.inUse ? null : jsx(ListRow, {
            title: t.useTitle(s.browser.name),
            description: t.useDesc,
            action: jsx(Button, { size: 'xs', variant: 'outline', onClick: () => use(s.browser.deviceId), children: t.use })
          })
        ]
      })
    }

    function BlockedSites({ s }) {
      const blocked = s.blockedSites ?? []
      const add = e => {
        e.preventDefault()
        const input = e.currentTarget.elements.domain
        const d = input.value.trim()
        if (!d) return
        save({ blockedSites: [...blocked, d] }).then(() => { input.value = '' })
      }
      return jsxs('div', {
        children: [
          jsx('h3', { className: 'mt-4 text-sm font-medium', children: t.blockedSites }),
          jsx('div', { className: `text-xs ${muted}`, children: t.blockedDesc }),
          jsxs('form', {
            className: 'my-2 flex gap-2',
            onSubmit: add,
            children: [
              jsx(Input, { name: 'domain', placeholder: 'example.com', className: 'max-w-xs' }),
              jsx(Button, { type: 'submit', size: 'sm', children: t.add })
            ]
          }),
          jsx(SiteList, {
            entries: blocked.map(d => [d, d]),
            empty: t.blockedEmpty,
            onRemove: d => save({ blockedSites: blocked.filter(x => x !== d) })
          })
        ]
      })
    }

    ctx.registerSettingsPage?.({ id: 'settings', title: t.name, icon: 'browser', render: () => jsx(Page, {}) })
  }
}
