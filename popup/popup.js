// Toolbar popup. Every control writes through WAP and the view re-renders from
// storage.onChanged, so it stays in sync with the eye buttons in WhatsApp.
const W = globalThis.WAP;
const L = globalThis.WAP_LOCK;
const $ = (id) => document.getElementById(id);

const WA_URL = 'https://web.whatsapp.com/';
const IN_TAB = new URLSearchParams(location.search).has('tab');
document.body.classList.toggle('tab', IN_TAB);

const PILL = {
  show: { cls: 'v', icon: 'i-eye', text: 'Visible' },
  part: { cls: 'p', icon: 'i-half', text: 'Partly' },
  blur: { cls: 'h', icon: 'i-eyeoff', text: 'Blurred' },
};
const AVATAR_COLORS = ['#4f9d8f', '#d97757', '#6a7fdb', '#c65d95', '#8d6e63', '#5d8aa8', '#9c7bd1', '#c79a2e'];

let settings = W.defaults();
let tab = { kind: 'other', id: null }; // kind: 'other' | 'disconnected' | 'nochat' | 'chat'
let currentKey = null;
let expandedKey = null; // chat expanded in "Chats you made visible"
let flash = null; // row to highlight after a change, e.g. "chat:messages"
let lockCfg = L.defaults();
let lockState = null;
let lockMode = null; // App lock section step: null | 'setup' | 'verify' | 'edit' | 'newpin'
let lockBoxKey = ''; // last rendered App lock step + options, so typing isn't wiped by redraws

init();

async function init() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!IN_TAB && active && active.url && active.url.startsWith(WA_URL)) {
    tab = { kind: 'disconnected', id: active.id };
    try {
      const res = await chrome.tabs.sendMessage(active.id, { type: 'wap:get-current' });
      currentKey = (res && res.key) || null;
      tab.kind = currentKey ? 'chat' : 'nochat';
    } catch {
      // Content script missing: the tab was open before the extension was (re)loaded.
    }
  }
  [settings, lockCfg, lockState] = await Promise.all([W.load(), L.getConfig(), L.getState()]);
  bind();
  $('others').open = tab.kind !== 'chat';
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[W.KEY]) {
    settings = W.normalize(changes[W.KEY].newValue);
    render();
  } else if (area === 'local' && (changes[L.CFG] || changes[L.STATE])) {
    if (changes[L.CFG]) lockCfg = L.normalizeConfig(changes[L.CFG].newValue);
    if (changes[L.STATE]) lockState = changes[L.STATE].newValue || null;
    renderLock();
  }
});

// The inactivity delay can run out while the popup is open.
setInterval(() => renderLock(), 5000);

// Run a settings write and report failures (e.g. sync quota) instead of failing silently.
function write(promise) {
  return promise.catch((err) => toast(`Couldn't save: ${err.message}`));
}

function bind() {
  $('enabled').addEventListener('change', (e) => write(W.update((s) => { s.enabled = e.target.checked; })));
  $('resume').addEventListener('click', () => write(W.update((s) => { s.enabled = true; })));
  $('hover').addEventListener('change', (e) => write(W.update((s) => { s.hoverReveal = e.target.checked; })));

  const strength = $('strength');
  strength.addEventListener('input', () => setSample(Number(strength.value)));
  strength.addEventListener('change', () => write(W.update((s) => { s.blurPx = Number(strength.value); })));

  $('search').addEventListener('input', renderList);

  $('shortcuts').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  $('export').addEventListener('click', exportSettings);
  // A file picker opened from the popup can close it, so import runs in a tab.
  $('import').addEventListener('click', () => {
    if (IN_TAB) $('import-file').click();
    else chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?tab=1') });
  });
  $('import-file').addEventListener('change', importSettings);

  digitsOnly($('unlock-pin'));
  $('unlock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await checkPin($('unlock-pin'), $('unlock-err'), $('unlock-btn'), L.unlock);
    if (res) toast('Unlocked.');
  });
}

// ---------- Render ----------

