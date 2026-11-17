"use strict";
const $ = (id) => document.getElementById(id);
const ids = { src: null, tgt: null };
let runChapters = [], releaseLock = null, stopFlag = false, running = false, pauseFlag = false, results = [], runStart = 0, alertTimer = null;

function log(msg, cls) {
    let d = document.createElement("div");
    d.textContent = new Date().toLocaleTimeString() + "  " + msg;
    if (cls) { d.className = cls; }
    $("log").appendChild(d);
    $("log").scrollTop = $("log").scrollHeight;
}
// Waits are done by a worker thread: a minimized or hidden window slows ordinary timers to a crawl, a worker is not slowed.
let timerWorker = null, timerId = 0; const timerWait = new Map();
function sleep(ms) {
    return new Promise((res) => {
        try {
            if (!timerWorker) { timerWorker = new Worker("timer.js"); timerWorker.onmessage = (e) => { let f = timerWait.get(e.data); if (f) { timerWait.delete(e.data); f(); } }; }
            let id = ++timerId; timerWait.set(id, res); timerWorker.postMessage({ id: id, ms: ms });
        } catch (e) { setTimeout(res, ms); }
    });
}
function setStatus(t) { $("status").textContent = t; }


// ------------------------------------------------------------------ tab lookup that also works for private (incognito) tabs
const tabMeta = { src: null, tgt: null };   // what we remember about each chosen tab, so it can be found again if its id changes
/** like chrome.tabs.get, but falls back to tabs.query (which lists private tabs reliably once "Allow in Incognito" is on) */
async function tabGet(id) {
    try { return await chrome.tabs.get(id); } catch (e) {
        let all = []; try { all = await chrome.tabs.query({}); } catch (e2) { all = []; }
        let t = all.find(x => x.id === id);
        if (t) { return t; }
        throw e;
    }
}
async function noTabHelp() {
    let allowed = false; try { allowed = await chrome.extension.isAllowedIncognitoAccess(); } catch (e) { allowed = false; }
    return allowed
        ? "The tab is gone or was replaced. Press ↻ Refresh tab list and choose the tab again."
        : "This extension cannot see private (incognito) tabs yet. Press “Use private tabs…”, switch on “Allow in Incognito”, then ↻ Refresh tab list and choose the tabs again.";
}
/** make sure the chosen tab for this role still exists; if its id changed, find it again by address + private/normal and carry on */
async function liveTab(role) {
    let id = ids[role];
    if (!id) { throw new Error("The " + (role === "src" ? "SOURCE" : "TARGET") + " tab is not chosen."); }
    try { let t = await tabGet(id); tabMeta[role] = { url: t.url, incognito: !!t.incognito, windowId: t.windowId }; return t; } catch (e) { /* look again below */ }
    let m = tabMeta[role], found = null;
    if (m) {
        let all = []; try { all = await chrome.tabs.query({}); } catch (e) { all = []; }
        let cand = all.filter(x => !!x.incognito === m.incognito && x.id !== ids[role === "src" ? "tgt" : "src"]);
        found = cand.find(x => x.url === m.url) || cand.filter(x => { try { return new URL(x.url).hostname === new URL(m.url).hostname; } catch (e) { return false; } }).find(x => x.windowId === m.windowId) || null;
    }
    if (found) {
        log("The " + (role === "src" ? "SOURCE" : "TARGET") + " tab changed its internal id (" + id + " → " + found.id + "); reconnected to it.", "warn");
        ids[role] = found.id; tabMeta[role] = { url: found.url, incognito: !!found.incognito, windowId: found.windowId };
        let saved = (await chrome.storage.local.get("ccTabs")).ccTabs || {}; saved[role] = found.id; await chrome.storage.local.set({ ccTabs: saved });
        return found;
    }
    throw new Error("The " + (role === "src" ? "SOURCE" : "TARGET") + " tab (id " + id + ") cannot be reached. " + (await noTabHelp()));
}

// ------------------------------------------------------------------ tabs
async function listTabs() {
    let tabs = (await chrome.tabs.query({})).filter(t => /^https?:/.test(t.url || ""));
    tabs.sort((a, b) => (a.incognito ? 1 : 0) - (b.incognito ? 1 : 0));        // normal tabs first, private ones after
    let saved = (await chrome.storage.local.get("ccTabs")).ccTabs || {};
    for (let role of ["src", "tgt"]) {
        let sel = $(role + "Tab");
        let keep = ids[role] || saved[role];
        sel.textContent = "";
        let none = document.createElement("option"); none.value = ""; none.textContent = "— choose a tab —"; sel.appendChild(none);
        for (let t of tabs) {
            let o = document.createElement("option");
            o.value = String(t.id);
            let host = ""; try { host = new URL(t.url).hostname; } catch (e) { /* ignore */ }
            o.textContent = (t.incognito ? "🕶 PRIVATE · " : "") + "[window " + t.windowId % 1000 + "] " + (t.title || "").slice(0, 45) + " — " + host;
            sel.appendChild(o);
        }
        if (keep && tabs.some(t => t.id === keep)) { sel.value = String(keep); ids[role] = keep; let tk = tabs.find(t => t.id === keep); tabMeta[role] = { url: tk.url, incognito: !!tk.incognito, windowId: tk.windowId }; } else { ids[role] = null; }
    }
    renderPicks(); renderTgtPicks();
    showIncoInfo(tabs);
}
/** private (incognito) tabs are only visible to an extension after "Allow in Incognito" is switched on for it */
async function showIncoInfo(tabs) {
    let box = $("incoInfo"), allowed = false;
    try { allowed = await chrome.extension.isAllowedIncognitoAccess(); } catch (e) { allowed = false; }
    let n = tabs.filter(t => t.incognito).length;
    $("incoWin").style.display = (n && !IN_PRIVATE) ? "" : "none";
    box.className = "small " + (allowed ? "ok-t" : "todo-t");
    if (allowed && n && !IN_PRIVATE) { box.className = "small todo-t"; box.textContent = "Private tabs are listed, but Chrome only lets a PRIVATE window control them. Press “🕶 Open this tool in a PRIVATE window” and do everything there."; return; }
    if (allowed && IN_PRIVATE) { box.className = "small ok-t"; box.textContent = "This tool is running in a private window ✔ – private and normal tabs can be used."; return; }
    box.textContent = allowed
        ? "Private (incognito) tabs: allowed ✔ – " + (n ? n + " private tab(s) shown as “🕶 PRIVATE”." : "none open right now. Open the page in a private window, then press ↻ Refresh tab list.")
        : "Private (incognito) tabs are hidden. Press “Use private tabs…”, switch on “Allow in Incognito” for this extension, then come back and press ↻ Refresh tab list.";
}
let presetTpl = "";
async function chooseTab(role) {
    ids[role] = parseInt($(role + "Tab").value, 10) || null;
    tabMeta[role] = null; if (ids[role]) { try { let t0 = await tabGet(ids[role]); tabMeta[role] = { url: t0.url, incognito: !!t0.incognito, windowId: t0.windowId }; } catch (e) { /* ignore */ } }
    let saved = (await chrome.storage.local.get("ccTabs")).ccTabs || {};
    saved[role] = ids[role];
    await chrome.storage.local.set({ ccTabs: saved });
    if (role === "tgt" && ids.tgt) {
        try {
            let h = new URL((await tabGet(ids.tgt)).url).hostname;
            let pre = ccPresetFor(h);
            if (pre && $("tgtProfile").value === "auto" && pre.profile !== "auto") { $("tgtProfile").value = pre.profile; log("Built-in settings for " + pre.name + " loaded (button names" + (pre.steps.length ? ", extra steps" : "") + ").", "ok"); }
            if (pre && pre.titleTpl && !$("titleTpl").value.trim()) { $("titleTpl").value = pre.titleTpl; presetTpl = pre.titleTpl; log("Title template set to " + pre.titleTpl + " – " + pre.name + " adds the chapter number itself.", "ok"); }
            else if (!pre && presetTpl && $("titleTpl").value.trim() === presetTpl) { $("titleTpl").value = ""; presetTpl = ""; }
            $("presetInfo").textContent = pre ? "✔ " + pre.notes : "";
            if ($("tgtProfile").value === "auto") {
                if (/(^|\.)royalroad\.com$/i.test(h)) { $("tgtProfile").value = "royalroad"; log("Target looks like Royal Road – website type set to Royal Road.", "ok"); }
                else if (/(^|\.)webnovel\.com$/i.test(h)) { $("tgtProfile").value = "webnovel"; log("Target looks like Webnovel – website type set to Webnovel.", "ok"); }
            }
        } catch (e) { /* ignore */ }
    }
    renderPicks(); renderTgtPicks(); if (typeof wizRender === "function") { wizRender(); }
}
// ---- target website profile + the buttons/boxes the user picked on the target page (remembered per website)
async function getTProf() {
    let picks = {};
    try { if (ids.tgt) { let host = new URL((await tabGet(ids.tgt)).url).hostname; picks = ((await chrome.storage.local.get("ccTgt")).ccTgt || {})[host] || {}; } } catch (e) { picks = {}; }
    let pre = null; try { pre = ids.tgt ? ccPresetFor(new URL((await tabGet(ids.tgt)).url).hostname) : null; } catch (e) { pre = null; }
    if (pre) { picks = Object.assign({}, pre.picks, picks); }
    return { id: $("tgtProfile").value, picks: picks };
}
const TP_KEYS = { tConfirm: "confirm", tTimer: "timer", tAddLink: "addLink", tEditor: "editor", tTitle: "title", tPublish: "publish", tDraft: "draft", tSchedule: "schedule", tSchedDate: "schedDate", tSchedTime: "schedTime" };
const TP_NAMES = { txt_publish: "Publish name", txt_draft: "Draft name", txt_schedule: "Schedule name", confirm: "Confirm button", timer: "timer switch", addLink: "New Chapter link", editor: "text editor", title: "name box", publish: "Publish", draft: "Draft", schedule: "Schedule", schedDate: "date box", schedTime: "time box" };
async function renderTgtPicks() {
    if (!ids.tgt) { $("tpicked").textContent = ""; $("stepList").textContent = ""; return; }
    try {
        let p = await getTProf(); let host = new URL((await tabGet(ids.tgt)).url).hostname;
        let names = Object.keys(p.picks).map(k => TP_NAMES[k] || k);
        let ns = (await getSteps()).length; if (ns) { names.push(ns + " extra step(s)"); }
        renderSteps();
        $("tpicked").textContent = host + ": " + (names.length ? "picked → " + names.join(", ") : "nothing picked (automatic detection)");
    } catch (e) { $("tpicked").textContent = ""; }
}
async function pickT(what) {
    if (!ids.tgt) { alert("Choose the TARGET tab first."); return; }
    try {
        await focusTab(ids.tgt);
        let r = await call("tgt", "pick", what);
        await backToRunner();
        if (!r) { log("Pick cancelled."); return; }
        let host = new URL((await tabGet(ids.tgt)).url).hostname;
        let all = (await chrome.storage.local.get("ccTgt")).ccTgt || {};
        all[host] = Object.assign(all[host] || {}, { [TP_KEYS[what]]: r.selector });
        await chrome.storage.local.set({ ccTgt: all });
        log("✔ Picked " + TP_NAMES[TP_KEYS[what]] + " on " + host + "  (" + r.preview + ")", "ok");
        if ($("tgtProfile").value === "auto") { $("tgtProfile").value = "custom"; log("Website type set to “Any other site” so your picks are used.", "ok"); }
        renderTgtPicks();
    } catch (e) { await backToRunner(); log("Pick failed: " + e.message, "err"); }
}
async function ensureTab(id) {
    let t = await tabGet(id);
    if (t.discarded) { await chrome.tabs.reload(id); await waitComplete(id, 30000, true); }
    return t;
}
async function waitComplete(id, timeoutMs, expectLoad, settleMs) {
    let t0 = Date.now(), sawLoading = !expectLoad;
    while (Date.now() - t0 < timeoutMs) {
        let t = await tabGet(id);
        if (t.status === "loading") { sawLoading = true; }
        if (t.status === "complete" && (sawLoading || Date.now() - t0 > (settleMs || 2500))) { return true; }
        await sleep(settleMs && settleMs < 2000 ? 150 : 300);
    }
    return false;
}

