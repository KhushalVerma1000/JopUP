# Bulk candidate create in batches

Problem: POST /api/v1/resume-parser/bulk-create failed with 413 PayloadTooLargeError
(114592 bytes vs the 102400 default). Every draft carries its parsed resume text, so
a few dozen candidates exceeded the global express.json() limit.

Changes
- backend/src/app.js: bulk-create gets a 10mb JSON limit (registered before the global parser). All other routes keep 100kb.
- backend/src/middlewares/errorHandler.js: body-parser errors now return 413 / 400 instead of a 500 "Unhandled Error".
- frontend ResumeImportSheet.jsx: candidates are created in batches of 20, with "Saving X of Y" progress. A failed batch is marked on its rows and the other batches still save; "Back to review" retries the rest.
- backend/test/resumeParser.test.js: two new tests (large bulk-create body accepted; large body elsewhere still 413).

Server cap stays at 100 items per request; the UI sends 20 at a time.
Docker: the backend needs a restart to pick up app.js (or your auto-reload compose).