function render() {
  const paused = !settings.enabled;
  document.body.classList.toggle('paused', paused);
  $('banner').hidden = !paused;
  $('enabled').checked = settings.enabled;

  renderHero();
  renderChatParts();

  // With a chat open, the all-chats settings fold under it; otherwise they are the panel.
  $('others').classList.toggle('flat', tab.kind !== 'chat');
  if (tab.kind !== 'chat') $('others').open = true;

  const defaults = settings.defaultVisible;
  $('default-count').textContent = countText(defaults);
  $('default-items').replaceChildren(
    ...partRows('all', defaults, (part, visible) => W.setDefaultPart(part, visible)),
  );

  $('hover').checked = settings.hoverReveal;
  $('strength').value = settings.blurPx;
  setSample(settings.blurPx);

  renderList();
  renderLock();
  flash = null;
}

function renderHero() {
  const hero = $('hero');
  if (tab.kind === 'chat') {
    hero.replaceChildren(chatCard(currentKey));
    return;
  }
  const cards = {
    nochat: ['i-list', 'No chat open', 'Open a chat to set it here, or use the eye on any chat in the list.'],
    other: ['i-globe', 'Not on WhatsApp Web', 'Settings apply when you open it.', 'Open', openWhatsApp],
    disconnected: ['i-reload', 'Reload WhatsApp Web', 'The page was open before the extension loaded.', 'Reload', reloadTab],
  };
  const [iconId, title, text, action, onAction] = cards[tab.kind];
  const row = el('div', 'row');
  const ic = el('span', 'info-ic');
  ic.append(svg(iconId, 18));
  const info = el('div', 'info who');
  info.append(el('b', '', title), el('span', '', text));
  row.append(ic, info);
  if (action) {
    const btn = el('button', 'btn', action);
    btn.type = 'button';
    btn.addEventListener('click', onAction);
    row.append(btn);
  }
  hero.replaceChildren(row);
}

function chatCard(key) {
  const parts = W.partsOf(settings, key);
  const state = W.stateOf(parts);
  const own = W.hasOwn(settings, key);

  const row = el('div', 'row');
  const who = el('div', 'who');
  const name = el('div', 'cname', key);
  name.title = key;
  who.append(name, el('div', 'cmeta', own ? 'Open now · own settings' : 'Open now · follows All chats'));
  const label = state === 'blur' ? `${key} is blurred. Show the whole chat` : `${key} is ${PILL[state].text.toLowerCase()}. Blur the whole chat`;
  row.append(avatar(key), who, pill(state, { lg: true, label, onClick: () => write(W.toggleChat(key)) }));

  const sentence = el('p', 'sentence');
  sentence.append(...describeSentence(parts, state, own));
  const frag = document.createDocumentFragment();
  frag.append(row, sentence);
  return frag;
}

function describeSentence(parts, state, own) {
  const same = own ? '' : ' Same as All chats.';
  if (state === 'show') return [el('b', '', 'Shown normally.'), ` Nothing in this chat is blurred.${same}`];
  if (state === 'blur') return [el('b', '', 'Everything blurred'), own ? '.' : ', like your other chats.'];
  const d = W.describe(parts);
  const text = d.startsWith('except') ? `Shown, ${d}.` : `${capitalize(d)} visible.`;
  return [el('b', '', text), same];
}

function renderChatParts() {
  const show = tab.kind === 'chat';
  $('chat-parts').hidden = !show;
  if (!show) return;
  const parts = W.partsOf(settings, currentKey);
  $('chat-count').textContent = countText(parts);
  $('chat-items').replaceChildren(
    ...partRows('chat', parts, (part, visible) => W.setChatPart(currentKey, part, visible)),
  );
}

function renderList() {
  const query = $('search').value.trim().toLowerCase();
  const all = Object.keys(settings.chats).sort((a, b) => a.localeCompare(b));
  const shown = all.filter((key) => key.toLowerCase().includes(query));
  $('wl-count').textContent = String(all.length);
  $('search-row').hidden = all.length < 4;

  $('wl').replaceChildren(...shown.map(listItem));

  const empty = $('wl-empty');
  empty.hidden = shown.length > 0;
  empty.textContent = all.length
    ? 'No matches.'
    : 'None yet. Open a chat and click its pill, or use the eye button on a chat in WhatsApp.';
}

