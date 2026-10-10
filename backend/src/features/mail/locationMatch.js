/**
 * Which client location does a candidate's free-text location belong to?
 * "Aligarh UP" → the "Aligarh store" whose aliases include "Aligarh".
 *
 * 1. exact match on the name or any alias (ignoring case, punctuation, spacing);
 * 2. otherwise an alias/name whose words all appear in the candidate's location
 *    ("Aligarh UP" contains "Aligarh"); the longest such alias wins;
 * 3. a tie between two different locations is NOT guessed — it counts as unmatched,
 *    so HR fixes the aliases rather than a mail going to the wrong store.
 */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, ' ').trim();
const words = (s) => (norm(s) ? norm(s).split(' ') : []);

function matchLocation(candidateLocation, locations) {
  const target = norm(candidateLocation);
  if (!target) return null;
  const targetWords = new Set(words(candidateLocation));

  const exact = new Set();
  const partial = []; // { id, size }
  for (const loc of locations) {
    const names = [loc.name, ...(loc.aliases || [])].filter((n) => norm(n));
    for (const n of names) {
      if (norm(n) === target) exact.add(loc.id);
      else if (words(n).every((w) => targetWords.has(w))) partial.push({ id: loc.id, size: words(n).length });
    }
  }
  if (exact.size === 1) return [...exact][0];
  if (exact.size > 1) return null;

  if (!partial.length) return null;
  const best = Math.max(...partial.map((p) => p.size));
  const winners = new Set(partial.filter((p) => p.size === best).map((p) => p.id));
  return winners.size === 1 ? [...winners][0] : null;
}

module.exports = { matchLocation, norm };
