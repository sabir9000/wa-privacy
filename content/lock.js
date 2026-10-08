// App lock on WhatsApp Web: decides when to lock (inactivity, browser start,
// leaving the tab, "Lock now"), draws the PIN screen in a closed shadow root so
// WhatsApp's CSS can't touch it, and keeps the page blurred and unclickable
// underneath (html.wap-locked, see content.css).
(() => {
  const L = globalThis.WAP_LOCK;
  const root = document.documentElement;
  const instance = root.dataset.wapInstance; // set by content.js, which runs first
  const ACTIVITY_WRITE_MS = 15_000;
  const CHECK_MS = 5_000;

  // Take over from an older copy (see the hand-over in content.js).
  document.getElementById('wap-lock-host')?.remove();
  // Fail closed: keep the page blurred until we know whether it should be locked.
  root.classList.add('wap-lock-pending');

  let cfg = L.defaults();
  let state = null;
  let locked = false;
  let lastWrite = 0;
  let ui = null;
  let alive = true;

  function isCurrent() {
    if (alive && (root.dataset.wapInstance !== instance || !chrome.runtime?.id)) {
      alive = false;
      clearInterval(timer);
    }
    return alive;
  }

  Promise.all([L.getConfig(), L.getState()]).then(([c, s]) => {
    cfg = c;
    state = s;
    if (cfg.enabled && !state && !cfg.onStartup) {
      state = { locked: false, lastActive: Date.now(), reason: null };
      L.markActive();
    }
    evaluate();
    root.classList.remove('wap-lock-pending');
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !isCurrent()) return;
    if (changes[L.CFG]) cfg = L.normalizeConfig(changes[L.CFG].newValue);
    if (changes[L.STATE]) state = changes[L.STATE].newValue || null;
    if (changes[L.CFG] || changes[L.STATE]) evaluate();
  });

  const timer = setInterval(evaluate, CHECK_MS);

  function evaluate() {
    if (!isCurrent()) return;
    const should = L.isLocked(cfg, state);
    // Record the lock so every WhatsApp tab (and the popup) follows.
    if (should && (!state || !state.locked)) {
      const reason = state ? 'timeout' : 'startup';
      state = { locked: true, lastActive: Date.now(), reason };
      L.lock(reason);
    }
    setLocked(should);
  }

  function setLocked(value) {
    root.classList.toggle('wap-locked', value);
    if (value && !locked) showScreen();
    else if (!value && locked) hideScreen();
    else if (value && ui) {
      ui.reason.textContent = L.reasonText(cfg, state);
      if (!ui.host.isConnected) root.appendChild(ui.host);
    }
    locked = value;
  }

  // ---------- Activity ----------

  function onActivity() {
    if (!alive || locked || !cfg.enabled) return;
    const now = Date.now();
    if (state) state.lastActive = now;
    if (now - lastWrite > ACTIVITY_WRITE_MS) {
      lastWrite = now;
      L.markActive();
    }
  }
  for (const type of ['pointerdown', 'keydown', 'wheel', 'mousemove', 'touchstart']) {
    addEventListener(type, onActivity, { capture: true, passive: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (!isCurrent() || !cfg.enabled) return;
    if (!document.hidden) {
      evaluate();
    } else if (cfg.onLeave && !locked) {
      // Lock before leaving, so the page is already covered when you come back.
      state = { locked: true, lastActive: Date.now(), reason: 'leave' };
      L.lock('leave');
      setLocked(true);
    }
  });

  // ---------- Lock screen ----------

  function showScreen() {
    if (!ui) ui = buildScreen();
    ui.reason.textContent = L.reasonText(cfg, state);
    ui.input.value = '';
    ui.err.textContent = '';
    root.appendChild(ui.host);
    requestAnimationFrame(() => ui.input.focus());
    L.waitSeconds().then(countdown);
  }

  function hideScreen() {
    if (ui) ui.host.remove();
  }

  async function submit(e) {
    e.preventDefault();
    const pin = ui.input.value.trim();
    if (!pin) return;
    ui.button.disabled = true;
    ui.err.textContent = '';
    const res = await L.unlock(pin);
    ui.button.disabled = false;
    if (res.ok) {
      state = { locked: false, lastActive: Date.now(), reason: null };
      evaluate();
      return;
    }
    ui.input.value = '';
    if (res.wait) countdown(res.wait);
    else ui.err.textContent = `Wrong PIN. ${res.left} ${res.left === 1 ? 'try' : 'tries'} left.`;
    ui.input.focus();
  }

  let countdownTimer;
  function countdown(seconds) {
    clearInterval(countdownTimer);
    if (!seconds) return;
    let left = seconds;
    const tick = () => {
      if (left <= 0) {
        clearInterval(countdownTimer);
        ui.input.disabled = ui.button.disabled = false;
        ui.err.textContent = '';
        ui.input.focus();
        return;
      }
      ui.input.disabled = ui.button.disabled = true;
      ui.err.textContent = `Too many wrong tries. Try again in ${left}s.`;
      left -= 1;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    node.append(...children);
    return node;
  }

  function lockIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '26');
    svg.setAttribute('height', '26');
    svg.setAttribute('aria-hidden', 'true');
    const shapes = [
      ['rect', { x: 5, y: 10.5, width: 14, height: 10, rx: 2.2, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }],
      ['path', { d: 'M8 10.5V8a4 4 0 0 1 8 0v2.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }],
      ['circle', { cx: 12, cy: 15.5, r: 1.4, fill: 'currentColor' }],
    ];
    for (const [tag, attrs] of shapes) {
      const s = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, String(v));
      svg.append(s);
    }
    return svg;
  }

  function buildScreen() {
    const host = el('div', { id: 'wap-lock-host' });
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:block;';
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = el('style', { text: SCREEN_CSS });
    const icon = el('div', { class: 'ic' }, lockIcon());
    const title = el('h1', { id: 'wap-lock-title', text: 'WhatsApp Web is locked' });
    const reason = el('p', { class: 'reason' });
    const input = el('input', {
      type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '8',
      placeholder: 'Enter PIN', 'aria-label': 'PIN', spellcheck: 'false',
    });
    const err = el('p', { class: 'err', role: 'alert' });
    const button = el('button', { type: 'submit', text: 'Unlock' });
    const help = el('details', {},
      el('summary', { text: 'Forgot your PIN?' }),
      el('p', { text: 'Open chrome://extensions, remove WA Privacy and add it again. That clears the PIN, and also your chat settings.' }),
    );
    const form = el('form', { class: 'card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wap-lock-title' },
      icon, title, reason, input, err, button, help);
    form.addEventListener('submit', submit);
    // Only digits in the PIN box.
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 8); });
    // Keep focus in the PIN box while locked, even if WhatsApp tries to take it.
    input.addEventListener('blur', () => setTimeout(() => locked && !input.disabled && input.focus(), 0));

    // Don't let typing reach WhatsApp's own keyboard handlers.
    for (const type of ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'paste', 'copy', 'cut']) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }

    shadow.append(style, el('div', { class: 'veil' }, form));
    return { host, reason, input, err, button };
  }

  const SCREEN_CSS = `
    :host { all: initial; }
    .veil {
      position: fixed; inset: 0; display: grid; place-items: center;
      background: rgba(240, 242, 245, .78);
      font: 14px/1.4 "Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif;
      color: #111b21;
    }
    .card {
      width: min(340px, calc(100vw - 32px)); box-sizing: border-box;
      background: #fff; border-radius: 16px; padding: 26px 28px 20px; text-align: center;
      box-shadow: 0 8px 30px rgba(0, 0, 0, .14);
      display: grid; gap: 0;
    }
    .ic { width: 56px; height: 56px; border-radius: 50%; background: #e3f6ec; color: #1fa463; display: grid; place-items: center; margin: 0 auto 12px; }
    h1 { font-size: 18px; margin: 0; font-weight: 700; }
    .reason { color: #667781; font-size: 12.5px; margin: 4px 0 18px; }
    input {
      box-sizing: border-box; width: 100%; padding: 11px 12px; border-radius: 10px;
      border: 1.5px solid #d1d7db; background: #fff; color: inherit;
      font: inherit; font-size: 20px; letter-spacing: .45em; text-align: center; outline: none;
    }
    input::placeholder { letter-spacing: normal; font-size: 14px; color: #8696a0; }
    input:focus { border-color: #1fa463; box-shadow: 0 0 0 3px rgba(31, 164, 99, .18); }
    input:disabled { opacity: .55; }
    .err { color: #c2410c; font-size: 12px; min-height: 18px; margin: 6px 0; }
    button {
      border: 0; border-radius: 10px; padding: 11px 14px; font: inherit; font-weight: 600;
      background: #1fa463; color: #fff; cursor: pointer;
    }
    button:hover:not(:disabled) { filter: brightness(.95); }
    button:focus-visible { outline: 2px solid #111b21; outline-offset: 2px; }
    button:disabled { opacity: .55; cursor: default; }
    details { margin-top: 14px; font-size: 12px; color: #667781; }
    summary { cursor: pointer; }
    details p { margin: 8px 0 0; text-align: left; }
    @media (prefers-color-scheme: dark) {
      .veil { background: rgba(11, 20, 26, .8); color: #e9edef; }
      .card { background: #111b21; box-shadow: 0 8px 30px rgba(0, 0, 0, .5); }
      .ic { background: #10362a; color: #21c063; }
      .reason, details { color: #8696a0; }
      input { background: #202c33; border-color: #2a3942; }
      button { background: #21c063; color: #0b141a; }
      .err { color: #fb923c; }
    }
  `;
})();
