# Patch: Phase 2D — client profiles (locations, contacts) and the full tracker-mail workflow

Needs main at 0aa90bf or later. Full files, extract with -Force.
Run the migration: `npm run db:migrate` (0005_client_mail_profiles). No re-seed needed: it uses the existing clients:* and trackers:* permissions.

## What it does
Follows the approved design: client profile, then the five-step mail flow.
1. HR selects candidates. 2. Email tracker: To, CC and template fill in from the client's profile.
3. Review, toggle columns for this send only. 4. Copy table, paste in Outlook/Gmail.
5. Mark as sent: logged against the client (sent history). Automatic status changes are Phase 2E.

## Backend
- New tables: client_location (name, aliases, tracker template), client_mail_log (one row per "mark as sent").
- client_spoc gains location_id (null = client-wide contact) and mail_role (to | cc). Existing contacts become client-wide "To".
- Clients API: GET /clients/:id/mail-profile, GET /clients/:id/mail-log, locations and contacts CRUD (clients:write = manager / org admin).
- features/mail/locationMatch.js: exact match on name/alias, then whole-word containment ("Aligarh UP" fits "Aligarh"). If two locations claim a candidate it counts as unmatched, never a guess.
- POST /mail/compose (type tracker): now one mail per (client, location). Each message carries to, cc, locationName, templateName, trackerIds, locationUnmatched.
  Columns: per-send toggles, else chosen template, else the location's template, else the default template, else standard.
  Omit templateId for Auto.
- POST /mail/sent (trackers:write): re-checks tenant, team and single-client rules, then logs it.
- A mail to one client still can never contain another client's candidates (clientScope.js unchanged; grouping is client-first).

## Frontend
- /clients/:id client profile: Overview, Locations & Contacts (aliases, To/CC pills, template, "how a mail finds its contact", unmatched-location warning), Mail settings (template per location), Sent history.
- Company names in the Clients list link to the profile.
- TrackerMailSheet: Auto template by default, To/CC with copy buttons, unmatched/no-contact warnings linking to the profile, Mark as sent.

## Checked / not checked
- Backend: npm test 156 pass, 19 skipped (need a database), 0 fail. New tests: test/mail.profiles.test.js.
- Frontend: vite build passes, oxlint 0 errors.
- NOT run against a live Postgres: the migration, the queries and the end-to-end mail flow are untested. Please run the migration and try one mail before relying on it.
- Not tried in a browser or on a phone.
- The design's "Fix Locations…" opens the client profile; there is no one-tap fix of a single candidate's spelling yet.
- Contacts are only editable by managers/org admins; HR sees them read-only.
