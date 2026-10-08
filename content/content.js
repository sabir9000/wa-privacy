// Tags WhatsApp Web's DOM with data attributes; blur itself is pure CSS keyed off them.
//   <html class="wap-on wap-hover">   master switch, hover reveal
//   [data-wap-scope] + [data-wap-key] + [data-wap-vis="visible parts"] on each chat row and on #main
//   [data-wap-el="name|photo|preview"] on the elements inside them
(() => {
  const S = globalThis.WAP_SEL;
  const W = globalThis.WAP;
  const root = document.documentElement;

  let settings = W.defaults();
  let currentKey = null;
  let framePending = false;

  // Hand-over: when the extension is installed, updated or reloaded, the service
  // worker starts a fresh copy in tabs that are already open. The newest copy owns
  // the page: it clears the previous copy's style and buttons, and older copies stop
  // as soon as they see a newer id (or lose their connection to the extension).
  const instance = Math.random().toString(36).slice(2);
  root.dataset.wapInstance = instance;
  document.getElementById('wap-style')?.remove();
  for (const old of document.querySelectorAll('.wap-eye')) old.remove();
  let alive = true;

  function isCurrent() {
    if (alive && (root.dataset.wapInstance !== instance || !chrome.runtime?.id)) {
      alive = false;
      observer.disconnect();
    }
    return alive;
  }

  // Fail closed: blur with default settings before stored settings arrive.
  injectStyle();
  applyRootClasses();

  W.load().then((s) => {
    if (!isCurrent()) return;
    settings = s;
    applyRootClasses();
    scan();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes[W.KEY] || !isCurrent()) return;
    settings = W.normalize(changes[W.KEY].newValue);
    applyRootClasses();
    scan();
  });

  // ---------- CSS ----------

  function injectStyle() {
    // Outermost message element only: nested matches would compound the blur.
    const msg = `:is(${S.message}):not(:is(${S.message}) *)`;
    const blur = 'filter: blur(var(--wap-blur, 6px)) !important;';
    // The :not(#…) pair adds two ids of specificity so hover beats every blur rule
    // (the message rules carry one id via #main).
    const reveal = 'html:not(#wap-x):not(#wap-y).wap-hover';
    const css = `
      html.wap-on [data-wap-scope]:not([data-wap-vis~="name"]) [data-wap-el="name"],
      html.wap-on [data-wap-scope]:not([data-wap-vis~="photo"]) [data-wap-el="photo"],
      html.wap-on [data-wap-scope]:not([data-wap-vis~="preview"]) [data-wap-el="preview"],
      html.wap-on #main:not([data-wap-vis~="messages"]) ${msg},
      html.wap-on #main:not([data-wap-vis~="media"]) ${msg} :is(${S.messageMedia}) { ${blur} }

      /* Fade only on reveal; blurring is always instant so nothing flashes unblurred. */
      ${reveal} [data-wap-scope="row"]:hover [data-wap-el],
      ${reveal} #main header:hover [data-wap-el],
      ${reveal} #main ${msg}:hover,
      ${reveal} #main ${msg}:hover * { filter: none !important; transition: filter .15s ease; }
    `;
    const style = document.createElement('style');
    style.id = 'wap-style';
    style.textContent = css;
    root.appendChild(style);
  }

  function applyRootClasses() {
    root.classList.toggle('wap-on', settings.enabled);
    root.classList.toggle('wap-hover', settings.hoverReveal);
    root.style.setProperty('--wap-blur', `${settings.blurPx}px`);
  }

  // ---------- Tagging ----------

  function scan() {
    if (!isCurrent()) return;
    const list = document.querySelector(S.chatList);
    if (list) list.querySelectorAll(S.chatRow).forEach(tagRow);
    const main = document.querySelector(S.conversation);
    if (main) tagConversation(main);
    else currentKey = null;
  }

  function tagRow(row) {
    const nameEl = row.querySelector(S.rowName);
    const key = nameEl && textOf(nameEl);
    if (!key) return;
    setAttr(row, 'data-wap-scope', 'row');
    setAttr(row, 'data-wap-key', key);
    setAttr(row, 'data-wap-vis', W.visibleAttr(settings, key));
    setAttr(nameEl, 'data-wap-el', 'name');
    markPhotos(row);
    markText(row, S.rowText, nameEl, 'preview');
    ensureRowEye(row, key);
  }

  function tagConversation(main) {
    const header = main.querySelector(S.header);
    const nameEl = header && header.querySelector(S.headerName);
    const key = (nameEl && textOf(nameEl)) || null;
    currentKey = key;
    setAttr(main, 'data-wap-scope', 'main');
    setAttr(main, 'data-wap-key', key || '');
    setAttr(main, 'data-wap-vis', key ? W.visibleAttr(settings, key) : '');
    if (!header) return;
    if (nameEl) setAttr(nameEl, 'data-wap-el', 'name');
    markPhotos(header);
    // Subtitle (group member list, "last seen") counts as a name.
    markText(header, S.headerText, nameEl, 'name');
    ensureEyeButton(header, key);
  }

  // Mark every avatar picture in `scope` (there can be several, e.g. a status ring).
  function markPhotos(scope) {
    for (const el of scope.querySelectorAll(S.avatar)) {
      if (!el.closest('.wap-eye')) setAttr(el, 'data-wap-el', 'photo');
    }
  }

  // Mark text spans under `scope` as `kind`, skipping `except` and anything
  // nested in an already-marked span (nested filters would compound the blur).
  function markText(scope, selector, except, kind) {
    for (const el of scope.querySelectorAll(selector)) {
      if (el === except || el.closest('.wap-eye')) continue;
      if (except && (except.contains(el) || el.contains(except))) continue;
      const marked = el.parentElement && el.parentElement.closest('[data-wap-el]');
      if (marked && scope.contains(marked)) continue;
      if (!el.textContent.trim()) continue;
      setAttr(el, 'data-wap-el', kind);
    }
  }

  function textOf(el) {
    return (el.getAttribute('title') || el.textContent || '').trim();
  }

  function setAttr(el, name, value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  // ---------- Eye buttons: chat header and chat list rows ----------

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    show: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0'],
    blur: [
      'M9.9 5.2A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2',
      'M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6',
      'M3 3l18 18',
      'M9.9 9.9a3 3 0 0 0 4.2 4.2',
    ],
  };
  // Half-filled circle, matching the popup's "Partly" pill.
  ICONS.part = ['M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z', { d: 'M12 3.5a8.5 8.5 0 0 1 0 17z', fill: true }];
  // Each click moves one step: Blurred → Name & photo → Visible → Blurred.
  function tooltip(parts) {
    const state = W.stateOf(parts);
    if (state === 'blur') return 'Blurred: click to show name & photo (Alt+W)';
    if (state === 'show') return 'Shown normally: click to blur (Alt+W)';
    const now = W.isNamePhoto(parts) ? 'Name & photo visible' : 'Partly visible';
    return `${now}: click to show everything (Alt+W)`;
  }

  function makeEyeButton(className, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    // Keep WhatsApp from treating the click as "open chat" / "open contact info".
    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup']) {
      btn.addEventListener(type, (e) => e.stopPropagation());
    }
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isCurrent()) onClick(btn);
    });
    return btn;
  }

  function updateEyeButton(btn, key, iconSize) {
    const parts = W.partsOf(settings, key);
    const state = W.stateOf(parts);
    btn.hidden = !key;
    setAttr(btn, 'data-state', state);
    const title = key ? `${key}: ${tooltip(parts)}` : '';
    setAttr(btn, 'title', title);
    setAttr(btn, 'aria-label', title);
    if (btn.dataset.icon !== state) {
      btn.dataset.icon = state;
      btn.replaceChildren(icon(ICONS[state], iconSize));
    }
  }

  function ensureEyeButton(header, key) {
    let btn = header.querySelector('.wap-eye');
    if (!btn) {
      btn = makeEyeButton('wap-eye', cycleCurrent);
      const icons = header.lastElementChild;
      if (icons && icons !== header.firstElementChild) header.insertBefore(btn, icons);
      else header.appendChild(btn);
    }
    updateEyeButton(btn, key, 20);
  }

  // Chat list: a button on the right of the row's second line, between the
  // preview text and WhatsApp's unread/pin icons, so the preview shrinks
  // instead of being covered. Falls back to floating at the row's right edge.
  function ensureRowEye(row, key) {
    let btn = row.querySelector('.wap-row-eye');
    if (!btn) {
      // Rows are recycled for other chats while scrolling, so read the key at click time.
      btn = makeEyeButton('wap-eye wap-row-eye', (b) => {
        const k = b.closest('[data-wap-scope="row"]')?.getAttribute('data-wap-key');
        if (k) W.cycleChat(k);
      });
      placeRowEye(row, btn);
    }
    updateEyeButton(btn, key, 14);
  }

  function placeRowEye(row, btn) {
    let anchor = row.querySelector('[data-wap-el="preview"]');
    while (anchor && anchor.parentElement && anchor.parentElement !== row && anchor.parentElement.children.length === 1) {
      anchor = anchor.parentElement;
    }
    const line = anchor && anchor.parentElement;
    if (line && line !== row) {
      const css = getComputedStyle(line);
      if (css.display.includes('flex') && !css.flexDirection.startsWith('column')) {
        anchor.after(btn);
        return;
      }
    }
    btn.classList.add('wap-row-eye-float');
    if (getComputedStyle(row).position === 'static') row.style.position = 'relative';
    row.appendChild(btn);
  }

  function icon(paths, size) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    for (const entry of paths) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', typeof entry === 'string' ? entry : entry.d);
      if (entry.fill) p.setAttribute('class', 'wap-fill');
      svg.appendChild(p);
    }
    return svg;
  }

  function cycleCurrent() {
    if (currentKey) W.cycleChat(currentKey);
  }

  // ---------- Messages from popup / service worker ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isCurrent()) return;
    if (msg.type === 'wap:get-current') sendResponse({ key: currentKey });
    else if (msg.type === 'wap:toggle-current') cycleCurrent();
  });

  // ---------- Observe ----------

  // Rescan once per frame, before paint, so new rows never flash unblurred.
  function schedule() {
    if (framePending || !isCurrent()) return;
    framePending = true;
    requestAnimationFrame(() => {
      framePending = false;
      scan();
    });
  }

  // Only title/src attribute changes matter; our own data-wap-* writes don't retrigger.
  const observer = new MutationObserver(schedule);
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['title', 'src'],
  });
})();
