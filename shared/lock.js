// App lock, shared by the content script, popup and service worker.
// Everything lives in chrome.storage.local: it stays on this computer (never
// synced) and content scripts can read it without extra permissions.
//
//   'lock'       { enabled, delayMin, onStartup, onLeave, pin: { salt, hash, iter } }
//                The PIN itself is never stored, only a salted PBKDF2 hash.
//   'lockState'  { locked, lastActive, reason }   shared by all WhatsApp tabs
//   'lockTries'  { count, until }                 wrong-PIN back-off
//
// Browser start: the service worker locks (or, with onStartup off, unlocks) on
// chrome.runtime.onStartup. If WhatsApp loads before that runs, lastActive is
// from the previous session and has normally expired, so it is locked anyway.
(() => {
  const CFG = 'lock';
  const STATE = 'lockState';
  const TRIES = 'lockTries';
  const DELAYS = [1, 5, 15, 30, 60];
  const MAX_TRIES = 5;
  const BACKOFF_MS = 30_000;
  const ITERATIONS = 150_000;

  function defaults() {
    return { enabled: false, delayMin: 5, onStartup: true, onLeave: false, pin: null };
  }

  function normalizeConfig(raw) {
    const c = defaults();
    if (!raw || typeof raw !== 'object') return c;
    if (typeof raw.onStartup === 'boolean') c.onStartup = raw.onStartup;
    if (typeof raw.onLeave === 'boolean') c.onLeave = raw.onLeave;
    if (DELAYS.includes(raw.delayMin)) c.delayMin = raw.delayMin;
    const pin = raw.pin;
    if (pin && typeof pin.salt === 'string' && typeof pin.hash === 'string' && Number.isFinite(pin.iter)) c.pin = pin;
    c.enabled = raw.enabled === true && !!c.pin;
    return c;
  }

  async function getConfig() {
    return normalizeConfig((await chrome.storage.local.get(CFG))[CFG]);
  }

  async function setConfig(patch) {
    const c = { ...(await getConfig()), ...patch };
    await chrome.storage.local.set({ [CFG]: c });
    return normalizeConfig(c);
  }

  async function getState() {
    return (await chrome.storage.local.get(STATE))[STATE] || null;
  }

  function setState(state) {
    return chrome.storage.local.set({ [STATE]: state });
  }

  // Should WhatsApp be locked right now?
  function isLocked(cfg, state, now = Date.now()) {
    if (!cfg.enabled) return false;
    if (!state) return cfg.onStartup;
    if (state.locked) return true;
    return now - state.lastActive >= cfg.delayMin * 60_000;
  }

  // Why it is locked, for the lock screen's subtitle.
  function reasonText(cfg, state) {
    const reason = state ? state.reason : 'startup';
    if (reason === 'startup') return 'Locked when the browser started';
    if (reason === 'leave') return 'Locked when you left the tab';
    if (reason === 'manual') return 'Locked with “Lock now”';
    const m = cfg.delayMin;
    return `Locked after ${m} minute${m === 1 ? '' : 's'} without activity`;
  }

  function lock(reason) {
    return setState({ locked: true, lastActive: Date.now(), reason });
  }

  function markActive() {
    return setState({ locked: false, lastActive: Date.now(), reason: null });
  }

  // ---------- PIN ----------

  const PIN_RE = /^\d{4,8}$/;

  function validPin(pin) {
    return PIN_RE.test(pin);
  }

  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  async function derive(pin, salt, iter) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  }

  async function makePin(pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return { salt: toB64(salt), hash: toB64(await derive(pin, salt, ITERATIONS)), iter: ITERATIONS };
  }

  // Turn the lock on (or change the PIN). Counts as activity so it doesn't lock straight away.
  async function enable(pin) {
    if (!validPin(pin)) throw new Error('PIN must be 4 to 8 digits');
    await setConfig({ enabled: true, pin: await makePin(pin) });
    await markActive();
  }

  async function disable() {
    await setConfig({ enabled: false, pin: null });
  }

  // Seconds until another try is allowed (0 = now).
  async function waitSeconds() {
    const t = (await chrome.storage.local.get(TRIES))[TRIES];
    return t && t.until > Date.now() ? Math.ceil((t.until - Date.now()) / 1000) : 0;
  }

  // { ok: true } | { ok: false, wait: seconds } | { ok: false, left: tries before back-off }
  async function verify(pin) {
    const wait = await waitSeconds();
    if (wait) return { ok: false, wait };
    const cfg = await getConfig();
    if (!cfg.pin) return { ok: true };
    const actual = toB64(await derive(String(pin), fromB64(cfg.pin.salt), cfg.pin.iter));
    if (actual === cfg.pin.hash) {
      await chrome.storage.local.remove(TRIES);
      return { ok: true };
    }
    const t = (await chrome.storage.local.get(TRIES))[TRIES] || { count: 0, until: 0 };
    const count = t.count + 1;
    if (count >= MAX_TRIES) {
      await chrome.storage.local.set({ [TRIES]: { count: 0, until: Date.now() + BACKOFF_MS } });
      return { ok: false, wait: BACKOFF_MS / 1000 };
    }
    await chrome.storage.local.set({ [TRIES]: { count, until: 0 } });
    return { ok: false, left: MAX_TRIES - count };
  }

  async function unlock(pin) {
    const res = await verify(pin);
    if (res.ok) await markActive();
    return res;
  }

  globalThis.WAP_LOCK = {
    CFG, STATE, TRIES, DELAYS,
    defaults, normalizeConfig, getConfig, setConfig, getState,
    isLocked, reasonText, lock, markActive,
    validPin, enable, disable, verify, unlock, waitSeconds,
  };
})();
