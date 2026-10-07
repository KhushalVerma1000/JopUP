/**
 * One-off rollout: move existing hand-entered KPIs, goals and strategy key
 * results onto the metric catalogue so they fill themselves in.
 *
 *   node scripts/rollout-auto-metrics.js            dry run: prints what it WOULD change
 *   node scripts/rollout-auto-metrics.js --apply    does it
 *   ... --apply --keep-entries                      keep old hand-typed KPI readings
 *
 * Matching is by wording ("Placements per month" → placements). Anything that
 * doesn't match confidently — or a goal with no number in its title — is left
 * manual and listed, never given a guessed metric. Safe to run again.
 *
 * Old hand-typed readings of a converted KPI are deleted unless --keep-entries:
 * they would otherwise sit beside, and block, the computed ones for the same
 * period. Only run with --apply on data you are happy to replace (test data).
 */
require('dotenv').config();
const { db, schema } = require('../src/utils/db');
const { eq, and, inArray, sql } = require('drizzle-orm');
const { getMetric, guessMetricKey } = require('../src/features/performance/metrics.catalogue');
const metrics = require('../src/features/performance/metrics.service');
const { parsePeriod } = require('../src/features/performance/performance.math');

const APPLY = process.argv.includes('--apply');
const KEEP = process.argv.includes('--keep-entries');
const say = (...a) => console.log(...a);

async function main() {
  say(APPLY ? '▶ Applying rollout' : '▶ Dry run (nothing is changed; add --apply to do it)');
  const touchedOrgs = new Set();
  const kept = [];

  // ── KPIs ──
  const kpis = await db.select().from(schema.kpiDefinition).where(and(eq(schema.kpiDefinition.source, 'manual'), sql`${schema.kpiDefinition.metricKey} is null`));
  for (const k of kpis) {
    const key = guessMetricKey(k.name);
    if (!key) { kept.push(`KPI "${k.name}" — no matching metric, stays manual`); continue; }
    const m = getMetric(key);
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from kpi_entry where kpi_id = ${k.id}`)).rows;
    say(`  KPI  "${k.name}" → ${m.label}  (${m.kind}${KEEP ? '' : `, replaces ${n} typed reading${n === 1 ? '' : 's'}`})`);
    if (APPLY) {
      if (!KEEP) await db.delete(schema.kpiEntry).where(eq(schema.kpiEntry.kpiId, k.id));
      await db.update(schema.kpiDefinition).set({ source: 'auto', metricKey: key, unit: m.unit, direction: m.direction, updatedAt: new Date() }).where(eq(schema.kpiDefinition.id, k.id));
      touchedOrgs.add(k.organisationId);
    }
  }

  // ── Goals (needs a metric match, a number in the title, and a due date) ──
  const goals = await db.select().from(schema.goal).where(and(eq(schema.goal.progressSource, 'manual'), inArray(schema.goal.status, ['active', 'overdue'])));
  for (const g of goals) {
    const key = guessMetricKey(g.title);
    const target = Number((g.title.match(/\b(\d+(?:\.\d+)?)\b/) || [])[1]);
    const m = key && getMetric(key);
    if (!m || !(target > 0) || !g.dueDate) { kept.push(`Goal "${g.title}" — ${!m ? 'no matching metric' : !(target > 0) ? 'no target number in the title' : 'no due date'}, stays manual`); continue; }
    if (g.assignedTo && !m.userScope) { kept.push(`Goal "${g.title}" — ${m.label} is team-wide only but the goal is assigned to a person, stays manual`); continue; }
    const start = (g.createdAt instanceof Date ? g.createdAt : new Date(g.createdAt)).toISOString().slice(0, 10);
    say(`  Goal "${g.title}" → ${m.label}, target ${target}, ${start} to ${g.dueDate}${g.assignedTo ? ' (per person)' : ''}`);
    if (APPLY) {
      await db.update(schema.goal).set({ progressSource: 'auto', metricKey: key, targetValue: target, startDate: start > g.dueDate ? g.dueDate : start, finalizedAt: null, updatedAt: new Date() }).where(eq(schema.goal.id, g.id));
      touchedOrgs.add(g.organisationId);
    }
  }

  // ── Strategy key results ──
  const strategies = await db.select().from(schema.teamStrategy).where(sql`${schema.teamStrategy.finalizedAt} is null`);
  for (const s of strategies) {
    const window = s.periodStart && s.periodEnd ? { start: s.periodStart, end: s.periodEnd } : parsePeriod(s.period);
    let changed = false;
    const objectives = (s.objectives || []).map((o) => ({
      ...o,
      key_results: (o.key_results || []).map((k) => {
        if (k.type && k.type !== 'manual') return k;
        const key = guessMetricKey(k.kr);
        if (!key) { kept.push(`Strategy "${s.title}" › "${k.kr}" — no matching metric, stays manual`); return k; }
        if (!window) { kept.push(`Strategy "${s.title}" › "${k.kr}" — period "${s.period}" has no readable dates, stays manual`); return k; }
        say(`  KR   "${s.title}" › "${k.kr}" → ${getMetric(key).label}`);
        changed = true;
        const { current, ...rest } = k;
        return { ...rest, type: 'metric', metric_key: key };
      }),
    }));
    if (changed && APPLY) {
      await db.update(schema.teamStrategy).set({ objectives, periodStart: window.start, periodEnd: window.end, updatedAt: new Date() }).where(eq(schema.teamStrategy.id, s.id));
      touchedOrgs.add(s.organisationId);
    }
  }

  if (kept.length) { say('\nLeft manual:'); kept.forEach((x) => say(`  · ${x}`)); }

  if (APPLY) {
    say('\nComputing the numbers…');
    for (const orgId of touchedOrgs) say(`  org ${orgId}:`, JSON.stringify(await metrics.syncOrg(orgId, { force: true })));
    say('\n✅ Rollout complete.');
  } else say('\nNo changes made. Re-run with --apply to roll out.');
  process.exit(0);
}

main().catch((e) => { console.error('Rollout failed:', e); process.exit(1); });
