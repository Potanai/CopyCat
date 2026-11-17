"use strict";
/* CopyCat – page helpers. Injected on demand by the controller (runner.js); holds NO state of its own. */
(() => {
    if (window.__ccLib) { return; }
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    async function waitFor(fn, timeoutMs, stepMs) {
        let end = Date.now() + timeoutMs;
        while (Date.now() < end) {
            let v = null;
            try { v = fn(); } catch (e) { v = null; }
            if (v) { return v; }
            await sleep(stepMs || 400);
        }
        return null;
    }
    /** a human-verification page (Cloudflare Turnstile, reCAPTCHA, "Security Check Required", "I'm not a robot"…). Never solved by this tool – only detected. */
    function detectChallenge() {
        if (/just a moment|attention required|verify you are human|checking your browser|security (check|verification)|are you a robot|captcha/i.test(document.title || "")) { return true; }
        if (document.querySelector("#challenge-form, #challenge-running, .cf-turnstile, .g-recaptcha, .h-captcha, iframe[src*='challenges.cloudflare.com'], iframe[src*='recaptcha'], iframe[src*='hcaptcha'], [data-cc-demo-verification='pending']")) { return true; }
        let t = ((document.body && document.body.innerText) || "").slice(0, 8000);
        return /security check required|complete the security (check|challenge)|unusual (reading )?activity from your ip|verify that you are human|i['’]m not a robot|cloudflare turnstile/i.test(t);
    }
    /** other reasons the chapter text is not there: locked, login wall, not found */
    function blockedReason() {
        let t = ((document.body && document.body.innerText) || "").slice(0, 8000);
        if (/chapter (is )?locked|unlock (this )?chapter|premium (members|chapter)s? only|(buy|purchase) (this )?chapter/i.test(t)) { return "the chapter is locked"; }
        if (/(please|you must|you need to) (log ?in|sign ?in)( first)? to (read|continue|view)|login required/i.test(t)) { return "the site asks you to log in"; }
        if (/chapter not found|page not found|404 not found|this chapter (does not|doesn['’]t) exist/i.test(t)) { return "the chapter was not found"; }
        return "";
    }
    function visible(e) {
        if (!e || !e.getBoundingClientRect) { return false; }
        let r = e.getBoundingClientRect();
        let st = e.ownerDocument.defaultView.getComputedStyle(e);
        return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
    }


    let SEL = {};
    // target-site profile (set by the controller before every call): which website type + the elements the user picked
    let TP = { id: "auto", picks: {} };
    function pk(k) {
        let q = (TP.picks || {})[k];
        if (!q) { return null; }
        try { return document.querySelector(q); } catch (e) { return null; }
    }
    /** the user's own name for a button (Target → Extra buttons → “my site's button names”) goes first */
    function mine(k, res) {
        let t = ((TP.picks || {})["txt_" + k] || "").trim();
        if (!t) { return res; }
        return t.split("|").map(x => x.trim()).filter(Boolean).map(x => new RegExp("^\\s*" + x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "i")).concat(res);
    }
    function btnByText(res, picked, opts) {
        if (picked) { return picked; }
        opts = opts || {};
        let items = [...document.querySelectorAll("button, input[type=submit], input[type=button], a.btn, a[role=button], [role=button]")].filter(visible);
        let txt = (e) => (e.textContent || e.value || e.getAttribute("aria-label") || "").trim();
        if (opts.exclude) { items = items.filter(e => !opts.exclude.test(txt(e))); }
        if (opts.preferDialog) { let d = items.filter(e => e.closest(".modal, [role=dialog], dialog")); if (d.length) { items = d; } }
        for (let re of res) {
            let m = items.filter(e => re.test(txt(e)));
            if (m.length) { return opts.last ? m[m.length - 1] : m[0]; }
        }
        return null;
    }
    function cssPath(el) {
        let parts = [];
        for (let e = el; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) {
            let part = e.tagName.toLowerCase();
            if (e.id && /^[A-Za-z][\w-]*$/.test(e.id) && !/\d{4,}/.test(e.id)) { parts.unshift("#" + e.id); break; }
            let cls = [...e.classList].filter(c => /^[A-Za-z][\w-]*$/.test(c) && !/\d{3,}|^css-|^jsx-|^sc-|^svelte-|^_/.test(c)).slice(0, 2);
            if (cls.length) { part += "." + cls.join("."); }
            if (e.parentElement) {
                let sameTag = [...e.parentElement.children].filter(x => x.tagName === e.tagName);
                if (sameTag.length > 1) { part += ":nth-of-type(" + (sameTag.indexOf(e) + 1) + ")"; }
            }
            parts.unshift(part);
            try { if (document.querySelectorAll(parts.join(" > ")).length === 1) { break; } } catch (err) { /* keep climbing */ }
        }
        return parts.join(" > ");
    }
    function containerFor(el) {
        let p = el.closest("p");
        let start = p ? p.parentElement : (isLeafText(el) ? el.parentElement : el);
        for (let e = start; e && e !== document.body; e = e.parentElement) {
            let n = 0;
            for (let c of e.children) { if (isParaLike(c)) { ++n; } }
            if (n >= 3) { return e; }
        }
        return start || el;
    }
    function diagnose() {
        let blocks = [...document.querySelectorAll("p, div, article, section, main")]
            .map(e => ({ e: e, n: [...e.children].filter(c => c.textContent.trim().length > 0).length, chars: e.textContent.trim().length }))
            .filter(x => x.n >= 2).sort((a, b) => b.chars - a.chars).slice(0, 4);
        let desc = blocks.map(x => x.e.tagName.toLowerCase() + (typeof x.e.className === "string" && x.e.className ? "." + x.e.className.trim().split(/\s+/).slice(0, 2).join(".") : "") + " (" + x.n + " children, " + x.chars + " chars)");
        return "Page has " + document.querySelectorAll("p").length + " <p>, " + document.querySelectorAll("iframe").length + " iframes, title “" + (document.title || "").slice(0, 60) + "”. Biggest blocks: " + (desc.join("; ") || "none") + ".";
    }

    // =========================================================== SOURCE: read the chapter
    const BLOCK = "p,div,ul,ol,table,blockquote,h1,h2,h3,h4,h5,h6,section,article,nav,footer,header,li";
    const JUNK = /comment|reply|menu|footer|sidebar|related|recommend|share|breadcrumb|advert|\bads?\b|modal|login|toolbar|pagination|toast/i;
    const SITE_WORDS = "intro|about us|contact us?|changelog|dmca|cookie policy|privacy policy|terms of (use|service)|stats|home|novel list|library|ranking|leaderboard|discord|patreon|login|sign up|register|wtr-?lab";
    const JUNK_LINE = new RegExp("^(problematic ad\\??|report it here|you can disable popup ads.*|become a contributor|loading comments.*|spoiler\\s*\\d+\\s*/\\s*\\d+|ch\\.?\\s*\\d+\\s*/\\s*\\d+.*|(prev|next)|(" + SITE_WORDS + ")[\\s·•|.\\-]*)$", "i");
    const SITE_SUFFIX = /\s*[-–—|·]\s*(wtr[-\s]?lab|novelping|novel ?ping)\s*$/i;

    function inChrome(e) { return !!e.closest("footer, nav, aside, [role=navigation], [role=contentinfo], [role=banner]"); }
    function isLeafText(c) { return c.textContent.trim().length > 0 && !c.querySelector(BLOCK); }
    /** a paragraph, or a wrapper that only holds one paragraph */
    function isParaLike(c) {
        if (!["P", "DIV", "SPAN", "LI"].includes(c.tagName)) { return false; }
        if (isLeafText(c)) { return true; }
        return c.children.length === 1 && c.textContent.trim().length > 0 && isParaLike(c.children[0]);
    }
    function linkRatio(c) {
        let total = c.textContent.trim().length;
        if (!total) { return 1; }
        let linked = [...c.querySelectorAll("a")].reduce((n, a) => n + a.textContent.trim().length, 0);
        return linked / total;
    }
    function selfJunk(e) { return JUNK.test((e.id || "") + " " + (typeof e.className === "string" ? e.className : "")); }
    function siteClean(t) { return t.replace(SITE_SUFFIX, "").trim(); }

    let lastMulti = 1;
    function proseStats(e) {
        let n = 0, chars = 0;
        for (let c of e.children) {
            if (!isParaLike(c) || linkRatio(c) > 0.5) { continue; }
            let t = c.textContent.trim();
            if (JUNK_LINE.test(t)) { continue; }
            ++n; chars += t.length;
        }
        return { n: n, chars: chars };
    }
    /** ALL blocks that look like chapter text. Some readers keep the next chapters loaded in the page, so there can be several. */
    function chapterBlocks() {
        let list = [];
        for (let e of document.querySelectorAll("div, article, section, main")) {
            if (selfJunk(e) || inChrome(e) || !visible(e)) { continue; }
            let st = proseStats(e);
            if (st.n >= 3 && st.chars / st.n >= 30) { list.push({ e: e, chars: st.chars }); }   // real prose: long paragraphs, not link lists
        }
        if (!list.length) { return []; }
        let max = Math.max.apply(null, list.map(x => x.chars));
        let big = list.filter(x => x.chars >= max * 0.4);
        return big.filter(x => !big.some(y => y !== x && x.e.contains(y.e)));      // drop outer wrappers
    }
    /** numbers the reader itself announces for the chapter on screen */
    function wantedNumbers() {
        let w = [], prog = readProgress();
        if (prog) { w.push(prog.cur); }
        let un = urlNumber(); if (un !== null) { w.push(un); }
        return w;
    }
    function labelOk(b) {
        let w = wantedNumbers(), l = labelNo(b);
        return l === null || w.length === 0 || w.indexOf(l) >= 0;
    }
    /** What the person sees: the text under the middle of the window, climbed up to the container that holds the paragraphs. */
    function screenBlock() {
        let vw = window.innerWidth || 1000, vh = window.innerHeight || 800;
        for (let y of [0.35, 0.5, 0.65, 0.25, 0.8, 0.15]) {
            for (let x of [0.5, 0.4, 0.6, 0.3, 0.7]) {
                let el = null;
                try { el = document.elementFromPoint(vw * x, vh * y); } catch (e) { el = null; }
                if (!el || el === document.body || el === document.documentElement || inChrome(el)) { continue; }
                if ((el.textContent || "").trim().length < 20) { continue; }
                let box = containerFor(el);
                if (!box || box === document.body || inChrome(box)) { continue; }
                let st = proseStats(box);
                if (st.n >= 3 && st.chars / st.n >= 25) { return box; }
            }
        }
        return null;
    }
    /** any block of prose (hidden or not, whatever its class) that announces the wanted chapter number */
    function findByLabel() {
        let wants = wantedNumbers();
        if (!wants.length) { return null; }
        let list = [];
        for (let e of document.querySelectorAll("div, article, section, main")) {
            if (inChrome(e)) { continue; }
            let st = proseStats(e);
            if (st.n >= 3 && st.chars / st.n >= 25) { list.push({ e: e, chars: st.chars }); }
        }
        list = list.filter(x => !list.some(y => y !== x && x.e.contains(y.e)));
        for (let w of wants) {
            let m = list.filter(x => labelNo(x.e) === w);
            if (m.length) { m.sort((a, b) => b.chars - a.chars); return m[0].e; }
        }
        return null;
    }
    function pathOf(e) { return e ? cssPath(e) : "none"; }
    /** a plain-words report of how the page was read, for the log */
    function explain() {
        let out = [], w = wantedNumbers();
        out.push("reader says chapter " + (w.length ? w.join(" / ") : "?") + " · page holds " + chapterBlocks().length + " chapter-like block(s)");
        let sb = screenBlock();
        out.push("text under the middle of the window: " + (sb ? "ch " + labelNo(sb) + " · " + pathOf(sb) : "not found"));
        let fl = findByLabel();
        out.push("block announcing the reader's number: " + (fl ? pathOf(fl) : "not found"));
        let all = [];
        for (let e of document.querySelectorAll("div, article, section, main")) {
            let st = proseStats(e);
            if (st.n >= 3 && st.chars / st.n >= 25) {
                let r = e.getBoundingClientRect();
                all.push({ e: e, chars: st.chars, flags: (selfJunk(e) ? "junk-class " : "") + (inChrome(e) ? "in-nav/footer " : "") + (!visible(e) ? "hidden " : ""), top: Math.round(r.top), label: labelNo(e) });
            }
        }
        all = all.filter(x => !all.some(y => y !== x && x.e.contains(y.e)));
        for (let x of all.slice(0, 6)) { out.push("  block: ch " + x.label + " · top " + x.top + " · " + x.chars + " chars · " + (x.flags || "ok") + "· " + pathOf(x.e)); }
        return out;
    }
    /** the chapter number a block announces: its first line ("Chapter 11:") or the heading just above it ("#11 Please stop flirting.") */
    function labelNo(block) {
        let first = parasFromBlock(block).slice(0, 2);
        for (let p of first) {
            let pl = p.length <= 220 ? parseChapterLine(p) : null;
            if (pl) { return pl.no; }
        }
        for (let e = block, depth = 0; e && e !== document.body && depth < 4; e = e.parentElement, depth++) {
            let k = 0;
            for (let p = e.previousElementSibling; p && k < 3; p = p.previousElementSibling, k++) {
                let t = (p.textContent || "").replace(/\s+/g, " ").trim();
                if (!t || t.length > 200) { continue; }
                let m = /^#\s*(\d{1,5})\b/.exec(t);
                if (m) { return parseInt(m[1], 10); }
                let pl = parseChapterLine(t);
                if (pl) { return pl.no; }
            }
        }
        return null;
    }
    /** the chapter the reader is actually looking at: the block on screen (the first one in the page when it is at the top) – never just "the biggest" */
    function findContentBlock() {
        let big = chapterBlocks();
        lastMulti = big.length || 1;
        if (!big.length) { return null; }
        if (big.length === 1) { return big[0].e; }
        big.sort((x, y) => (x.e.compareDocumentPosition(y.e) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
        // 1) the block that announces the number the reader itself shows (pager "Ch. 11 / 453", then the address)
        let prog = readProgress(), wants = [];
        if (prog) { wants.push(prog.cur); }
        let un = urlNumber(); if (un !== null) { wants.push(un); }
        for (let w of wants) {
            let m = big.filter(x => labelNo(x.e) === w);
            if (m.length === 1) { return m[0].e; }
            if (m.length > 1) { big = m; break; }
        }
        // 2) otherwise the block that is on screen
        let vh = window.innerHeight || 800, best = null, bestVis = 0;
        for (let x of big) {
            let r = x.e.getBoundingClientRect();
            let vis = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
            if (vis > bestVis + 1) { best = x; bestVis = vis; }
        }
        return (best || big[0]).e;
    }
    function findContentBlockRelaxed() {
        let best = null, bestScore = 0;
        for (let e of document.querySelectorAll("div, article, section, main, body")) {
            if (e.closest("footer, nav")) { continue; }
            let n = 0, chars = 0;
            for (let c of e.children) {
                if (!isParaLike(c) || linkRatio(c) > 0.5) { continue; }
                let t = c.textContent.trim();
                if (JUNK_LINE.test(t)) { continue; }
                ++n; chars += t.length;
            }
            if (n >= 3 && chars / n >= 40 && linkRatio(e) <= 0.2 && bestScore < chars) { best = e; bestScore = chars; }
        }
        if (best) { return best; }
        // one big block whose paragraphs are separated by line breaks
        for (let e of document.querySelectorAll("div, article, section, main, p")) {
            if (e.closest("footer, nav") || e.querySelector(BLOCK)) { continue; }
            let t = (e.innerText || e.textContent || "");
            if (t.length >= 800 && t.split(/\n+/).filter(x => x.trim()).length >= 3 && linkRatio(e) <= 0.2 && bestScore < t.length) { best = e; bestScore = t.length; }
        }
        return best;
    }
    function paragraphText(c) {
        let clone = c.cloneNode(true);
        clone.querySelectorAll("br").forEach(b => b.replaceWith("\n"));
        return clone.textContent.replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
    }
    function parasFromBlock(block) {
        let paras = [];
        for (let c of block.children) {
            if (!isParaLike(c) || linkRatio(c) > 0.5) { continue; }
            let t = paragraphText(c);
            if (t && !JUNK_LINE.test(t)) { paras.push(t); }
        }
        if (paras.length < 3) {                      // text is one block with line breaks
            let lines = (block.innerText || block.textContent || "").split(/\n+/).map(x => x.replace(/[ \t ]+/g, " ").trim()).filter(x => x && !JUNK_LINE.test(x));
            if (lines.length > paras.length) { paras = lines; }
        }
        return paras;
    }
    function readProgress() {
        let m = /\bCh\.?\s*(\d+)\s*\/\s*(\d+)/i.exec(document.body.innerText || "");
        return m ? { cur: parseInt(m[1], 10), total: parseInt(m[2], 10) } : null;
    }
    const CH_RE = /^(chapter|chap\.?|ch\.?|episode|ep\.?)\s*[#.:\-]?\s*\d+/i;
    /** "#13Chapter 13 The Dragon King…"  →  {no: 13, title: "Chapter 13: The Dragon King…"}.  A pager like "Ch. 13 / 346" is not a title. */
    function parseChapterLine(t) {
        t = String(t || "").replace(/\s+/g, " ").trim();
        if (/\d+\s*\/\s*\d+/.test(t.slice(0, 25))) { return null; }
        let m = /^#?\d{0,5}\s*(?:chapter|chap\.?|ch\.?|episode|ep\.?)\s*[#.:\-]?\s*(\d{1,5})\s*[:\-–—.]?\s*(.*)$/i.exec(t);
        if (!m) { return null; }
        let rest = m[2].trim();
        return { no: parseInt(m[1], 10), title: "Chapter " + m[1] + (rest ? ": " + rest : "") };
    }

    /** The chapter title: a heading-like line just above the text, else the page title without the novel name / site name. */
    function findTitle(block, paras) {
        let p0 = paras.length && paras[0].length <= 220 ? parseChapterLine(paras[0]) : null;
        if (p0) {
            paras.shift();
            if (/^Chapter \d+$/.test(p0.title)) {      // "Chapter 11:" alone on the first line; its name is in the heading above ("#11 Please stop flirting.")
                let heads = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,div,span,p,strong,b")].filter(e =>
                    isLeafText(e) && !inChrome(e) && !block.contains(e) && visible(e) && (block.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_PRECEDING));
                for (let i = heads.length - 1; i >= 0 && i >= heads.length - 12; i--) {
                    let t = heads[i].textContent.replace(/\s+/g, " ").trim();
                    let m = /^#\s*(\d{1,5})\s*[:\-–—.]?\s*(.{2,150})$/.exec(t);
                    if (m && parseInt(m[1], 10) === p0.no) { return { title: p0.title + ": " + m[2].trim(), no: p0.no }; }
                }
            }
            return { title: p0.title, no: p0.no };
        }
        let all = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,div,span,p,strong,b")].filter(e =>
            isLeafText(e) && !inChrome(e) && !block.contains(e) && e.textContent.trim().length <= 160 && parseChapterLine(e.textContent) !== null && visible(e));
        let before = all.filter(e => block.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_PRECEDING);
        let pick = before.length ? before[before.length - 1] : all[0];
        if (pick) {
            let pl = parseChapterLine(pick.textContent);
            let t = pl.title;
            if (/^Chapter \d+$/.test(t)) {
                // "Chapter 5" on one line, its name on the next
                let next = pick.nextElementSibling || (pick.parentElement && pick.parentElement.nextElementSibling);
                if (next && isLeafText(next) && !block.contains(next) && next.textContent.trim().length <= 150 && next.textContent.trim() !== pick.textContent.trim()) {
                    t = t + ": " + next.textContent.trim().replace(/\s+/g, " ");
                }
            }
            return { title: t, no: pl.no };
        }
        // fall back to the browser tab title:  "Novel name Chapter 5 - Site"  →  "Chapter 5"
        let dt = (document.title || "").replace(/\s+/g, " ").trim();
        dt = siteClean(dt);
        let m = /((?:chapter|chap\.?|ch\.?|episode|ep\.?)\s*[#.:\-]?\s*\d+.*)$/i.exec(dt);
        if (m) { dt = m[1]; }
        dt = dt.replace(/\s*[-–—|]\s*[^-–—|]{2,25}$/, "").trim() || dt;
        let pt = parseChapterLine(dt);
        return { title: pt ? pt.title : dt, no: pt ? pt.no : null };
    }
    function extract() {
        let block = null;
        if (SEL.content) { try { block = document.querySelector(SEL.content); } catch (e) { block = null; } }
        lastMulti = 1;
        if (!block) {
            let sb = screenBlock();
            if (sb && labelOk(sb)) { block = sb; lastMulti = Math.max(1, chapterBlocks().length); }
        }
        if (!block) { block = findByLabel(); if (block) { lastMulti = Math.max(1, chapterBlocks().length); } }
        if (!block) { block = findContentBlock() || findContentBlockRelaxed(); }
        if (!block) { return null; }
        let paras = parasFromBlock(block);
        let title = "", no = null;
        let pickedTitle = null;
        if (SEL.title) { try { pickedTitle = document.querySelector(SEL.title); } catch (e) { pickedTitle = null; } }
        if (pickedTitle && pickedTitle.textContent.trim()) {
            let raw = pickedTitle.textContent.trim().replace(/\s+/g, " ");
            let pl = parseChapterLine(raw);
            title = pl ? pl.title : raw; no = pl ? pl.no : null;
            if (paras.length && (paras[0] === raw || (parseChapterLine(paras[0]) && parseChapterLine(paras[0]).title === title))) { paras.shift(); }
        } else {
            let ft = findTitle(block, paras);
            title = ft.title; no = ft.no;
        }
        title = siteClean(title).slice(0, 150);
        if (paras.length < 2) { return null; }
        if (no === null) {
            let m = /(?:chapter|chap\.?|ch\.?|episode|ep\.?)\s*[#.:\-]?\s*(\d+)/i.exec(title);
            no = m ? parseInt(m[1], 10) : null;
        }
        let prog = readProgress();
        return {
            title: title, no: no, paras: paras, multi: lastMulti, pager: prog,
            key: title + "|" + paras[0].slice(0, 80), last: !!(prog && prog.cur >= prog.total)
        };
    }
    function looksLikeChapter(ch) {
        let chars = ch.paras.join("").length;
        return ch.title.length > 0 && chars >= 300 && chars / ch.paras.length >= 25;
    }
    function findNext() {
        if (SEL.next) {
            try { let n = document.querySelector(SEL.next); if (n && !n.disabled && n.getAttribute("aria-disabled") !== "true") { return n; } } catch (e) { /* fall through */ }
        }
        let items = [...document.querySelectorAll("button, a, [role=button]")];
        let good = (e) => visible(e) && !e.disabled && e.getAttribute("aria-disabled") !== "true" && !/disabled/.test(e.className || "");
        return items.find(e => good(e) && /^\s*next\b/i.test(e.textContent.trim()))
            || items.find(e => good(e) && (e.getAttribute("rel") === "next" || /next/i.test((e.getAttribute("aria-label") || "") + " " + (e.getAttribute("title") || ""))))
            || null;
    }

    function describe(el) {
        let t = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
        return "<" + el.tagName.toLowerCase() + (t ? " “" + t + "”" : "") + (el.href ? " → " + el.href.slice(0, 80) : "") + ">";
    }
    /** .../chapter-12  →  .../chapter-13  (last resort when no working Next button exists) */
    function nextUrlByNumber() {
        let re = /(chapter[-_/]?)(\d+)(?!.*\d)/i;
        let m = re.exec(location.pathname);
        if (!m) { return null; }
        return location.origin + location.pathname.replace(re, "$1" + (parseInt(m[2], 10) + 1)) + location.search;
    }
    // =========================================================== TARGET: fill the form
    function setNative(el, value) {
        let proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        let setter = Object.getOwnPropertyDescriptor(proto, "value").set;
        setter.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

    function editorIn(box) {
        if (!box) { return null; }
        let f = box.matches && box.matches("iframe") ? box : box.querySelector && box.querySelector("iframe");
        if (f) { try { let d = f.contentDocument; if (d && d.body) { return { el: d.body, kind: "rich", frame: f }; } } catch (e) { /* cross-origin */ } }
        let ce = box.matches && box.matches("[contenteditable]") ? box : box.querySelector && box.querySelector("[contenteditable='true'], [contenteditable='']");
        if (ce) { return { el: ce, kind: "rich" }; }
        let ta = box.matches && box.matches("textarea") ? box : box.querySelector && box.querySelector("textarea");
        return ta ? { el: ta, kind: "textarea" } : null;
    }
    function editorCandidates() {
        let sel = [".ql-editor", ".note-editable", ".trumbowyg-editor", ".fr-element", ".ProseMirror", ".cke_editable", "[contenteditable='true'], [contenteditable='']"];
        let cands = [], seen = new Set();
        for (let s of sel) { for (let e of document.querySelectorAll(s)) { if (visible(e) && !seen.has(e)) { seen.add(e); cands.push({ el: e, kind: "rich" }); } } }
        for (let f of document.querySelectorAll("iframe")) {
            try {
                let d = f.contentDocument;
                if (d && d.body && (d.body.isContentEditable || d.body.getAttribute("contenteditable") !== null || d.designMode === "on") && visible(f)) { cands.push({ el: d.body, kind: "rich", frame: f }); }
            } catch (e) { /* cross-origin */ }
        }
        // document order (several editors: author note, chapter text, author note…)
        return cands.sort((a, b) => ((a.frame || a.el).compareDocumentPosition(b.frame || b.el) & 4) ? -1 : 1);
    }
    function findEditor() {
        let picked = pk("editor");
        if (picked) { let pe = editorIn(picked); if (pe) { return pe; } }
        let cands = editorCandidates();
        if (cands.length > 1) {
            // pages with several editors (Royal Road: pre-note, Chapter Content, post-note): take the one that follows the “Chapter Content” label
            let lab = [...document.querySelectorAll("label, legend, h1, h2, h3, h4, h5, h6, div, span, p, strong, b")]
                .find(e => e.children.length === 0 && /^\s*(chapter content|chapter text|chapter body)\s*:?\s*$/i.test(e.textContent) && visible(e));
            if (lab) {
                let after = cands.filter(c => lab.compareDocumentPosition(c.frame || c.el) & 4);
                // stop at the next field label (e.g. “Post-chapter author note”) so a note editor is never taken
                let nextLab = [...document.querySelectorAll("label, legend, h1, h2, h3, h4, h5, h6, div, span, p, strong, b")]
                    .find(e => e.children.length === 0 && visible(e) && (lab.compareDocumentPosition(e) & 4) && /^\s*(post[- ]?chapter|author'?s? note|pre[- ]?chapter|scheduled release|poll)/i.test(e.textContent));
                if (nextLab) { after = after.filter(c => nextLab.compareDocumentPosition(c.frame || c.el) & 2); }
                if (after.length) {
                    let ar = (c) => { let r = (c.frame || c.el).getBoundingClientRect(); return r.width * r.height; };
                    let real = after.filter(c => c.el.matches && c.el.matches(".ProseMirror, .ql-editor, .note-editable, .fr-element, .cke_editable, .trumbowyg-editor, body"));
                    let pool = real.length ? real : after;
                    return pool.slice().sort((a, b) => ar(b) - ar(a))[0];
                }
            }
        }
        let area = (c) => { let r = (c.frame || c.el).getBoundingClientRect(); return r.width * r.height; };
        if (cands.length) { return cands.slice().sort((a, b) => area(b) - area(a))[0]; }
        let ta = [...document.querySelectorAll("textarea")].filter(visible).sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
        return ta ? { el: ta, kind: "textarea" } : null;
    }
    /** some editors (e.g. Webnovel) use a one-line textarea or contenteditable heading above the text instead of an input */
    function fallbackTitle(editor) {
        let ed = editor && editor.el;
        let edTop = ed ? (editor.frame || ed).getBoundingClientRect().top : 1e9;
        let c = [...document.querySelectorAll("textarea, [contenteditable='true'], [contenteditable='']")].filter(e => visible(e) && e !== ed && !(ed && (ed.contains(e) || e.contains(ed))));
        c = c.filter(e => { let r = e.getBoundingClientRect(); return r.height < 140 && r.top <= edTop + 5; });
        return c.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
    }
    function setTitleValue(el, v) {
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") { setNative(el, v); return; }
        el.focus();
        let d = el.ownerDocument;
        d.execCommand("selectAll");
        if (!d.execCommand("insertText", false, v)) { el.textContent = v; el.dispatchEvent(new Event("input", { bubbles: true })); }
    }
    function findTitleInput(editor) {
        let picked = pk("title");
        if (picked) { return picked; }
        if (TP.id === "royalroad") {
            let r = document.querySelector("#title, input[name='Title'], input[name='title'], input#Title"); if (r && visible(r)) { return r; }
            let lab = [...document.querySelectorAll("label, div, span")].find(e => e.children.length === 0 && /^\s*title\s*$/i.test(e.textContent) && visible(e));
            if (lab) {
                let el = lab.tagName === "LABEL" && lab.htmlFor ? document.getElementById(lab.htmlFor) : null;
                el = el || [...document.querySelectorAll("input[type=text], input:not([type])")].filter(visible).find(i => lab.compareDocumentPosition(i) & 4);
                if (el) { return el; }
            }
        }
        let scope = (editor && editor.el.closest && editor.el.closest("form")) || document;
        let inputs = [...scope.querySelectorAll("input[type=text], input:not([type])")].filter(i => visible(i) && !/search/i.test((i.placeholder || "") + (i.type || "") + (i.name || "")) && !i.closest("[role=dialog], dialog, .modal, .ant-modal"));
        return inputs.find(i => /chapter/i.test((i.placeholder || "") + (i.name || "") + (i.id || ""))) || inputs.find(i => /title|name/i.test((i.name || "") + (i.id || ""))) || (TP.id === "webnovel" ? (fallbackTitle(editor) || inputs[0]) : (inputs[0] || fallbackTitle(editor))) || null;
    }
    function findCoinInput() {
        let label = [...document.querySelectorAll("label")].find(l => /coin price/i.test(l.textContent));
        if (!label) { return null; }
        let el = label.htmlFor ? document.getElementById(label.htmlFor) : null;
        return el || (label.parentElement && label.parentElement.querySelector("input")) || null;
    }


    /** the editor's own “chars: N” counter (Royal Road’s new editor shows one under the text), or null when there is none */
    function siteCounter(el) {
        let e = el;
        for (let i = 0; i < 8 && e; i++, e = e.parentElement) {
            let m = /chars?\s*:?\s*([\d,]+)/i.exec((e.innerText || "").slice(-400));
            if (m && /words?\s*:?\s*[\d,]+/i.test((e.innerText || "").slice(-400))) { return parseInt(m[1].replace(/,/g, ""), 10); }
        }
        return null;
    }
    async function insertRich(el, paras, want) {
        let d = el.ownerDocument, html = paras.map(p => "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>").join("");
        let ok = () => {
            let own = el.textContent.replace(/\s+/g, "").length, c = siteCounter(el);
            return own >= want * 0.9 && (c === null || c >= want * 0.5);
        };
        let tries = [
            () => { el.focus(); d.execCommand("selectAll"); d.execCommand("insertHTML", false, html); },
            () => {   // behave like a real paste: editors built on ProseMirror/TipTap/Quill read the clipboard event, not execCommand
                el.focus(); d.execCommand("selectAll");
                let dt = new DataTransfer(); dt.setData("text/html", html); dt.setData("text/plain", paras.join("\n\n"));
                el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
            },
            () => { el.focus(); el.innerHTML = html; el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" })); }
        ];
        for (let t of tries) {
            try { t(); } catch (e) { /* try the next way */ }
            await sleep(350);
            if (ok()) { return true; }
        }
        return false;
    }
    async function fillForm(msg) {
        let editor = await waitFor(findEditor, 25000, 500);
        if (!editor) { return { ok: false, error: "Could not find the chapter text box on the Add chapter page." }; }
        let titleInput = findTitleInput(editor);
        if (!titleInput) { return { ok: false, error: "Could not find the “Chapter name” box." }; }
        titleInput.focus();
        setTitleValue(titleInput, msg.title);

        let el = editor.el;
        if (editor.kind === "textarea") {
            setNative(el, msg.paras.join("\n\n"));
        } else {
            let want0 = msg.paras.join("").replace(/\s+/g, "").length;
            if (!(await insertRich(el, msg.paras, want0))) { return { ok: false, error: "The website’s text editor did not accept the pasted chapter (its own character counter stayed low). Nothing was published." }; }
        }
        let got = (editor.kind === "textarea" ? el.value : el.textContent).replace(/\s+/g, "").length;
        let want = msg.paras.join("").replace(/\s+/g, "").length;
        if (got < want * 0.9) { return { ok: false, error: "The text did not paste completely (" + got + " of " + want + " characters)." }; }

        if (msg.coin !== null && msg.coin !== undefined && msg.coin !== "" && (msg.applyCoin === true || (msg.no && msg.no > 30))) {
            let coin = findCoinInput();
            if (coin) { setNative(coin, String(msg.coin)); }
        }
        return { ok: true };
    }

    /** click a button the user described: a picked selector, or its text (several alternatives separated by |). Waits up to msg.timeout for it to appear. */
    async function clickStep(msg) {
        let alts = String(msg.text || "").split("|").map(x => x.trim().toLowerCase()).filter(Boolean);
        let txt = (e) => (e.textContent || e.value || e.getAttribute("aria-label") || e.title || "").replace(/\s+/g, " ").trim().toLowerCase();
        let find = () => {
            if (msg.selector) { try { let e = document.querySelector(msg.selector); if (e && visible(e)) { return e; } } catch (e) { /* bad selector */ } }
            if (!alts.length) { return null; }
            let items = [...document.querySelectorAll("button, a, input[type=submit], input[type=button], [role=button], [role=tab], [role=menuitem], label, .btn, summary")].filter(visible);
            let dlg = items.filter(e => e.closest(".modal, [role=dialog], dialog"));
            for (let pool of [dlg, items]) {
                for (let a of alts) { let ex = pool.filter(e => txt(e) === a); if (ex.length) { return ex[ex.length - 1]; } }
                for (let a of alts) { let ct = pool.filter(e => txt(e).includes(a) && txt(e).length < a.length + 25); if (ct.length) { return ct[ct.length - 1]; } }
            }
            return null;
        };
        let el = await waitFor(find, Math.max(0, msg.timeout || 0), 250) || find();
        if (!el) { return { ok: false, error: "button not found" }; }
        el.scrollIntoView({ block: "center" });
        el.click();
        return { ok: true, desc: describe(el) };
    }
    function clickPublish() {
        let b = btnByText(mine("publish", [/publish chapter/i, /^\s*publish\b/i, /^\s*(save chapter|post|submit|save)\b/i]), pk("publish"), { exclude: /draft|schedul/i });
        if (!b) { return { ok: false, error: "Could not find the “Publish” button. Use “Pick PUBLISH” in the Target box and click it on the page." }; }
        b.click();
        return { ok: true };
    }
    function clickDraft() {
        let b = btnByText(mine("draft", [/save\s*(as)?\s*(a\s*)?draft/i, /^\s*draft\b/i, /draft/i, /save for later/i, /^\s*save\s*$/i]), pk("draft"));
        if (!b) { return { ok: false, error: "Could not find a “Save as draft” button on this page. Use “Pick DRAFT” in the Target box and click it on the page." }; }
        b.click();
        return { ok: true };
    }
    function clickSchedule() {
        let b = btnByText(mine("schedule", [/^\s*(confirm\s*)?schedule\b/i, /schedul/i]), pk("schedule"), { preferDialog: true, last: true });
        if (!b) { return { ok: false, error: "Could not find a “Schedule” button on this page. Use “Pick SCHEDULE” in the Target box and click it on the page." }; }
        b.click();
        return { ok: true };
    }
    const pad2 = (n) => String(n).padStart(2, "0");
    function fmtDate(d, f) {
        return String(f).replace(/YYYY/g, d.getFullYear()).replace(/MM/g, pad2(d.getMonth() + 1)).replace(/DD/g, pad2(d.getDate())).replace(/HH/g, pad2(d.getHours())).replace(/mm/g, pad2(d.getMinutes()));
    }
    function schedInputs() {
        let all = [...document.querySelectorAll("input")].filter(visible);
        let hint = (i) => (i.name || "") + " " + (i.id || "") + " " + (i.placeholder || "") + " " + (i.getAttribute("aria-label") || "");
        let dateEl = pk("schedDate") || all.find(i => i.type === "datetime-local") || all.find(i => i.type === "date")
            || all.find(i => /(schedul|releas|publish|go.?live).*(date|time|at|when)|(date|time|when).*(schedul|releas|publish|go.?live)/i.test(hint(i)));
        if (!dateEl) {
            let lab = [...document.querySelectorAll("label, div, span, strong, b")].find(e => e.children.length <= 1 && /^\s*(scheduled? (release|date|time)|release (date|time)|publish (at|date|time))\s*\??\s*$/i.test(e.textContent) && visible(e));
            if (lab) { dateEl = [...document.querySelectorAll("input")].filter(visible).find(i => i.type !== "checkbox" && i.type !== "radio" && (lab.compareDocumentPosition(i) & 4)) || null; }
        }
        let timeEl = pk("schedTime") || all.find(i => i.type === "time");
        return { dateEl: dateEl, timeEl: timeEl };
    }
    async function fillSchedule(msg) {
        let d = new Date(msg.ms);
        let f = schedInputs();
        if (!f.dateEl) {
            // open a "schedule" switch/tab if the date box is hidden – but never click a plain button (it could submit the form)
            let t = [...document.querySelectorAll("label, [role=tab], [aria-expanded], [data-toggle], [data-bs-toggle], input[type=checkbox], input[type=radio]")].filter(visible)
                .find(e => /schedul/i.test((e.textContent || "") + " " + (e.value || "") + " " + (e.getAttribute("aria-label") || "")));
            if (t) { t.click(); await sleep(700); f = schedInputs(); }
        }
        if (!f.dateEl && TP.id === "webnovel") { return { ok: false, notFound: true, dialogFlow: true, error: "date box is inside the Publish confirm window" }; }
        if (!f.dateEl) { return { ok: false, notFound: true, error: "Could not find the schedule date box on this page. Open the website’s schedule option, then use “Pick DATE box” (and “Pick TIME box” if the time is separate)." }; }
        let v;
        if (f.dateEl.type === "datetime-local") { v = fmtDate(d, "YYYY-MM-DDTHH:mm"); }
        else if (f.dateEl.type === "date") { v = fmtDate(d, "YYYY-MM-DD"); }
        else { v = fmtDate(d, msg.dateFmt || "YYYY-MM-DD") + (f.timeEl ? "" : " " + fmtDate(d, msg.timeFmt || "HH:mm")); }
        setNative(f.dateEl, v);
        let shown = v;
        if (f.timeEl) { let tv = f.timeEl.type === "time" ? fmtDate(d, "HH:mm") : fmtDate(d, msg.timeFmt || "HH:mm"); setNative(f.timeEl, tv); shown += " " + tv; }
        await sleep(300);
        return { ok: true, shown: shown };
    }
    function findDialog() {
        // 1) by its own wording (works whatever the site's class names are)
        let w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), n, best = null;
        while ((n = w.nextNode())) {
            if (!/confirm publish|publish timer|publish setting/i.test(n.nodeValue || "") || !n.parentElement || !visible(n.parentElement)) { continue; }
            let e = n.parentElement;
            for (let i = 0; i < 10 && e && e !== document.body; i++, e = e.parentElement) {
                if (e.querySelector("button, [role=button]") && /confirm/i.test(e.textContent)) { best = e; break; }
            }
            if (best) { return best; }
        }
        // 2) a standard dialog element that has a confirm-like button
        let c = [...document.querySelectorAll("[role=dialog], dialog, .modal, .ant-modal, .el-dialog, .swal2-popup")].filter(visible)
            .filter(e => [...e.querySelectorAll("button, [role=button]")].some(b => /^\s*(confirm|publish|schedule|ok|yes)\b/i.test(b.textContent)));
        return c.length ? c[c.length - 1] : null;
    }
    function switchOn(sw) {
        if (sw.type === "checkbox") { return !!sw.checked; }
        return sw.getAttribute("aria-checked") === "true" || /(^|[\s-_])(checked|active|on)($|[\s-_])/i.test(sw.className || "") || !!sw.querySelector("[class*=checked]");
    }
    async function typeInto(el, v) {
        el.focus();
        setNative(el, v);
        await sleep(250);
        if (el.value !== v) { try { el.select(); document.execCommand("insertText", false, v); } catch (e) { /* ignore */ } await sleep(250); }
        return el.value === v;
    }
    const MON = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)";
    const clsOf = (e) => String((e.className && e.className.baseVal !== undefined) ? e.className.baseVal : (e.className || ""));
    /** the site's own read-back of the chosen release time, e.g. "2026-11-16 00:29 (GMT+8)" */
    function readPreview(dlg) {
        let t = dlg.innerText || dlg.textContent || "";
        let m = /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s*\(\s*GMT\s*([+-]\d{1,2})(?::?(\d{2}))?\s*\)/i.exec(t);
        if (!m) { return null; }
        let h = parseInt(m[6], 10);
        return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], off: h + (m[7] ? (h < 0 || /^-/.test(m[6]) ? -1 : 1) * parseInt(m[7], 10) / 60 : 0), text: m[0] };
    }
    function previewCheck(pv, ms) {
        let t = new Date(ms + pv.off * 3600000);
        return { dateOk: t.getUTCFullYear() === pv.y && t.getUTCMonth() + 1 === pv.mo && t.getUTCDate() === pv.d, timeOk: t.getUTCHours() === pv.h && t.getUTCMinutes() === pv.mi, pv: pv };
    }
    /** like a person typing: key by key, so masks and pickers see every character */
    async function typeKeys(el, v) {
        el.focus();
        setNative(el, "");
        for (let ch of v) {
            el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
            setNative(el, el.value + ch);
            try { el.dispatchEvent(new InputEvent("input", { data: ch, inputType: "insertText", bubbles: true })); } catch (e) { /* ignore */ }
            el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
            await sleep(15);
        }
        el.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(250);
        return el.value === v;
    }
    function calendarRoot() {
        let leaves = [...document.querySelectorAll("*")].filter(e => e.children.length === 0 && /^\s*\d{1,2}\s*$/.test(e.textContent) && visible(e));
        if (leaves.length < 28) { return null; }
        let monRe = new RegExp(MON + "[a-z]*\\.?\\W*\\d{4}|\\d{4}\\W*" + MON, "i");
        for (let l of leaves) {
            let e = l.parentElement;
            for (let i = 0; i < 9 && e && e !== document.body; i++, e = e.parentElement) {
                if (leaves.filter(x => e.contains(x)).length < 28) { continue; }
                let txt = e.textContent;
                let wd = new Set([...e.querySelectorAll("*")].filter(x => x.children.length === 0 && /^\s*(su|mo|tu|we|th|fr|sa)[a-z]*\.?\s*$/i.test(x.textContent)).map(x => x.textContent.trim().slice(0, 2).toLowerCase()));
                if (wd.size >= 5 && monRe.test(txt)) { return e; }
            }
        }
        return null;
    }
    function readHeader(root) {
        let t = root.textContent, m = new RegExp(MON + "[a-z]*\\.?\\W*(\\d{4})", "i").exec(t), m2 = new RegExp("(\\d{4})\\W*" + MON, "i").exec(t);
        let mon = m ? m[1] : (m2 ? m2[2] : null), yr = m ? m[2] : (m2 ? m2[1] : null);
        if (!mon) { return null; }
        return { m: ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(mon.toLowerCase()) + 1, y: parseInt(yr, 10) };
    }
    function navButton(root, dir) {
        let els = [...root.querySelectorAll("button, a, span, i, div, svg, li")].filter(visible);
        let chars = dir === "next" ? ["›", ">", "❯", "〉", "▶", "→"] : ["‹", "<", "❮", "〈", "◀", "←"];
        let t = els.find(e => e.children.length === 0 && chars.includes(e.textContent.trim()));
        if (t) { return t.closest("button, a, [role=button]") || t; }
        let re = dir === "next" ? /next|right/i : /prev|left/i;
        return els.find(e => re.test(clsOf(e) + " " + (e.getAttribute("aria-label") || "") + " " + (e.title || "")) && !/year|super|double/i.test(clsOf(e) + " " + (e.getAttribute("aria-label") || "") + " " + (e.title || ""))) || null;
    }
    async function calendarPick(dateEl, d) {
        dateEl.focus(); dateEl.click();
        await sleep(500);
        let root = calendarRoot();
        if (!root) { return "no calendar opened"; }
        for (let g = 0; g < 40; g++) {
            let cur = readHeader(root); if (!cur) { return "could not read the calendar month"; }
            let diff = (d.getFullYear() - cur.y) * 12 + (d.getMonth() + 1 - cur.m);
            if (!diff) { break; }
            let b = navButton(root, diff > 0 ? "next" : "prev");
            if (!b) { return "calendar month buttons not found"; }
            b.click(); await sleep(220);
            root = calendarRoot() || root;
        }
        let day = d.getDate();
        let cells = [...root.querySelectorAll("*")].filter(e => e.children.length === 0 && e.textContent.trim() === String(day) && visible(e));
        if (!cells.length) { return "day " + day + " not found in the calendar"; }
        let pick = day <= 14 ? cells[0] : cells[cells.length - 1];      // leading days of last month come first, trailing days of next month (1–12) come last
        let cell = pick.closest("td, button, [role=gridcell], [role=button]") || pick;
        if (cell.getAttribute("aria-disabled") === "true" || /disabled/i.test(clsOf(cell) + " " + clsOf(pick))) { return "the website does not allow that date (too soon?)"; }
        cell.click(); await sleep(500);
        return "";
    }
    /** time pop-ups with an hour column and a minute column */
    async function timeColumns(timeEl, h, mi) {
        timeEl.focus(); timeEl.click(); await sleep(500);
        let leaves = [...document.querySelectorAll("*")].filter(e => e.children.length === 0 && /^\d{2}$/.test(e.textContent.trim()) && visible(e));
        let groups = new Map();
        for (let l of leaves) { let k = l.closest("ul, ol, [class*=column], [class*=list]") || l.parentElement; (groups.get(k) || groups.set(k, []).get(k)).push(l); }
        let cols = [...groups.values()].filter(g => g.length >= 12);
        let max = (g) => Math.max(...g.map(x => parseInt(x.textContent, 10)));
        let hc = cols.find(g => max(g) <= 23 && g.length >= 20), mc = cols.find(g => max(g) >= 45);
        if (!hc || !mc) { return false; }
        let hh = String(h).padStart(2, "0"), mm = String(mi).padStart(2, "0");
        let hi = hc.find(x => x.textContent.trim() === hh);
        let mmi = mc.find(x => x.textContent.trim() === mm) || mc.filter(x => parseInt(x.textContent, 10) <= mi).pop();
        if (!hi || !mmi) { return false; }
        hi.click(); await sleep(250); mmi.click(); await sleep(250);
        let ok = [...document.querySelectorAll("button, [role=button], a, span")].filter(visible).find(e => e.children.length === 0 && /^\s*(ok|done)\s*$/i.test(e.textContent));
        if (ok) { ok.click(); await sleep(300); }
        return true;
    }
    /** set the release date/time inside the confirm window and PROVE it worked by reading the site's own preview line */
    async function setSchedule(dlg, dateEl, timeEl, d, msg) {
        let want = d.getTime();
        let dstr = null, tstr = fmtDate(d, msg.timeFmt || "HH:mm");
        if (dateEl) { let sep = /^\d{4}\//.test(dateEl.value) ? "/" : /^\d{4}\./.test(dateEl.value) ? "." : ""; dstr = fmtDate(d, sep ? "YYYY" + sep + "MM" + sep + "DD" : (msg.dateFmt || "YYYY-MM-DD")); }
        const closePop = async () => {
            let lab = [...dlg.querySelectorAll("div, span, label, p")].find(e => visible(e) && e.children.length === 0 && /^\s*publish time\s*$/i.test(e.textContent));
            if (lab) { lab.click(); } else if (dateEl) { dateEl.blur(); }
            await sleep(350);
        };
        const check = async () => { await sleep(450); let pv = readPreview(dlg); return pv ? previewCheck(pv, want) : null; };
        const valuesOk = () => (!dateEl || dateEl.value === dstr) && (!timeEl || timeEl.value === tstr);
        const done = (c) => ({ ok: true, shown: (dstr || "") + " " + tstr + (c ? "  → the website shows " + c.pv.text : "") });
        // round 1: write the values
        if (dateEl) { await typeInto(dateEl, dstr); }
        if (timeEl) { await typeInto(timeEl, tstr); }
        await closePop();
        let c = await check();
        if (!c) { return valuesOk() ? done(null) : { ok: false, error: "The Confirm window did not accept the date/time." }; }     // no preview line on this site: trust the boxes
        if (c.dateOk && c.timeOk) { return done(c); }
        // round 2: type key by key
        if (!c.dateOk && dateEl) { await typeKeys(dateEl, dstr); await closePop(); }
        if (!c.timeOk && timeEl) { await typeKeys(timeEl, tstr); await closePop(); }
        c = await check() || c;
        if (c.dateOk && c.timeOk) { return done(c); }
        // round 3: use the calendar like a person (month arrows, then the day)
        let why = "";
        if (!c.dateOk && dateEl) {
            why = await calendarPick(dateEl, d);
            await closePop();
            if (timeEl) { await typeInto(timeEl, tstr); await closePop(); }       // picking a day can reset the time
            c = await check() || c;
            if (c.dateOk && c.timeOk) { return done(c); }
        }
        // round 4: hour / minute columns
        if (!c.timeOk && timeEl) {
            await timeColumns(timeEl, d.getHours(), d.getMinutes());
            await closePop();
            c = await check() || c;
            if (c.dateOk && c.timeOk) { return done(c); }
        }
        let t = new Date(want + c.pv.off * 3600000), p2 = (n) => String(n).padStart(2, "0");
        return { ok: false, error: "The website shows “" + c.pv.text + "” but the schedule needs " + t.getUTCFullYear() + "-" + p2(t.getUTCMonth() + 1) + "-" + p2(t.getUTCDate()) + " " + p2(t.getUTCHours()) + ":" + p2(t.getUTCMinutes()) + " (GMT" + (c.pv.off >= 0 ? "+" : "") + c.pv.off + ")" + (why ? " (calendar: " + why + ")" : "") + ". Nothing was published." };
    }
    /** after Publish is clicked: if a confirm window opens, set the Publish Timer (when asked) and press Confirm */
    async function dialogStep(msg) {
        let wait = TP.id === "webnovel" ? 6000 : (TP.id === "royalroad" || TP.id === "custom") ? 2000 : 0;
        if (msg.timer || pk("confirm")) { wait = Math.max(wait, 6000); }
        if (!wait) { return { ok: true, dialog: false }; }
        let pc = () => { let c = pk("confirm"); return c && visible(c) ? c : null; };
        let dlg = await waitFor(() => findDialog() || (pc() ? (pc().closest(".modal, [role=dialog], dialog") || pc().parentElement || document.body) : null), wait, 250);
        if (!dlg) {
            return msg.timer ? { ok: false, fatal: true, error: "The Confirm window did not open after clicking Publish, so the schedule could not be set. The chapter may have been published immediately – check your chapter list." } : { ok: true, dialog: false };
        }
        await sleep(400);
        let shown = "";
        let sws = [...dlg.querySelectorAll("[role=switch], .ant-switch, .el-switch, [class*=switch], input[type=checkbox]")];
        let sw = pk("timer") || sws.find(e => visible(e) && /timer|schedul/i.test((e.closest("div") && e.closest("div").parentElement ? e.closest("div").parentElement.textContent : "") + (e.getAttribute("aria-label") || ""))) || sws.find(visible) || null;
        if (sw && switchOn(sw) !== !!msg.timer) { sw.click(); await sleep(700); }
        if (msg.timer) {
            if (!sw) { return { ok: false, fatal: true, error: "No “Publish Timer” switch was found in the Confirm window. The Confirm window is still open – nothing was published. Use the Pick buttons or tell me what it looks like." }; }
            let inputs = [...dlg.querySelectorAll("input")].filter(visible);
            let hint = (i) => (i.name || "") + " " + (i.id || "") + " " + (i.placeholder || "") + " " + (i.getAttribute("aria-label") || "");
            let dateEl = pk("schedDate") || inputs.find(i => /^\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}/.test(i.value) || /date/i.test(hint(i)));
            let timeEl = pk("schedTime") || inputs.find(i => i !== dateEl && (/^\d{1,2}:\d{2}/.test(i.value) || /time/i.test(hint(i))));
            if (!dateEl && !timeEl) { return { ok: false, fatal: true, error: "Could not find the date/time boxes in the Confirm window. Nothing was published. Open the window and use “Pick DATE box” / “Pick TIME box”." }; }
            let sr = await setSchedule(dlg, dateEl, timeEl, new Date(msg.ms), msg);
            if (!sr.ok) { return { ok: false, fatal: true, error: sr.error }; }
            shown = sr.shown;
        }
        let b = btnByText([/^\s*confirm\b/i, /^\s*(publish|schedule|ok|submit|save)\b/i], null, { last: true });
        let inside = [...dlg.querySelectorAll("button, [role=button], input[type=submit]")].filter(visible);
        let txt = (e) => (e.textContent || e.value || "").trim();
        b = pk("confirm") || inside.filter(e => /^\s*confirm\b/i.test(txt(e)))[0] || inside.filter(e => /^\s*(publish|schedule|ok|submit|save)\b/i.test(txt(e))).pop() || null;
        if (!b) { return { ok: false, fatal: true, error: "Could not find the Confirm button in the window that opened. Nothing was confirmed." }; }
        await sleep(300);
        b.click();
        return { ok: true, dialog: true, shown: shown };
    }
    function noticeText() {
        let els = [...document.querySelectorAll(".toast, .toastify, .Toastify__toast, .alert-success, .alert-info, [role=status], [role=alert], .swal2-popup, .notification, .ant-message, .ant-notification, .el-message, .snackbar, .noty_body")].filter(visible);
        let t = els.map(e => e.textContent.trim()).filter(Boolean).join(" | ");
        return /(saved|scheduled|published|success|draft)/i.test(t) ? t.slice(0, 200) : "";
    }
    function targetButtons() {
        let d = (e) => e ? describe(e) : "";
        let f = schedInputs();
        return {
            publish: d(btnByText([/publish chapter/i, /^\s*publish\b/i, /^\s*(save chapter|post|submit|save)\b/i], pk("publish"), { exclude: /draft|schedul/i })),
            draft: d(btnByText([/save\s*(as)?\s*(a\s*)?draft/i, /^\s*draft\b/i, /draft/i, /save for later/i, /^\s*save\s*$/i], pk("draft"))),
            schedule: d(btnByText([/^\s*(confirm\s*)?schedule\b/i, /schedul/i], pk("schedule"), { preferDialog: true, last: true })),
            date: f.dateEl ? describe(f.dateEl) + " [" + (f.dateEl.type || "text") + "]" : "",
            editor: (() => { let all = editorCandidates(), e = findEditor(); if (!e) { return ""; } let k = all.findIndex(c => c.el === e.el); return all.length > 1 ? "editor " + (k + 1) + " of " + all.length + " (should be the Chapter Content one)" : "the only editor"; })()
        };
    }
    function readErrors() {
        // only real error messages: ignore the rich-text editor's own notices (e.g. TinyMCE's “Microsoft Word” paste notice) and anything that does not read like an error
        let editorNoise = ".tox, .mce-container, [class*=tinymce], [class*=tox-], .ql-editor, .note-editor, .fr-box, .cke";
        let looksBad = /(error|invalid|required|failed|failure|must |cannot|can't|could not|too (short|long|many|few)|not allowed|already|wrong|unable|denied|exceed|minimum|maximum|at least|please (enter|select|choose|fill)|duplicate)/i;
        let noise = /(microsoft word|paste as text|pasted content|clipboard|word formatting)/i;
        let strong = [...document.querySelectorAll(".alert-danger, .invalid-feedback, .text-danger")].filter(visible)
            .filter(e => !e.closest(editorNoise)).map(e => e.textContent.trim()).filter(t => t.length > 2 && !noise.test(t));
        let weak = [...document.querySelectorAll(".error, [role=alert]")].filter(visible)
            .filter(e => !e.closest(editorNoise)).map(e => e.textContent.trim()).filter(t => t.length > 2 && looksBad.test(t) && !noise.test(t));
        let list = strong.concat(weak);
        return list.length ? list.join(" | ").slice(0, 300) : "";
    }
    function pageKind() {
        let t = (document.body.innerText || "").slice(0, 3000);
        if (TP.id && TP.id !== "auto") {
            if (/\/edit(\/|$|\?)|edit-chapter|chapter\/edit/i.test(location.pathname) || /edit (chapter|draft)/i.test(t.slice(0, 1500))) { return "edit"; }
            return findEditor() ? "add" : "other";
        }
        if (/add a new chapter/i.test(t)) { return "add"; }
        if (/edit chapter/i.test(t)) { return "edit"; }
        return "other";
    }
    function findAddLink() {
        let pl = pk("addLink");
        if (pl) { return pl.href || (pl.closest && pl.closest("a[href]") ? pl.closest("a[href]").href : ""); }
        let a = [...document.querySelectorAll("a[href]")].find(x => visible(x) && /add chapter|new chapter|\+\s*chapter/i.test(x.textContent));
        return a ? a.href : "";
    }


    function startPicker(what) {
        return new Promise(resolve => {
            let label = { content: "any paragraph of the chapter TEXT", title: "the chapter TITLE", next: "the NEXT button",
                tTitle: "the chapter NAME (title) box", tPublish: "the PUBLISH button", tDraft: "the SAVE AS DRAFT button", tSchedule: "the SCHEDULE button (the one that confirms)", tSchedDate: "the schedule DATE (or date-time) box", tSchedTime: "the schedule TIME box", tEditor: "the TOOLBAR (or the words/chars bar) of the CHAPTER TEXT editor – not the author-note editors",
                tConfirm: "the CONFIRM button of the window that opens after Publish", tStep: "the button you want clicked as an extra step", tTimer: "the PUBLISH TIMER / SCHEDULE switch (or tab) in that window", tAddLink: "the NEW CHAPTER link on your story page" }[what];
            let banner = document.createElement("div");
            banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#6a58f2;color:#fff;font:14px system-ui,sans-serif;padding:9px 12px;text-align:center";
            banner.textContent = "CopyCat – click " + label + "   (Esc to cancel)";
            let box = document.createElement("div");
            box.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;outline:3px solid #6a58f2;background:rgba(106,88,242,.18)";
            document.documentElement.append(banner, box);
            let cur = null;
            let move = (e) => {
                let t = document.elementFromPoint(e.clientX, e.clientY);
                if (!t || t === banner) { return; }
                cur = t;
                let r = t.getBoundingClientRect();
                Object.assign(box.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
            };
            let cleanup = () => {
                document.removeEventListener("mousemove", move, true);
                document.removeEventListener("click", click, true);
                document.removeEventListener("keydown", key, true);
                banner.remove(); box.remove();
            };
            let key = (e) => { if (e.key === "Escape") { cleanup(); resolve(null); } };
            let click = (e) => {
                e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
                let t = cur || e.target;
                cleanup();
                let el = t;
                if (what === "content") { el = containerFor(t); }
                else if (what === "next") { el = t.closest("button, a, [role=button]") || t; }
                else if (what === "title") { el = t.closest("h1,h2,h3,h4,h5,h6") || t; }
                else if (what === "tPublish" || what === "tDraft" || what === "tSchedule") { el = t.closest("button, a, input[type=submit], input[type=button], [role=button]") || t; }
                else if (what === "tConfirm" || what === "tStep") { el = t.closest("button, a, input[type=submit], input[type=button], [role=button]") || t; }
                else if (what === "tTimer") { el = t.closest("[role=switch], .ant-switch, .el-switch, [class*=switch], input[type=checkbox], label, [role=tab], button") || t; }
                else if (what === "tAddLink") { el = t.closest("a[href]") || t; }
                else if (what === "tEditor" && t.matches && t.matches("textarea, [contenteditable='true'], [contenteditable='']")) { el = t; }
                else if (what === "tEditor") {
                    el = t.closest(".tox-tinymce, .mce-tinymce, .ql-container, .note-editor, .fr-box, .cke, .trumbowyg-box, .tiptap, .ProseMirror");
                    if (!el) { let e = t; for (let i = 0; i < 8 && e; i++, e = e.parentElement) { if (e.querySelector && e.querySelector("iframe, [contenteditable], textarea")) { el = e; break; } } }
                    el = el || t;
                }
                else if (what === "tTitle" || what === "tSchedDate" || what === "tSchedTime") { el = t.closest("input, textarea, select") || t; }
                resolve({
                    selector: cssPath(el),
                    preview: what === "content" ? el.children.length + " blocks, " + el.textContent.trim().length + " characters" : "“" + (el.textContent || el.value || el.placeholder || el.tagName).toString().trim().slice(0, 50) + "”"
                });
            };
            document.addEventListener("mousemove", move, true);
            document.addEventListener("click", click, true);
            document.addEventListener("keydown", key, true);
        });
    }

    // ------------------------------------------------------------------ the calls the controller makes
    function urlNumber() {
        let m = /(?:chapter|chap|ch|episode|ep)[-_/]?(\d{1,5})(?!.*\d)/i.exec(location.pathname);
        return m ? parseInt(m[1], 10) : null;
    }
    function inspectTarget() {
        let editor = findEditor();
        return { kind: pageKind(), hasEditor: !!editor, hasTitle: !!findTitleInput(editor), url: location.href };
    }
    function formInfo() {
        let editor = findEditor();
        let t = findTitleInput(editor);
        let chars = 0;
        if (editor) { chars = (editor.kind === "textarea" ? editor.el.value : editor.el.textContent).replace(/\s+/g, "").length; }
        return { title: t ? (typeof t.value === "string" ? t.value : (t.textContent || "")) : "", chars: chars };
    }
    function hasText(text) {
        let norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
        return norm(document.body.innerText).includes(norm(text));
    }
    window.__ccLib = {
        extract: (sel) => { SEL = sel || {}; let c = extract(); if (c) { c.urlNo = urlNumber(); c.url = location.href; } return c; },
        clickNext: (sel) => { SEL = sel || {}; let n = findNext(); if (!n) { return { ok: false }; } let d = describe(n); n.click(); return { ok: true, desc: d }; },
        nextHref: (sel) => {
            SEL = sel || {};
            let el = findNext();
            // the button itself may be wrapped in, or contain, the real link
            let a = el && (el.href ? el : (el.closest("a[href]") || el.querySelector("a[href]")));
            if (!a || !a.href || /^javascript:/i.test(a.href)) { return null; }
            let m = /(?:chapter|chap|ch|episode|ep)[-_/]?(\d{1,5})(?!.*\d)/i.exec(new URL(a.href).pathname);
            return { href: a.href, no: m ? parseInt(m[1], 10) : null };
        },
        isChallenge: () => detectChallenge(),
        blockedReason: () => blockedReason(),
        nextCandidates: () => [...document.querySelectorAll("a, button, [role=button]")]
            .filter(e => /next|›|»|→/i.test((e.textContent || "") + " " + (e.getAttribute("aria-label") || "") + " " + (e.getAttribute("title") || "")))
            .slice(0, 6).map(e => describe(e) + (e.disabled ? " (disabled)" : "")),
        nextUrlByNumber: () => nextUrlByNumber(),
        diagnose: () => diagnose(),
        explain: (sel) => { SEL = sel || {}; return explain(); },
        describeBlocks: (sel) => { SEL = sel || {}; return chapterBlocks().map(x => { let r = x.e.getBoundingClientRect(); return { label: labelNo(x.e), chars: x.chars, top: Math.round(r.top), start: (parasFromBlock(x.e)[1] || parasFromBlock(x.e)[0] || "").slice(0, 50) }; }); },
        pick: (what) => startPicker(what),
        inspectTarget: () => inspectTarget(),
        fillForm: (msg) => fillForm(msg),
        formInfo: () => formInfo(),
        setProfile: (p) => { TP = { id: (p && p.id) || "auto", picks: (p && p.picks) || {} }; },
        clickStep: (m) => clickStep(m),
        clickPublish: () => clickPublish(),
        clickDraft: () => clickDraft(),
        clickSchedule: () => clickSchedule(),
        fillSchedule: (m) => fillSchedule(m),
        dialogStep: (m) => dialogStep(m),
        noticeText: () => noticeText(),
        targetButtons: () => targetButtons(),
        readErrors: () => readErrors(),
        findAddLink: () => findAddLink(),
        hasText: (t) => hasText(t),
        describeNext: (sel) => { SEL = sel || {}; let n = findNext(); return n ? describe(n) : ""; }
    };
})();
