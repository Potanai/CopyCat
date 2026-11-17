"use strict";
/*  CopyCat – the controller logic. Pure orchestration: it only talks to the outside world through `env`,
    so every step is checked and nothing depends on a page staying loaded.                                         */
const CCCore = (() => {
    class StopError extends Error { }
    /** a failure after which retrying could duplicate something (e.g. "not sure it was published") – always stops the run */
    class FatalError extends Error { }
    class EndError extends Error { }
    /** a stop that the user asked for (a stop word, a time limit): finish quietly, nothing is an error */
    class HaltError extends Error { }

    /** the chapter's place in the sequence: the number in the address is the most reliable (titles can be mis-read) */
    const seqOf = (ch) => (ch.urlNo != null ? ch.urlNo : ch.no);
    const numOf = (ch) => (ch.no != null ? ch.no : ch.urlNo);      // number shown in the title (used for pricing / display)

    /** .../chapter-13 → .../chapter-14, computed from a KNOWN address, never from whatever the page shows now */
    function nextUrlFrom(url) {
        try {
            let u = new URL(url);
            let re = /(chapter|chap|ch|episode|ep)([-_/]?)(\d{1,5})(?!.*\d)/i;
            if (!re.test(u.pathname)) { return null; }
            u.pathname = u.pathname.replace(re, (s, a, b, n) => a + b + (parseInt(n, 10) + 1));
            return u.href;
        } catch (e) { return null; }
    }

    /** same address with the chapter number replaced: .../chapter-17 → .../chapter-14 */
    function urlForNo(url, n) {
        try {
            let u = new URL(url);
            let re = /(chapter|chap|ch|episode|ep)([-_/]?)(\d{1,5})(?!.*\d)/i;
            if (!re.test(u.pathname)) { return null; }
            u.pathname = u.pathname.replace(re, (s, a, b) => a + b + n);
            return u.href;
        } catch (e) { return null; }
    }

    /** a fingerprint of the story text, so the same text is never posted twice even under a different title */
    function fingerprint(ch) {
        let t = ch.paras.join("").replace(/\s+/g, "");
        return t.slice(0, 200) + "#" + t.slice(-200) + "#" + t.length;
    }

    /** The reader showed the wrong chapter: open the one that is due, directly by address, and check it really is that one. */
    async function goTo(env, ref, want) {
        let target = urlForNo(ref.url, want);
        if (!target) { throw new Error("Expected chapter " + want + " but the reader shows " + seqOf(ref) + ", and the address has no number to correct it with. Stopped so nothing is skipped or duplicated."); }
        let seen = seqOf(ref);
        for (let i = 1; i <= 3; i++) {
            env.checkStop();
            env.log("… the reader shows chapter " + seen + " but chapter " + want + " is due – opening " + target + " (try " + i + ")", "warn");
            await env.navigate("src", target);
            let ch = await readStable(env, null, 45000);
            if (ch && seqOf(ch) === want) { return ch; }
            if (ch) { seen = seqOf(ch); }
            await env.sleep(2000);
        }
        throw new Error("Expected chapter " + want + " but the reader keeps showing chapter " + seen + ". Stopped so nothing is skipped or duplicated.");
    }

    function looksLikeChapter(ch) {
        let chars = ch.paras.join("").length;
        return !!ch.title && chars >= 200 && chars / ch.paras.length >= 20;
    }

    async function waitUntil(env, fn, timeoutMs, stepMs) {
        let end = Date.now() + timeoutMs;
        while (Date.now() < end) {
            env.checkStop();
            let v = null;
            try { v = await fn(); } catch (e) { v = null; }
            if (v) { return v; }
            if (env.hint && Date.now() - (waitUntil.lastHint || 0) > 10000) { waitUntil.lastHint = Date.now(); try { await env.hint(); } catch (e) { /* ignore */ } }
            await env.sleep(stepMs || env.pollMs || 500);
        }
        return null;
    }

    /** Reads the chapter on the source tab and only returns it once it has stayed the same for a moment
     *  (so a half-loaded page, with the new title but the old text, is never copied). */
    /**
     * The source page is not showing the chapter because a person has to act (security check, login, locked chapter).
     * This tool NEVER tries to solve or get around a verification. It either stops, or waits for the person and carries on by itself.
     * Returns the milliseconds it waited.
     */
    async function humanWait(env, reason) {
        if (env.alert) { try { env.alert(reason + " – please deal with it in the SOURCE tab."); } catch (e) { /* ignore */ } }
        if (env.focusSrc) { try { env.focusSrc(); } catch (e) { /* ignore */ } }
        if ((env.challengeMode || "wait") === "stop") {
            throw new HaltError("Stopped here: " + reason + ". Solve it in the SOURCE tab (or fix the page), then press Start again – with “skip chapters already published” ticked it continues where it stopped.");
        }
        let limit = (env.challengeMinutes || 30) * (env.minuteMs || 60000), t0 = Date.now(), lastStatus = 0;
        env.log("🛑 " + reason + ". Solve it in the SOURCE tab – I am waiting (up to " + (env.challengeMinutes || 30) + " min) and will carry on by myself, or press “▶ I solved it – continue”.", "warn");
        if (env.setWaiting) { env.setWaiting(true); }
        try {
            while (Date.now() - t0 < limit) {
                env.checkStop();
                if (env.takeResume && env.takeResume()) {
                    env.log("▶ Continuing – reloading the source page…");
                    try { await env.reload("src"); } catch (e) { /* ignore */ }
                    await env.sleep(1200);
                    return Date.now() - t0;
                }
                let still = false; try { still = await env.call("src", "isChallenge"); } catch (e) { still = false; }
                if (!still) {
                    let ch = null; try { ch = await env.call("src", "extract", env.sel); } catch (e) { ch = null; }
                    if (ch && looksLikeChapter(ch)) { env.log("✔ The chapter text is back – continuing.", "ok"); return Date.now() - t0; }
                }
                if (env.status && Date.now() - lastStatus > 900) { lastStatus = Date.now(); env.status("🛑 Waiting for you: " + reason + " (" + Math.round((limit - (Date.now() - t0)) / 60000) + " min left)"); }
                await env.sleep(1500);
            }
        } finally { if (env.setWaiting) { env.setWaiting(false); } }
        throw new HaltError("Waited " + Math.round(limit / 60000) + " minutes and the source page still shows no chapter (" + reason + "). Stopped here.");
    }
    async function whyBlocked(env, badFor) {
        try { if (await env.call("src", "isChallenge")) { return "A security check / human verification is showing on the source page"; } } catch (e) { /* ignore */ }
        if (badFor > 8000) { try { let r = await env.call("src", "blockedReason"); if (r) { return "The source page is not showing the chapter: " + r; } } catch (e) { /* ignore */ } }
        return "";
    }
    async function readStable(env, notKey, timeoutMs) {
        let end = Date.now() + timeoutMs;
        let last = null, since = 0, lastCheck = 0, badSince = 0;
        while (Date.now() < end) {
            env.checkStop();
            let ch = null;
            try { ch = await env.call("src", "extract", env.sel); } catch (e) { ch = null; }
            if (!ch && env.hint && Date.now() - (readStable.lastHint || 0) > 10000) { readStable.lastHint = Date.now(); try { await env.hint(); } catch (e) { /* ignore */ } }
            let bad = !ch || !looksLikeChapter(ch);
            if (bad) { if (!badSince) { badSince = Date.now(); } } else { badSince = 0; }
            if (bad && Date.now() - lastCheck > 1000) {
                lastCheck = Date.now();
                let reason = await whyBlocked(env, Date.now() - badSince);
                if (reason) {
                    let waited = await humanWait(env, reason);
                    end = Math.max(end + waited, Date.now() + 20000); last = null; badSince = 0;
                    continue;
                }
            }
            if (ch && ch.key !== notKey) {
                if (last && last.key === ch.key) {
                    let held = Date.now() - since;
                    // Sites often number titles and addresses differently ("Chapter 9" lives at /chapter-7), always by the same
                    // offset. Once that offset is known, a different one means the page is half-loaded: wait for it to settle.
                    let mismatch = env.offset !== undefined && ch.no != null && ch.urlNo != null && (ch.urlNo - ch.no) !== env.offset;
                    if (held >= env.stableMs && (!mismatch || held >= 8000)) {
                        if (bad) {      // a short/odd page: make sure it is not a verification page before accepting it
                            let reason = await whyBlocked(env, Date.now() - badSince);
                            if (reason) { let waited = await humanWait(env, reason); end = Math.max(end + waited, Date.now() + 20000); last = null; badSince = 0; continue; }
                        }
                        return ch;
                    }
                } else { last = ch; since = Date.now(); }
            } else { last = null; }
            await env.sleep(env.pollMs || 500);
        }
        return null;
    }

    /** Moves the source tab to the next chapter.
     *  The next address is worked out from the address of the chapter just read (never from the page as it is now),
     *  and if the page has already moved on by itself (a slow Next click) it is simply waited for – never moved twice. */
    async function advance(env, prev) {
        let byUrl = nextUrlFrom(prev.url);
        let methods = {
            url: { wait: env.nextWaitMs, run: async () => { if (!byUrl) { return null; } await env.navigate("src", byUrl); return "opened " + byUrl; } },
            click: { wait: env.clickWaitMs, run: async () => { let r = await env.call("src", "clickNext", env.sel); return r && r.ok ? "clicked " + r.desc : null; } },
            link: { wait: env.linkWaitMs, run: async () => {
                let h = await env.call("src", "nextHref", env.sel);
                if (!h || !h.href) { return null; }
                if (h.no != null && prev.urlNo != null && h.no !== prev.urlNo + 1) { env.log("… ignored a “next” link that does not lead to the following chapter (" + h.href + ")", "warn"); return null; }
                await env.navigate("src", h.href);
                return "opened its link " + h.href;
            } }
        };
        let order = byUrl ? ["url", "click", "link"] : ["click", "link"];
        if (env.pref && order.includes(env.pref)) { order = [env.pref].concat(order.filter(n => n !== env.pref)); }

        let moved = async () => (await env.tabUrl("src")) !== prev.url;
        for (let name of order) {
            env.checkStop();
            if (await moved()) {                       // the page moved on by itself: wait for it
                let late = await readStable(env, prev.key, 60000);
                if (late) { return late; }
            }
            let how = null;
            try { how = await methods[name].run(); } catch (e) { how = null; }
            if (!how) { continue; }
            env.log("→ next chapter: " + how);
            let nx = await readStable(env, prev.key, methods[name].wait);
            if (!nx && await moved()) { nx = await readStable(env, prev.key, 60000); }   // still loading: keep waiting
            if (nx) { env.pref = name; return nx; }
            env.log("… the page did not change, trying another way", "warn");
        }
        if (await moved()) { let late = await readStable(env, prev.key, 60000); if (late) { return late; } }
        try {
            let cands = await env.call("src", "nextCandidates");
            env.log("Reader is at " + (await env.tabUrl("src")) + " · chapter " + numOf(prev) + " · candidates: " + (cands && cands.length ? cands.join(" | ") : "none"), "warn");
        } catch (e) { /* ignore */ }
        throw new Error("Could not move the reader to the next chapter. Use “Pick NEXT”, click the Next button on the page, then start again.");
    }

    /** Fills the Add chapter page, publishes, and confirms it worked. Returns {review:true} when only reviewing. */
    /** release time (ms) of the k-th scheduled chapter. "Chapters per day" plan: fixed times of day; otherwise N chapters every X. */
    function slotTime(o, k) {
        let start = o.schedStartMs || Date.now();
        if (o.perDayTimes && o.perDayTimes.length) {
            let n = -1, d0 = new Date(start); d0.setHours(0, 0, 0, 0);
            for (let day = 0; day < 5000; day++) {
                for (let m of o.perDayTimes) {
                    let t = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + day, Math.floor(m / 60), m % 60, 0, 0).getTime();
                    if (t < start - 59000) { continue; }
                    if (++n === k) { return t; }
                }
            }
        }
        return start + Math.floor(k / Math.max(1, o.schedBatch || 1)) * (o.schedEveryMs || 0);
    }

    async function post(env, st, ch, o) {
        let mode = o.saveMode || "publish";      // publish | draft | site (schedule on the website) | timer (this tool waits, then publishes)
        let slotMs = null;
        if (mode === "site" || mode === "timer") {
            let idx = st.slot || 0, nowN = o.nowCount || 0;
            if (idx < nowN) { mode = "publish"; }          // the first N chapters go out right away, the rest follow the schedule
            else { slotMs = slotTime(o, idx - nowN); }
            if (mode === "timer" && slotMs > Date.now()) {
                if (slotMs > Date.now() + 1500) { env.log("⏳ “" + ch.title + "” is set for " + new Date(slotMs).toLocaleString() + " – waiting. Keep this window open.", "warn"); }
                let lastShown = 0;
                while (Date.now() < slotMs) {
                    env.checkStop();
                    if (env.status && Date.now() - lastShown > 900) {
                        lastShown = Date.now();
                        let left = Math.round((slotMs - Date.now()) / 1000);
                        env.status("⏳ Waiting to publish “" + ch.title + "” at " + new Date(slotMs).toLocaleString() + " (" + (left >= 7200 ? Math.round(left / 3600) + " h" : left >= 120 ? Math.round(left / 60) + " min" : left + " s") + " left)");
                    }
                    await env.sleep(Math.min(1000, Math.max(50, slotMs - Date.now())));
                }
            }
        }
        if (!st.fresh) { await env.navigate("tgt", st.addUrl); }
        st.fresh = false;
        if ((env.steps || []).some(x => x.when === "before")) {
            await runSteps(env, "before", x => x.always);            // e.g. “New Chapter +” on sites whose editor is always showing an old chapter
            if ((env.steps || []).some(x => x.when === "before" && x.ifFilled)) {
                let f0 = null; try { f0 = await env.call("tgt", "formInfo"); } catch (e) { f0 = null; }
                if (f0 && ((f0.title || "").trim() || f0.chars > 0)) { await runSteps(env, "before", x => x.ifFilled && !x.always); }
            }
            let i1 = null; try { i1 = await env.call("tgt", "inspectTarget"); } catch (e) { i1 = null; }
            if (!(i1 && i1.hasEditor && i1.hasTitle)) { await runSteps(env, "before", x => !x.always && !x.ifFilled); }
        }
        if (env.requireBlank) {
            let f1 = null; try { f1 = await env.call("tgt", "formInfo"); } catch (e) { f1 = null; }
            if (f1 && ((f1.title || "").trim() || f1.chars > 0)) { throw new Error("The editor still shows an old chapter (“" + (f1.title || "").slice(0, 40) + "”), so nothing was typed – an existing chapter must never be overwritten. Press “New Chapter +” on the website yourself, or check the extra step “New Chapter” in Target → Extra buttons."); }
        }
        let ready = await waitUntil(env, async () => {
            let i = await env.call("tgt", "inspectTarget");
            return i.hasEditor && i.hasTitle ? i : null;
        }, 30000, env.pollMs || 600);
        if (!ready) { throw new Error("The Add chapter page did not show a Chapter name box and text box. Are you still logged in to Author studio?"); }
        if (ready.kind === "edit") {
            throw new Error("The target tab is on an “Edit chapter” page. Open “Add a new chapter” (not an existing chapter), pick it as the target and start again.");
        }

        let want = ch.paras.join("").replace(/\s+/g, "").length;
        let price = coinFor(o, numOf(ch));
        let fillArgs = { title: ch.title, paras: ch.paras, no: numOf(ch), coin: price, applyCoin: price !== null };
        let r = null;
        try { r = await env.call("tgt", "fillForm", fillArgs); } catch (e) { r = null; }
        if (!r || !r.ok) { await env.sleep(2000); r = await env.call("tgt", "fillForm", fillArgs); }
        if (!r || !r.ok) { throw new Error((r && r.error) || "Could not fill in the form."); }
        await env.mainSync();
        await env.sleep(env.fillPauseMs || 500);
        let info = await env.call("tgt", "formInfo");
        if (info.title.trim() !== ch.title.trim() || info.chars < want * 0.9) {
            throw new Error("The form does not contain the chapter after filling it (title “" + info.title + "”, " + info.chars + " of " + want + " characters). Nothing was published.");
        }
        if (o.review) { return { review: true }; }

        if (env.status) { env.status((mode === "draft" ? "Saving draft “" : mode === "site" ? "Scheduling “" : "Publishing “") + ch.title + "”…"); }
        let inline = true;                     // false = the date/time are set inside the Confirm window that opens after Publish (Webnovel)
        if (mode === "site") {
            let fr = await env.call("tgt", "fillSchedule", { ms: slotMs, dateFmt: o.dateFmt, timeFmt: o.timeFmt });
            if (fr && fr.ok) { env.log("   release date set to " + fr.shown + " (your computer's time zone)"); }
            else if (fr && fr.dialogFlow) { inline = false; }
            else { throw new Error((fr && fr.error) || "Could not set the schedule date. Nothing was published."); }
        }
        await runSteps(env, "beforePublish");
        let useNotice = mode !== "publish" || o.keepAddUrl === true;
        let notice0 = ""; if (useNotice) { try { notice0 = await env.call("tgt", "noticeText"); } catch (e) { notice0 = ""; } }
        let before = await env.tabUrl("tgt");
        let pr = await env.call("tgt", mode === "draft" ? "clickDraft" : (mode === "site" && inline) ? "clickSchedule" : "clickPublish");
        if (!pr || !pr.ok) { throw new Error((pr && pr.error) || "Could not click the " + (mode === "draft" ? "Save as draft" : mode === "site" ? "Schedule" : "Publish") + " button."); }
        if (mode !== "draft") {
            let ds = null; try { ds = await env.call("tgt", "dialogStep", { timer: mode === "site" && !inline, ms: slotMs, dateFmt: o.dateFmt, timeFmt: o.timeFmt }); } catch (e) { ds = null; }
            if (ds && ds.ok === false) { if (ds.fatal) { throw new FatalError(ds.error); } throw new Error(ds.error); }
            if (ds && ds.dialog) { env.log("   Confirm window handled" + (ds.shown ? " – release set to " + ds.shown + " (your computer's time zone)" : "") + "."); }
        }

        await runSteps(env, "afterClick");
        let outcome = null;
        let end = Date.now() + env.publishWaitMs;
        while (Date.now() < end && !outcome) {
            env.checkStop();
            await env.sleep(env.pubPollMs || 700);
            if ((await env.tabUrl("tgt")) !== before) { outcome = "page changed"; break; }
            let i = null;
            try { i = await env.call("tgt", "inspectTarget"); } catch (e) { outcome = "page changed"; break; }
            if (i.kind !== "add") { outcome = "page changed"; break; }
            let errs = ""; try { errs = await env.call("tgt", "readErrors"); } catch (e) { errs = ""; }
            if (errs) { throw new Error("The site said: " + errs); }
            if (useNotice) {
                let nt = ""; try { nt = await env.call("tgt", "noticeText"); } catch (e) { nt = ""; }
                if (nt && nt !== notice0) { outcome = "notice: " + nt; break; }
            }
            let f = null; try { f = await env.call("tgt", "formInfo"); } catch (e) { f = null; }
            if (f && f.title === "" && f.chars === 0) { outcome = "form cleared"; break; }
            if (f && env.loose && (f.title.trim() !== ch.title.trim() || f.chars < want * 0.5)) { outcome = "form changed"; break; }
        }
        if (!outcome) { throw new FatalError("Not sure whether “" + ch.title + "” was " + (mode === "draft" ? "saved" : mode === "site" ? "scheduled" : "published") + " (nothing changed after " + Math.round(env.publishWaitMs / 1000) + " s). Check your chapter list" + (mode === "draft" ? " / drafts" : "") + ". Stopped so nothing is duplicated."); }

        // learn where "+ Add chapter" leads and confirm the chapter shows up
        st.slot = (st.slot || 0) + 1;
        await env.sleep(env.afterPublishMs || 1200);
        await runSteps(env, "afterPublish");
        let live = (mode === "publish" || mode === "timer");
        if (live && !o.keepAddUrl) {
            let add = await waitUntil(env, async () => { let h = await env.call("tgt", "findAddLink"); return h || null; }, 6000, env.pollMs || 600);
            if (add) { st.addUrl = add; }
        }
        let verified = null;
        if (live) { verified = false; try { verified = !!(await env.call("tgt", "hasText", ch.title)); } catch (e) { verified = false; } }
        return { ok: true, verified: verified, verb: { publish: "Published", timer: "Published", draft: "Saved as draft", site: "Scheduled" }[mode] };
    }


    function urlNoOf(url) {
        try { let m = /(chapter|chap|ch|episode|ep)[-_/]?(\d{1,5})(?!.*\d)/i.exec(new URL(url).pathname); return m ? parseInt(m[2], 10) : null; } catch (e) { return null; }
    }

    /** Opens chapter n by ITS OWN address and checks, from the browser's tab address and from the page, that it really is chapter n. */
    async function openChapter(env, baseUrl, n, prevKey) {
        let target = urlForNo(baseUrl, n), seen = null;
        for (let i = 1; i <= 3; i++) {
            env.checkStop();
            await env.navigate("src", target);
            let ch = await readStable(env, prevKey, 45000);
            let tabNo = urlNoOf(await env.tabUrl("src"));
            if (ch && seqOf(ch) === n && tabNo === n) { return ch; }
            seen = ch ? seqOf(ch) : null;
            env.log("… opened chapter " + n + " but the page shows " + (ch ? "chapter " + seen : "no chapter text") + " (try " + i + " of 3)", "warn");
            await env.sleep(2500);
        }
        return { failed: true, seen: seen };
    }

    /** coin price for a chapter number: the last rule whose "from" is not above the number; null = leave the site's value */
    function coinFor(o, no) {
        let rules = (o.coinRules && o.coinRules.length) ? o.coinRules : ((o.coin !== null && o.coin !== undefined && o.coin !== "") ? [{ from: o.coinFrom || 31, price: o.coin }] : []);
        let price = null, best = -1;
        for (let r of rules) { if (no != null && no >= r.from && r.from >= best) { best = r.from; price = r.price; } }
        return price;
    }

    /** text clean-up and title renumbering chosen by the user */
    function applyRules(ch, o, n) {
        let drop = (o.dropLines || []).map(x => String(x).trim().toLowerCase()).filter(Boolean);
        let paras = ch.paras.filter(p => !drop.some(d => p.toLowerCase().includes(d)));
        for (let r of (o.replacements || [])) { if (r.from) { paras = paras.map(p => p.split(r.from).join(r.to || "")); } }
        paras = paras.filter(p => p.trim());
        let title = ch.title, no = ch.no;
        if (o.titleStart != null && o.titleStart !== "" && !isNaN(o.titleStart)) {
            no = parseInt(o.titleStart, 10) + (n - o.from);
            let rest = String(title).replace(/^\s*chapter\s*\d+\s*[:\-–—.]?\s*/i, "").trim();
            title = "Chapter " + no + (rest ? ": " + rest : "");
        }
        else if (o.titleBy !== "site") {      // default: name it by the number in the browser address, which is what the user sees
            no = n;
            let rest2 = String(title).replace(/^\s*chapter\s*\d+\s*[:\-–—.]?\s*/i, "").trim();
            title = "Chapter " + no + (rest2 ? ": " + rest2 : "");
        }
        if (o.titleTpl && no != null) {
            let nm = String(title).replace(/^\s*chapter\s*\d+\s*[:\-–—.]?\s*/i, "").trim();
            title = o.titleTpl.replace(/\{n\}/g, String(no)).replace(/\{name\}/g, nm).replace(/[\s:–—\-.]+$/, "").trim();
        }
        if (o.prepend && String(o.prepend).trim()) { paras = [String(o.prepend).trim()].concat(paras); }
        if (o.append && String(o.append).trim()) { paras = paras.concat([String(o.append).trim()]); }
        return Object.assign({}, ch, { paras: paras, title: title, no: no });
    }

    /** The target tab should show the Add-chapter form. If it shows the story page instead (a “New Chapter” button/link), open that first. */

    /** the user's own extra clicks (Next, Back, Confirm, “click here”…) for the target website. when = before | beforePublish | afterClick | afterPublish */
    const STEP_WAIT = { before: 1500, beforePublish: 3000, afterClick: 10000, afterPublish: 4000 };
    async function runSteps(env, when, flt) {
        for (let s of (env.steps || []).filter(x => x.when === when && (!flt || flt(x)))) {
            env.checkStop();
            let label = s.text || s.preview || s.selector || "?";
            let r = null;
            try { r = await env.call("tgt", "clickStep", { text: s.text || "", selector: s.selector || "", timeout: STEP_WAIT[when] || 3000 }); } catch (e) { r = { ok: false, error: e.message }; }
            if (r && r.ok) { env.log("   extra step: clicked " + r.desc); await env.sleep(Math.max(0, (s.wait || 0) * 1000) + (env.fillPauseMs || 200)); }
            else if (s.optional) { /* not on this page – fine */ }
            else { throw new Error("Your extra step “" + label + "” (" + ({ before: "before filling", beforePublish: "before Publish", afterClick: "right after Publish", afterPublish: "after publishing" }[when]) + ") could not find its button. Nothing was lost; check the step in Target → Extra buttons."); }
        }
    }

    async function getAddPage(env) {
        let ready = (i) => (i && i.hasEditor && i.hasTitle) ? i : null;
        let i0 = null; try { i0 = await env.call("tgt", "inspectTarget"); } catch (e) { i0 = null; }
        if (!ready(i0)) {
            let link = ""; try { link = await env.call("tgt", "findAddLink"); } catch (e) { link = ""; }
            if (link) { env.log("The target tab is not the Add-chapter form – opening “New Chapter” from this page…"); await env.navigate("tgt", link); }
            else if ((env.steps || []).some(x => x.when === "before")) { try { await runSteps(env, "before"); } catch (e) { /* the wait below reports it */ } }
        }
        return waitUntil(env, async () => ready(await env.call("tgt", "inspectTarget")), 20000, env.pollMs || 600);
    }

    /** RANGE MODE: chapter numbers From..To, each opened by its own address. Nothing is ever guessed or followed. */
    async function runRange(env, o) {
        let log = env.log;
        let say = (t) => { if (env.status) { env.status(t); } };
        let st = { fresh: true, addUrl: null, done: 0, skipped: 0, failed: [], lastNo: null, posted: new Set(), fps: new Set() };
        let t = await getAddPage(env);
        if (!t) { throw new Error("The TARGET tab does not look like an “Add a new chapter” page. Open the Add-chapter form (or your story page that has the “New Chapter” button) and choose its tab again."); }
        if (t.kind === "edit") { throw new Error("The TARGET tab is on an “Edit chapter” page. Open “Add a new chapter”, choose its tab and start again."); }
        st.addUrl = t.url;

        let base = await env.tabUrl("src");
        if (!urlForNo(base, 1)) { throw new Error("The reader address has no chapter number (" + base + "), so range mode cannot be used. Use follow-the-page mode (it is chosen automatically when From is blank and the address has no number)."); }
        say("Reading the chapter on screen…");
        let cur = await readStable(env, null, 60000);
        let off = 0;     // address number minus title number (this site: chapter-7 is titled "Chapter 9", so off = -2)
        if (o.numbers === "title" && cur && cur.no != null && cur.urlNo != null) { off = cur.urlNo - cur.no; env.offset = off; }
        else if (o.numbers === "title" && o.from) { throw new Error("Could not read the chapter on screen to learn how its title numbers relate to the address. Open the reader on a chapter page and try again."); }
        let titleNo = (a) => (o.numbers === "title" ? a - off : a);
        let fromA, toA;
        if (o.numbers !== "title") { fromA = o.from || (cur ? cur.urlNo : urlNoOf(base)); toA = o.to; }
        else { fromA = o.from ? o.from + off : (cur && cur.urlNo != null ? cur.urlNo : urlNoOf(base)); toA = o.to ? o.to + off : 0; }
        if (!fromA || fromA < 1) { throw new Error("From chapter is not valid for this site (it maps to address " + fromA + ")."); }
        o = Object.assign({}, o, { from: fromA });
        let to = toA && toA >= fromA ? toA : (o.max ? fromA + o.max - 1 : 0);
        if (cur) { log("Reader shows “" + cur.title + "” at address chapter-" + cur.urlNo + (off ? "  → this site's addresses are " + Math.abs(off) + (off < 0 ? " lower" : " higher") + " than its titles" : "")); }
        log("Will copy chapters " + titleNo(fromA) + " to " + (to ? titleNo(to) : "the end") + " (addresses chapter-" + fromA + " to " + (to ? "chapter-" + to : "the end") + ")");
        let retries = o.retries == null ? 2 : o.retries;
        let total = to ? to - o.from + 1 : 0;
        log("RANGE MODE · address pattern " + urlForNo(base, "N") + " · retries " + retries + (o.skipFailed ? " · skip failed" : "") + (o.skipDone ? " · skip already-published" : ""));

        let lastReadKey = null, streak = 0, patientTries = 0;
        /** open + check one chapter in the reader (never touches the target tab, so it can run while the previous chapter is being published) */
        const readOne = async (n, prevK) => {
            say("Opening chapter " + n + " in the reader…");
            let raw = await openChapter(env, base, n, prevK);
            if (raw.failed) {
                if (!to && raw.seen == null && n > o.from) { log("Chapter " + titleNo(n) + " shows no chapter text (and no security check) – treating chapter " + titleNo(n - 1) + " as the end of the novel. If that is wrong, look at the SOURCE tab (log in? locked chapter?) and press Start again.", "warn"); throw new EndError("end"); }
                throw new Error("Chapter " + n + " could not be opened as chapter " + n + (raw.seen != null ? " (the page showed " + raw.seen + ")" : "") + ".");
            }
            if (raw.pager && raw.no != null && raw.no !== raw.pager.cur && o.numbers !== "title") {
                throw new Error("The reader says it is on chapter " + raw.pager.cur + " (pager) but the text found is chapter " + raw.no + " – the wrong block of the page was read. Nothing was posted.");
            }
            if (raw.multi > 1) { log("⚠ The page holds " + raw.multi + " chapter texts at once; copied the one on screen (starts: “" + (raw.paras[0] || "").slice(0, 70) + "…”)", "warn"); }
            let ch = applyRules(raw, o, n);
            if (!looksLikeChapter(ch)) { throw new Error("Chapter " + n + " does not look like a chapter (too little text after clean-up). Title found: “" + ch.title + "”. Nothing was posted."); }
            return { raw: raw, ch: ch };
        };
        /** check, confirm, paste and publish one chapter that has been read */
        const postOne = async (n, got) => {
            let raw = got.raw, ch = got.ch;
            if (o.stopWords && o.stopWords.length) {
                let hay = (raw.title + " " + raw.paras.join(" ")).toLowerCase();
                let hit = o.stopWords.find(w => w && hay.includes(String(w).toLowerCase()));
                if (hit) { throw new HaltError("Stopped before chapter " + titleNo(n) + ": it contains “" + hit + "”. Nothing was posted for it."); }
            }
            if (st.fps.has(fingerprint(ch))) { throw new FatalError("Chapter " + n + " has the same text as one already posted in this run. Stopped so it is not duplicated."); }
            if (o.confirmFirst && st.done === 0 && !st.confirmed && env.confirm) {
                let okc = await env.confirm("About to " + ({ draft: "save as a DRAFT", site: "SCHEDULE", timer: "publish on your timer" }[o.saveMode] || "publish") + " the FIRST chapter of this run:\n\n• Browser address: chapter-" + n + (raw.pager ? "   (reader pager: Ch. " + raw.pager.cur + " / " + raw.pager.total + ")" : "") + "\n• The site's own title: “" + raw.title + "”\n• Will be posted as: “" + ch.title + "”\n• Text starts: “" + (ch.paras[0] || "").slice(0, 110) + "…”\n\nIs this the chapter you expect?");
                if (!okc) { throw new StopError("Cancelled at the first-chapter check. Nothing was posted."); }
                st.confirmed = true;
            }
            say("Pasting “" + ch.title + "”…");
            log("Chapter " + titleNo(n) + " (address chapter-" + n + ") · site title “" + raw.title + "” · posting as “" + ch.title + "” · " + ch.paras.length + " paragraphs, " + ch.paras.join("").length + " characters");
            let res = await post(env, st, ch, o);
            if (res.review) { return { review: true }; }
            st.fps.add(fingerprint(ch)); st.done++;
            log("✔ " + (res.verb || o.verb || "Published") + ": " + ch.title + (res.verified === null ? "" : res.verified ? "  (seen in your chapter list)" : "  (could not confirm in the list – check later)"), "ok");
            if (env.published) { env.published(ch.title, res.verified !== false); }
            if (env.markDone) { await env.markDone(n, ch.title); }
            if (env.saveChapter) { try { await env.saveChapter(n, ch); } catch (e) { /* saving the copy must never stop the run */ } }
            if (env.result) { env.result({ n: titleNo(n), title: ch.title, status: (res.verb || o.verb || "Published").toLowerCase(), note: res.verified === false ? "not confirmed in list" : "" }); }
            return { ok: true };
        };
        // PIPELINE: while chapter n is pasted and published in the target tab, chapter n+1 is already being read in the reader tab
        const pre = new Map();
        const startPrefetch = async (n) => {
            let m = n + 1;
            if (!o.pipeline || o.review || (to && m > to) || pre.has(m)) { return; }
            if (o.skipDone && env.isDone && await env.isDone(m)) { return; }
            let key = lastReadKey;
            pre.set(m, (async () => { try { return { v: await readOne(m, key) }; } catch (e) { return { e: e }; } })());
        };

        let t0 = Date.now(), skipSet = new Set(o.skipNums || []);
        for (let n = o.from; !to || n <= to; n++) {
            env.checkStop();
            if (env.gate) { await env.gate(); }
            env.checkStop();
            if (o.maxMinutes && Date.now() - t0 > o.maxMinutes * (env.minuteMs || 60000)) { log("⏱ Time limit of " + o.maxMinutes + " minute(s) reached – stopping after chapter " + titleNo(n - 1) + ".", "warn"); return st; }
            if (skipSet.has(titleNo(n))) {
                pre.delete(n); st.skipped++; log("↷ Chapter " + titleNo(n) + " is on your skip list – skipped.");
                if (env.result) { env.result({ n: titleNo(n), title: "", status: "skipped", note: "on skip list" }); }
                continue;
            }
            if (o.skipDone && env.isDone && await env.isDone(n)) {
                pre.delete(n); st.skipped++; log("↷ Chapter " + titleNo(n) + " was already published by this tool earlier – skipped.");
                if (env.result) { env.result({ n: titleNo(n), title: "", status: "skipped", note: "already published earlier" }); }
                continue;
            }
            let attempt = 0, out = null;
            for (;;) {
                attempt++;
                try {
                    let got = null;
                    if (attempt === 1 && pre.has(n)) {
                        let r = await pre.get(n); pre.delete(n);
                        if (r.e) { throw r.e; }
                        got = r.v;
                    } else {
                        if (pre.size) { await Promise.all([...pre.values()]); pre.clear(); }     // never use the reader tab twice at once
                        got = await readOne(n, attempt === 1 ? lastReadKey : null);
                    }
                    lastReadKey = got.raw.key;
                    await startPrefetch(n);
                    out = await postOne(n, got); streak = 0; patientTries = 0; break;
                }
                catch (e) {
                    if (e instanceof StopError || e instanceof FatalError) { throw e; }
                    if (e instanceof HaltError) { log("■ " + e.message, "warn"); return st; }
                    if (e instanceof EndError) { log("Chapter " + n + " cannot be opened – assuming the end of the novel.", "warn"); return st; }
                    if (attempt <= retries) { log("Chapter " + n + " failed: " + e.message + " – retrying (attempt " + (attempt + 1) + " of " + (retries + 1) + ")", "warn"); await env.sleep(3000 * attempt); continue; }
                    if (!o.skipFailed && o.patient === true && patientTries < (o.patientMax || 30)) {
                        patientTries++;
                        log("Chapter " + titleNo(n) + " is stuck: " + e.message + " – trying again in a minute (" + patientTries + " of " + (o.patientMax || 30) + "). Fix it in the browser or press Stop.", "warn");
                        if (env.alert && (patientTries === 1 || patientTries % 5 === 0)) { try { env.alert("Stuck on chapter " + titleNo(n) + ": " + e.message); } catch (x) { /* ignore */ } }
                        if (env.recover) { try { await env.recover(); } catch (x) { /* ignore */ } }
                        for (let i = 0; i < 60; i++) { env.checkStop(); if (i % 5 === 0) { say("⏳ Stuck on chapter " + titleNo(n) + " – trying again in " + (60 - i) + " s · " + e.message); } await env.sleep(1000); }
                        continue;
                    }
                    if (o.skipFailed) {
                        st.failed.push({ n: titleNo(n), error: e.message }); streak++;
                        log("✖ Gave up on chapter " + n + ": " + e.message + " – continuing with the next one.", "err");
                        if (env.result) { env.result({ n: titleNo(n), title: "", status: "FAILED", note: e.message }); }
                        if (streak >= 3) { throw new Error("3 chapters in a row failed – stopping (are you still logged in, is the site up?). Last error: " + e.message); }
                        out = { failed: true }; break;
                    }
                    throw e;
                }
            }
            if (out && out.review) { log("REVIEW: filled in but NOT published. Check it, then untick “Review first” and press Start.", "warn"); return st; }
            env.progress(st.done, total, st.failed.length, st.skipped);
            let d = Math.max(0, o.delay) * 1000; if (o.jitter) { d = d * (1 + Math.random() * 0.5); }
            await env.sleep(d);
        }
        log("Finished: chapters " + titleNo(o.from) + "–" + (to ? titleNo(to) : "end") + " · published " + st.done + (st.skipped ? " · skipped " + st.skipped : "") + (st.failed.length ? " · FAILED " + st.failed.map(f => f.n).join(", ") : ""), st.failed.length ? "warn" : "ok");
        return st;
    }

    /** PASTE MODE: the chapters come from text the user pasted (no source tab). Same posting, drafts, schedule and safety as copy mode. */
    async function runPaste(env, o) {
        let log = env.log;
        let say = (t) => { if (env.status) { env.status(t); } };
        let list = o.pasteChapters || [];
        if (!list.length) { throw new Error("There are no chapters to post. Paste your text and press “Preview split” first."); }
        let st = { fresh: true, addUrl: null, done: 0, skipped: 0, failed: [], lastNo: null, posted: new Set(), fps: new Set(), slot: 0 };
        let t = await getAddPage(env);
        if (!t) { throw new Error("The TARGET tab does not look like an “Add a new chapter” page. Open the Add-chapter form (or your story page that has the “New Chapter” button) and choose its tab again."); }
        if (t.kind === "edit") { throw new Error("The TARGET tab is on an “Edit chapter/draft” page. Open “Add a new chapter”, choose its tab and start again."); }
        st.addUrl = t.url;

        let startIdx = Math.max(0, (o.pasteFrom || 1) - 1);
        let endIdx = o.pasteCount ? Math.min(list.length, startIdx + o.pasteCount) : list.length;
        let total = Math.max(0, endIdx - startIdx);
        let firstNo = o.pasteStartNo != null ? o.pasteStartNo : 1;
        let noOf = (i) => (list[i].no != null ? list[i].no : firstNo + i);
        if (!total) { throw new Error("Nothing to post: the start position is beyond the last chapter in your list (" + list.length + " found)."); }
        let retries = o.retries == null ? 2 : o.retries;
        log("PASTE MODE · " + total + " chapter(s) from your text (" + list.length + " found) · " + (o.verb || "Published") + " · retries " + retries);
        let t0 = Date.now(), skipSet = new Set(o.skipNums || []);
        let ro = Object.assign({}, o, { titleBy: "site", from: noOf(startIdx) });

        for (let i = startIdx; i < endIdx; i++) {
            env.checkStop();
            if (env.gate) { await env.gate(); }
            env.checkStop();
            if (o.maxMinutes && Date.now() - t0 > o.maxMinutes * (env.minuteMs || 60000)) { log("⏱ Time limit of " + o.maxMinutes + " minute(s) reached – stopping.", "warn"); break; }
            let n = noOf(i);
            if (skipSet.has(n)) { st.skipped++; log("↷ Chapter " + n + " is on your skip list – skipped."); if (env.result) { env.result({ n: n, title: list[i].title, status: "skipped", note: "on skip list" }); } continue; }
            if (o.skipDone && env.isDone && await env.isDone(n)) { st.skipped++; log("↷ Chapter " + n + " was already posted by this tool earlier – skipped."); if (env.result) { env.result({ n: n, title: list[i].title, status: "skipped", note: "already posted earlier" }); } continue; }
            let ch = applyRules({ title: list[i].title, paras: list[i].paras.slice(), no: n, key: "paste-" + i }, ro, n);
            let attempt = 0, out = null;
            for (;;) {
                attempt++;
                try {
                    if (!ch.title || ch.paras.join("").length < 100) { throw new Error("“" + ch.title + "” has too little text (under 100 characters) to be a chapter. Nothing was posted."); }
                    if (o.stopWords && o.stopWords.length) {
                        let hay = (ch.title + " " + ch.paras.join(" ")).toLowerCase();
                        let hit = o.stopWords.find(w => w && hay.includes(String(w).toLowerCase()));
                        if (hit) { throw new HaltError("Stopped before “" + ch.title + "”: it contains “" + hit + "”. Nothing was posted for it."); }
                    }
                    if (st.fps.has(fingerprint(ch))) { throw new FatalError("“" + ch.title + "” has the same text as a chapter already posted in this run. Stopped so it is not duplicated."); }
                    if (o.confirmFirst && st.done === 0 && !st.confirmed && env.confirm) {
                        let okc = await env.confirm("About to " + ({ draft: "save as a DRAFT", site: "SCHEDULE", timer: "publish on your timer" }[o.saveMode] || "publish") + " the FIRST chapter:\n\n• Title: “" + ch.title + "”\n• Text starts: “" + (ch.paras[0] || "").slice(0, 110) + "…”\n• " + ch.paras.length + " paragraphs\n\nIs this what you expect?");
                        if (!okc) { throw new StopError("Cancelled at the first-chapter check. Nothing was posted."); }
                        st.confirmed = true;
                    }
                    say("Pasting “" + ch.title + "”…");
                    log("Chapter " + n + " · “" + ch.title + "” · " + ch.paras.length + " paragraphs, " + ch.paras.join("").length + " characters");
                    let res = await post(env, st, ch, o);
                    if (res.review) { out = { review: true }; break; }
                    st.fps.add(fingerprint(ch)); st.done++;
                    log("✔ " + (res.verb || o.verb || "Published") + ": " + ch.title + (res.verified === null ? "" : res.verified ? "  (seen in your chapter list)" : "  (could not confirm in the list – check later)"), "ok");
                    if (env.published) { env.published(ch.title, res.verified !== false); }
                    if (env.markDone) { await env.markDone(n, ch.title); }
                    if (env.result) { env.result({ n: n, title: ch.title, status: (res.verb || o.verb || "Published").toLowerCase(), note: res.verified === false ? "not confirmed in list" : "" }); }
                    out = { ok: true }; break;
                }
                catch (e) {
                    if (e instanceof StopError || e instanceof FatalError) { throw e; }
                    if (e instanceof HaltError) { log("■ " + e.message, "warn"); return st; }
                    if (attempt <= retries) { log("Chapter " + n + " failed: " + e.message + " – retrying (attempt " + (attempt + 1) + " of " + (retries + 1) + ")", "warn"); await env.sleep(3000 * attempt); continue; }
                    if (o.skipFailed) {
                        st.failed.push({ n: n, error: e.message });
                        log("✖ Gave up on chapter " + n + ": " + e.message + " – continuing with the next one.", "err");
                        if (env.result) { env.result({ n: n, title: ch.title, status: "FAILED", note: e.message }); }
                        if (st.failed.length >= 3 && st.done === 0) { throw new Error("The first 3 chapters failed – stopping. Last error: " + e.message); }
                        out = { failed: true }; break;
                    }
                    throw e;
                }
            }
            if (out && out.review) { log("REVIEW: filled in but NOT posted. Check it in the target tab, then untick “Review first” and press Start.", "warn"); return st; }
            env.progress(st.done, total, st.failed.length, st.skipped);
            let d = Math.max(0, o.delay) * 1000; if (o.jitter) { d = d * (1 + Math.random() * 0.5); }
            if (i < endIdx - 1) { await env.sleep(d); }
        }
        log("Finished: " + (o.verb || "Published").toLowerCase() + " " + st.done + " chapter(s)" + (st.skipped ? " · skipped " + st.skipped : "") + (st.failed.length ? " · FAILED " + st.failed.length : "") + ".");
        return st;
    }

    /** one text file with every chapter: title, blank line, paragraphs separated by blank lines */
    function buildText(name, items) {
        let sorted = items.slice().sort((a, b) => a.n - b.n);
        let out = [name || "Chapters", "Exported " + new Date().toISOString().slice(0, 16).replace("T", " ") + " · " + sorted.length + " chapter(s)" + (sorted.length ? " · address numbers " + sorted[0].n + "–" + sorted[sorted.length - 1].n : ""), "", "=".repeat(60), ""];
        for (let it of sorted) { out.push(it.title, "", it.paras.join("\n\n"), "", "=".repeat(60), ""); }
        return out.join("\n");
    }

    async function run(env, o) {
        if (o.from || (o.follow !== true && urlForNo(await env.tabUrl("src"), 1))) { return runRange(env, o); }
        let log = env.log;
        let say = (t) => { if (env.status) { env.status(t); } };
        let st = { fresh: true, addUrl: null, done: 0, lastNo: null, posted: new Set(), fps: new Set() };

        let t = await getAddPage(env);
        if (!t) { throw new Error("The TARGET tab does not look like an “Add a new chapter” page (no Chapter name box / text box found). Open that page and choose its tab again."); }
        if (t.kind === "edit") { throw new Error("The TARGET tab is on an “Edit chapter” page. Open “Add a new chapter”, choose its tab and start again."); }
        st.addUrl = t.url;

        say("Reading the chapter on the source tab…");
        log("Reading the first chapter…");
        let ch = await readStable(env, null, 60000);
        if (!ch) {
            let rep = ""; try { rep = await env.call("src", "diagnose"); } catch (e) { rep = ""; }
            if (rep) { log("Page report: " + rep, "warn"); }
            throw new Error("Could not find the chapter text on the source page. Use “Pick TEXT”, click a paragraph of the story, then start again.");
        }
        if (ch.no != null && ch.urlNo != null) { env.offset = ch.urlNo - ch.no; }
        log("Reader tab: " + (await env.tabUrl("src")) + "   · options: allow gaps " + (o.allowGaps ? "ON" : "off") + ", already-posted " + (o.skipFirst ? "ON" : "off"));
        log("Starting from: " + ch.title + (ch.urlNo != null ? "   (address chapter-" + ch.urlNo + ")" : ""));
        if (o.skipFirst) {
            st.posted.add(ch.key); st.fps.add(fingerprint(ch)); st.lastNo = seqOf(ch);
            log("Skipping (already posted): " + ch.title);
            ch = await advance(env, ch);
        }

        for (;;) {
            env.checkStop();
            let n = seqOf(ch);
            // the address number decides the order: if the reader is not on the chapter that is due, go to the right one
            if (!o.allowGaps && st.lastNo != null && n != null && n !== st.lastNo + 1) {
                ch = await goTo(env, ch, st.lastNo + 1);
                n = seqOf(ch);
            }
            if (!looksLikeChapter(ch)) { throw new Error("This does not look like a chapter (too little text). Title found: “" + ch.title + "”. Nothing was posted."); }
            if (st.posted.has(ch.key) || st.fps.has(fingerprint(ch))) { throw new Error("“" + ch.title + "” (address chapter-" + n + ") has the same text as a chapter already posted in this run – stopped so it is not duplicated."); }
            say("Pasting “" + ch.title + "” into the Add chapter form…");
            log("Copying: " + ch.title + "  (" + ch.paras.length + " paragraphs, " + ch.paras.join("").length + " characters)");
            let res = await post(env, st, ch, o);
            if (res.review) {
                log("REVIEW: the form is filled in but NOT published. Check the title and text in the target tab. If it is right, click Publish chapter yourself, then untick “Review first”, tick “Current chapter is already posted” and press Start.", "warn");
                return st;
            }
            st.posted.add(ch.key); st.fps.add(fingerprint(ch)); st.lastNo = n != null ? n : (st.lastNo != null ? st.lastNo + 1 : null); st.done++;
            log("✔ " + (res.verb || o.verb || "Published") + ": " + ch.title + (res.verified === null ? "" : res.verified ? "  (seen in your chapter list)" : "  (could not confirm in the list – check later)"), "ok");
            env.progress(st.done);
            if (env.published) { env.published(ch.title, res.verified !== false); }
            if (env.setLast && numOf(ch) != null) { await env.setLast({ no: numOf(ch), title: ch.title }); }

            if (o.max && st.done >= o.max) {
                log("Finished " + st.done + " chapter(s). Moving the reader to the next chapter.");
                try { await advance(env, ch); } catch (e) { /* best effort */ }
                return st;
            }
            if (ch.last) { log("Reached the last chapter."); return st; }

            say("Published ✔ “" + ch.title + "”. Moving the reader to the next chapter…");
            await env.sleep(Math.max(0, o.delay) * 1000);
            ch = await advance(env, ch);
            say("Reader is on “" + ch.title + "”.");
        }
    }

    return { humanWait, slotTime, run, runRange, runPaste, buildText, coinFor, HaltError, post, applyRules, FatalError, advance, readStable, looksLikeChapter, StopError, numOf, seqOf, nextUrlFrom, urlForNo };
})();
if (typeof module !== "undefined") { module.exports = CCCore; }