// ------------------------------------------------------------------ keeping pages awake when their window is hidden
/** runs INSIDE the page: tells it that it is visible and focused, so sites keep loading chapters while the window is minimized or covered */
function visSpoof() {
    if (window.__ccVis) { return; }
    window.__ccVis = true;
    try { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); } catch (e) { /* ignore */ }
    try { Object.defineProperty(document, "webkitHidden", { configurable: true, get: () => false }); } catch (e) { /* ignore */ }
    try { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); } catch (e) { /* ignore */ }
    try { document.hasFocus = () => true; } catch (e) { /* ignore */ }
    const stop = (e) => { e.stopImmediatePropagation(); };
    ["visibilitychange", "webkitvisibilitychange"].forEach((t) => { document.addEventListener(t, stop, true); window.addEventListener(t, stop, true); });
}
const spoofAt = {};
async function spoofVisible(id, force) {
    if (!force && Date.now() - (spoofAt[id] || 0) < 3000) { return; }
    spoofAt[id] = Date.now();
    try { await chrome.scripting.executeScript({ target: { tabId: id }, world: "MAIN", func: visSpoof }); } catch (e) { /* ignore */ }
}
let warnedMin = {};
/** a minimized window is paused by the browser: bring it back (without taking focus) or say so */
async function windowGuard() {
    for (let role of ["src", "tgt"]) {
        if (!ids[role]) { continue; }
        try {
            let t = await tabGet(ids[role]); let w = await chrome.windows.get(t.windowId);
            if (w.state === "minimized") {
                if ($("autoRestore").checked) {
                    await chrome.windows.update(w.id, { state: "normal", focused: false });
                    if (!warnedMin[role]) { warnedMin[role] = true; log("The " + (role === "src" ? "SOURCE" : "TARGET") + " window was minimized – the browser pauses minimized pages, so it was restored (behind your other windows).", "warn"); }
                } else if (!warnedMin[role]) { warnedMin[role] = true; alertUser("The " + (role === "src" ? "SOURCE" : "TARGET") + " window is minimized – the browser pauses it. Restore it, or tick “bring back minimized windows”."); }
            } else { warnedMin[role] = false; }
        } catch (e) { /* ignore */ }
    }
}

