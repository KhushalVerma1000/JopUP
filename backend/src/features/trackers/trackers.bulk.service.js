const { db, schema } = require('../../utils/db');
const { and, eq, inArray } = require('drizzle-orm');
const { BadRequestError } = require('../../utils/errors');
const { canSeeTeam, canActOnTeam } = require('../../utils/teamScope');
const { auditWrite } = require('../../utils/audit');
const trackersService = require('./trackers.service');

const OPEN = ['active', 'on_hold'];
const say = (status) => String(status).replace('_', ' ');

// ── pure planners (no database — unit tested directly) ─────────────────────

/**
 * Decide the new date for each tracker. `rows` is in the order HR selected /
 * saw them, which is the order a staggered schedule follows. Closed trackers
 * (joined / rejected / withdrawn) are skipped: a date on them means nothing.
 */
function planDates({ rows, mode, at, start, gapMinutes }) {
  let slot = 0;
  return rows.map((r) => {
    if (!OPEN.includes(r.status)) return { id: r.id, skip: `Already ${say(r.status)}` };
    if (mode === 'clear') return { id: r.id, value: null };
    if (mode === 'same') return { id: r.id, value: new Date(at) };
    const value = new Date(new Date(start).getTime() + slot * gapMinutes * 60000);
    slot += 1;
    return { id: r.id, value };
  });
}

/**
 * Decide what a bulk status action does to each tracker.
 *   rows:   { id, status, workflowTemplateId, currentStage: { id, orderIndex, name } | null }
 *   target: the stage asked for (advance only)
 *   stageFor(templateId): that template's stage with the target's stageKey, or null
 * A candidate on a different workflow still moves when that workflow has a
 * stage with the same stageKey — otherwise they are skipped, with the reason.
 */
function planStatus({ action, rows, target, stageFor }) {
  return rows.map((r) => {
    if (action === 'hold') return r.status === 'active' ? { id: r.id } : { id: r.id, skip: `Only an active candidate can be put on hold (this one is ${say(r.status)})` };
    if (action === 'resume') return r.status === 'on_hold' ? { id: r.id } : { id: r.id, skip: 'Not on hold' };
    if (action === 'block') return OPEN.includes(r.status) ? { id: r.id } : { id: r.id, skip: `Already ${say(r.status)}` };

    if (r.status !== 'active') return { id: r.id, skip: `Can't move — ${say(r.status)}` };
    const stage = r.workflowTemplateId === target.workflowTemplateId ? target : stageFor(r.workflowTemplateId);
    if (!stage) return { id: r.id, skip: `No "${target.name}" stage in this candidate's workflow` };
    const cur = r.currentStage;
    if (cur && cur.id === stage.id) return { id: r.id, skip: `Already in ${stage.name}` };
    if (cur && stage.orderIndex < cur.orderIndex) return { id: r.id, skip: `Already past ${stage.name}` };
    return { id: r.id, stageId: stage.id, stageName: stage.name };
  });
}

// ── database side ──────────────────────────────────────────────────────────

class TrackersBulkService {
  /**
   * Load the selected trackers in the caller's order. Ids that don't exist, belong
   * to another tenant or to a team the caller can't see all look the same: "Not found".
   */
  async _load(orgId, user, ids, entity, action) {
    const unique = [...new Set(ids)];
    const found = await db.select().from(schema.candidateTracker)
      .where(and(eq(schema.candidateTracker.organisationId, orgId), inArray(schema.candidateTracker.id, unique)));
    const byId = new Map(found.map((t) => [t.id, t]));
    const usable = []; const refused = [];
    for (const id of unique) {
      const t = byId.get(id);
      if (!t || !canSeeTeam(user, t.teamId)) refused.push({ id, reason: 'Not found' });
      else if (!canActOnTeam(user, t.teamId, entity, action)) refused.push({ id, reason: "You can't make this change for that team" });
      else usable.push(t);
    }
    const named = await trackersService._enrichTrackers(usable);
    const nameById = new Map(named.map((t) => [t.id, t.candidateName]));
    return { usable, refused, nameById, enriched: named };
  }

  _shape(plan, nameById, refused, extra = () => ({})) {
    const applied = plan.filter((p) => !p.skip).map((p) => ({ id: p.id, candidateName: nameById.get(p.id) || null, ...extra(p) }));
    const skipped = [
      ...plan.filter((p) => p.skip).map((p) => ({ id: p.id, candidateName: nameById.get(p.id) || null, reason: p.skip })),
      ...refused.map((r) => ({ id: r.id, candidateName: null, reason: r.reason })),
    ];
    return { applied, skipped };
  }

