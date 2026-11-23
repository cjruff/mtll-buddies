# MTLL Challenger Buddies — Sign-up page

Buddy sign-ups for the MTLL Challenger Division.
Code © Corey J. Ruff

## How it fits together

| Piece | Where it lives | What it does |
|---|---|---|
| The page (`index.html`, `logo.png`, `mascot.png`, `icons/`, `manifest.webmanifest`) | This GitHub repo, published with GitHub Pages | What volunteers see and use to sign up, change or cancel |
| The back end (`apps-script/Code.gs`, `apps-script/Admin.gs`) | Google Apps Script, attached to the "MTLL Buddies" Google Sheet | Saves sign-ups, sends confirmations, reminders and broadcasts |
| Dates, slots, wording, settings | The Google Sheet (`Slots`, `Settings` tabs) | **Most season-to-season changes happen here. No code needed.** |

The page talks to the back end through the Apps Script `/exec` link (`API_URL` in `index.html`).

## Everyday coordinator work (no code)

Everything runs from the Sheet's **Buddies** menu: add game dates, send broadcasts (email and text), turn reminders on or off.
To change the page title, description, contact info or open/close sign-ups, edit the **Settings** tab.

## Changing the code

**Look and layout of the page** → edit `index.html` in this repo (the pencil icon on GitHub works). Commit, and the site updates in a minute or two.

**Saving, emails, reminders, texting** (rare) → edit `apps-script/*.gs` here, paste into the Apps Script editor, then
**Deploy → Manage deployments → pencil → Version: New version → Deploy**.
Never use *New deployment* for updates. That creates a new `/exec` link, and `API_URL` in `index.html` would need updating to match.

## Handing this off

- Transfer this repo and the Google Sheet (with its script) to the next coordinator.
- If the Sheet moves to a new Google account, redeploy from that account, update `API_URL` in `index.html` to the new `/exec` link, and set **Settings → Web App URL**.
- Texting uses Twilio keys stored in **Apps Script → Project Settings → Script Properties** (`TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`). They are not in this repo, and should never be added to it.
