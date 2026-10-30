// Safety settings (storage.local "safety"): four tiers plus single switches for a custom cut.
// Shared by background.js (importScripts) and options.js (<script>). Missing settings (installations before 0.9) = standard.
const SAFETY_TIERS = {
  read: { act: false, js: false, navigate: false, upload: false, download: false, devtools: true,
    scriptWrites: false, frameTyping: false, passwords: false, closeShared: false },
  standard: { act: true, js: true, navigate: true, upload: true, download: true, devtools: true,
    scriptWrites: false, frameTyping: false, passwords: false, closeShared: false },
  extended: { act: true, js: true, navigate: true, upload: true, download: true, devtools: true,
    scriptWrites: true, frameTyping: true, passwords: false, closeShared: true },
  full: { act: true, js: true, navigate: true, upload: true, download: true, devtools: true,
    scriptWrites: true, frameTyping: true, passwords: true, closeShared: true },
};
const SAFETY_KEYS = Object.keys(SAFETY_TIERS.standard);
// The tier follows from the switches: a combination that matches no tier is "custom".
const tierOf = (f) => Object.keys(SAFETY_TIERS).find((t) => SAFETY_KEYS.every((k) => SAFETY_TIERS[t][k] === f[k])) ?? "custom";
function resolveSafety(s) {
  const base = SAFETY_TIERS[Object.hasOwn(SAFETY_TIERS, s?.tier ?? "") ? s.tier : "standard"];
  const f = Object.fromEntries(SAFETY_KEYS.map((k) => [k, typeof s?.[k] === "boolean" ? s[k] : base[k]]));
  return { tier: tierOf(f), ...f };
}
const getSafety = async () => resolveSafety((await chrome.storage.local.get("safety")).safety);
// Switches that go from off to on = loosening (needs the user's confirmation)
const loosenedKeys = (from, to) => SAFETY_KEYS.filter((k) => !from[k] && to[k]);