// ------------------------------------------------------------------ calling the page helpers
const IN_PRIVATE = !!(chrome.extension && chrome.extension.inIncognitoContext);
function privateHint(e, t) {
    if (t && t.incognito && !IN_PRIVATE && /No tab with id/i.test(e && e.message || "")) {
        return new Error("Chrome will not let a normal window control a private tab. Press “🕶 Open this tool in a PRIVATE window”, then choose the tabs again in that private copy of this window (close this one).");
    }
    return e;
}
async function call(role, name, ...args) {
    let tab0 = await liveTab(role);
    let id = ids[role];
    try { await ensureTab(id); await chrome.scripting.executeScript({ target: { tabId: id }, files: ["lib.js"] }); } catch (e) { throw privateHint(e, tab0); }
    await spoofVisible(id);
    let prof = role === "tgt" ? await getTProf() : null;
    let [r] = await chrome.scripting.executeScript({ target: { tabId: id }, func: (n, a, p) => { if (p && window.__ccLib.setProfile) { window.__ccLib.setProfile(p); } return window.__ccLib[n](...a); }, args: [name, args, prof] });
    return r ? r.result : undefined;
}
async function getSel(role) {
    let t = await tabGet(ids[role]);
    let host = new URL(t.url).hostname;
    let all = (await chrome.storage.local.get("ccSel")).ccSel || {};
    return all[host] || {};
}
async function renderPicks() {
    if (!ids.src) { $("picked").textContent = ""; return; }
    try {
        let t = await tabGet(ids.src);
        let host = new URL(t.url).hostname;
        let sel = await getSel("src");
        let names = ["content", "title", "next"].filter(k => sel[k]).map(k => k === "content" ? "text" : k);
        showLast();
        $("picked").textContent = host + ": " + (names.length ? "picked → " + names.join(", ") : "nothing picked (automatic detection)");
    } catch (e) { $("picked").textContent = ""; }
}
async function focusTab(id) {
    let t = await tabGet(id);
    await chrome.tabs.update(id, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
}
async function backToRunner() { try { let w = await chrome.windows.getCurrent(); await chrome.windows.update(w.id, { focused: true }); } catch (e) { /* ignore */ } }

async function pick(what) {
    if (!ids.src) { alert("Choose the SOURCE tab first."); return; }
    try {
        await focusTab(ids.src);
        let r = await call("src", "pick", what);
        await backToRunner();
        if (!r) { log("Pick cancelled."); return; }
        let t = await tabGet(ids.src);
        let host = new URL(t.url).hostname;
        let all = (await chrome.storage.local.get("ccSel")).ccSel || {};
        all[host] = Object.assign(all[host] || {}, { [what]: r.selector });
        await chrome.storage.local.set({ ccSel: all });
        log("✔ Picked " + what + " on " + host + "  (" + r.preview + ")", "ok");
        renderPicks();
    } catch (e) { await backToRunner(); log("Pick failed: " + e.message, "err"); }
}

// ------------------------------------------------------------------ tests
const tested = { src: null, tgt: null };
async function testSrc() {
    try {
        if (!ids.src) { throw new Error("Choose the SOURCE tab first."); }
        let sel = await getSel("src");
        let ch = await call("src", "extract", sel);
        if (!ch) { log("Source: no chapter text found. " + await call("src", "diagnose"), "err"); return; }
        let next = await call("src", "describeNext", sel);
        tested.src = ids.src; log("Source OK ✔  title: “" + ch.title + "”  ·  chapter " + (ch.no != null ? ch.no : (ch.urlNo != null ? ch.urlNo + " (from address)" : "?")) + "  ·  " + ch.paras.length + " paragraphs, " + ch.paras.join("").length + " characters", "ok");
        log("   starts: “" + ch.paras[0].slice(0, 90) + "…”");
        log("   ends:   “…" + ch.paras[ch.paras.length - 1].slice(-90) + "”");
        try { let ex = await call("src", "explain", sel); ex.forEach(l => log("   " + l)); } catch (e) { /* ignore */ }
        if (ch.multi > 1) {
            log("   ⚠ The page holds " + ch.multi + " chapter texts at once. The one matching the reader’s pager/address is used.", "warn");
            try { let bl = await call("src", "describeBlocks", sel); log("   blocks on the page: " + bl.map(b => "[" + (b.label != null ? "ch " + b.label : "?") + " · top " + b.top + " · " + b.chars + " chars · “" + b.start + "…”]").join("  ")); } catch (e) { /* ignore */ }
        }
        if (ch.pager) { log("   Reader pager: Ch. " + ch.pager.cur + " / " + ch.pager.total + "   ·   address number: " + (ch.urlNo != null ? ch.urlNo : "?")); }
        log(next ? "   Next button: " + next : "   Next button: NOT FOUND – use Pick NEXT", next ? "" : "warn");
    } catch (e) { log("Source test failed: " + e.message, "err"); }
}
async function testTgt() {
    try {
        if (!ids.tgt) { throw new Error("Choose the TARGET tab first."); }
        let i = await call("tgt", "inspectTarget");
        let good = i.hasEditor && i.hasTitle && i.kind !== "edit";
        if (good) { tested.tgt = ids.tgt; }
        log("Target " + (good ? "OK ✔" : "PROBLEM") + "  ·  page type: " + (i.kind === "add" ? "Add a new chapter" : i.kind === "edit" ? "Edit chapter (wrong page!)" : "unknown") + "  ·  Chapter name box: " + (i.hasTitle ? "found" : "NOT found") + "  ·  text box: " + (i.hasEditor ? "found" : "NOT found"), good ? "ok" : "err");
        try { let b = await call("tgt", "targetButtons"); log("   Publish → " + (b.publish || "NOT found") + "  ·  Draft → " + (b.draft || "not found") + "  ·  Schedule → " + (b.schedule || "not found") + "  ·  date box → " + (b.date || "not found") + "  ·  text editor → " + (b.editor || "NOT found")); } catch (e) { /* ignore */ }
    } catch (e) { log("Target test failed: " + e.message, "err"); }
}

// ------------------------------------------------------------------ remembers the last published chapter per novel
async function novelKey() {
    if ($("mode").value === "paste") { try { return "paste|" + new URL((await tabGet(ids.tgt)).url).hostname + "|" + ($("pasteBook").value.trim() || "book"); } catch (e) { return null; } }
    if (!ids.src) { return null; }
    try { let u = new URL((await tabGet(ids.src)).url); return u.hostname + u.pathname.replace(/\/?(?:chapter|chap|ch|episode|ep)[-_/]?\d+.*$/i, ""); } catch (e) { return null; }
}
async function showLast() {
    let k = await novelKey();
    let done = k ? ((await chrome.storage.local.get("ccDone")).ccDone || {})[k] : null;
    let nums = done ? Object.keys(done).map(Number).sort((x, y) => x - y) : [];
    let saved = k ? Object.keys(await chrome.storage.local.get(null)).filter(x => x.startsWith("ccBook|" + k + "|")).length : 0;
    $("lastInfo").textContent = (nums.length ? "This tool has published " + nums.length + " chapter(s) of this novel · last address number " + nums[nums.length - 1] : "") + (saved ? " · " + saved + " saved for download" : "");
}
$("continueLast").onclick = async () => {
    let k = await novelKey(); let done = k ? ((await chrome.storage.local.get("ccDone")).ccDone || {})[k] : null;
    let nums = done ? Object.keys(done).map(Number) : [];
    if (!nums.length) { log("Nothing published by this tool yet for this novel.", "warn"); return; }
    $("from").value = Math.max.apply(null, nums) + 1; log("From = " + (Math.max.apply(null, nums) + 1) + " (after the last chapter this tool published).", "ok");
};

// ------------------------------------------------------------------ schedule settings (shared by Start and the live preview)
/** reads the schedule boxes; logit (optional) receives explanations such as "date was in the past – moved" */
function schedFromUI(logit) {
    let say = logit || (() => {});
    let saveMode = $("saveMode").value, plan = $("schedPlan").value, out = { saveMode: saveMode, plan: plan, startMs: 0, perDayTimes: null, problem: "" };
    if (saveMode !== "site" && saveMode !== "timer") { return out; }
    let startMs = $("schedStart").value ? new Date($("schedStart").value).getTime() : 0;
    if (!startMs || isNaN(startMs)) { startMs = Date.now() + (saveMode === "site" ? 10 * 60000 : 0); say("First release: " + (saveMode === "site" ? "in 10 minutes" : "now") + " (no date chosen).", "warn"); out.startGuessed = true; }
    else if (saveMode === "site" && startMs < Date.now() + 2 * 60000) { startMs = Date.now() + 10 * 60000; say("The first release date was in the past – moved to 10 minutes from now (websites refuse past dates).", "warn"); out.startMoved = true; }
    out.startMs = startMs;
    if (plan === "perday") {
        let n = Math.max(1, Math.min(48, parseInt($("perDay").value, 10) || 1));
        let raw = $("perDayTimes").value.split(/[,;\s]+/).filter(Boolean);
        let typed = raw.map(x => /^(\d{1,2}):(\d{2})$/.exec(x)).filter(Boolean).map(m => parseInt(m[1], 10) * 60 + parseInt(m[2], 10)).filter(m => m < 1440);
        if (raw.length && typed.length !== raw.length) { out.problem = "Some of the times in “At these times” are not valid. Write them like 09:00, 21:30 (24-hour clock), separated by commas."; }
        if (typed.length) { out.perDayTimes = typed.sort((a, b) => a - b).filter((m, i, a) => i === 0 || m !== a[i - 1]); if (typed.length !== n) { say("Using your " + out.perDayTimes.length + " posting time(s) per day (not the “chapters per day” number).", "warn"); } }
        else { let sd = new Date(startMs); let base = sd.getHours() * 60 + sd.getMinutes(); out.perDayTimes = Array.from({ length: n }, (_, i) => (Math.round((base + i * 1440 / n) / 5) * 5) % 1440).sort((a, b) => a - b).filter((m, i, a) => i === 0 || m !== a[i - 1]); }
    }
    return out;
}
const fmtSlot = (ms) => new Date(ms).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function renderSchedPreview() {
    let box = $("schedPreview"); if (!box) { return; }
    box.textContent = "";
    let add = (t, c) => { let d = document.createElement("div"); d.textContent = t; if (c) { d.className = c; } box.appendChild(d); };
    let sc = schedFromUI(null);
    if (sc.saveMode !== "site" && sc.saveMode !== "timer") { return; }
    if (sc.problem) { add("⚠ " + sc.problem, "pe"); return; }
    let nowN = Math.max(0, parseInt($("nowCount").value, 10) || 0);
    let o = { schedStartMs: sc.startMs, perDayTimes: sc.perDayTimes, schedBatch: Math.max(1, parseInt($("schedBatch").value, 10) || 1), schedEveryMs: Math.max(0, parseFloat($("schedEvery").value) || 0) * (parseInt($("schedUnit").value, 10) || 86400000) };
    if (sc.plan === "every" && !o.schedEveryMs) { add("⚠ “Then the next batch after” is 0 – every chapter would get the same time. Enter a number above 0.", "pe"); }
    let total = ((parseInt($("max").value, 10) || 0) > 0 ? parseInt($("max").value, 10) : (parseInt($("from").value, 10) > 0 && parseInt($("to").value, 10) > 0 ? parseInt($("to").value, 10) - parseInt($("from").value, 10) + 1 : 0));
    if (sc.startGuessed) { add("No start chosen – the first release is about " + (sc.saveMode === "site" ? "10 minutes from now." : "now."), "pw"); }
    if (sc.startMoved) { add("The start you chose is in the past, so it was moved to 10 minutes from now (websites refuse past dates).", "pw"); }
    if (nowN) { add("Chapter 1" + (nowN > 1 ? "–" + nowN : "") + ": published right away.", "po"); }
    let shown = 0, lim = 6, slots = total ? Math.max(0, total - nowN) : lim;
    for (let k = 0; k < Math.min(lim, slots); k++) { add("Chapter " + (nowN + k + 1) + ": " + fmtSlot(CCCore.slotTime(o, k))); shown++; }
    if (total && slots > lim) { add("… and so on …"); add("Chapter " + total + " (last): " + fmtSlot(CCCore.slotTime(o, slots - 1))); }
    else if (!total) { add("… and so on, for as many chapters as you copy."); }
    if (sc.saveMode === "timer") { add("Keep this window open and the computer awake until the last one is out.", "pw"); }
    else { add("These times use your computer’s clock (" + Intl.DateTimeFormat().resolvedOptions().timeZone + "). Make sure the website uses the same time zone.", "small"); }
}


// ------------------------------------------------------------------ extra click steps + the website's own button names (per target website)
const WHEN_NAME = { before: "before filling", beforePublish: "before Publish", afterClick: "right after Publish", afterPublish: "after publishing" };
async function tgtHost() { try { return ids.tgt ? new URL((await tabGet(ids.tgt)).url).hostname : ""; } catch (e) { return ""; } }
async function getSteps() {
    let h = await tgtHost(); if (!h) { return []; }
    let all = (await chrome.storage.local.get("ccSteps")).ccSteps || {};
    let pre = ccPresetFor(h);
    let list = all[h] !== undefined ? all[h] : (pre ? pre.steps : []);
    return (list || []).filter(x => x && WHEN_NAME[x.when] && (x.text || x.selector));
}
async function setSteps(list) {
    let h = await tgtHost(); if (!h) { return; }
    let all = (await chrome.storage.local.get("ccSteps")).ccSteps || {}; all[h] = list;
    await chrome.storage.local.set({ ccSteps: all });
}
let pendingPick = null;   // selector picked on the page for the step being written
async function renderSteps() {
    let box = $("stepList"); if (!box) { return; }
    let list = await getSteps(); box.textContent = "";
    if (!list.length) { let d = document.createElement("div"); d.className = "small"; d.textContent = "No extra steps for this website."; box.appendChild(d); }
    list.forEach((st, i) => {
        let row = document.createElement("div"); row.className = "steprow";
        let t = document.createElement("span"); t.className = "small";
        t.textContent = (i + 1) + ". " + WHEN_NAME[st.when] + ": click “" + (st.text || st.preview || "picked button") + "”" + (st.selector && st.text ? " (or picked button)" : "") + " · wait " + (st.wait || 0) + "s" + (st.optional ? " · optional" : " · required") + (st.always ? " · every chapter" : "") + (st.ifFilled ? " · only if the editor has text" : "");
        row.appendChild(t);
        let mk = (label, title, fn) => { let b = document.createElement("button"); b.type = "button"; b.textContent = label; b.title = title; b.onclick = fn; row.appendChild(b); };
        mk("▶ Test", "Click it now on the target page", async () => { try { let r = await call("tgt", "clickStep", { text: st.text || "", selector: st.selector || "", timeout: 2000 }); log(r && r.ok ? "Test click OK ✔ " + r.desc : "Test click: button not found on the page right now.", r && r.ok ? "ok" : "warn"); } catch (e) { log("Test click failed: " + e.message, "err"); } });
        mk("↑", "Move up", async () => { if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; await setSteps(list); renderSteps(); } });
        mk("↓", "Move down", async () => { if (i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; await setSteps(list); renderSteps(); } });
        mk("✕", "Remove", async () => { list.splice(i, 1); await setSteps(list); renderSteps(); renderTgtPicks(); });
        box.appendChild(row);
    });
    // the website's own button names
    try {
        let p = await getTProf();
        [["txtPublish", "txt_publish"], ["txtDraft", "txt_draft"], ["txtSchedule", "txt_schedule"]].forEach(([id, k]) => { if (document.activeElement !== $(id)) { $(id).value = p.picks[k] || ""; } });
    } catch (e) { /* ignore */ }
}
$("stepPick").onclick = async () => {
    if (!ids.tgt) { alert("Choose the TARGET tab first."); return; }
    try {
        await focusTab(ids.tgt);
        let r = await call("tgt", "pick", "tStep");
        await backToRunner();
        if (!r) { log("Pick cancelled."); return; }
        pendingPick = r; $("stepPicked").textContent = "picked: " + r.preview;
        if (!$("stepText").value.trim()) { let m = /^“(.*)”$/.exec(r.preview || ""); if (m && m[1]) { $("stepText").value = m[1]; } }
    } catch (e) { await backToRunner(); log("Pick failed: " + e.message, "err"); }
};
$("stepAdd").onclick = async () => {
    if (!ids.tgt) { alert("Choose the TARGET tab first."); return; }
    let text = $("stepText").value.trim();
    if (!text && !pendingPick) { alert("Type the button’s text (for example: Next) or pick the button on the page."); return; }
    let list = await getSteps();
    list.push({ when: $("stepWhen").value, text: text, selector: pendingPick ? pendingPick.selector : "", preview: pendingPick ? pendingPick.preview : "", wait: Math.max(0, parseFloat($("stepWait").value) || 0), optional: $("stepOpt").checked, always: $("stepAlways").checked && $("stepWhen").value === "before" });
    await setSteps(list); pendingPick = null; $("stepPicked").textContent = ""; $("stepText").value = "";
    log("✔ Extra step added (" + WHEN_NAME[list[list.length - 1].when] + ").", "ok");
    renderSteps(); renderTgtPicks();
};
["txtPublish", "txtDraft", "txtSchedule"].forEach((id) => {
    $(id).onchange = async () => {
        let h = await tgtHost(); if (!h) { return; }
        let all = (await chrome.storage.local.get("ccTgt")).ccTgt || {}; all[h] = all[h] || {};
        let k = { txtPublish: "txt_publish", txtDraft: "txt_draft", txtSchedule: "txt_schedule" }[id], v = $(id).value.trim();
        if (v) { all[h][k] = v; } else { delete all[h][k]; }
        await chrome.storage.local.set({ ccTgt: all }); renderTgtPicks();
    };
});
$("siteCopy").onclick = async () => {
    let h = await tgtHost(); if (!h) { alert("Choose the TARGET tab first."); return; }
    let all = (await chrome.storage.local.get("ccTgt")).ccTgt || {};
    let pack = { chapterCopier: 1, website: h, picks: all[h] || {}, steps: await getSteps() };
    let txt = JSON.stringify(pack);
    try { await navigator.clipboard.writeText(txt); log("Settings for " + h + " copied (" + Object.keys(pack.picks).length + " pick(s), " + pack.steps.length + " step(s)). Paste them into a message to share.", "ok"); }
    catch (e) { prompt("Copy this text and share it:", txt); }
};
$("siteLoad").onclick = async () => {
    let h = await tgtHost(); if (!h) { alert("Open the website in a tab, choose it as the TARGET tab, then press this button."); return; }
    let txt = prompt("Paste the settings you were given (they will be applied to " + h + "):"); if (!txt) { return; }
    let pack; try { pack = JSON.parse(txt); } catch (e) { alert("That is not valid settings text. Copy the whole text again."); return; }
    if (!pack || pack.chapterCopier !== 1) { alert("That text is not CopyCat settings."); return; }
    let picks = {}; for (let [k, v] of Object.entries(pack.picks || {})) { if (typeof v === "string" && v.length < 600) { picks[String(k).slice(0, 30)] = v; } }
    let steps = (Array.isArray(pack.steps) ? pack.steps : []).filter(x => x && WHEN_NAME[x.when] && (typeof x.text === "string" || typeof x.selector === "string") && (x.text || x.selector)).slice(0, 30)
        .map(x => ({ when: x.when, text: String(x.text || "").slice(0, 100), selector: String(x.selector || "").slice(0, 500), preview: String(x.preview || "").slice(0, 100), wait: Math.max(0, Math.min(60, Number(x.wait) || 0)), optional: x.optional !== false, always: x.always === true, ifFilled: x.ifFilled === true }));
    if (!confirm("Apply " + Object.keys(picks).length + " pick(s) and " + steps.length + " step(s) made for " + (pack.website || "another website") + " to " + h + "?\n\nThis replaces this website’s saved picks and extra steps.")) { return; }
    let all = (await chrome.storage.local.get("ccTgt")).ccTgt || {}; all[h] = picks; await chrome.storage.local.set({ ccTgt: all });
    await setSteps(steps); if ($("tgtProfile").value === "auto" && Object.keys(picks).length) { $("tgtProfile").value = "custom"; }
    log("✔ Settings loaded for " + h + ". Press “Test target” to check them.", "ok"); renderTgtPicks();
};


