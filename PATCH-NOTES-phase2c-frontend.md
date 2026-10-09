# Patch: Phase 2C (frontend) — template picker, per-send columns, Excel-style tracker mail

Needs jopup-phase2c-templates.zip (backend) applied first and `npm run db:seed` re-run. Full files, extract with -Force. No migration.

## New (frontend/src/)
- components/hr/TrackerMailSheet.jsx      HR: pick a template, change columns for this send only, see the table as the client will, copy
- components/mail/ColumnPicker.jsx        choose + order columns (shared); managers can also rename headings
- components/managerial/TemplatesTab.jsx  Managerial → "Tracker templates": list, create, edit, delete, preselect default
- lib/richCopy.js                         copies a formatted table (pastes as a real table in Outlook/Gmail), text fallback

## Changed
- pages/HrPage.jsx         "Email tracker (n)" button in the filter row: the selected candidates while selecting, else everyone on screen
- pages/ManagerialPage.jsx new "Tracker templates" tab

## Behaviour
- Three copies: Copy table (formatted), Copy for Excel (cells), Copy as text. Subject is editable.
- One mail per client; several clients on screen show a client chip per mail.
- Per-send column changes are never saved to the template. Button only shows for roles with tracker_templates:read.
- Org-wide templates only for org admins; managers must pick a team.

## Checked / not checked
- vite build passes; oxlint 0 errors (warnings are the existing set-state-in-effect pattern).
- Not tried in a browser or phone, and not against a live backend. Rich "Copy table" needs https or localhost; otherwise it falls back to text.
