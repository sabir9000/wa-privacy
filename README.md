# WA Privacy

Blurs WhatsApp Web by default. Choose, per chat, which parts you want to see.

## Install
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this `wa-privacy` folder.

Open WhatsApp Web tabs start blurring straight away: on install and on every update the
extension activates itself in tabs that are already open (`scripting` permission), so no
page reload is needed. If that ever fails, the popup shows a **Reload WhatsApp Web** button.

## The five parts
Chat name · Profile photo · Last message · Messages · Photos & videos.
Each is **Visible** or **Blurred**. A chat is **Visible** (all parts), **Partly**, or **Blurred** (none).
Photos and videos sit inside messages, so they are blurred whenever messages are.

## Controls (all share the same settings)
- **Popup**: with a chat open, a big pill for the whole chat plus one pill per part.
  Settings for all other chats fold underneath. With no chat open, those settings
  (All chats, hover reveal, blur strength, chats you made visible) are the panel.
- **Eye buttons** in the chat header and on each chat-list row cycle
  **Blurred → Name & photo → Visible → Blurred**. `Alt+W` does the same for the open chat.
  (A custom Partly mix set in the popup moves on to Visible.)

`Alt+B` pauses / resumes blurring everywhere (badge shows **OFF**). Change shortcuts at
`chrome://extensions/shortcuts`.

**Which setting wins:** a chat you never set follows **All chats**; a chat you set keeps its own parts.

## App lock
Top of the popup → **Set up** → choose a 4–8 digit PIN. WhatsApp Web is then covered by a
PIN screen (and blurred underneath):
- after 1 / 5 / 15 / 30 / 60 minutes without clicks, typing or scrolling in WhatsApp (default 5),
- when the browser starts (default on),
- when you leave the tab (default off),
- right away with **Lock now** or `Alt+L`.

All WhatsApp tabs and the popup lock and unlock together. Changing app lock settings asks
for the PIN. After 5 wrong PINs you wait 30 seconds. Only a salted PBKDF2 hash of the PIN
is stored, in `chrome.storage.local` (this computer only, never synced).
Forgot the PIN? Remove the extension and add it again (this also clears chat settings).

It stops casual snooping, not a determined person: anyone who can open Chrome's developer
tools or turn the extension off can get past it, and WhatsApp's desktop notifications still
show while locked.

## When WhatsApp updates break it
All DOM hooks are in `content/selectors.js`. Inspect the page, update the selector, and
reload the extension.

## Limits
- Chats are matched by display name, so two chats with the same name share settings.
- Blur is visual only (against shoulder-surfing). Desktop notifications and the
  contact-info side panel are not blurred.
- Settings live in `chrome.storage.sync` (about 8 KB, a few hundred chats).
