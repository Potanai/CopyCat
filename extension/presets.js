"use strict";
/* Built-in settings for known author websites. They are used automatically when the TARGET tab is on one of these websites.
   Anything the user picks or types for a website overrides these; "Start clean for this website" goes back to them.
   picks: txt_publish / txt_draft / txt_schedule = the exact button names on that website.
   steps: extra clicks (see Target -> Extra buttons). ifFilled = only click when the editor already holds text (so an old chapter is never overwritten).
   noSite: the website has no schedule feature of its own.  blankRequired: refuse to type unless the editor is empty after the steps. */
const CC_PRESETS = [
    {
        id: "royalroad", name: "Royal Road", host: /(^|\.)royalroad\.com$/i, profile: "royalroad",
        picks: { txt_publish: "Publish Chapter", txt_draft: "Save Draft", txt_schedule: "Save & Schedule" },
        steps: [],
        notes: "Royal Road: scheduling uses the “Scheduled Release” box and the button then reads “Save & Schedule”. You should not need any Pick buttons – only use them if “Test target” says something is NOT found."
    },
    {
        id: "meganovel", name: "MegaNovel", host: /(^|\.)meganovel\.com$/i, profile: "custom", noSite: true, blankRequired: true,
        picks: { txt_publish: "PUBLISH", txt_draft: "SAVE" },
        steps: [
            { when: "before", text: "New Chapter", selector: "", preview: "", wait: 1.5, optional: true, always: false, ifFilled: true },
            { when: "afterClick", text: "Confirm | Yes | OK | Continue", selector: "", preview: "", wait: 0.5, optional: true, always: false }
        ],
        notes: "MegaNovel has no schedule feature: use “Save as draft” (the SAVE button), “Publish right away”, or “Publish later with this tool”. A new chapter is opened with “New Chapter +” whenever the editor already holds text."
    },
    {
        id: "goodnovel", name: "GoodNovel", host: /(^|\.)goodnovel\.com$/i, profile: "custom", noSite: true, blankRequired: true,
        picks: { txt_publish: "PUBLISH", txt_draft: "SAVE" },
        steps: [
            { when: "before", text: "New Chapter", selector: "", preview: "", wait: 1.5, optional: true, always: false, ifFilled: true },
            { when: "afterClick", text: "Confirm | Yes | OK | Continue", selector: "", preview: "", wait: 0.5, optional: true, always: false }
        ],
        notes: "GoodNovel has no schedule feature: use “Save as draft” (the SAVE button), “Publish right away”, or “Publish later with this tool”. A new chapter is opened with “New Chapter +” whenever the editor already holds text."
    },
    {
        id: "novelcat", name: "NovelCat", host: /(^|\.)novelcat\.[a-z]+$/i, profile: "custom", titleTpl: "{name}",
        picks: { txt_publish: "Publish now", txt_draft: "Save as Draft", txt_schedule: "Publish Later" },
        steps: [],
        notes: "NovelCat adds the chapter number itself, so only the chapter NAME is typed (title template “{name}”). Its “Publish Later” window has not been tested yet – try “Save as draft” or “Publish later with this tool” first."
    }
];
function ccPresetFor(host) { return CC_PRESETS.find(p => p.host.test(host || "")) || null; }