  async setDates(orgId, user, { trackerIds, field, mode, at, start, gapMinutes, dryRun }) {
    const { usable, refused, nameById } = await this._load(orgId, user, trackerIds, 'trackers', 'write');
    const plan = planDates({ rows: usable, mode, at, start, gapMinutes });

    if (!dryRun) {
      const toWrite = plan.filter((p) => !p.skip);
      const before = new Map(usable.map((t) => [t.id, t]));
      // One transaction: a bulk date change either lands for every applied row or for none.
      await db.transaction(async (tx) => {
        for (const p of toWrite) {
          await tx.update(schema.candidateTracker).set({ [field]: p.value, updatedAt: new Date() })
            .where(and(eq(schema.candidateTracker.id, p.id), eq(schema.candidateTracker.organisationId, orgId)));
        }
      });
      for (const p of toWrite) {
        await auditWrite(orgId, user.userId, 'update', 'candidate_tracker', p.id, { [field]: before.get(p.id)[field] }, { [field]: p.value }, 'pipeline', { bulk: true });
      }
    }
    return { dryRun: Boolean(dryRun), field, ...this._shape(plan, nameById, refused, (p) => ({ value: p.value ? p.value.toISOString() : null })) };
  }

  async setStatus(orgId, user, { trackerIds, action, nextStageId, note, reason, dryRun }) {
    const permissionKey = action === 'resume' ? 'hold' : action;
    const { usable, refused, nameById, enriched } = await this._load(orgId, user, trackerIds, 'workflow_actions', permissionKey);

    let target = null; let stageFor = () => null;
    if (action === 'advance') {
      const [stage] = await db.select().from(schema.workflowStage).where(eq(schema.workflowStage.id, nextStageId));
      const [tpl] = stage ? await db.select({ id: schema.workflowTemplate.id }).from(schema.workflowTemplate)
        .where(and(eq(schema.workflowTemplate.id, stage.workflowTemplateId), eq(schema.workflowTemplate.organisationId, orgId))) : [];
      if (!stage || !tpl) throw new BadRequestError('That stage was not found');
      target = stage;
      const otherTemplates = [...new Set(usable.map((t) => t.workflowTemplateId))].filter((id) => id !== stage.workflowTemplateId);
      const siblings = otherTemplates.length
        ? await db.select().from(schema.workflowStage).where(and(inArray(schema.workflowStage.workflowTemplateId, otherTemplates), eq(schema.workflowStage.stageKey, stage.stageKey)))
        : [];
      const byTemplate = new Map(siblings.map((s) => [s.workflowTemplateId, s]));
      stageFor = (templateId) => byTemplate.get(templateId) || null;
    }

    // The enriched rows only carry the stage's name/key — ordering needs orderIndex.
    const stageIds = [...new Set(enriched.map((t) => t.currentStage?.id).filter(Boolean))];
    const orders = stageIds.length ? await db.select({ id: schema.workflowStage.id, orderIndex: schema.workflowStage.orderIndex }).from(schema.workflowStage).where(inArray(schema.workflowStage.id, stageIds)) : [];
    const orderById = new Map(orders.map((o) => [o.id, o.orderIndex]));
    const rows = usable.map((t) => {
      const e = enriched.find((x) => x.id === t.id);
      return { id: t.id, status: t.status, workflowTemplateId: t.workflowTemplateId, currentStage: e?.currentStage ? { id: e.currentStage.id, name: e.currentStage.name, orderIndex: orderById.get(e.currentStage.id) ?? 0 } : null };
    });

    const plan = planStatus({ action, rows, target, stageFor });
    const failed = [];
    if (!dryRun) {
      // Each tracker is its own transaction (and takes its own row lock), so a
      // candidate who changed under us is reported, not allowed to undo the rest.
      for (const p of plan.filter((x) => !x.skip)) {
        try {
          if (action === 'advance') await trackersService.advanceStage(orgId, p.id, p.stageId, user.userId, note);
          else if (action === 'hold') await trackersService.holdTracker(orgId, p.id, user.userId);
          else if (action === 'resume') await trackersService.resumeTracker(orgId, p.id, user.userId);
          else await trackersService.blockTracker(orgId, p.id, reason, user.userId);
        } catch (err) {
          failed.push({ id: p.id, reason: err.message || 'Could not update' });
        }
      }
    }
    const failedIds = new Set(failed.map((f) => f.id));
    const settled = plan.map((p) => (failedIds.has(p.id) ? { id: p.id, skip: failed.find((f) => f.id === p.id).reason } : p));
    return { dryRun: Boolean(dryRun), action, ...this._shape(settled, nameById, refused, (p) => (p.stageName ? { toStage: p.stageName } : {})) };
  }
}

module.exports = new TrackersBulkService();
module.exports.planDates = planDates;
module.exports.planStatus = planStatus;
