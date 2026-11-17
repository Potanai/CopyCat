COPYCAT — ROYAL EDITION
======================================
Theme: midnight royal blue, polished gold accents and diamond identity.

Copies chapters from a reader page into "Add a new chapter" in Author studio, in order, with no guessing.

INSTALL (Chrome / Edge):
1. Extract the ZIP to a permanent folder (do not load directly from inside the ZIP).
2. Open chrome://extensions (Edge: edge://extensions).
3. Enable Developer mode.
4. Remove or disable older CopyCat copies to avoid duplicate toolbar entries.
5. Choose Load unpacked and select the extracted CC49 folder.
6. Pin the extension if desired. Click its toolbar icon to open the Royal Edition control window.

Keep the extracted folder in place; the browser loads the extension from that folder.

Use: open the reader on your first chapter and the "Add a new chapter" page in two tabs -> click the icon ->
choose both tabs -> "Use reader's chapter" (fills From) -> type To -> tick the rights box -> Start.

Numbers: From/To are the chapter numbers in the browser address (chapter-10), which equal the reader's pager (Ch. 10 / 453). You can switch to title numbers.
Leave From blank to start at the chapter on screen. Posted titles default to "Chapter {number}: name".
Some readers keep several chapters in the page at once; the extension picks the block that matches the pager/address (Test reading lists every block it finds)
and refuses to post if the text found does not match the pager. Before the first publish it shows address, title and first words and asks you to confirm.

How it stays correct: every chapter is opened by its own address (chapter-14, chapter-15 ...) and checked to be exactly that one.
It never clicks Next and never follows the page, so it cannot skip or repeat a chapter. Identical text is never posted twice.
If it is unsure whether a chapter was published, it stops (never retries that case, so nothing is duplicated).

Features: retry failed chapters; optionally skip failures and list them; pause/resume between chapters; Continue after last published;
skip chapters already published by this tool; remove junk lines / find-replace text; renumber titles; coin price after chapter 30;
random pacing; beep + flashing window on a verification page; progress bar with time left; CSV report; Copy log.
Follow-the-page mode is only used when the reader address has no chapter number.

Minimizing / other windows: browsers pause pages in minimized or fully covered windows. This extension (a) does its waiting in a worker thread,
(b) holds a lock and keeps the computer awake while running, (c) tells the reader and Author studio pages they are visible, and
(d) brings a minimized reader/Author studio window back WITHOUT taking focus (option in "Pace & safety").
Best practice: leave the two windows un-minimized, even partly hidden behind other windows; do not close the CopyCat window.

Stuck handling (optional tick box, off by default): if a chapter fails after its retries, the run does not end. It beeps, restores windows, and tries that chapter again every minute
(up to 30 minutes). It only stops completely when you press Stop, when it cannot tell whether a chapter was published (to avoid duplicates), or when the limit is used up.
If it stops, the log's last lines say why - please send "Copy log".

Speed: "Turbo" is the fastest option (needs a quick connection). "Fast" speed (default) uses the shortest safe waits; "Read the next chapter while the current one is being published" overlaps the two tabs' work.
Use "Gentle" speed if a slow site ever misreads. Pause between chapters defaults to 1 second.

Text file: every published chapter is also saved inside the extension. "Download chapters (.txt)" gives one file with all saved chapters of the novel in the
SOURCE tab; with the tick box on, a .txt of the chapters copied in a run is downloaded when the run finishes or stops.

New in 4.10.0:
- Works on other websites. Target box: "Website type" = Auto-detect / Royal Road / Webnovel / Any other website. If "Test target" misses the name box,
  Publish, Draft, Schedule or date/time box, press the matching Pick button and click it on the page (remembered per website).
- Royal Road and Webnovel readers have no chapter numbers in their addresses, so the run starts at the chapter on screen and follows the Next button
  (automatic for those two; tick the box in "Range" for any other site like that). Use "Chapters to copy" to limit the run.
