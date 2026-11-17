"use strict";
// Clicking the toolbar icon opens (or focuses) the control window. All the work happens in that window, not here,
// because a service worker can be stopped by the browser in the middle of a long run.
chrome.action.onClicked.addListener(async () => {
    const url = chrome.runtime.getURL("runner.html");
    const existing = await chrome.tabs.query({ url: url });
    if (existing.length) {
        await chrome.windows.update(existing[0].windowId, { focused: true });
        await chrome.tabs.update(existing[0].id, { active: true });
        return;
    }
    await chrome.windows.create({ url: url, type: "popup", width: 620, height: 920 });
});