function listItem(key) {
  const parts = settings.chats[key];
  const state = W.stateOf(parts);
  const li = document.createElement('li');

  const row = el('div', 'item');
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-expanded', String(expandedKey === key));
  row.title = 'Show this chat\'s parts';
  const lbl = el('span', 'lbl');
  const name = el('span', 'wname', key);
  name.title = key;
  lbl.append(name, el('small', '', W.describe(parts)));
  const reset = pill(state, {
    label: `Reset ${key} to All chats settings`,
    title: 'Click to reset this chat to the All chats settings',
    onClick: () => {
      if (expandedKey === key) expandedKey = null;
      write(W.resetChat(key)).then(() => toast(`${key} now follows All chats.`));
    },
  });
  row.append(avatar(key, true), lbl, reset);

  const toggle = () => {
    expandedKey = expandedKey === key ? null : key;
    renderList();
  };
  row.addEventListener('click', toggle);
  row.addEventListener('keydown', (e) => {
    if (e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      toggle();
    }
  });
  li.append(row);

  if (expandedKey === key) {
    const sub = el('ul', 'sub');
    sub.append(...partRows(`wl:${key}`, parts, (part, visible) => W.setChatPart(key, part, visible)));
    li.append(sub);
  }
  return li;
}

// One row per part with its own Visible / Blurred pill.
function partRows(scope, parts, onToggle) {
  const vis = W.effective(parts);
  return W.PARTS.map((part) => {
    const info = W.PART_INFO[part];
    const visible = vis.includes(part);
    const blocked = part === 'media' && !parts.includes('messages');
    const row = el('li', 'item');
    if (flash === `${scope}:${part}`) {
      row.classList.add('changed');
      requestAnimationFrame(() => requestAnimationFrame(() => row.classList.remove('changed')));
    }
    const ic = el('span', 'ic');
    ic.append(svg(`i-${part}`, 14));
    const lbl = el('span', 'lbl', info.label);
    const hint = blocked ? 'blurred with messages' : info.hint;
    if (hint) lbl.append(el('small', '', hint));
    const p = pill(visible ? 'show' : 'blur', {
      disabled: blocked,
      title: blocked ? 'Photos and videos sit inside messages: make Messages visible first' : `Click to ${visible ? 'blur' : 'show'}`,
      label: `${info.label}: ${visible ? 'visible' : 'blurred'}. Click to ${visible ? 'blur' : 'show'}`,
      onClick: () => {
        flash = `${scope}:${part}`;
        write(onToggle(part, !visible));
      },
    });
    row.append(ic, lbl, p);
    return row;
  });
}

function countText(parts) {
  return `${W.effective(parts).length} of ${W.PARTS.length} visible`;
}

// ---------- App lock ----------

function renderLock() {
  const locked = L.isLocked(lockCfg, lockState);
  const wasLocked = document.body.classList.contains('locked');
  document.body.classList.toggle('locked', locked);
  $('lockview').hidden = !locked;
  $('lock-reason').textContent = locked ? L.reasonText(lockCfg, lockState) : '';
  if (locked && !wasLocked) {
    $('unlock-pin').value = '';
    $('unlock-err').textContent = '';
    L.waitSeconds().then((w) => countdown(w, $('unlock-pin'), $('unlock-err'), $('unlock-btn')));
    requestAnimationFrame(() => $('unlock-pin').focus());
  }
  if (!locked && lockMode !== null && !lockCfg.enabled && lockMode !== 'setup') lockMode = null;
  renderLockBox();
}

function renderLockBox() {
  $('lock-status').textContent = lockCfg.enabled ? 'On' : 'Off';
  const { pin, ...options } = lockCfg;
  const key = `${lockMode}|${JSON.stringify(options)}`;
  if (key === lockBoxKey) return;
  lockBoxKey = key;

  const box = $('lockbox');
  if (lockMode === 'setup' || lockMode === 'newpin') box.replaceChildren(...pinSetupForm(lockMode));
  else if (lockMode === 'verify') box.replaceChildren(verifyForm());
  else if (lockMode === 'edit' && lockCfg.enabled) box.replaceChildren(editCard());
  else if (lockCfg.enabled) box.replaceChildren(summaryCard());
  else box.replaceChildren(offCard());
}

function setLockMode(mode) {
  lockMode = mode;
  renderLockBox();
  const first = $('lockbox').querySelector('input.pin');
  if (first) first.focus();
}

function offCard() {
  const card = el('div', 'lockcard');
  card.append(optRow('Off', 'Lock WhatsApp Web with a PIN', button('Set up', 'btn sm', () => setLockMode('setup'))));
  return card;
}

