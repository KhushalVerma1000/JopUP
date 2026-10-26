# PATCH: compose links (Phase A of IMPLEMENTATION-email-send.md)

Applies on top of `main` @ `c6b8a05`. Frontend only. No backend, no migration.

## What it does
One click on the Email Tracker (desktop page and phone sheet) copies the formatted table
to the clipboard (`text/html` + `text/plain`) and opens a prefilled compose window in the
user's own Gmail / Outlook / desktop mail app: To, Cc, Subject and a short greeting and sign-off.
The user pastes the table and sends. "Mark as Sent" is unchanged and is highlighted after the click.

## Files
- NEW `frontend/src/lib/composeLinks.js`: URL builder (gmail, outlook_work, outlook_personal, mailto), body builder
- NEW `frontend/src/lib/composeLinks.test.js`: 11 tests (`npm test` in `frontend/`)
- NEW `frontend/src/hooks/useMailProvider.js`: remembered provider per user, default `gmail`
- NEW `frontend/src/components/mail/OpenInMail.jsx`: button, provider picker, "what happened / what next" note
- CHANGED `frontend/src/hooks/useTrackerMail.js`: `openInMail`, `provider`, `opened`
- CHANGED `frontend/src/pages/EmailTrackerPage.jsx`, `frontend/src/components/hr/TrackerMailSheet.jsx`
- CHANGED `frontend/package.json`: `test` script

## Differences from the plan (decide if you want them changed)
1. **Provider preference is stored in the browser (localStorage, per user), not in a `users` column.**
   The plan said "no backend change in this phase" and also "new column"; those conflict. This avoids a
   migration and a drizzle snapshot now. It does not follow the user to another device.
   Moving it to a column later only touches `useMailProvider.js` plus the profile endpoint.
2. **The picker sits next to the button on the tracker**, not in Settings. Settings (ManagerialPage) is
   manager/org_admin only, and HR is who sends these mails.
3. Copy Table is now a secondary button; Open in Gmail/Outlook is the primary one.

## Fallbacks
- No `ClipboardItem` / insecure context: plain text is copied instead (existing `copyRich` behaviour).
- Copy fails: the note tells the user to tap Copy Table.
- Popup blocked: a visible "Open the email" link appears.
- URL over 1,900 chars: the body is shortened; recipients and subject are never cut.

## Tested here
- 11 unit tests pass; `vite build` passes; lint adds no errors.
- NOT tested: actually opening Gmail / Outlook / mailto and pasting. See checklist.

## Manual checklist (you)
- [ ] Gmail, Outlook work, Outlook personal, mailto: each opens with To, Cc, Subject filled
- [ ] Paste gives a formatted table (Gmail, Outlook web)
- [ ] Where does the cursor land in the body? The blank gap between greeting and sign-off is for the
      table; if the cursor lands at the end, shorten the body to the greeting only (`buildBody`)
- [ ] Popup blocker on: the fallback link shows
- [ ] Phone: Gmail / Outlook app behaviour on tap
- [ ] Signed in to several Google accounts: it opens in the default one (account hint not wired: untested)

## Apply (PowerShell, from the repo root)
```powershell
Expand-Archive -Path .\jopup-compose-links.zip -DestinationPath . -Force
cd frontend; npm test; npm run build
```

## Note for Phase B
The plan's migration `0008_mail_oauth.sql` stays 0008, since this patch adds no migration.