// ------------------------------------------------------------------ plain-English help when a run stops
function showHelp(msg) {
    let box = $("helpBox"); if (!box) { return; }
    msg = String(msg || "");
    let tips = [
        [/No tab with id|cannot be reached|private \(incognito\)/i, "The browser lost one of your two tabs.", ["Keep the reader and the Add-chapter page open in normal windows.", "Press ↻ Refresh tab list and choose both tabs again."]],
        [/does not look like an “Add a new chapter”|Add chapter page did not show/i, "The Target tab is not on the Add-chapter form.", ["Open your site’s “Add a new chapter” page (not the chapter list), and make sure you are logged in.", "Press ↻ Refresh tab list, choose that tab as Target, then press “Test target”.", "If your site needs a click first (e.g. “New Chapter”), add it in Target → Extra buttons."]],
        [/The site said/i, "Your website refused the chapter and showed a message.", ["Read the message in the log above. It usually says what is missing (title too long, a required box, a date in the past…).", "Check the website: a chapter may already be saved or scheduled, so look before running again.", "Press 🧹 Start clean for this website if you picked wrong buttons earlier."]],
        [/Not sure whether/i, "The tool could not tell if the chapter was saved, so it stopped to avoid posting it twice.", ["Look at your chapter list / drafts / scheduled list on the website.", "If it is there, set “Start at chapter” to the next number. If not, run again."]],
        [/security check|verification|login wall|locked chapter/i, "The reader page is asking for a human check or a login.", ["Solve it yourself in the reader tab, then press “I solved it – continue”."]],
        [/schedule date|schedule box|Schedule button|date box/i, "The tool could not set the release date on the website.", ["Press “Test target”. If the date box is “NOT found”, open the Target box → “Fix what Test target misses” and pick the real date box.", "Or choose “Save as draft” and schedule by hand."]],
        [/Could not find the .*button|could not find its button/i, "A button on the website was not found.", ["In Target → “This website’s own names for the main buttons”, type exactly what the button says on your site.", "Or open “All options” and use the Pick buttons."]],
        [/Chapter name box|text box|Could not fill/i, "The tool could not find the title or text box.", ["Press “Test target” and open “All options” → “Fix what Test target misses”."]],
        [/No chapter text|not showing the chapter|Reading/i, "The tool could not read the chapter on the reader page.", ["Press “Test reading”. If it fails, open “All options” → Source → pick TEXT, TITLE and NEXT by hand."]]
    ];
    let hit = tips.find(t => t[0].test(msg));
    box.textContent = "";
    let b = document.createElement("b"); b.textContent = "What happened: " + (hit ? hit[1] : "the run stopped."); box.appendChild(b);
    let ul = document.createElement("ul");
    (hit ? hit[2] : ["Read the last red line in the log.", "Press “Copy log” and send it to whoever helps you with this tool."]).forEach(x => { let li = document.createElement("li"); li.textContent = x; ul.appendChild(li); });
    box.appendChild(ul); box.style.display = "block";
}
function hideHelp() { let b = $("helpBox"); if (b) { b.style.display = "none"; } }
$("siteReset").onclick = async () => {
    let h = await tgtHost(); if (!h) { alert("Choose the TARGET tab first."); return; }
    if (!confirm("Forget every pick, button name and extra step saved for " + h + "?\n\nNothing on the website changes.")) { return; }
    let t = (await chrome.storage.local.get("ccTgt")).ccTgt || {}; delete t[h]; await chrome.storage.local.set({ ccTgt: t });
    let sa = (await chrome.storage.local.get("ccSteps")).ccSteps || {}; delete sa[h]; await chrome.storage.local.set({ ccSteps: sa });
    $("tgtProfile").value = "auto"; await chooseTab("tgt");
    log("🧹 " + h + " is clean again. Press “Test target” to see what the tool finds by itself.", "ok");
};

