# WA Privacy – Privacy Policy

_Last updated: 8 October 2026_

WA Privacy is a Chrome extension that blurs content on WhatsApp Web (web.whatsapp.com) so people
looking at your screen can't read it, with per-chat visibility settings and an optional PIN lock.

**WA Privacy does not send any data to the developer or to any third party. There are no servers,
no analytics, no ads and no tracking.** Everything described below stays in your browser.

## What the extension handles

| Data | Why | Where it is kept |
|---|---|---|
| **Chat names** shown on WhatsApp Web | To remember which chats you chose to show, and which parts of them | `chrome.storage.sync` (your Chrome profile; synced by Chrome to your other devices if you use Chrome Sync) |
| **Your settings** (what is blurred by default, blur strength, hover reveal, pause) | To apply your preferences | `chrome.storage.sync` |
| **App lock PIN** | To unlock WhatsApp Web | Only a salted PBKDF2-SHA-256 hash is stored, in `chrome.storage.local` on this computer. The PIN itself is never stored and is never synced. |
| **Last activity time** (a timestamp of your last click, key press, scroll or mouse movement on WhatsApp Web) | To lock WhatsApp Web after the inactivity delay you choose | `chrome.storage.local` on this computer. Only the time is kept, not what you clicked or typed. |
| **Page content on WhatsApp Web** (names, photos, previews, messages, media) | Read in the page only to apply the blur. It is **not** stored, copied or sent anywhere. | Not stored |

The extension does not read, store or transmit the text of your messages, your contacts' phone
numbers, or any data from websites other than web.whatsapp.com.

## Permissions

- **storage** – saves the settings, chat choices and app-lock data described above.
- **scripting** – activates the extension in WhatsApp Web tabs that were already open when it was
  installed or updated, so they are protected without a reload.
- **Access to https://web.whatsapp.com/** – needed to blur WhatsApp Web and show the lock screen.
  The extension does not run on any other website.

## Sharing and selling

We do not sell, share or transfer any user data. No data is used for advertising, profiling,
credit-worthiness or any purpose other than the extension's single purpose described above.

## Your control

- Change or remove any chat's settings at any time from the extension's popup.
- Export or import your settings from the popup.
- Removing the extension from Chrome deletes all of its stored data (settings, chat choices,
  PIN hash and activity timestamp).

## Changes

If this policy changes, the updated version will be published at this address with a new date.

## Contact

Questions or concerns: open an issue at https://github.com/sabir9000/wa-privacy/issues

WA Privacy is not affiliated with, endorsed by, or sponsored by WhatsApp or Meta.
