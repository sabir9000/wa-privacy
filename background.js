// Service worker: activation in open tabs, keyboard shortcuts, app lock on
// browser start, and the OFF badge.
importScripts('shared/settings.js', 'shared/lock.js');

const W = globalThis.WAP;
const L = globalThis.WAP_LOCK;

chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
  activateOpenTabs();
});

// Content scripts only reach pages loaded after install/update, so start them in
// WhatsApp tabs that are already open: no reload, and no unblurred gap.
// The content script hands over cleanly if an older copy is still in the page.
async function activateOpenTabs() {
  const { matches, js, css } = chrome.runtime.getManifest().content_scripts[0];
  const tabs = await chrome.tabs.query({ url: matches });
  await Promise.all(tabs.filter((t) => !t.discarded).map(async (t) => {
    try {
      await chrome.scripting.insertCSS({ target: { tabId: t.id }, files: css });
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: js });
    } catch {
      // Tab closed, crashed or still loading: it gets the content script when it loads.
    }
  }));
}

chrome.runtime.onStartup.addListener(async () => {
  updateBadge();
  // App lock: lock on browser start, or start the inactivity clock fresh if that's off.
  const cfg = await L.getConfig();
  if (cfg.enabled) await (cfg.onStartup ? L.lock('startup') : L.markActive());
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[W.KEY]) updateBadge();
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'lock-now') {
    if ((await L.getConfig()).enabled) await L.lock('manual');
  } else if (command === 'toggle-all') {
    await W.update((s) => { s.enabled = !s.enabled; });
  } else if (command === 'toggle-chat') {
    const target = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (target && target.id != null) chrome.tabs.sendMessage(target.id, { type: 'wap:toggle-current' }).catch(() => {});
  }
});

// Toolbar badge shows OFF while blur is paused.
async function updateBadge() {
  const s = await W.load();
  chrome.action.setBadgeText({ text: s.enabled ? '' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: '#c2410c' });
}
