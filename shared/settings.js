// Settings model shared by the content script, popup and service worker.
// Everything lives under one chrome.storage.sync key so all three UIs stay in sync.
//
// Visibility is stored as lists of *visible* parts:
//   defaultVisible  – parts visible in every chat you haven't set yourself ("All chats")
//   chats[name]     – a chat's own visible parts; present only when it differs from defaultVisible
(() => {
  const KEY = 'settings';

  const PARTS = ['name', 'photo', 'preview', 'messages', 'media'];
  const PART_INFO = {
    name: { label: 'Chat name', short: 'chat name', hint: 'list, header, senders' },
    photo: { label: 'Profile photo', short: 'profile photo' },
    preview: { label: 'Last message', short: 'last message', hint: 'preview in chat list' },
    messages: { label: 'Messages', short: 'messages' },
    media: { label: 'Photos & videos', short: 'photos & videos' },
  };

  // Settings from v1 (per-chat modes) map onto visible-part lists.
  const LEGACY_MODES = {
    show: PARTS,
    names: ['name', 'photo'],
    messages: ['preview', 'messages', 'media'],
  };

  function defaults() {
    return { enabled: true, hoverReveal: true, blurPx: 6, defaultVisible: [], chats: {} };
  }

  function cleanParts(list) {
    return Array.isArray(list) ? PARTS.filter((p) => list.includes(p)) : null;
  }

  function sameParts(a, b) {
    return a.length === b.length && a.every((p) => b.includes(p));
  }

  // Coerce anything read from storage (or imported) into a valid settings object.
  function normalize(raw) {
    const s = defaults();
    if (!raw || typeof raw !== 'object') return s;
    if (typeof raw.enabled === 'boolean') s.enabled = raw.enabled;
    if (typeof raw.hoverReveal === 'boolean') s.hoverReveal = raw.hoverReveal;
    if (Number.isFinite(raw.blurPx)) s.blurPx = Math.min(20, Math.max(2, Math.round(raw.blurPx)));

    const defaultVisible = cleanParts(raw.defaultVisible);
    if (defaultVisible) s.defaultVisible = defaultVisible;
    else if (raw.blur && typeof raw.blur === 'object') {
      // v1 stored "blur this part" flags.
      s.defaultVisible = PARTS.filter((p) => raw.blur[p] === false);
    }

    if (raw.chats && typeof raw.chats === 'object') {
      for (const [key, value] of Object.entries(raw.chats)) {
        const parts = typeof value === 'string' ? LEGACY_MODES[value] : cleanParts(value);
        if (key && parts && !sameParts(parts, s.defaultVisible)) s.chats[key] = [...parts];
      }
    }
    return s;
  }

  async function load() {
    const r = await chrome.storage.sync.get(KEY);
    return normalize(r[KEY]);
  }

  function save(s) {
    return chrome.storage.sync.set({ [KEY]: s });
  }

  // Read-modify-write against fresh storage so concurrent UIs don't clobber each other.
  // Updates from the same context are queued so back-to-back calls can't interleave.
  let queue = Promise.resolve();
  function update(fn) {
    const run = queue.then(async () => {
      const s = await load();
      fn(s);
      await save(s);
      return s;
    });
    queue = run.catch(() => {});
    return run;
  }

  // ---------- Reading ----------

  function hasOwn(s, key) {
    return !!key && Object.prototype.hasOwnProperty.call(s.chats, key);
  }

  // Stored visible parts for a chat (its own, or the All chats defaults).
  function partsOf(s, key) {
    return hasOwn(s, key) ? s.chats[key] : s.defaultVisible;
  }

  // What is actually visible: media sits inside message bubbles, so it is
  // blurred along with them whenever messages are blurred.
  function effective(parts) {
    return parts.includes('messages') ? parts : parts.filter((p) => p !== 'media');
  }

  // 'show' (all visible) | 'part' (some) | 'blur' (none)
  function stateOf(parts) {
    const n = effective(parts).length;
    return n === 0 ? 'blur' : n === PARTS.length ? 'show' : 'part';
  }

  // Plain-language summary, e.g. "everything visible", "except messages".
  function describe(parts) {
    const vis = effective(parts);
    if (vis.length === PARTS.length) return 'everything visible';
    if (vis.length === 0) return 'everything blurred';
    const hidden = PARTS.filter((p) => !vis.includes(p) && !(p === 'media' && !vis.includes('messages')));
    const names = (list) => list.map((p) => PART_INFO[p].short);
    if (hidden.length <= 2) return `except ${names(hidden).join(' and ')}`;
    return `only ${names(vis).join(', ')}`;
  }

  // Space-separated list used by the content script's CSS ([data-wap-vis~="name"]).
  function visibleAttr(s, key) {
    return partsOf(s, key).join(' ');
  }

  // ---------- Writing ----------

  // A chat whose parts equal the defaults simply follows All chats.
  function applyChat(s, key, parts) {
    const clean = cleanParts(parts) || [];
    if (sameParts(clean, s.defaultVisible)) delete s.chats[key];
    else s.chats[key] = clean;
  }

  function setChatParts(key, parts) {
    return update((s) => applyChat(s, key, parts));
  }

  // Big pill / eye button / Alt+W: blurred → everything visible, otherwise → everything blurred.
  function toggleChat(key) {
    return update((s) => applyChat(s, key, stateOf(partsOf(s, key)) === 'blur' ? PARTS : []));
  }

  // Eye buttons / Alt+W cycle through three steps:
  //   Blurred → Partly (name and photo only) → Visible → Blurred.
  // A custom Partly mix counts as the Partly step, so it moves on to Visible.
  const NAME_PHOTO = ['name', 'photo'];

  function nextInCycle(parts) {
    const state = stateOf(parts);
    if (state === 'blur') return NAME_PHOTO;
    if (state === 'part') return PARTS;
    return [];
  }

  function cycleChat(key) {
    return update((s) => applyChat(s, key, nextInCycle(partsOf(s, key))));
  }

  function isNamePhoto(parts) {
    return sameParts(effective(parts), NAME_PHOTO);
  }

  function setChatPart(key, part, visible) {
    return update((s) => {
      const parts = new Set(partsOf(s, key));
      if (visible) parts.add(part);
      else parts.delete(part);
      applyChat(s, key, [...parts]);
    });
  }

  function resetChat(key) {
    return update((s) => { delete s.chats[key]; });
  }

  function setDefaultPart(part, visible) {
    return update((s) => {
      const parts = new Set(s.defaultVisible);
      if (visible) parts.add(part);
      else parts.delete(part);
      s.defaultVisible = PARTS.filter((p) => parts.has(p));
      // Chats that now match the new defaults go back to following them.
      for (const [key, own] of Object.entries(s.chats)) if (sameParts(own, s.defaultVisible)) delete s.chats[key];
    });
  }

  globalThis.WAP = {
    KEY, PARTS, PART_INFO,
    defaults, normalize, load, save, update,
    hasOwn, partsOf, effective, stateOf, describe, visibleAttr,
    setChatParts, toggleChat, cycleChat, isNamePhoto, setChatPart, resetChat, setDefaultPart,
  };
})();
