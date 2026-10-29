// Runs in the page (injected via Runtime.evaluate): HERMES_PAGE(op, arg).
// Also walks open shadow DOMs and same-origin iframes. References (ref_N) live in a table of
// the top window (WeakRef), not in the DOM: copies of an element (cloneNode, templates) do not
// inherit them, and removed elements report "not found".
// eslint-disable-next-line no-unused-vars
function HERMES_PAGE(op, arg) {
  const TOP = window;
  // Every page gets its own number range: a reference from before never hits a different element
  // by chance after a navigation ("not found" instead of a wrong click).
  TOP.__hermesRef ??= (Math.floor(Math.random() * 1e8) + 1e6) * 1e4; // 10,000 refs per page, collision ~1:10^8
  TOP.__hermesRefs ??= new Map(); // N -> WeakRef(Element)

  const TAGS = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);
  const ROLES = new Set([
    "button", "link", "checkbox", "radio", "tab", "menuitem", "menuitemcheckbox", "menuitemradio",
    "option", "combobox", "textbox", "searchbox", "switch", "slider", "spinbutton", "treeitem", "listbox",
  ]);
  const LANDMARKS = new Set(["NAV", "MAIN", "HEADER", "FOOTER", "FORM", "DIALOG", "ASIDE", "TABLE", "UL", "OL"]);

  const clip = (s, n = 100) => {
    s = String(s ?? "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n) + "…" : s;
  };
  const style = (el) => el.ownerDocument.defaultView.getComputedStyle(el);
  const displayed = (el) => {
    const s = style(el);
    return s.display !== "none" && s.visibility !== "hidden";
  };
  const hasBox = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && displayed(el);
  };
  const interactive = (el) =>
    (TAGS.has(el.tagName) && !(el.tagName === "A" && !el.hasAttribute("href")) && el.type !== "hidden") ||
    ROLES.has(el.getAttribute("role")) ||
    el.hasAttribute("contenteditable") && el.isContentEditable ||
    el.hasAttribute("onclick") ||
    (el.hasAttribute("tabindex") && el.tabIndex >= 0 && el.tagName !== "BODY");

  const kids = (el) => {
    const out = [];
    if (el.shadowRoot) out.push(...el.shadowRoot.children);
    if (el.tagName === "IFRAME" || el.tagName === "FRAME") {
      try {
        const body = el.contentDocument?.body;
        if (body) out.push(body);
      } catch {}
    }
    out.push(...el.children);
    return out;
  };

  const directText = (el) =>
    [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();

  const labelText = (el) => {
    if (el.labels?.length) return [...el.labels].map((l) => l.innerText).join(" ");
    const ids = el.getAttribute("aria-labelledby");
    if (ids) return ids.split(/\s+/).map((i) => el.ownerDocument.getElementById(i)?.innerText ?? "").join(" ");
    return "";
  };

  const role = (el) => {
    const r = el.getAttribute("role");
    if (r) return r;
    const t = el.tagName.toLowerCase();
    if (t === "a") return "link";
    if (t === "input") {
      return { checkbox: "checkbox", radio: "radio", submit: "button", button: "button", reset: "button",
        image: "button", range: "slider", search: "searchbox", file: "file", number: "spinbutton" }[el.type] ?? "textbox";
    }
    if (t === "textarea" || el.isContentEditable && el.hasAttribute("contenteditable")) return "textbox";
    if (t === "select") return "combobox";
    if (/^h[1-6]$/.test(t)) return "heading";
    return { nav: "navigation", main: "main", header: "banner", footer: "contentinfo", form: "form", dialog: "dialog",
      ul: "list", ol: "list", li: "listitem", table: "table", summary: "button", button: "button", aside: "complementary",
      img: "img", label: "label", p: "paragraph", iframe: "iframe", td: "cell", th: "columnheader" }[t] ?? "generic";
  };

  const name = (el) => {
    if (/^H[1-6]$/.test(el.tagName)) return clip(el.innerText, 150);
    if (el.tagName === "IMG") return clip(el.alt || el.title, 100);
    if (!interactive(el)) return clip(directText(el), 200);
    const isField = ["SELECT", "INPUT", "TEXTAREA"].includes(el.tagName);
    return clip(
      el.getAttribute("aria-label") || labelText(el) || (isField ? "" : el.innerText) ||
        el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt") ||
        el.querySelector?.("img[alt]")?.alt || el.getAttribute("name") || "",
    );
  };

  const refOf = (el) => {
    if (!el.__hermesRef) {
      el.__hermesRef = ++TOP.__hermesRef; // expando property: not copied by cloneNode
      TOP.__hermesRefs.set(el.__hermesRef, new WeakRef(el));
    }
    return "ref_" + el.__hermesRef;
  };

  // What a click on the element's center would hit – null if the center is outside the window (unknown).
  const hitAt = (el) => {
    const r = el.getBoundingClientRect(), win = el.ownerDocument.defaultView;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (!r.width || !r.height || cx < 0 || cy < 0 || cx >= win.innerWidth || cy >= win.innerHeight) return null;
    const root = el.getRootNode();
    return (root.elementFromPoint ? root : el.ownerDocument).elementFromPoint(cx, cy);
  };
  const hitsSelf = (el, top) => top === el || el.contains(top) || (top.tagName === "LABEL" && top.contains(el)) ||
    [...(el.labels ?? [])].some((l) => l.contains(top));
  // Covered = something else lies on top, or the element takes no clicks there (collapsed menus, masks).
  const covered = (el) => { const top = hitAt(el); return !!top && !hitsSelf(el, top); };

  const describe = (el) => {
    const r = role(el);
    let s = r === "heading" ? `heading level=${el.tagName[1]}` : r;
    const n = name(el);
    if (n) s += ` "${n.replace(/"/g, "'")}"`;
    s += ` [${refOf(el)}]`;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      if (el.type === "checkbox" || el.type === "radio") s += el.checked ? " checked" : " unchecked";
      else if (el.type !== "file" && el.type !== "password" && el.value) s += ` value="${clip(el.value, 80)}"`;
      if (el.tagName === "INPUT" && !["text", "checkbox", "radio", "submit", "button"].includes(el.type)) s += ` type=${el.type}`;
      const ph = el.getAttribute("placeholder");
      if (ph && ph !== n) s += ` placeholder="${clip(ph, 80)}"`;
    }
    if (el.tagName === "SELECT") {
      s += ` value="${clip(el.selectedOptions[0]?.text, 60)}" options="${clip([...el.options].map((o) => o.text.trim()).join(" | "), 200)}"`;
    }
    if (el.tagName === "A" && el.getAttribute("href")) s += ` href="${clip(el.getAttribute("href"), 100)}"`;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") s += " disabled";
    for (const a of ["aria-expanded", "aria-selected", "aria-checked", "aria-pressed"]) {
      if (el.hasAttribute(a)) s += ` ${a.slice(5)}=${el.getAttribute(a)}`;
    }
    if (interactive(el) && covered(el)) s += " (covered – a click would hit something else)";
    return s;
  };

  const byRef = (ref) => {
    const el = TOP.__hermesRefs.get(Number(String(ref).replace(/^ref_/, "")))?.deref();
    if (!el || !el.isConnected) throw new Error(`${ref} not found – call read_page or find again`);
    return el;
  };

  const frameOffset = (el) => {
    let x = 0, y = 0, win = el.ownerDocument.defaultView;
    while (win !== TOP && win.frameElement) {
      const fe = win.frameElement, r = fe.getBoundingClientRect();
      x += r.left + fe.clientLeft;
      y += r.top + fe.clientTop;
      win = win.parent;
    }
    return { x, y };
  };

  const offscreen = (r, win) => r.top < 0 || r.left < 0 || r.bottom > win.innerHeight || r.right > win.innerWidth;
  const center = (el) => {
    // First scroll the enclosing iframes (outside in) into view, then the element itself.
    const frames = [];
    for (let win = el.ownerDocument.defaultView; win !== TOP && win.frameElement; win = win.parent) frames.unshift(win.frameElement);
    for (const node of [...frames, el]) {
      if (offscreen(node.getBoundingClientRect(), node.ownerDocument.defaultView)) {
        node.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      }
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) throw new Error("Element has no visible area");
    const o = frameOffset(el);
    const x = Math.round(o.x + r.left + r.width / 2), y = Math.round(o.y + r.top + r.height / 2);
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
      throw new Error("Element cannot be scrolled into the visible area – no click performed");
    }
    // Does a click at this spot hit the element at all? (overlays, banners, collapsed search fields)
    const top = hitAt(el);
    const hits = !top || hitsSelf(el, top);
    const editable = (el.tagName === "INPUT" && !/^(button|submit|reset|checkbox|radio|file|image|range|color|hidden)$/i.test(el.type)) ||
      el.tagName === "TEXTAREA" || el.isContentEditable;
    return { x, y, covered: hits ? null : describe(top), editable };
  };

  const read = ({ filter, refId, depth = 15, maxChars = 50000 }) => {
    const out = [];
    let size = 0, total = 0;
    const emit = (d, text) => {
      const line = "  ".repeat(d) + text;
      total += line.length + 1;
      if (size + line.length + 1 <= maxChars) {
        out.push(line);
        size += line.length + 1;
      }
    };
    const onlyInteractive = filter === "interactive";
    let offscreen = 0;
    const inViewport = (el) => {
      const r = el.getBoundingClientRect(), o = frameOffset(el);
      return r.bottom + o.y > 0 && r.right + o.x > 0 && r.top + o.y < innerHeight && r.left + o.x < innerWidth;
    };
    const visit = (el, d, inInteractive) => {
      if (!(el instanceof el.ownerDocument.defaultView.Element) || !displayed(el)) return;
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD"].includes(el.tagName)) return;
      const isI = interactive(el);
      let show;
      if (onlyInteractive) {
        // only the visible area, otherwise long pages blow up every answer
        show = isI && hasBox(el) && (refId || inViewport(el));
        if (isI && !show && hasBox(el)) offscreen++;
      }
      else if (inInteractive) show = isI;
      else {
        show = isI || /^H[1-6]$/.test(el.tagName) || LANDMARKS.has(el.tagName) || el.tagName === "IFRAME" ||
          (el.tagName === "IMG" && (el.alt || el.title)) || el.hasAttribute("role") || directText(el).length > 0;
      }
      if (show && d > depth) return;
      if (show) emit(onlyInteractive ? 0 : d, describe(el));
      for (const k of kids(el)) visit(k, show && !onlyInteractive ? d + 1 : d, inInteractive || (show && isI));
    };
    const root = refId ? byRef(refId) : document.body ?? document.documentElement;
    const se = document.scrollingElement ?? document.documentElement;
    out.push(`Title: ${document.title}`, `URL: ${location.href}`,
      `Viewport: ${innerWidth}x${innerHeight}, scrolled ${Math.round(scrollY)} of ${se.scrollHeight}`, "");
    visit(root, 0, false);
    if (offscreen) out.push(`(visible area only; ${offscreen} more interactive elements outside – scroll, use find, or read_page without filter)`);
    if (total > size) out.push(`… truncated at ${size} of ${total} characters; raise max_chars or use ref_id/depth/filter`);
    return out.join("\n");
  };

  const SYNONYMS = {
    button: ["button"], knopf: ["button"], schaltfl\u00e4che: ["button"], link: ["link"],
    suche: ["search", "such", "finden", "find"], suchfeld: ["search", "such", "finden", "find"], search: ["search", "such", "finden", "find"],
    searchbar: ["search", "such", "finden", "find"], suchleiste: ["search", "such", "finden", "find"], searchbox: ["search", "such", "finden", "find"],
    feld: ["textbox", "input"], field: ["textbox", "input"], input: ["textbox", "input"], eingabe: ["textbox", "input"],
    checkbox: ["checkbox"], "h\u00e4kchen": ["checkbox"], dropdown: ["combobox", "select"], auswahl: ["combobox", "select"],
    "men\u00fc": ["menu"], menu: ["menu"], bild: ["img"], image: ["img"], "\u00fcberschrift": ["heading"], heading: ["heading"],
    warenkorb: ["cart", "warenkorb"], cart: ["cart", "warenkorb"], login: ["login", "anmeld", "sign in"], anmelden: ["login", "anmeld"],
  };
  const STOP = new Set(["the", "a", "an", "der", "die", "das", "ein", "eine", "den", "dem", "for", "f\u00fcr", "mit", "with", "of", "von", "to", "zum", "zur", "on", "auf", "in", "im", "und", "and"]);

  // Role words ("button", "field") check the role, not the text; whole words rank above word parts.
  // German synonyms are kept for German-language pages and queries.
  const ROLE_WORDS = {
    button: ["button"], knopf: ["button"], schaltfl\u00e4che: ["button"], link: ["link"], checkbox: ["checkbox", "switch"],
    "h\u00e4kchen": ["checkbox"], dropdown: ["combobox", "listbox"], auswahl: ["combobox", "listbox"], feld: ["textbox", "searchbox", "combobox"],
    field: ["textbox", "searchbox", "combobox"], input: ["textbox", "searchbox", "combobox"], eingabe: ["textbox", "searchbox"],
    textfeld: ["textbox", "searchbox"], suchfeld: ["searchbox", "combobox", "textbox"], suchleiste: ["searchbox", "combobox", "textbox"],
    searchbox: ["searchbox", "combobox", "textbox"], searchbar: ["searchbox", "combobox", "textbox"], bild: ["img"], image: ["img"], "\u00fcberschrift": ["heading"], heading: ["heading"], tab: ["tab"],
  };
  const FIELD_WORDS = new Set(["feld", "field", "input", "eingabe", "textfeld", "suchfeld", "suchleiste", "searchbox", "searchbar"]);
  const find = (query) => {
    const words = String(query).slice(0, 300).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w)).slice(0, 20);
    const roleWords = words.filter((w) => ROLE_WORDS[w]);
    // "searchbox"/"Suchfeld" is role and text at once (role input field, text "search…"/"such…").
    const textWords = words.filter((w) => !ROLE_WORDS[w] || /^(such|search)/.test(w));
    const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wordRe = (w) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}([^\\p{L}\\p{N}]|$)`, "u");
    const startRe = (w) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}`, "u"); // word start: "search" matches "searchterm"
    const hits = [];
    const visit = (el) => {
      if (!displayed(el)) return;
      const isI = interactive(el);
      if ((isI || /^H[1-6]$/.test(el.tagName) || el.tagName === "IMG" || directText(el)) && hasBox(el)) {
        const r = role(el);
        const n = name(el).toLowerCase();
        const attrs = [r, el.type, el.id, el.getAttribute("name"), el.getAttribute("placeholder"),
          typeof el.className === "string" ? el.className : "", el.getAttribute("href")].join(" ").toLowerCase();
        let score = 0;
        for (const w of textWords) {
          const alts = [w, ...(SYNONYMS[w] ?? [])];
          if (alts.some((a) => wordRe(a).test(n))) score += 3;
          else if (alts.some((a) => a.length >= 4 && startRe(a).test(n))) score += 2.5;
          else if (alts.some((a) => n.includes(a))) score += 1.5;
          else if (alts.some((a) => attrs.includes(a))) score += 1;
        }
        if (textWords.length && score === 0) score = -1; // no text match, no hit
        // "field" means something to type into: select lists (even role=combobox) do not count.
        const editable = (el.tagName === "INPUT" && !/^(button|submit|reset|checkbox|radio|file|image|range|color|hidden)$/i.test(el.type)) ||
          el.tagName === "TEXTAREA" || el.isContentEditable;
        for (const w of roleWords) {
          if (!ROLE_WORDS[w].includes(r)) continue;
          if (FIELD_WORDS.has(w) && !editable) continue;
          score += 2;
          if (/^(such|search)/.test(w) && (el.type === "search" || r === "searchbox")) score += 1;
        }
        if (score > 0 && isI && covered(el)) score -= 1.5; // visible before covered (e.g. search field in a collapsed menu)
        if (score > 0) hits.push({ el, score: score + (isI ? 0.5 : 0) - n.length / 1000 });
      }
      for (const k of kids(el)) visit(k);
    };
    visit(document.body ?? document.documentElement);
    if (!hits.length) return `Nothing found for "${query}" – use read_page or rephrase`;
    hits.sort((a, b) => b.score - a.score);
    const best = hits[0].score;
    const good = hits.filter((h) => h.score >= Math.max(1, best - 1));
    const lines = good.slice(0, 20).map((h) => describe(h.el));
    if (good.length > 20) lines.push(`… ${good.length - 20} more hits; be more specific`);
    return lines.join("\n");
  };

  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));

  const formInput = ({ ref, value }) => {
    const el = byRef(ref);
    const win = el.ownerDocument.defaultView;
    // What a human could not change, Hermes does not change either (and does not report it as success).
    if (el.disabled || el.closest?.("fieldset[disabled]") || el.getAttribute("aria-disabled") === "true") {
      throw new Error(`${ref} is disabled`);
    }
    if (el.readOnly || el.getAttribute("aria-readonly") === "true") throw new Error(`${ref} is read-only`);
    if (isPassword(el)) throw new Error(`${ref} is a password field – Hermes does not enter credentials, the user does that`);
    if (el.tagName === "SELECT") {
      const vals = Array.isArray(value) ? value.map(String) : [String(value)];
      const opts = [...el.options].filter((o) => !o.disabled && (vals.includes(o.value) || vals.includes(o.text.trim())));
      if (!opts.length || opts.length < vals.length) {
        throw new Error(`Option not found or disabled: ${vals} – available: ${[...el.options].filter((o) => !o.disabled).map((o) => o.text.trim()).join(" | ")}`);
      }
      for (const o of el.options) o.selected = opts.includes(o);
      fire(el, "input");
      fire(el, "change");
      return `selected: ${opts.map((o) => o.text.trim()).join(", ")}`;
    }
    const native = el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio");
    if (native || ["checkbox", "switch", "radio"].includes(el.getAttribute("role"))) {
      const want = value === true || ["true", "on", "1", "yes", "ja"].includes(String(value).toLowerCase());
      const state = () => (native ? el.checked : el.getAttribute("aria-checked") === "true");
      if (state() !== want) el.click();
      if (state() !== want) throw new Error(`${ref} could not be set to ${want ? "on" : "off"} (disabled, or a radio that cannot be unchecked?)`);
      return want ? "checked" : "unchecked";
    }
    if (el.isContentEditable) {
      el.focus();
      el.textContent = String(value);
      el.dispatchEvent(new win.InputEvent("input", { bubbles: true }));
      return "set";
    }
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const proto = el.tagName === "TEXTAREA" ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
      el.focus();
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(value)); // also for React & co.
      fire(el, "input");
      fire(el, "change");
      return "set";
    }
    throw new Error(`${ref} is not a form field (${role(el)})`);
  };

  const toFiles = (files, win) =>
    files.map((f) => {
      const bin = atob(f.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new win.File([bytes], f.name, { type: f.mimeType || "application/octet-stream" });
    });

  const upload = ({ ref, files }) => {
    let el = byRef(ref);
    if (!(el.tagName === "INPUT" && el.type === "file")) el = el.querySelector?.("input[type=file]") ?? el;
    if (!(el.tagName === "INPUT" && el.type === "file")) throw new Error(`${ref} is not a file input`);
    const win = el.ownerDocument.defaultView;
    const dt = new win.DataTransfer();
    for (const f of toFiles(files, win)) dt.items.add(f);
    el.files = dt.files;
    fire(el, "input");
    fire(el, "change");
    return `${dt.files.length} file(s) set`;
  };

  const drop = ({ x, y, files }) => {
    let doc = document, el = doc.elementFromPoint(x, y);
    while (el && (el.tagName === "IFRAME" || el.tagName === "FRAME")) {
      try {
        const r = el.getBoundingClientRect();
        x -= r.left + el.clientLeft;
        y -= r.top + el.clientTop;
        doc = el.contentDocument;
        el = doc.elementFromPoint(x, y);
      } catch {
        break;
      }
    }
    if (!el) throw new Error("No element at this position");
    const win = doc.defaultView;
    const dt = new win.DataTransfer();
    for (const f of toFiles(files, win)) dt.items.add(f);
    for (const type of ["dragenter", "dragover", "drop"]) {
      el.dispatchEvent(new win.DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    }
    return `dropped on ${role(el)} "${name(el)}"`;
  };

  const pageText = ({ maxChars }) => {
    const cands = [...document.querySelectorAll("article, main, [role=main]")].filter(hasBox);
    cands.sort((a, b) => b.innerText.length - a.innerText.length);
    const root = cands[0] && cands[0].innerText.length > 500 ? cands[0] : document.body;
    const text = root.innerText;
    return `Title: ${document.title}\nURL: ${location.href}\n\n` + text.slice(0, maxChars) +
      (text.length > maxChars ? `\n… truncated at ${maxChars} of ${text.length} characters` : "");
  };


  // Scrollable area under the point (also in shadow DOMs), else the document.
  const scroller = ({ x, y, dx, dy }) => {
    let el = document.elementFromPoint(x, y);
    while (el?.shadowRoot) { const inner = el.shadowRoot.elementFromPoint(x, y); if (!inner || inner === el) break; el = inner; }
    const can = (e, axis) => {
      const o = getComputedStyle(e)[axis === "y" ? "overflowY" : "overflowX"];
      return /(auto|scroll|overlay)/.test(o) && (axis === "y" ? e.scrollHeight > e.clientHeight : e.scrollWidth > e.clientWidth);
    };
    for (; el && el !== document.body && el !== document.documentElement; el = el.parentElement || el.getRootNode().host) {
      if ((dy && can(el, "y")) || (dx && can(el, "x"))) return el;
    }
    return document.scrollingElement || document.documentElement;
  };
  const scrollPos = (a) => { const s = scroller(a); return [s.scrollTop, s.scrollLeft]; };
  // Fallback when the mouse wheel moved nothing (e.g. pages that intercept wheel events).
  const scrollBy = (a) => { const s = scroller(a); s.scrollBy({ top: a.dy, left: a.dx, behavior: "instant" }); return [s.scrollTop, s.scrollLeft]; };

  // ---------- Visibility: frame, pointer, label, stop, permission prompt ----------
  // Closed shadow DOM: page CSS does not apply inside, and the page cannot reach the buttons.
  // Answers go via the debugger binding __hermesTabs, which exists only in this isolated world.
  // Texts (o.t) come localized from background.js; the isolated world has no chrome.i18n.
  const overlay = (o) => {
    let host = TOP.__hermesOverlay;
    if (!host || !host.isConnected) {
      host = document.createElement("hermes-tabs-overlay");
      host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
      const root = host.attachShadow({ mode: "closed" });
      root.innerHTML = `<style>
        :host, * { box-sizing: border-box; font: 13px/1.3 system-ui, sans-serif; }
        .frame { position: fixed; inset: 0; border: 3px solid #a855f7; box-shadow: inset 0 0 18px rgba(168,85,247,.55);
                 opacity: 0; transition: opacity .3s; pointer-events: none; }
        .cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; opacity: 0; pointer-events: none;
                  transition: left .35s ease, top .35s ease, opacity .3s; filter: drop-shadow(0 1px 2px rgba(0,0,0,.5)); }
        .ring { position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px; border: 3px solid #a855f7;
                border-radius: 50%; opacity: 0; pointer-events: none; }
        .ring.go { animation: ring .55s ease-out; }
        @keyframes ring { from { opacity: 1; transform: scale(.4); } to { opacity: 0; transform: scale(1.4); } }
        .label { position: fixed; max-width: 360px; padding: 4px 8px; border-radius: 6px; background: #2e1065; color: #fff;
                 opacity: 0; transition: opacity .3s; pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bar { position: fixed; left: 50%; bottom: 10px; transform: translateX(-50%); display: none; align-items: center; gap: 8px;
               padding: 6px 8px 6px 12px; border-radius: 999px; background: #2e1065; color: #fff; pointer-events: auto; white-space: nowrap;
               box-shadow: 0 2px 10px rgba(0,0,0,.35); }
        .bar button, .ask button { border: 0; border-radius: 999px; padding: 4px 10px; cursor: pointer; font-weight: 600; }
        .stop { background: #ef4444; color: #fff; }
        .ask { position: fixed; left: 50%; top: 12px; transform: translateX(-50%); display: none; max-width: 520px;
               padding: 12px 14px; border-radius: 10px; background: #fff; color: #111; pointer-events: auto;
               box-shadow: 0 4px 24px rgba(0,0,0,.35); border: 2px solid #a855f7; }
        .ask .row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; justify-content: flex-end; }
        .once, .session, .always, .all1h { background: #a855f7; color: #fff; } .deny { background: #e5e7eb; color: #111; }
        .hidden { display: none !important; }
      </style>
      <div class="frame"></div><div class="ring"></div>
      <svg class="cursor" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.4-7.6L20.5 11z" fill="#a855f7" stroke="#fff" stroke-width="1.5"/></svg>
      <div class="label"></div>
      <div class="bar"><span class="barText"></span><button class="stop"></button></div>
      <div class="ask"><div class="q"></div><div class="row">
        <button class="deny"></button><button class="once"></button><button class="session"></button>
        <button class="always"></button><button class="all1h"></button></div></div>`;
      const t = o.t ?? {};
      for (const [c, k] of [["barText", "overlayBar"], ["stop", "overlayStop"], ["deny", "askDeny"], ["once", "askOnce"],
        ["session", "askSession"], ["always", "askAlways"], ["all1h", "askAll1h"]]) root.querySelector("." + c).textContent = t[k] ?? k;
      const send = (payload) => (e) => {
        if (!e.isTrusted) return; // only real user clicks
        e.stopPropagation(); e.preventDefault();
        try { globalThis.__hermesTabs?.(JSON.stringify(payload)); } catch {}
      };
      root.querySelector(".stop").addEventListener("click", send({ type: "stop" }), true);
      for (const d of ["deny", "once", "session", "always", "all1h"]) root.querySelector("." + d).addEventListener("click", send({ type: "permission", decision: d }), true);
      document.documentElement.append(host);
      TOP.__hermesOverlay = host;
      TOP.__hermesRoot = root;
    }
    const root = TOP.__hermesRoot, $ = (c) => root.querySelector(c);
    if (o.hidden !== undefined) host.style.visibility = o.hidden ? "hidden" : "visible";
    if (o.passthrough !== undefined) setPassthrough(root, o.passthrough);
    if (o.active) {
      $(".frame").style.opacity = 1;
      $(".bar").style.display = "flex";
      clearTimeout(TOP.__hermesIdle);
      TOP.__hermesIdle = setTimeout(() => { $(".frame").style.opacity = 0; $(".cursor").style.opacity = 0; $(".label").style.opacity = 0; $(".bar").style.display = "none"; }, 6000);
    }
    if (o.x !== undefined) {
      const c = $(".cursor");
      c.style.opacity = 1; c.style.left = o.x + "px"; c.style.top = o.y + "px";
      if (o.ripple) {
        const r = $(".ring");
        r.style.left = o.x + "px"; r.style.top = o.y + "px";
        r.classList.remove("go"); void r.offsetWidth; r.classList.add("go");
      }
    }
    if (o.label) {
      const l = $(".label");
      l.textContent = o.label; l.style.opacity = 1;
      const x = o.x ?? innerWidth / 2 - 120, y = o.y ?? 40;
      l.style.left = Math.max(8, Math.min(innerWidth - 370, x + 18)) + "px";
      l.style.top = Math.max(8, Math.min(innerHeight - 60, y + 22)) + "px";
    }
    if (o.ask !== undefined) {
      $(".ask").style.display = o.ask ? "block" : "none";
      if (o.ask) $(".q").textContent = o.ask;
    }
    if (o.remove) { host.remove(); TOP.__hermesOverlay = null; }
    return "ok";
  };
  // While Hermes itself clicks, the overlay must not catch clicks (otherwise Hermes might hit "Stop").
  const setPassthrough = (root, on) => {
    for (const el of root.querySelectorAll(".bar, .ask")) el.style.pointerEvents = on ? "none" : "auto";
  };

  // Revealed passwords (type=text with autocomplete=current-password) count too.
  const isPassword = (el) => el?.type === "password" || /password/i.test(el?.getAttribute?.("autocomplete") ?? "");

  // Which field has focus right now (also in shadow DOMs and same-origin iframes)?
  const focusInfo = () => {
    let el = document.activeElement, opaque = false;
    while (el) {
      if (el.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
      else if (el.tagName === "IFRAME" || el.tagName === "FRAME") {
        const doc = (() => { try { return el.contentDocument; } catch { return null; } })();
        if (!doc) { opaque = true; break; } // cross-origin: field type cannot be checked
        el = doc.activeElement;
      } else break;
    }
    const editable = !!el && ((el.tagName === "INPUT" && !/^(button|submit|reset|checkbox|radio|file|image|range|color|hidden)$/i.test(el.type)) ||
      el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    return { tag: el?.tagName ?? null, type: el?.type ?? null, password: isPassword(el), opaque, editable };
  };

  switch (op) {
    case "read": return read(arg);
    case "find": return find(arg.query);
    case "center": return center(byRef(arg.ref));
    case "scrollTo": {
      byRef(arg.ref).scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      return `${arg.ref} scrolled into view`;
    }
    case "formInput": return formInput(arg);
    case "upload": return upload(arg);
    case "drop": return drop(arg);
    case "pageText": return pageText(arg);
    case "viewport": return { w: innerWidth, h: innerHeight, dpr: devicePixelRatio };
    case "overlay": return overlay(arg);
    case "focusInfo": return focusInfo();
    case "scrollPos": return scrollPos(arg);
    case "scrollBy": return scrollBy(arg);
    default: throw new Error(`Unknown page operation ${op}`);
  }
}