function summaryCard() {
  const m = lockCfg.delayMin;
  const extras = [lockCfg.onStartup && 'when the browser starts', lockCfg.onLeave && 'when you leave the tab'].filter(Boolean);
  const card = el('div', 'lockcard');
  const lockNow = button('', 'btn sm', () => L.lock('manual'));
  lockNow.title = 'Lock WhatsApp now (Alt+L)';
  lockNow.append(svg('i-lock', 12), 'Lock now');
  const ctrls = el('span', 'ctrls');
  ctrls.append(lockNow, button('Change', 'btn ghost sm', () => setLockMode('verify')));
  card.append(optRow(
    `Locks after ${m} minute${m === 1 ? '' : 's'}`,
    extras.length ? `and ${extras.join(' and ')}` : 'without activity',
    ctrls,
  ));
  return card;
}

// Changing app lock settings needs the PIN, so an unlocked computer can't simply switch it off.
function verifyForm() {
  const card = el('form', 'lockcard');
  const input = pinInput('Current PIN');
  const err = el('p', 'err');
  const ok = button('Continue', 'btn', null, 'submit');
  card.append(field('Enter your PIN to change app lock', input), err, actions(button('Cancel', 'btn ghost', () => setLockMode(null)), ok));
  card.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await checkPin(input, err, ok, L.verify)) setLockMode('edit');
  });
  return card;
}

function pinSetupForm(mode) {
  const card = el('form', 'lockcard');
  const a = pinInput(mode === 'setup' ? 'Choose a PIN' : 'New PIN');
  const b = pinInput('Type it again');
  const err = el('p', 'err');
  const ok = button(mode === 'setup' ? 'Turn on app lock' : 'Save PIN', 'btn', null, 'submit');
  card.append(
    field(mode === 'setup' ? 'Choose a PIN' : 'New PIN', a),
    el('p', 'hint', '4 to 8 digits'),
    field('Type it again', b),
    err,
    actions(button('Cancel', 'btn ghost', () => setLockMode(mode === 'setup' ? null : 'edit')), ok),
  );
  card.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!L.validPin(a.value)) { err.textContent = 'The PIN must be 4 to 8 digits.'; a.focus(); return; }
    if (a.value !== b.value) { err.textContent = "The two PINs don't match."; b.value = ''; b.focus(); return; }
    ok.disabled = true;
    try {
      await L.enable(a.value);
      toast(mode === 'setup' ? 'App lock is on.' : 'PIN changed.');
      setLockMode(mode === 'setup' ? null : 'edit');
    } catch (ex) {
      err.textContent = `Couldn't save: ${ex.message}`;
      ok.disabled = false;
    }
  });
  const nodes = [card];
  if (mode === 'setup') {
    nodes.push(el('p', 'lock-note', 'If you forget the PIN, the only way back in is to remove WA Privacy and add it again, which also clears your chat settings.'));
  }
  return nodes;
}

function editCard() {
  const card = el('div', 'lockcard');

  const on = switchInput(true, async (input) => {
    if (input.checked) return;
    await L.disable();
    lockMode = null;
    toast('App lock is off.');
  });

  const delay = document.createElement('select');
  delay.className = 'sel';
  delay.setAttribute('aria-label', 'Lock after');
  for (const m of L.DELAYS) delay.add(new Option(`${m} minute${m === 1 ? '' : 's'}`, String(m), false, m === lockCfg.delayMin));
  delay.addEventListener('change', async () => {
    await L.setConfig({ delayMin: Number(delay.value) });
    await L.markActive(); // a shorter delay shouldn't lock you out the moment you pick it
  });

  card.append(
    optRow('App lock', 'PIN needed to open WhatsApp', on),
    optRow('Lock after', 'no clicks or typing in WhatsApp', delay),
    optRow('Lock when the browser starts', '', switchInput(lockCfg.onStartup, (i) => L.setConfig({ onStartup: i.checked }))),
    optRow('Lock when I leave the tab', 'switching tabs or minimising', switchInput(lockCfg.onLeave, (i) => L.setConfig({ onLeave: i.checked }))),
    optRow('PIN', '', button('Change', 'btn ghost', () => setLockMode('newpin'))),
  );
  card.append(actions(button('Done', 'btn', () => setLockMode(null))));
  return card;
}