// ------------------------------------------------------------------ the run
// how long the waits are: fast = shortest safe waits, safe = the old, slower waits
const SPEED = {
    max:    { stable: 200,  poll: 80,  pubPoll: 100, after: 80,   fill: 50,  navPause: 0,   settle: 300 },
    turbo:  { stable: 400,  poll: 150, pubPoll: 200, after: 200,  fill: 100, navPause: 50,  settle: 600 },
    fast:   { stable: 700,  poll: 250, pubPoll: 300, after: 350,  fill: 200, navPause: 150, settle: 1000 },
    normal: { stable: 1100, poll: 400, pubPoll: 500, after: 700,  fill: 350, navPause: 400, settle: 1800 },
    safe:   { stable: 1500, poll: 500, pubPoll: 700, after: 1200, fill: 500, navPause: 800, settle: 2500 }
};
function makeEnv(opts, sel) {
    return {
        steps: opts.steps || [], requireBlank: !!opts.requireBlank, loose: opts.tgtProfile === "custom", sel: sel, stableMs: SPEED[opts.speed || "fast"].stable, pollMs: SPEED[opts.speed || "fast"].poll, pubPollMs: SPEED[opts.speed || "fast"].pubPoll,
        afterPublishMs: SPEED[opts.speed || "fast"].after, fillPauseMs: SPEED[opts.speed || "fast"].fill, clickWaitMs: 10000, linkWaitMs: 15000, nextWaitMs: 25000, publishWaitMs: 40000,
        setLast: async (v) => { let k = await novelKey(); if (!k) { return; } let all = (await chrome.storage.local.get("ccLast")).ccLast || {}; all[k] = v; await chrome.storage.local.set({ ccLast: all }); showLast(); },
        sleep: sleep, log: log,
        confirm: async (t) => { alertUser("Please check the first chapter and answer the question in this window."); let ok = window.confirm(t); stopAlert(); return ok; },
        gate: async () => {
            if (!pauseFlag) { return; }
            setStatus("Paused – press Resume."); $("pause").textContent = "▶ Resume"; log("⏸ Paused after the last chapter. Press Resume to continue.", "warn");
            while (pauseFlag && !stopFlag) { await sleep(400); }
            $("pause").textContent = "⏸ Pause after this chapter"; setStatus("Running…");
        },
        alert: (msg) => alertUser(msg),
        challengeMode: opts.onBlock || "wait", challengeMinutes: opts.blockMinutes || 30,
        focusSrc: () => { try { chrome.tabs.update(ids.src, { active: true }); tabGet(ids.src).then(t => chrome.windows.update(t.windowId, { focused: true })).catch(() => {}); } catch (e) { /* ignore */ } },
        setWaiting: (on) => { $("resumeBtn").style.display = on ? "" : "none"; if (!on) { resumeNow = false; } },
        takeResume: () => { let v = resumeNow; resumeNow = false; return v; },
        reload: async (role) => { await liveTab(role); await chrome.tabs.reload(ids[role]); await waitComplete(ids[role], 40000, true, SPEED[opts.speed || "fast"].settle); },
        hint: windowGuard,
        saveChapter: async (n, ch) => {
            runChapters.push({ n: n, title: ch.title, paras: ch.paras });
            let k = await novelKey(); if (!k) { return; }
            await chrome.storage.local.set({ ["ccBook|" + k + "|" + n]: { t: ch.title, p: ch.paras } });
            showLast();
        },
        recover: async () => { await windowGuard(); for (let role of ["src", "tgt"]) { if (ids[role]) { await spoofVisible(ids[role], true); } } },
        result: (r) => { results.push(r); },
        markDone: async (n, title) => { let k = await novelKey(); if (!k) { return; } let all = (await chrome.storage.local.get("ccDone")).ccDone || {}; (all[k] = all[k] || {})[n] = title; await chrome.storage.local.set({ ccDone: all }); showLast(); },
        isDone: async (n) => { let k = await novelKey(); if (!k) { return false; } let all = (await chrome.storage.local.get("ccDone")).ccDone || {}; return !!(all[k] && all[k][n] !== undefined); },
        progress: (done, total, failed, skipped) => {
            setStatus("Running… " + done + " published" + (total ? " of " + total : "") + (skipped ? " · " + skipped + " skipped" : "") + (failed ? " · " + failed + " FAILED" : ""));
            if (total) {
                let handled = done + (failed || 0) + (skipped || 0);
                $("barfill").style.width = Math.min(100, Math.round(handled / total * 100)) + "%";
                if (done > 0) { let per = (Date.now() - runStart) / handled; let left = Math.max(0, total - handled) * per / 1000; $("eta").textContent = "about " + (left >= 120 ? Math.round(left / 60) + " min" : Math.round(left) + " s") + " left · " + (60000 / per).toFixed(1) + " chapters/min"; }
            }
        },
        status: (t) => { $("now").textContent = "▶ " + t; },
        published: (title, verified) => {
            let box = $("pub"); if (box.textContent === "nothing yet") { box.textContent = ""; }
            let d = document.createElement("div"); d.textContent = "✔ " + title + (verified ? "" : "  (not confirmed in list)"); box.appendChild(d);
        },
        checkStop: () => { if (stopFlag) { throw new CCCore.StopError("Stopped by you."); } },
        call: call,
        tabUrl: async (role) => (await liveTab(role)).url,
        navigate: async (role, url) => { await liveTab(role); await chrome.tabs.update(ids[role], { url: url }); await waitComplete(ids[role], 40000, true, SPEED[opts.speed || "fast"].settle); await spoofVisible(ids[role], true); await sleep(SPEED[opts.speed || "fast"].navPause); },
        mainSync: async () => {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: ids.tgt }, world: "MAIN",
                    func: () => {
                        try { if (window.tinymce && window.tinymce.triggerSave) { window.tinymce.triggerSave(); } } catch (e) { /* ignore */ }
                        try { document.querySelectorAll("textarea").forEach(t => t.dispatchEvent(new Event("change", { bubbles: true }))); } catch (e) { /* ignore */ }
                    }
                });
            } catch (e) { /* ignore */ }
        }
    };
}
function parseNumList(t) {
    let out = [];
    for (let part of String(t || "").split(/[,;\s]+/)) {
        let m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part.trim());
        if (!m) { continue; }
        let a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
        for (let i = Math.min(a, b); i <= Math.min(Math.max(a, b), Math.min(a, b) + 5000); i++) { out.push(i); }
    }
    return out;
}
function parseCoinRules(t) {
    return String(t || "").split("\n").map(l => { let m = /^\s*(\d+)\s*(?:=>|=|:|->)\s*(\d+)\s*$/.exec(l); return m ? { from: parseInt(m[1], 10), price: parseInt(m[2], 10) } : null; }).filter(Boolean);
}
async function start() {
    if (running) { return; }
    let paste = $("mode").value === "paste";
    if (paste ? !ids.tgt : (!ids.src || !ids.tgt)) { alert(paste ? "Choose the TARGET tab first." : "Choose the SOURCE tab and the TARGET tab first."); return; }
    if (!paste && ids.src === ids.tgt) { alert("Source and target must be two different tabs."); return; }
    for (let role of (paste ? ["tgt"] : ["src", "tgt"])) {
        try { await liveTab(role); } catch (e) { log("■ " + e.message, "err"); setStatus("Stopped: " + e.message); alert(e.message); await listTabs(); return; }
    }
    if (!$("attest").checked) { alert("Please tick the box to confirm you have the right to publish this novel."); return; }
    let coin = $("coin").value.trim();
    let opts = {
        max: parseInt($("max").value, 10) || 0, delay: parseFloat($("delay").value) || 0,
        coin: coin === "" ? null : parseInt(coin, 10), coinFrom: parseInt($("coinFrom").value, 10) || 31, coinRules: parseCoinRules($("coinRules").value),
        maxMinutes: parseInt($("maxMinutes").value, 10) || 0, skipNums: parseNumList($("skipNums").value), stopWords: $("stopWords").value.split("\n").map(x => x.trim()).filter(Boolean),
        titleTpl: $("titleTpl").value.trim(), prepend: $("prepend").value.trim(), append: $("append").value.trim(), review: $("review").checked,
        skipFirst: $("skipFirst").checked, from: parseInt($("from").value, 10) || 0, jitter: $("jitter").checked, skipFailed: $("skipFailed").checked, skipDone: $("skipDone").checked,
        retries: Math.max(0, Math.min(5, parseInt($("retries").value, 10) || 0)), titleStart: $("titleStart").value.trim() === "" ? null : parseInt($("titleStart").value, 10),
        dropLines: $("dropLines").value.split("\n").map(x => x.trim()).filter(Boolean),
        replacements: $("repl").value.split("\n").map(l => { let i = l.indexOf("=>"); return i < 0 ? null : { from: l.slice(0, i).trim(), to: l.slice(i + 2).trim() }; }).filter(x => x && x.from),
        alertOn: $("alertOn").checked, autoTxt: $("autoTxt").checked, coinRulesText: $("coinRules").value, skipText: $("skipNums").value, speed: $("speed").value, pipeline: $("pipeline").checked, patient: $("patient").checked, autoRestore: $("autoRestore").checked, numbers: $("numMode").value, titleBy: $("titleMode").value, confirmFirst: $("confirmFirst").checked, to: parseInt($("to").value, 10) || 0, allowGaps: $("allowGaps").checked
    };
    // ---- save mode, schedule, website type
    let host = ""; try { host = paste ? "" : new URL((await tabGet(ids.src)).url).hostname; } catch (e) { host = ""; }
    let stepsList = await getSteps();
    let preH = await tgtHost(), pre = ccPresetFor(preH);
    if (pre && pre.noSite && $("saveMode").value === "site") {
        let m = pre.name + " has no schedule feature of its own. Choose “Publish later with this tool” (keeps this window open), “Save as draft”, or “Publish right away” in box 4.";
        alert(m); log("■ " + m, "err"); return;
    }
    let sc = schedFromUI(log), saveMode = sc.saveMode, startMs = sc.startMs, perDayTimes = sc.perDayTimes, plan = sc.plan;
    if (sc.problem) { alert(sc.problem); log("■ " + sc.problem, "err"); return; }
    if (perDayTimes && (saveMode === "site" || saveMode === "timer")) {
        log("Release plan: " + perDayTimes.length + " chapter(s) per day at " + perDayTimes.map(m => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0")).join(", ") + ", starting " + new Date(startMs).toLocaleString() + (parseInt($("nowCount").value, 10) > 0 ? " (after the first " + parseInt($("nowCount").value, 10) + " published right away)" : "") + ".");
    }
    Object.assign(opts, {
        perDayTimes: perDayTimes, nowCount: Math.max(0, parseInt($("nowCount").value, 10) || 0), schedPlan: plan, perDay: $("perDay").value, perDayTimesText: $("perDayTimes").value,
        saveMode: saveMode, schedStartMs: startMs, schedBatch: Math.max(1, parseInt($("schedBatch").value, 10) || 1),
        schedEveryMs: Math.max(0, parseFloat($("schedEvery").value) || 0) * (parseInt($("schedUnit").value, 10) || 86400000),
        dateFmt: $("dateFmt").value.trim() || "YYYY-MM-DD", timeFmt: $("timeFmt").value.trim() || "HH:mm",
        verb: { publish: "Published", timer: "Published", draft: "Saved as draft", site: "Scheduled" }[saveMode] || "Published",
        steps: stepsList, requireBlank: !!(pre && pre.blankRequired), keepAddUrl: $("tgtProfile").value !== "auto" || stepsList.length > 0, tgtProfile: $("tgtProfile").value,
        schedStartText: $("schedStart").value, schedUnit: $("schedUnit").value, schedEveryText: $("schedEvery").value, forceFollow: $("forceFollow").checked
    });
    Object.assign(opts, { onBlock: $("onBlock").value, blockMinutes: Math.max(1, parseInt($("blockMinutes").value, 10) || 30) });
    if (opts.speed === "max") { opts.delay = 0; opts.jitter = false; opts.pipeline = true; log("MAX speed: no pause between chapters and the shortest waits. If a chapter ever looks wrong, use Turbo or Fast.", "warn"); }
    else if (opts.speed === "turbo") { opts.jitter = false; }
    Object.assign(opts, { mode: $("mode").value, splitBy: $("splitBy").value, splitMarker: $("splitMarker").value, pasteStartNo: parseInt($("pasteStartNo").value, 10) || 0, pasteBook: $("pasteBook").value.trim(),
        pasteFrom: Math.max(1, parseInt($("pasteFrom").value, 10) || 1), pasteCount: parseInt($("pasteCount").value, 10) || 0 });
    if (paste) {
        let items = parsePaste($("pasteText").value, $("splitBy").value, $("splitMarker").value);
        if (!items.length) { alert("No chapters found in your pasted text. Paste it, choose where each chapter starts, and press “Preview split”."); return; }
        opts.pasteChapters = items;
    }
    if (!paste && ($("forceFollow").checked || /(^|\.)(royalroad\.com|webnovel\.com)$/i.test(host))) {
        // these readers do not number chapters in their address (or the user said so): follow the Next button, never guess an address
        if (opts.from) { log("This reader has no chapter numbers in its address – “From” is ignored; the run starts at the chapter on screen and follows Next.", "warn"); }
        Object.assign(opts, { follow: true, from: 0, to: 0, allowGaps: true });
    }
    await chrome.storage.local.set({ ccOpts: Object.assign({}, opts, { steps: null, pasteChapters: null, attest: false, review: false, skipFirst: false, allowGaps: false, from: 0, to: 0, follow: false }) });
    results = []; runChapters = []; runStart = Date.now(); pauseFlag = false; $("barfill").style.width = "0"; $("eta").textContent = ""; $("pause").disabled = false;
    running = true; stopFlag = false; warnedMin = {}; hideHelp();
    try { chrome.power.requestKeepAwake("system"); } catch (e) { /* ignore */ }
    try { if (navigator.locks) { navigator.locks.request("cc-run", () => new Promise((res) => { releaseLock = res; })); } } catch (e) { /* ignore */ }
    (async () => { while (running) { await windowGuard(); await sleep(4000); } })();
    $("pub").textContent = "nothing yet"; $("now").textContent = "";
    $("start").disabled = true; $("stop").disabled = false;
    setStatus("Running…");
    try {
        let sel = paste ? {} : await getSel("src");
        let st = paste ? await CCCore.runPaste(makeEnv(opts, sel), opts) : await CCCore.run(makeEnv(opts, sel), opts);
        if (opts.review) { setStatus("Review: filled in, NOT published."); alert("Review mode: the chapter is filled in on the target tab but NOT published.\n\nNote: your Author studio autosaves the form as a draft every few seconds, so a draft may appear in Manage chapters.\n\nTo publish and keep going, untick “Review first” and press Start."); }
        else { setStatus("Done – " + st.done + " chapter(s) published" + (st.failed && st.failed.length ? ", " + st.failed.length + " FAILED (see log / report)" : "") + "."); $("barfill").style.width = "100%"; }
        $("now").textContent = "";
    } catch (e) {
        if (e instanceof CCCore.StopError) { log("■ Stopped by you.", "warn"); setStatus("Stopped."); }
        else { log("■ " + e.message, "err"); setStatus("Stopped: " + e.message); alertUser("STOPPED: " + e.message); showHelp(e.message); }
    } finally {
        if ($("autoTxt").checked && runChapters.length) { exportRun().catch(() => {}); }
        running = false; pauseFlag = false; try { chrome.power.releaseKeepAwake(); } catch (e) { /* ignore */ } if (releaseLock) { releaseLock(); releaseLock = null; } $("start").disabled = false; $("stop").disabled = true; $("pause").disabled = true; $("pause").textContent = "⏸ Pause after this chapter"; stopAlert();
    }
}


// ------------------------------------------------------------------ mode: copy from a website  /  paste my own chapters
function applyMode() {
    document.body.classList.toggle("paste", $("mode").value === "paste");
    if ($("lastInfo")) { showLast(); }
    wizRender();
}
function parsePaste(text, how, marker) {
    let lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    const headRe = /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*((?:chapter|chap\.?|ch\.?|episode|ep\.?)\s*\d+\b.*|prologue\b.*|epilogue\b.*|interlude\b.*)$/i;
    const sepRe = /^\s*([-=*_~#]{3,})\s*$/;
    const clean = (l) => l.replace(/^\s*#{1,6}\s*/, "").replace(/\*\*/g, "").trim();
    let blocks = [], cur = null;
    const start = (title) => { cur = { title: title, body: [] }; blocks.push(cur); };
    if (how === "heading") {
        for (let ln of lines) {
            if (ln.length <= 140 && headRe.test(ln)) { start(clean(ln)); }
            else if (cur) { cur.body.push(ln); }
        }
    } else if (how === "separator" || how === "marker") {
        let mk = String(marker || "").trim();
        if (how === "marker" && !mk) { return []; }
        let raw = [[]];
        for (let ln of lines) { if (how === "separator" ? sepRe.test(ln) : ln.trim() === mk) { raw.push([]); } else { raw[raw.length - 1].push(ln); } }
        for (let b of raw) {
            let i = b.findIndex(x => x.trim());
            if (i < 0) { continue; }
            start(clean(b[i])); cur.body = b.slice(i + 1);
        }
    }
    if (!blocks.length) {          // no headings found, or "one chapter": first non-empty line is the title
        let i = lines.findIndex(x => x.trim());
        if (i >= 0) { blocks = [{ title: clean(lines[i]), body: lines.slice(i + 1) }]; }
    }
    return blocks.map(b => {
        let paras = b.body.map(x => x.trim()).filter(x => x && !sepRe.test(x));
        let m = /^(?:chapter|chap\.?|ch\.?|episode|ep\.?)\s*(\d+)/i.exec(b.title);
        return { title: b.title, paras: paras, no: m ? parseInt(m[1], 10) : null };
    }).filter(b => b.title && b.paras.length);
}
function previewPaste() {
    let items = parsePaste($("pasteText").value, $("splitBy").value, $("splitMarker").value);
    let box = $("pasteInfo"); box.textContent = "";
    if (!items.length) { box.textContent = "No chapters found. Check the text and the “Where does each chapter start?” choice."; return items; }
    let words = (it) => it.paras.join(" ").split(/\s+/).filter(Boolean).length;
    let head = document.createElement("div"); head.className = "ok-t"; head.textContent = items.length + " chapter(s) found · " + items.reduce((a, it) => a + words(it), 0).toLocaleString() + " words in total"; box.appendChild(head);
    items.slice(0, 12).forEach((it, i) => {
        let d = document.createElement("div");
        let warn = it.title.length > 100 ? "  ⚠ title over 100 characters" : it.paras.join("").length < 100 ? "  ⚠ very short" : "";
        d.textContent = (i + 1) + ". " + it.title + "  — " + words(it).toLocaleString() + " words, " + it.paras.length + " paragraphs" + warn;
        box.appendChild(d);
    });
    if (items.length > 12) { let d = document.createElement("div"); d.textContent = "… and " + (items.length - 12) + " more."; box.appendChild(d); }
    return items;
}
let pasteSaveTimer = null;
$("pasteText").oninput = () => { clearTimeout(pasteSaveTimer); pasteSaveTimer = setTimeout(() => chrome.storage.local.set({ ccPaste: $("pasteText").value }).catch(() => {}), 600); };
$("pasteFile").onchange = async () => {
    let f = $("pasteFile").files[0]; if (!f) { return; }
    $("pasteText").value = await f.text(); $("pasteText").oninput(); previewPaste(); log("Loaded " + f.name + " (" + Math.round(f.size / 1024) + " KB).");
};
$("pastePreview").onclick = previewPaste;
$("mode").onchange = applyMode;

// ------------------------------------------------------------------ guided setup (any website)
async function testFill() {
    if (!ids.tgt) { alert("Choose the TARGET tab first."); return; }
    try {
        await call("tgt", "fillForm", { title: "Test title - not published", paras: ["This is the first test paragraph, used only to check the form can be filled.", "This is the second test paragraph."], no: 1, coin: null, applyCoin: false });
        let i = await call("tgt", "formInfo");
        log("Test fill done – NOTHING was published. The form now shows the title “" + i.title + "” and " + i.chars + " characters of text. Reload the target page to clear it.", "ok");
    } catch (e) { log("Test fill failed: " + e.message, "err"); }
}
const WIZ = [
    { id: "tabs", title: "Choose your tabs", btn: "↻ Refresh tab list", action: listTabs,
      text: () => $("mode").value === "paste" ? "Open the website’s NEW CHAPTER form (or your story page that has the “New Chapter” button) in a browser tab. Then choose it as the Target tab below." : "Open the website’s NEW CHAPTER form in one tab and the chapter you want to copy in another. Choose them as the Source and Target tabs below." },
    { id: "s_text", src: true, what: "content", optional: true, title: "Source: the chapter TEXT", text: "On the SOURCE tab press “Pick it”, then click any paragraph of the story. Skip this if “Test source” already finds the text." },
    { id: "s_next", src: true, what: "next", optional: true, title: "Source: the NEXT button", text: "Press “Pick it”, then click the site’s “Next chapter” button. Skip it if the address has chapter numbers." },
    { id: "t_title", what: "tTitle", optional: true, title: "Target: the chapter NAME box", text: "On the TARGET tab open the Add-chapter form. Press “Pick it”, then click the box where the chapter title is typed." },
    { id: "t_editor", what: "tEditor", optional: true, title: "Target: the chapter TEXT editor", text: "Press “Pick it”, then click the TOOLBAR (or the “words” bar) of the main chapter-text editor – not an author-note editor. If it is a plain text box, click inside it." },
    { id: "t_publish", what: "tPublish", optional: true, title: "Target: the PUBLISH button", text: "Scroll to the bottom of the form if needed. Press “Pick it”, then click the Publish button." },
    { id: "t_confirm", what: "tConfirm", optional: true, title: "Target: the CONFIRM button (if a window opens)", text: "Only if clicking Publish opens a window that asks you to confirm: click Publish by hand so the window is open, press “Pick it”, then click its Confirm button. Otherwise Skip." },
    { id: "t_draft", what: "tDraft", optional: true, title: "Target: the SAVE AS DRAFT button", text: "Only needed for “Save as draft” mode. Press “Pick it”, then click the Save-draft button." },
    { id: "t_timer", what: "tTimer", optional: true, title: "Target: the schedule switch / tab", text: "Only for “Schedule on the website”. Open the website’s schedule option by hand (often inside the Publish window) so its switch or tab is visible, press “Pick it”, then click it." },
    { id: "t_date", what: "tSchedDate", optional: true, title: "Target: the schedule DATE box", text: "Only for “Schedule on the website”. With the schedule options open, press “Pick it”, then click the date box (or the combined date-time box)." },
    { id: "t_time", what: "tSchedTime", optional: true, title: "Target: the schedule TIME box", text: "Only if the time is a separate box. Press “Pick it”, then click the time box. Otherwise Skip." },
    { id: "t_sched", what: "tSchedule", optional: true, title: "Target: the SCHEDULE confirm button", text: "Only if the schedule has its own button (skip it if you already picked the Confirm button above)." },
    { id: "t_addlink", what: "tAddLink", optional: true, title: "Target: the NEW CHAPTER link", text: "Only if the Add-chapter form has no stable address. Open your story page, press “Pick it”, then click its “New chapter” link. Skip it if your target tab is already the Add-chapter form." },
    { id: "test", title: "Test it", btn: "Test fill (nothing is published)", action: testFill, text: "Open the Add-chapter form on the target tab, then press the button: it types a test title and text into the form without publishing. Also try “Test target” in box 2 – it lists the buttons it found. When it looks right, choose a Save mode below and press Start." }
];
let wizI = 0;
const wizList = () => WIZ.filter(s => !(s.src && $("mode").value === "paste"));
async function wizDone(s) {
    try {
        if (s.src) { if (!ids.src) { return false; } let h = new URL((await tabGet(ids.src)).url).hostname; return !!((((await chrome.storage.local.get("ccSel")).ccSel || {})[h]) || {})[s.what]; }
        if (s.what) { if (!ids.tgt) { return false; } return !!(await getTProf()).picks[TP_KEYS[s.what]]; }
        if (s.id === "tabs") { return !!(ids.tgt && ($("mode").value === "paste" || ids.src)); }
    } catch (e) { /* ignore */ }
    return false;
}
async function wizRender() {
    let L = wizList(); wizI = Math.max(0, Math.min(wizI, L.length - 1)); let s = L[wizI];
    $("wizStep").textContent = "STEP " + (wizI + 1) + " OF " + L.length + (s.optional ? " · OPTIONAL" : "");
    $("wizFill").style.width = Math.round((wizI + 1) / L.length * 100) + "%";
    $("wizTitle").textContent = s.title; $("wizText").textContent = typeof s.text === "function" ? s.text() : s.text;
    $("wizPick").textContent = s.btn || "Pick it"; $("wizBack").disabled = wizI === 0;
    $("wizNext").textContent = wizI === L.length - 1 ? "✔ Finish" : "Next →"; $("wizSkip").style.display = s.optional && wizI < L.length - 1 ? "" : "none";
    let d = await wizDone(s), st = $("wizState");
    if (s.what || s.id === "tabs") { st.className = "small " + (d ? "ok-t" : "todo-t"); st.textContent = d ? (s.id === "tabs" ? "✔ tabs chosen" : "✔ picked and remembered for this website") : (s.id === "tabs" ? "choose the tab(s) below" : "not picked yet – auto-detect is used if it can find it"); }
    else { st.className = "small"; st.textContent = ""; }
}
$("wizBack").onclick = () => { wizI--; wizRender(); };
$("wizSkip").onclick = () => { wizI++; wizRender(); };
$("wizNext").onclick = () => { if (wizI >= wizList().length - 1) { log("Guided setup finished. Use “Test target”, choose a Save mode, then press Start.", "ok"); return; } wizI++; wizRender(); };
$("wizPick").onclick = async () => {
    let s = wizList()[wizI];
    if (s.what) { if (s.src) { await pick(s.what); } else { await pickT(s.what); } }
    else if (s.action) { await s.action(); }
    wizRender();
};
$("tpEditor").onclick = () => pickT("tEditor"); $("incoWin").onclick = async () => { try { await chrome.windows.create({ url: chrome.runtime.getURL("runner.html"), type: "popup", incognito: true, width: 620, height: 920 }); } catch (e) { alert("Could not open a private window: " + e.message + "\n\nTurn on “Allow in Incognito” for this extension first."); } };
$("incoOpen").onclick = () => chrome.tabs.create({ url: "chrome://extensions/?id=" + chrome.runtime.id });
$("tpTitle").onclick = () => pickT("tTitle"); $("tpPublish").onclick = () => pickT("tPublish"); $("tpDraft").onclick = () => pickT("tDraft");
$("tpSchedule").onclick = () => pickT("tSchedule"); $("tpDate").onclick = () => pickT("tSchedDate"); $("tpTime").onclick = () => pickT("tSchedTime");
$("tpForget").onclick = async () => {
    if (!ids.tgt) { return; }
    let host = new URL((await tabGet(ids.tgt)).url).hostname;
    let all = (await chrome.storage.local.get("ccTgt")).ccTgt || {}; delete all[host];
    await chrome.storage.local.set({ ccTgt: all }); renderTgtPicks(); log("Target picks for " + host + " forgotten.");
};
$("tgtProfile").onchange = () => renderTgtPicks();
$("schedPlan").onchange = () => { let day = $("schedPlan").value === "perday"; document.body.classList.toggle("planday", day); document.body.classList.toggle("planevery", !day); renderSchedPreview(); };
$("saveMode").onchange = () => { let m = $("saveMode").value; updateSchedUI(); $("start").textContent = m === "draft" ? "▶ Start (save drafts)" : m === "site" ? "▶ Start (schedule on site)" : m === "timer" ? "▶ Start (timed release)" : "▶ Start"; };
$("srcTab").onchange = () => chooseTab("src");
$("tgtTab").onchange = () => chooseTab("tgt");
$("refresh").onclick = listTabs;
$("pickContent").onclick = () => pick("content");
$("pickTitle").onclick = () => pick("title");
$("pickNext").onclick = () => pick("next");
$("forget").onclick = async () => {
    if (!ids.src) { return; }
    let t = await tabGet(ids.src); let host = new URL(t.url).hostname;
    let all = (await chrome.storage.local.get("ccSel")).ccSel || {}; delete all[host];
    await chrome.storage.local.set({ ccSel: all }); renderPicks(); log("Picks for " + host + " forgotten.");
};
$("forgetLast").onclick = async () => { let k = await novelKey(); if (!k) { return; } let all = (await chrome.storage.local.get("ccDone")).ccDone || {}; delete all[k]; await chrome.storage.local.set({ ccDone: all }); showLast(); log("Forgot this tool’s list of published chapters for this novel."); };
$("deleteAll").onclick = async () => {
    if (!confirm("Delete ALL saved data of CopyCat?\n\n• chosen tabs\n• your options\n• picked text / title / Next buttons for every website\n• the list of chapters this tool published, for every novel\n• the saved text copies of the chapters\n\nNothing on your websites is touched.")) { return; }
    await chrome.storage.local.remove(Object.keys(await chrome.storage.local.get(null)).filter(x => x.startsWith("ccBook|")));
    await chrome.storage.local.remove(["ccDone", "ccLast", "ccSel", "ccTgt", "ccTabs", "ccOpts", "ccT", "cc"]);
    $("max").value = 0; $("from").value = ""; $("to").value = ""; $("dropLines").value = ""; $("repl").value = ""; $("titleStart").value = ""; $("retries").value = 2; $("skipFailed").checked = false; $("skipDone").checked = false; $("jitter").checked = false; $("alertOn").checked = true; $("numMode").value = "address"; $("titleMode").value = "address"; $("confirmFirst").checked = true; $("autoRestore").checked = true; $("patient").checked = false; $("speed").value = "fast"; $("pipeline").checked = true; $("autoTxt").checked = true; $("coinFrom").value = 31; $("coinRules").value = ""; $("skipNums").value = ""; $("maxMinutes").value = 0; $("stopWords").value = ""; $("titleTpl").value = ""; $("prepend").value = ""; $("append").value = ""; $("delay").value = 1; $("coin").value = "";
    $("review").checked = false; $("skipFirst").checked = false; $("allowGaps").checked = false; $("attest").checked = false;
    ids.src = null; ids.tgt = null;
    await listTabs();
    $("lastInfo").textContent = "";
    log("All saved data deleted.", "ok");
};
$("useReader").onclick = async () => {
    try {
        if (!ids.src) { throw new Error("Choose the SOURCE tab first."); }
        let ch = await call("src", "extract", await getSel("src"));
        if (!ch) { throw new Error("Could not read the chapter on screen. Open a chapter in the reader and try again."); }
        let v = $("numMode").value === "title" ? ch.no : ch.urlNo;
        if (v == null) { throw new Error("Could not read that number from the page."); }
        $("from").value = v; log("From = " + v + " (the chapter on screen: address chapter-" + ch.urlNo + ", page title “" + ch.title + "”).", "ok");
    } catch (e) { log(e.message, "err"); }
};
$("testSrc").onclick = testSrc;
$("testTgt").onclick = testTgt;
$("start").onclick = start;
$("stop").onclick = () => { stopFlag = true; pauseFlag = false; log("Stopping after the current step…", "warn"); };
$("copyLog").onclick = () => navigator.clipboard.writeText($("log").innerText).then(() => log("Log copied."));
window.addEventListener("beforeunload", (e) => { if (running) { e.preventDefault(); e.returnValue = ""; } });
chrome.tabs.onCreated.addListener(() => { if (!running) { listTabs(); } });
chrome.tabs.onRemoved.addListener(() => { if (!running) { listTabs(); } });
(async () => {
    let o = (await chrome.storage.local.get("ccOpts")).ccOpts;
    if (o) {
        $("max").value = o.max || 0; $("delay").value = o.delay == null ? 3 : o.delay; $("coin").value = o.coin == null ? "" : o.coin;
        $("autoTxt").checked = o.autoTxt !== false; $("coinFrom").value = o.coinFrom || 31; $("coinRules").value = o.coinRulesText || ""; $("skipNums").value = o.skipText || ""; $("maxMinutes").value = o.maxMinutes || 0;
        $("stopWords").value = (o.stopWords || []).join("\n"); $("titleTpl").value = o.titleTpl || ""; $("prepend").value = o.prepend || ""; $("append").value = o.append || ""; $("speed").value = o.speed || "fast"; $("saveMode").value = o.saveMode || "publish"; $("tgtProfile").value = o.tgtProfile || "auto"; $("schedStart").value = o.schedStartText || ""; $("schedBatch").value = o.schedBatch || 1; $("schedEvery").value = o.schedEveryText || 1; $("schedUnit").value = o.schedUnit || "86400000"; $("dateFmt").value = o.dateFmt || "YYYY-MM-DD"; $("timeFmt").value = o.timeFmt || "HH:mm"; $("forceFollow").checked = o.forceFollow === true; $("onBlock").value = o.onBlock || "wait"; $("blockMinutes").value = o.blockMinutes || 30; $("mode").value = o.mode || "copy"; $("schedPlan").value = o.schedPlan || "perday"; $("perDay").value = o.perDay || 1; $("perDayTimes").value = o.perDayTimesText || ""; $("nowCount").value = o.nowCount || 0; $("splitBy").value = o.splitBy || "heading"; $("splitMarker").value = o.splitMarker || ""; $("pasteStartNo").value = o.pasteStartNo != null ? o.pasteStartNo : 1; $("pasteBook").value = o.pasteBook || ""; $("pipeline").checked = o.pipeline !== false; $("patient").checked = o.patient === true; $("autoRestore").checked = o.autoRestore !== false; $("numMode").value = o.numbers || "address"; $("titleMode").value = o.titleBy || "address"; $("confirmFirst").checked = o.confirmFirst !== false; $("jitter").checked = o.jitter !== false; $("skipFailed").checked = !!o.skipFailed; $("skipDone").checked = !!o.skipDone; $("alertOn").checked = o.alertOn !== false;
        $("retries").value = o.retries == null ? 2 : o.retries; $("titleStart").value = o.titleStart == null ? "" : o.titleStart;
        $("dropLines").value = (o.dropLines || []).join("\n"); $("repl").value = (o.replacements || []).map(x => x.from + " => " + x.to).join("\n");
    }
    listTabs();
    try { let pt = (await chrome.storage.local.get("ccPaste")).ccPaste; if (pt) { $("pasteText").value = pt; } } catch (e) { /* ignore */ }
    $("saveMode").onchange(); $("schedPlan").onchange(); renderTgtPicks(); applyMode(); wizRender();
})();

let resumeNow = false;
$("resumeBtn").onclick = () => { resumeNow = true; $("resumeBtn").style.display = "none"; };
function stopAlert() { if (alertTimer) { clearInterval(alertTimer); alertTimer = null; document.title = "CopyCat"; } }
function alertUser(msg) {
    log("⚠ " + msg, "warn");
    if (!$("alertOn").checked) { return; }
    try {
        let ctx = new (window.AudioContext || window.webkitAudioContext)(), o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = 0.15; o.start(); o.stop(ctx.currentTime + 0.4);
    } catch (e) { /* ignore */ }
    if (!alertTimer) { let on = false; alertTimer = setInterval(() => { on = !on; document.title = on ? "⚠ ACTION NEEDED" : "CopyCat"; }, 700); setTimeout(stopAlert, 120000); }
    try { chrome.windows.getCurrent().then(w => chrome.windows.update(w.id, { drawAttention: true })); } catch (e) { /* ignore */ }
}
window.addEventListener("focus", stopAlert);
$("pause").onclick = () => { pauseFlag = !pauseFlag; if (pauseFlag) { log("Will pause after the chapter that is being copied now.", "warn"); $("pause").textContent = "▶ Resume (pausing…)"; } };
$("report").onclick = () => {
    let esc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    let csv = "address_number,title,status,note\n" + results.map(r => [r.n, r.title, r.status, r.note].map(esc).join(",")).join("\n");
    let a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "copycat-report.csv"; a.click();
    log("Report saved (" + results.length + " rows).", "ok");
};

// ------------------------------------------------------------------ text export
function novelName(k) {
    try { let seg = k.split("/").filter(Boolean).pop() || k; return decodeURIComponent(seg).replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()).slice(0, 120); } catch (e) { return k; }
}
async function savedChapters() {
    let k = await novelKey(); if (!k) { return { k: null, items: [] }; }
    let all = await chrome.storage.local.get(null), prefix = "ccBook|" + k + "|", items = [];
    for (let key of Object.keys(all)) { if (key.startsWith(prefix)) { let v = all[key]; items.push({ n: parseInt(key.slice(prefix.length), 10), title: v.t, paras: v.p }); } }
    return { k: k, items: items };
}
function downloadText(filename, text) {
    let a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + text], { type: "text/plain;charset=utf-8" }));
    a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
function fileName(name, items) {
    let ns = items.map(i => i.n).sort((x, y) => x - y);
    return (name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 60) || "chapters") + "_" + ns[0] + "-" + ns[ns.length - 1] + ".txt";
}
async function exportRun() {
    if (!runChapters.length) { return; }
    let k = await novelKey(), name = k ? novelName(k) : "Chapters";
    downloadText(fileName(name, runChapters), CCCore.buildText(name, runChapters));
    log("⬇ Saved a text file with the " + runChapters.length + " chapter(s) of this run (check your Downloads folder).", "ok");
}
$("download").onclick = async () => {
    let s = await savedChapters();
    if (!s.items.length) { log("No chapters are saved yet for this novel (they are saved as each chapter is published).", "warn"); return; }
    let name = novelName(s.k);
    downloadText(fileName(name, s.items), CCCore.buildText(name, s.items));
    log("⬇ Downloaded all " + s.items.length + " saved chapter(s) of this novel as one text file.", "ok");
};
$("forgetBook").onclick = async () => {
    let s = await savedChapters(); if (!s.items.length) { return; }
    if (!confirm("Delete the " + s.items.length + " saved chapter copies of this novel from the extension?\n\nNothing on your websites is touched.")) { return; }
    await chrome.storage.local.remove(s.items.map(i => "ccBook|" + s.k + "|" + i.n)); showLast(); log("Saved chapter copies deleted.");
};


// ------------------------------------------------------------------ simple / all-options view, remembered open sections, quick guide
function lsGet(k, d) { try { let v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
function applyView() { document.body.classList.toggle("simple", $("viewMode").value !== "all"); document.body.classList.toggle("easy", $("viewMode").value === "easy"); lsSet("ccView", $("viewMode").value); }
$("viewMode").value = lsGet("ccView", "easy"); if (!$("viewMode").value) { $("viewMode").value = "easy"; } applyView(); $("viewMode").onchange = applyView;
(function rememberOpen() {
    let saved = {}; try { saved = JSON.parse(lsGet("ccOpen", "{}")) || {}; } catch (e) { saved = {}; }
    document.querySelectorAll("details[id]").forEach((d) => {
        if (saved[d.id] != null) { d.open = !!saved[d.id]; }
        d.addEventListener("toggle", () => { saved[d.id] = d.open; lsSet("ccOpen", JSON.stringify(saved)); });
    });
})();
$("refresh2").onclick = listTabs;

function updateSchedUI() {
    let m = $("saveMode").value, sch = (m === "site" || m === "timer");
    $("schedFields").style.display = sch ? "" : "none";
    $("saveHint").textContent = {
        publish: "Each chapter goes live as soon as it is copied. Nothing else to set here.",
        draft: "Each chapter is saved in your drafts. You publish them yourself later on the website.",
        site: "The website itself holds each chapter and publishes it at the time you choose, so your computer can be off afterwards. Needs the site’s schedule box to be found (use “Test target”).",
        timer: "This tool copies each chapter only when its time comes, so this window must stay open and the computer awake. Use it when the site has no schedule feature."
    }[m] || "";
    renderSchedPreview();
}
function rangeHint() {
    let f = parseInt($("from").value, 10) || 0, t = parseInt($("to").value, 10) || 0, mx = parseInt($("max").value, 10) || 0, follow = $("forceFollow").checked || /royalroad|webnovel/.test($("tgtProfile").value);
    let txt = "";
    if (f && t && t < f) { txt = "⚠ “Last chapter” is smaller than “Start at”."; }
    else if (f && t) { txt = "Will copy chapters " + f + " to " + t + " (" + (t - f + 1) + " chapters)."; }
    else if (f && mx) { txt = "Will copy " + mx + " chapters, starting at chapter " + f + "."; }
    else if (f) { txt = "Will copy from chapter " + f + " until the novel ends."; }
    else if (mx) { txt = "Will copy " + mx + " chapters, starting at the chapter shown in the reader tab."; }
    else if (t) { txt = "Will copy from the chapter shown in the reader tab up to chapter " + t + "."; }
    else { txt = "Nothing set: it starts at the chapter shown in the reader tab and goes until the novel ends." + (follow ? "" : ""); }
    $("rangeHint").textContent = txt;
}
function renderGuide() {
    let paste = $("mode").value === "paste", m = $("saveMode").value;
    let haveTabs = paste ? !!ids.tgt : !!(ids.src && ids.tgt);
    let testedOk = paste ? (tested.tgt === ids.tgt && !!ids.tgt) : (tested.src === ids.src && tested.tgt === ids.tgt && !!ids.src && !!ids.tgt);
    let range = paste ? true : ($("from").value || parseInt($("max").value, 10) > 0 || $("to").value || $("forceFollow").checked);
    let modeTxt = { publish: "Publish right away", draft: "Save as draft", site: "Schedule on the website", timer: "Publish later with this tool" }[m];
    let steps = [
        { t: paste ? "Open your site’s “Add a new chapter” page in a browser tab" : "Open the reader (chapter to copy) and your site’s “Add a new chapter” page in two tabs", s: "Use two normal windows side by side. Don’t minimize them.", done: haveTabs, req: true, auto: true },
        { t: "Choose those tabs in " + (paste ? "box 2 (Target)" : "box 1 (Source) and box 2 (Target)"), s: "Pressing ↻ Refresh tab list shows new tabs.", done: haveTabs, req: true },
        { t: "Press “" + (paste ? "Test target" : "Test reading") + "” " + (paste ? "" : "and “Test target” ") + "– they should say OK ✔", s: "If something is missing, open “All options” (top) to pick it by hand.", done: testedOk, req: false },
        paste ? { t: "Paste your chapters in box 1 and press “Preview split”", s: "", done: !!$("pasteText").value.trim(), req: true } : { t: "Say which chapters (box 3)", s: "Leave blank to start at the chapter on screen.", done: !!range, req: false },
        { t: "Choose what happens to each chapter (box 4): " + modeTxt, s: m === "site" || m === "timer" ? "Check the release preview that appears." : "", done: true, req: false },
        { t: "Tick “I have the right to publish this novel” (box 7)", s: "", done: $("attest").checked, req: true },
        { t: "Press ▶ Start", s: "You can watch the progress bar and log at the bottom.", done: running, req: true }
    ];
    let ul = $("guideList"); ul.textContent = "";
    steps.forEach((st, i) => {
        let li = document.createElement("li"); li.className = (st.done ? "done" : "") + (st.req ? "" : " opt");
        let b = document.createElement("span"); b.className = "st"; b.textContent = st.done ? "✓" : String(i + 1);
        let d = document.createElement("div"); d.textContent = st.t; if (st.s) { let sm = document.createElement("small"); sm.textContent = st.s; d.appendChild(sm); }
        li.appendChild(b); li.appendChild(d); ul.appendChild(li);
    });
    let nx = steps.find(x => x.req && !x.done), box = $("guideNext");
    if (running) { box.className = "nextstep good"; box.textContent = "Running… watch the log at the bottom. You can press Pause or Stop at any time."; }
    else if (nx) { box.className = "nextstep"; box.textContent = "Next: " + nx.t; }
    else { box.className = "nextstep good"; box.textContent = "All set – press ▶ Start when you are ready."; }
}
function refreshUI() { try { rangeHint(); renderGuide(); } catch (e) { /* ignore */ } }
["input", "change"].forEach((ev) => document.addEventListener(ev, (e) => { refreshUI(); if (e.target && /^(saveMode|schedStart|schedPlan|perDay|perDayTimes|schedBatch|schedEvery|schedUnit|nowCount|max|from|to)$/.test(e.target.id)) { renderSchedPreview(); } }));
setInterval(refreshUI, 1500);
updateSchedUI(); refreshUI();
