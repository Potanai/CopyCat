"use strict";
// Timer thread: browsers slow down timers of minimized / hidden pages, but not the timers of a worker.
self.onmessage = (e) => { const id = e.data.id; setTimeout(() => self.postMessage(id), e.data.ms); };
