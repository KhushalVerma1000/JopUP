# Patch: data import 7 — every file "Skipped (502)" in production

Apply after patches 5 and 6 (it touches one file those do not).

## What happened
In production every spreadsheet showed **Skipped · Request failed (502)**; the same files worked in development.

## Cause
`reader.js` looped over each row and, for every cell, read `ws.columnCount` from ExcelJS. That getter rescans the whole sheet each
time it is read, so reading a tab cost roughly *rows × columns × rows*. Measured here, before the fix:

| file | size | read time |
|------|------|-----------|
| 8-tab client tracker | 135 KB | **13.2 s** |
| 1-tab daily tracker (14 real rows, 999 formatted rows) | 77 KB | **15.8 s** |
| small 3-tab file | 11 KB | 0.3 s |

On a fast development machine that is a pause. On the hosted server (Render free plan, a fraction of a CPU) it is minutes, so the
request outlived the proxy's timeout and the browser got a 502. Small files squeaked through, which is why it looked like "every file".

## Fix
The column count is read once per tab. Same rows come back (analysis results on the three real files are unchanged).
After: **0.65 s**, **0.38 s**, **0.1 s**.

## Tests
- New `test/dataImport.reader.test.js`: a 3,000-row × 25-column tab must read in under 8 s with every cell intact, and 1,000 formatted-but-empty
  rows must neither slow the read nor add candidates. **Both tests fail without the fix and pass with it.**
- Whole backend suite: 341 pass, 0 fail, 43 skipped (live-only).

## Not confirmed
I have not seen the production logs. This is the cause I could reproduce and measure, and it matches the symptom, but if files still 502 after
deploying, the Render log lines around the upload (an "out of memory" event, or a crash) are what to look at next. After a period of
inactivity the free plan also needs about a minute to wake; the first request after that can fail with a 502 whatever the code does.

## Files
backend: `src/features/data-import/reader.js`, `test/dataImport.reader.test.js` (new). No migration, no frontend change.
