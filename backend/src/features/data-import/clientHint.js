/**
 * Where does the client come from when a tracker has no "Client" column?
 *
 * Staffing trackers are very often one file or one tab per client: "Outsourcing_Tracker.xlsx" with tabs
 * "L&T Finance", "Zepto Cafe", "Ereka", or "HDFC_Delhi_Tracker.xlsx" with tabs per region. Nothing in the
 * rows says so, so the analyser used to import every lineup with no client (and so no open position).
 *
 * Modes (chosen per file):
 *   none   leave the client empty (the old behaviour, and still the default for API callers)
 *   sheet  each tab's name is the client
 *   name   one client for the whole file, typed or suggested from the file name
 *   auto   take our suggestion (see suggestClient)
 * Pure functions, no database.
 */
const path = require('path');
const N = require('./normalize');

const MAX_CLIENT_NAME = 120;
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CLIENT_NAME);

const GENERIC_SHEET = /^(sheet|page|tab|data|lineups?|line ?ups?|trackers?|daily( tracker)?|candidates?|report|extra|others?|misc|new|old|main|final|copy|test|template|master)[\s_-]*\d*$/i;

/** "Sheet2", "Extra", "13-10-2026" or "5" tell us nothing about a client. */
function isGenericSheetName(name) {
  const s = String(name || '').trim();
  if (!s) return true;
  if (GENERIC_SHEET.test(s) || /^\d+$/.test(s)) return true;
  return N.parseDate(s).date !== null;
}

const NOISE = /\b(trackers?|daily|weekly|monthly|report|reports|lineups?|line ?ups?|candidates?|data|sheet|copy|final|updated?|new|old|v\d+|xlsx|csv|dated?)\b/gi;

/** "HDFC_Delhi_Tracker_20-03-2025_____.xlsx" -> "HDFC Delhi"; "" when nothing readable is left. */
function nameFromFile(fileName) {
  let base = path.basename(String(fileName || ''), path.extname(String(fileName || '')));
  base = base.replace(/[_]+/g, ' ')
    .replace(/\(\d+\)/g, ' ')
    .replace(/\b\d{1,2}[-./]\d{1,2}[-./]\d{2,4}\b/g, ' ')   // 20-03-2025
    .replace(/\b(19|20)\d{2}\b/g, ' ')                       // a bare year
    .replace(NOISE, ' ')
    .replace(/[-–.]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return clean(base);
}

/**
 * @param fileName   the uploaded file's name
 * @param sheets     analysed sheets of that file ({ name, kind })
 * @returns { mode: 'sheet' | 'name' | 'none', name: string|null }
 */
function suggestClient(fileName, sheets) {
  const real = (sheets || []).filter((s) => s.kind !== 'unknown');
  if (real.length && real.every((s) => !isGenericSheetName(s.name))) return { mode: 'sheet', name: null };
  const name = nameFromFile(fileName);
  if (name) return { mode: 'name', name };
  return { mode: 'none', name: null };
}

/**
 * Settle the mode for a file.
 * @param ask { mode?, name? }  what the caller asked for (mode absent = none)
 * @returns { mode, name, source: 'auto'|'chosen'|'default', suggestion }
 */
function resolveClient(ask, fileName, sheets) {
  const suggestion = suggestClient(fileName, sheets);
  const mode = ask && ask.mode ? ask.mode : 'none';
  if (mode === 'auto') return { ...suggestion, source: 'auto', suggestion };
  if (mode === 'name') {
    const name = clean(ask.name) || nameFromFile(fileName) || null;
    return name ? { mode: 'name', name, source: 'chosen', suggestion } : { mode: 'none', name: null, source: 'chosen', suggestion };
  }
  if (mode === 'sheet') return { mode: 'sheet', name: null, source: 'chosen', suggestion };
  return { mode: 'none', name: null, source: ask && ask.mode ? 'chosen' : 'default', suggestion };
}

/** What each tab's client becomes under a resolved setting (null = leave empty). */
const clientForSheet = (resolved, sheetName) => {
  if (resolved.mode === 'sheet') return clean(sheetName) || null;
  if (resolved.mode === 'name') return resolved.name;
  return null;
};

module.exports = { MAX_CLIENT_NAME, isGenericSheetName, nameFromFile, suggestClient, resolveClient, clientForSheet, clean };