- Save mode (box 4): Publish now / Save as draft / Schedule on the website (fills the site's own date box) / Publish later with this tool's timer.
  Schedule settings: first release, chapters per release, and the gap (minutes / hours / days). Timer mode needs this window and the computer to stay on.
- Drafts and website schedules are confirmed by the site's "saved/scheduled" message or a page change; if neither appears the run stops (never guesses, never duplicates).
- Royal Road / Webnovel presets are best-effort and were not tested against the live sites: if a button is not found, use the Pick buttons and send the log.

New in 4.9.0 (on top of 4.7.0):
- Coins: "Coins start from chapter" + "Coin price" (the old fixed "after chapter 30" is now just the default 31). Optional tiers, one per line: 31 => 5 / 100 => 8 / 300 => 10.
- Stop: "Stop after chapter" (last one to copy), "Chapters to copy", "Stop after running for N minutes", and "Stop BEFORE any chapter containing" words like "Volume 2".
- Skip these chapters: e.g. 45, 60-62.
- Title template: e.g. "Chapter {n} - {name}". Add a line at the START and/or END of every chapter.

DEMO VERIFICATION TEST (local mock only)
- Open demo-verification.html in a browser tab.
- Use that tab as the CopyCat source to test challenge detection/waiting.
- Click the checkbox and then "Verify checkbox", or use "Simulate automatic demo verification" to trigger a real JavaScript click on the local demo checkbox.
- The mock challenge marker is removed after demo verification so the extension can detect that the page is clear.
- This is only a local simulation. It does not solve, click, or bypass real CAPTCHA / anti-bot challenges.

Webnovel (4.10.1): Publish opens a "Confirm Publish" window. The tool now handles it: for "Publish now" it presses Confirm; for
"Schedule on the website" it turns on "Publish Timer", sets the time and date boxes, checks they were accepted, then presses Confirm.
"Save as draft" presses the SAVE button. Royal Road scheduling still needs its exact layout (send a screenshot of its schedule area).

Royal Road (4.10.2): the form has three editors (pre-note, Chapter Content, post-note) – the tool now picks the one under the "Chapter Content" label
(Test target shows "editor 2 of 3"); "Pick TEXT editor" is the fallback (click that editor's toolbar). The target tab may be the Add-chapter form OR your
story page (the one with the "New Chapter" button); an "Edit Draft" / "Edit Chapter" page is refused so nothing is overwritten.

New in 4.11.0:
- MODE box (top): "Copy chapters from another website" (as before) or "Paste my own chapters" (text or a .txt/.md file). Paste mode uses the same Target,
  Save mode / schedule (publish now, draft, schedule on the website, timer), Speed, Text and safety settings.
  Split rules: lines like "Chapter 12: Title" / a separator line (--- === ***) / your own marker line / one single chapter. "Preview split" shows what will be posted.
  Pasted text is remembered; duplicates inside a run are blocked; "skip already posted" works per book name.
- GUIDED SETUP (★ box): Back / Pick it / Skip / Next steps for any website – chapter text, next button, name box, text editor, Publish, Confirm window,
  Draft, schedule switch, date, time, schedule button, New-Chapter link, then a "Test fill" that types a test chapter WITHOUT publishing.
  Every pick is remembered per website.

New in 4.12.0 (schedule made simple):
- "Release plan: Chapters per day": say how many chapters per day (e.g. 2) and optionally at which times (09:00, 21:00); blank times = spread evenly from the
  start time. "Start" can be any date/time later. "Publish the first N chapters right away, schedule the rest" is available for both website-schedule and timer modes.
  The old "N chapters every X minutes/hours/days" plan is still there as "Every so often (advanced)".

4.12.1 – Webnovel date fix: the Confirm window's release date/time is now set like a person would and PROVEN before pressing Confirm. The tool reads the
site's own preview line (e.g. "2026-11-16 00:29 (GMT+8)") and compares it with the wanted time: it types the values; if the site ignores that it types key by key;
then it opens the calendar, clicks the month arrows and the day; for time pop-ups it clicks the hour/minute columns. If the preview still does not match,
the run stops with what the site shows vs. what was needed, and nothing is published.

New in 4.13.0:
- SECURITY CHECKS / BLOCKED PAGES: Cloudflare Turnstile, reCAPTCHA, "Security Check Required", login walls and locked chapters are detected on EVERY read
  (a verification page is never copied as a chapter, and never taken as "end of novel"). The tool never solves or bypasses a verification.
  Setting (box 5): "Pause here, wait for me, then continue by itself" (default; brings the source tab forward, beeps, waits up to N minutes,
  button "▶ I solved it – continue" reloads the source page and carries on) or "Stop the run here".
- SPEED: new "🚀 MAX" level (no pause between chapters, shortest waits, read-ahead on, no random jitter). Order: Gentle, Normal, Fast, Turbo, Max.
  Note: very fast reading is exactly what makes sites show "unusual reading activity" checks – if a site keeps asking, use Fast/Turbo.

New in 4.14.0: PRIVATE (incognito) TABS can be the source and/or the target.
Chrome hides private tabs from every extension until you switch it on: press "🕶 Use private tabs…" (box 2), turn on "Allow in Incognito" for this extension,
then press "↻ Refresh tab list". Private tabs then appear as "🕶 PRIVATE · …" in both tab lists. A private window has its own cookies, so log in to the
site inside the private window first.

New in 4.15.0: collapsible sections, "Simple / All options" view (top), a live Quick guide with a "Next:" hint, and a clearer
"4. What happens to each chapter?" box with a Release preview that lists the real release times before you press Start.
Private-window helper buttons live under "Private (incognito) windows" (All options view).

New in 4.16.0: EXTRA BUTTONS FOR ANY AUTHOR WEBSITE (Target box -> "Extra buttons to click", visible in the "All options" view).
- Add steps that click Next / Back / Continue / Confirm / "click here"… by their text (several allowed: Next | Continue) or by picking the button on the page.
  When: before filling each chapter / after filling before Publish / right after pressing Publish (Confirm windows) / after publishing.
  Each step has a wait, can be optional, can be tested with one click, and can be re-ordered.
- "This website's own names for the main buttons": type what the Publish / Save-draft / Schedule buttons are called on your site.
- Copy this website's settings / Load settings someone shared: one text block with the picks, button names and steps, so others can use the same site in one click.

New in 4.17.0: EASY view (default): only the steps most people need. A yellow "What happened / what to do" box explains in plain words why a run stopped.
"Start clean for this website" forgets every pick, button name and extra step for the target website.
Fixed: Royal Road's editor notice ("Microsoft Word") was wrongly treated as a site error (4.16.1).

New in 4.18.0: BUILT-IN WEBSITES (presets.js): Royal Road, MegaNovel, GoodNovel, NovelCat. They load automatically when the Target tab is on that website
(button names, extra steps, title template). Your own picks override them; "Start clean for this website" returns to them.
- Royal Road: the text is now typed like a real paste and checked against the editor's own "chars:" counter (fixes "The Content field is required");
  the Chapter Content editor is chosen between its label and the next one; Title and Scheduled Release are found by their labels.
- MegaNovel / GoodNovel: no schedule feature (the tool says so); "New Chapter +" is pressed only when the editor already holds text, and the tool refuses to type over an old chapter.
- NovelCat: only the chapter name is typed (title template {name}).
MegaNovel, GoodNovel and NovelCat were set up from screenshots and have not been tested on the live sites yet.