// Verify a PIN from `input`, showing errors and the wrong-PIN countdown. Returns true on success.
async function checkPin(input, err, btn, fn) {
  const pin = input.value.trim();
  if (!pin) return false;
  btn.disabled = true;
  err.textContent = '';
  const res = await fn(pin);
  btn.disabled = false;
  if (res.ok) return true;
  input.value = '';
  if (res.wait) countdown(res.wait, input, err, btn);
  else err.textContent = `Wrong PIN. ${res.left} ${res.left === 1 ? 'try' : 'tries'} left.`;
  input.focus();
  return false;
}

const countdowns = new WeakMap();
function countdown(seconds, input, err, btn) {
  clearInterval(countdowns.get(input));
  if (!seconds) return;
  let left = seconds;
  const tick = () => {
    if (left <= 0) {
      clearInterval(countdowns.get(input));
      input.disabled = btn.disabled = false;
      err.textContent = '';
      return;
    }
    input.disabled = btn.disabled = true;
    err.textContent = `Too many wrong tries. Try again in ${left}s.`;
    left -= 1;
  };
  tick();
  countdowns.set(input, setInterval(tick, 1000));
}

function pinInput(label) {
  const i = document.createElement('input');
  Object.assign(i, { type: 'password', className: 'pin', maxLength: 8, autocomplete: 'off', placeholder: '••••' });
  i.inputMode = 'numeric';
  i.setAttribute('aria-label', label);
  digitsOnly(i);
  return i;
}

function digitsOnly(input) {
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 8); });
}

function field(label, input) {
  const f = el('div', 'field');
  const l = el('label', '', label);
  input.id = input.id || `pin-${Math.random().toString(36).slice(2)}`;
  l.htmlFor = input.id;
  f.append(l, input);
  return f;
}

function actions(...buttons) {
  const a = el('div', 'actions');
  a.append(...buttons);
  return a;
}

function optRow(title, sub, control) {
  const row = el('div', 'opt');
  const lbl = el('span', 'lbl', title);
  if (sub) lbl.append(el('small', '', sub));
  row.append(lbl, control);
  return row;
}

function switchInput(checked, onChange) {
  const wrap = el('label', 'switch sm');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.checked = checked;
  input.addEventListener('change', () => onChange(input));
  wrap.append(input, el('span'));
  return wrap;
}

function button(text, cls, onClick, type = 'button') {
  const b = el('button', cls, text);
  b.type = type;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

// ---------- Small DOM helpers ----------

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function svg(id, size) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  s.append(use);
  return s;
}

function pill(state, { lg = false, label, title, disabled = false, onClick }) {
  const cfg = PILL[state];
  const b = el('button', `pill ${cfg.cls}${lg ? ' lg' : ''}`);
  b.type = 'button';
  b.disabled = disabled;
  if (title) b.title = title;
  if (label) b.setAttribute('aria-label', label);
  b.append(svg(cfg.icon, lg ? 14 : 12), cfg.text);
  if (onClick) {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
  }
  return b;
}

function avatar(name, small) {
  const a = el('span', `av${small ? ' sm' : ''}`, initials(name));
  a.style.background = colorFor(name);
  a.setAttribute('aria-hidden', 'true');
  return a;
}

function initials(name) {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '#';
  return (words[0][0] + (words[1] ? words[1][0] : '')).toUpperCase();
}

function colorFor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function setSample(px) {
  $('sample').style.filter = `blur(${(px / 3).toFixed(1)}px)`;
}

// ---------- Actions ----------

async function openWhatsApp() {
  const [existing] = await chrome.tabs.query({ url: `${WA_URL}*` });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: WA_URL });
  }
  window.close();
}

function reloadTab() {
  chrome.tabs.reload(tab.id);
  window.close();
}

function exportSettings() {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'wa-privacy-settings.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Imported options replace the current ones; imported chats are merged in.
async function importSettings(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const incoming = W.normalize(JSON.parse(await file.text()));
    const added = Object.keys(incoming.chats).filter((k) => !W.hasOwn(settings, k)).length;
    await W.update((s) => {
      Object.assign(s, W.normalize({ ...s, ...incoming, chats: { ...s.chats, ...incoming.chats } }));
    });
    toast(`Imported. ${added} chat${added === 1 ? '' : 's'} added.`);
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  }
}

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}
