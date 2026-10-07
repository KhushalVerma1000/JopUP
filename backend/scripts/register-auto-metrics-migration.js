/**
 * Adds 0003_auto_metrics to drizzle's migration journal with the NEXT free
 * index, so it works whatever migrations your copy of the repo already has
 * (e.g. a local 0003 that isn't on GitHub). Safe to run twice.
 *
 *   node scripts/register-auto-metrics-migration.js
 *   npm run db:migrate
 */
const fs = require('fs');
const path = require('path');

const TAG = '0003_auto_metrics';
const dir = path.join(__dirname, '..', 'drizzle', 'migrations');
const journalPath = path.join(dir, 'meta', '_journal.json');

if (!fs.existsSync(path.join(dir, `${TAG}.sql`))) { console.error(`Missing ${TAG}.sql in drizzle/migrations — extract the patch first.`); process.exit(1); }
const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
if (journal.entries.some((e) => e.tag === TAG)) { console.log(`${TAG} is already registered (idx ${journal.entries.find((e) => e.tag === TAG).idx}).`); process.exit(0); }

// drizzle applies a migration only if its `when` is newer than the last one applied.
const last = Math.max(0, ...journal.entries.map((e) => e.when));
const entry = { idx: journal.entries.length, version: journal.version || '7', when: Math.max(last + 1, 1791278752943), tag: TAG, breakpoints: true };
journal.entries.push(entry);
fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
console.log(`Registered ${TAG} as migration #${entry.idx}. Now run: npm run db:migrate`);
