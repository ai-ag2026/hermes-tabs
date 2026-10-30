const $ = (id) => document.getElementById(id);
const msg = (key, ...subs) => chrome.i18n.getMessage(key, subs);
for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = msg(el.dataset.i18n);
document.documentElement.lang = chrome.i18n.getUILanguage();
document.documentElement.dir = msg("@@bidi_dir");
$("version").textContent = chrome.runtime.getManifest().version;

chrome.storage.local.get({ relay: "ws://127.0.0.1:8766/ext", token: "", browserName: "" }).then((c) => {
  $("relay").value = c.relay;
  $("token").value = c.token;
  $("browserName").value = c.browserName;
});
// The service worker creates a default name ("Vega 42") when none is stored
chrome.storage.onChanged.addListener((c, area) => area === "local" && c.browserName && ($("browserName").value = c.browserName.newValue ?? ""));

$("save").onclick = async () => {
  await chrome.storage.local.set({ relay: $("relay").value.trim(), token: $("token").value.trim(), browserName: $("browserName").value.trim() });
  $("status").textContent = msg("optSaved");
};

// Site permissions: view, revoke, choose mode and time window
function siteList(id, area, key, sites) {
  const list = $(id);
  list.replaceChildren();
  for (const origin of Object.keys(sites).sort()) {
    const li = document.createElement("li"), span = document.createElement("span"), b = document.createElement("button");
    span.textContent = origin;
    b.textContent = msg("optRevoke");
    b.onclick = async () => {
      const now = (await chrome.storage[area].get(key))[key] ?? {};
      delete now[origin];
      await chrome.storage[area].set({ [key]: now });
    };
    li.append(span, b);
    list.append(li);
  }
  if (!list.children.length) list.innerHTML = `<li class="none">${msg("optNone")}</li>`;
}

async function showSites() {
  const { siteMode = "ask", allowedSites = {}, allowAllUntil = 0 } = await chrome.storage.local.get(["siteMode", "allowedSites", "allowAllUntil"]);
  const { sessionSites = {}, allowAllSession = false } = await chrome.storage.session.get(["sessionSites", "allowAllSession"]);
  for (const r of document.getElementsByName("mode")) r.checked = r.value === siteMode;
  $("temp").textContent = allowAllSession ? msg("optActiveSession")
    : allowAllUntil > Date.now() ? msg("optActiveUntil", new Date(allowAllUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
    : msg("optOff");
  siteList("sites", "local", "allowedSites", allowedSites);
  const { enabled = true, blockedSites = [] } = await chrome.storage.local.get(["enabled", "blockedSites"]);
  $("enabled").checked = enabled;
  const bl = $("blocked");
  bl.replaceChildren();
  for (const d of blockedSites) {
    const li = document.createElement("li"), span = document.createElement("span"), b = document.createElement("button");
    span.textContent = d;
    b.textContent = msg("optRemove");
    b.onclick = () => chrome.storage.local.set({ blockedSites: blockedSites.filter((x) => x !== d) });
    li.append(span, b);
    bl.append(li);
  }
  if (!bl.children.length) bl.innerHTML = `<li class="none">${msg("optNone")}</li>`;
  siteList("sessionSites", "session", "sessionSites", sessionSites);
}
for (const r of document.getElementsByName("mode")) r.onchange = () => chrome.storage.local.set({ siteMode: r.value });
for (const b of document.querySelectorAll("button[data-t]")) b.onclick = async () => {
  const t = b.dataset.t, h = 3600e3;
  if (t === "allSession") await chrome.storage.session.set({ allowAllSession: true });
  else if (t === "off") { await chrome.storage.session.set({ allowAllSession: false }); await chrome.storage.local.set({ allowAllUntil: 0 }); }
  else await chrome.storage.local.set({ allowAllUntil: Date.now() + (t === "all1h" ? 1 : 8) * h });
};
chrome.storage.onChanged.addListener(showSites);
showSites();
setInterval(showSites, 30000);
$("enabled").onchange = () => chrome.storage.local.set({ enabled: $("enabled").checked });
$("blockAdd").onclick = async () => {
  const d = $("blockNew").value.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^\*\./, "").split(/[/:?#]/)[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return alert(msg("optBadDomain"));
  const { blockedSites = [] } = await chrome.storage.local.get("blockedSites");
  await chrome.storage.local.set({ blockedSites: [...new Set([...blockedSites, d])].sort() });
  $("blockNew").value = "";
};

// Safety: tier and single switches (safety.js). Loosening asks first; "full" also allows all websites without asking.
const WARN_FLAGS = ["passwords", "scriptWrites", "frameTyping"];
function optionRow(key, input, warn) {
  const row = document.createElement("label");
  row.className = warn ? "row warn" : "row";
  row.innerHTML = '<div><div class="title"></div><div class="desc"></div></div>';
  row.querySelector(".title").textContent = msg(key);
  row.querySelector(".desc").textContent = msg(key + "_desc");
  row.append(input);
  return row;
}
for (const t of [...Object.keys(SAFETY_TIERS), "custom"]) {
  const r = Object.assign(document.createElement("input"), { type: "radio", name: "tier", value: t, disabled: t === "custom" });
  r.onchange = () => changeSafety(SAFETY_TIERS[t], true);
  $("tiers").append(Object.assign(optionRow(`tier_${t}`, r), { id: `tier-${t}` }));
}
for (const k of SAFETY_KEYS) {
  const c = Object.assign(document.createElement("input"), { type: "checkbox", className: "switch", id: `safety-${k}` });
  c.onchange = async () => changeSafety({ ...(await getSafety()), [k]: c.checked }, false);
  $("switches").append(optionRow(`safety_${k}`, c, k === "passwords"));
}

async function changeSafety(want, isTier) {
  const cur = await getSafety(), next = resolveSafety(want);
  const up = loosenedKeys(cur, next), allSites = next.tier === "full" && cur.tier !== "full";
  const list = up.map((k) => msg(`safety_${k}`)).concat(allSites ? [msg("optModeAll")] : []);
  if (list.length && (isTier || allSites || up.some((k) => WARN_FLAGS.includes(k)))) {
    const text = msg("warnLoosen", list.join(", ")) + (up.includes("passwords") ? "\n\n" + msg("warnPasswords") : "");
    if (!confirm(text)) return showSafety();
  }
  await chrome.storage.local.set({ safety: next, ...(allSites && { siteMode: "all" }) });
}

async function showSafety() {
  const s = await getSafety();
  for (const r of document.getElementsByName("tier")) r.checked = r.value === s.tier;
  $("tier-custom").hidden = s.tier !== "custom";
  for (const k of SAFETY_KEYS) $(`safety-${k}`).checked = s[k];
  const { pendingLoosening: p } = await chrome.storage.session.get("pendingLoosening");
  $("pending").hidden = !p;
  if (p) {
    $("pendingText").textContent = msg("looseText", p.summary);
    $("pendingYes").onclick = () => chrome.runtime.sendMessage({ type: "loosening", id: p.id, ok: true }).catch(() => {});
    $("pendingNo").onclick = () => chrome.runtime.sendMessage({ type: "loosening", id: p.id, ok: false }).catch(() => {});
  }
}
chrome.storage.onChanged.addListener(showSafety);
showSafety();
