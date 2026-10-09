# Patch: Phase 2C (backend) — column catalogue, tracker templates, Excel-style tracker mail

Applies on top of GitHub main 5ef1074. Full files, extract with -Force. **No migration** (uses the existing `tracker_template` table).
After extracting, re-run `npm run db:seed` so the new permission key reaches the system roles.

## New (backend/)
- src/features/mail/columns.js              the column catalogue (18 columns + free `cf:<name>` candidate custom fields)
- src/features/mail/templates.{schema,service,controller}.js   tracker template CRUD
- src/services/email/templates/trackerTable.js   bordered Excel-style HTML table + aligned text + TSV (paste into Excel)
- test/mail.tracker.test.js                 6 tests, no DB needed

## Changed
- src/features/mail/mail.routes.js          GET /mail/columns, GET|POST /mail/templates, GET|PATCH|DELETE /mail/templates/:id
- src/features/mail/mail.schema.js          compose type `tracker`, optional templateId, optional per-send columns
- src/features/mail/mail.service.js         `_tracker`: one mail per client, columns = this send's toggles > template > defaults
- src/seed.ts                               new permission key `tracker_templates` (org_admin, manager: read+write; hr: read)

## Behaviour
- Manager defines templates (org-wide needs org_admin; a manager can only write for their own team). HR can read them and
  toggle columns on a single send; that toggle is never saved back to the template.
- A mail never mixes clients: candidates are grouped by client, and when the caller names `clientId` any outsider is refused.
- Turn up is worded "Reached" in the Status column. Empty dates show an empty cell, not "Invalid Date".
- Every cell is HTML-escaped; tabs/newlines inside a cell can't break the TSV.
- Deleting a template that already produced a tracker is refused (clear message) rather than failing with a raw FK error.

## Checked / not checked
- Full suite: 151 pass, 0 fail (incl. 6 new). Template/compose routes are covered for auth, schemas, rendering and escaping.
- NOT run against a live database: template create/update/delete, default-switching, and `compose type=tracker` end to end.
  Please create one template as a manager and send one tracker compose from demo data.
- No frontend yet (template picker, column toggles, rendered table in the compose sheet) — that is 2C part 2.

## Next
2C frontend → 2D client + location mail profiles (location aliases, contacts tied to locations) → 2E automation rules.
