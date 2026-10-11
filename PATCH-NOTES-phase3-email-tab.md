# Phase 3: Email Tracker tab, mail types, hiring locations, page cleanup

Applies on top of main at e4e8cfc.

## What changed
1. **Hiring locations, not stores.** Client locations are now worded as places the client wants to hire in (client profile, forms, schema comments). No data change.
2. **Email Tracker tab** (`/email-tracker`, in the sidebar and phone "More"). Pick what you are sending, then Client → Hiring location → Date. Each step only offers what exists for the step before; a lone client/location/nearest day is preselected. The workbench's Email Tracker button still works (`/email-tracker?from=hr`); the old `/hr/email-tracker` URL redirects there. The choice lives in the URL, so refresh and Back keep your place.
3. **Mail types registry** (`backend/src/features/mail/types.js`): Lineup, Interview schedule, Profiles submitted, Status update, Offers, Joinings. Each declares its picker steps, which candidates it covers, default columns and wording. A new kind of mail is a new entry here.
4. **Mistake-proofing.** Ready-to-send checks (no recipient, candidates matching no hiring location, missing dates, missing mobiles, each with a fix link), an "already sent" warning (same type, client, location, overlapping candidates, last 7 days), and the client id is passed to compose so a client mail can never include another client's candidates.
5. **Old pages** (Employees, Clients, Settings, Dashboard) moved to `PageHeader` + wide layout; Settings tabs are now `Chips`. Unrouted `HrClassicPage.jsx` deleted.

## API
- `GET /api/v1/mail/types`
- `GET /api/v1/mail/options?type=&clientId=&locationId=&date=` (`locationId` may be `all` or `other`)
- `POST /api/v1/mail/compose` accepts `mailType`; each message gains `checks`, `alreadySent`, `mailType`
- `POST /api/v1/mail/sent` accepts `mailType`

## Migration
`0006_mail_log_type`: adds nullable `client_mail_log.mail_type`. Run `npm run db:migrate` (Docker: restart the backend).

## Apply (PowerShell, repo root)
    Expand-Archive jopup-phase3-email-tab.zip -DestinationPath . -Force
    Remove-Item frontend/src/pages/HrClassicPage.jsx

## Tests
New `backend/test/mail.types.test.js` (11 tests). Full backend suite: 167 pass, 0 fail (live-DB tests skip without a database). Frontend builds. The new screens were not exercised in a browser against a live database.
