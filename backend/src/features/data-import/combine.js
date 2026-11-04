/**
 * Several files, one import. Pure helpers (no database) so they are easy to test.
 *
 * Sheet names are the join key for row decisions ("Sheet:row"), so when more than one
 * file is imported each sheet is qualified with its file: "lineups_oct › Oct 13".
 * A single-file import keeps the plain sheet name, exactly as before.
 */
const path = require('path');
const crypto = require('crypto');

const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const SEP = ' › ';

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const baseLabel = (name) => (path.basename(String(name || ''), path.extname(String(name || ''))).replace(/:/g, '-').trim() || 'file');

/** One short, unique label per file name; two files with the same base name get " (2)". */
function labelFiles(names) {
  const seen = new Map();
  return names.map((n) => {
    const base = baseLabel(n);
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count > 1 ? `${base} (${count})` : base;
  });
}

const qualifySheets = (sheets, label) => sheets.map((s) => ({ ...s, name: `${label}${SEP}${s.name}` }));

/** What the batch is called in lists and notes: "a.xlsx", "a.xlsx, b.csv" or "a.xlsx + 3 more". */
function batchFileName(names) {
  if (names.length <= 2) return names.join(', ');
  return `${names[0]} + ${names.length - 1} more`;
}

/** A single file keeps its own hash; several files get one hash that does not depend on their order. */
function combinedHash(hashes) {
  if (hashes.length === 1) return hashes[0];
  return crypto.createHash('sha256').update([...hashes].sort().join('|')).digest('hex');
}

module.exports = { MAX_FILES, MAX_TOTAL_BYTES, SEP, sha256, labelFiles, qualifySheets, batchFileName, combinedHash };
