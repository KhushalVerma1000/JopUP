const { db, schema } = require('../../utils/db');
const { and, eq, inArray, isNull, asc } = require('drizzle-orm');
const { BadRequestError, NotFoundError, ConflictError } = require('../../utils/errors');
const { auditWrite } = require('../../utils/audit');
const mailTypes = require('../mail/types');

const DATE_FIELDS = [
  { key: 'lineupDate', label: 'A lineup date is set' },
  { key: 'interviewDate', label: 'An interview date is set' },
];

const isUniqueViolation = (err) => (err?.code || err?.cause?.code) === '23505';

/** Every thing a rule can listen for — the picker on the rules screen. */
function triggerOptions() {
  return [
    ...DATE_FIELDS.map((d) => ({ trigger: 'date_set', key: d.key, label: d.label })),
    ...mailTypes.TYPES.filter((t) => t.audience === 'client')
      .map((t) => ({ trigger: 'mail_sent', key: t.key, label: `${t.label} mail is marked as sent` })),
  ];
}

function isKnownTrigger(trigger, key) {
  return triggerOptions().some((o) => o.trigger === trigger && o.key === key);
}

/** Starting points a manager can add in one tap. Joined is left out on purpose: it marks a candidate placed. */
const SUGGESTED = [
  { name: 'Lineup date set → Line-up', trigger: 'date_set', triggerKey: 'lineupDate', targetStageKey: 'lineup' },
  { name: 'Interview date set → Interview', trigger: 'date_set', triggerKey: 'interviewDate', targetStageKey: 'interview' },
  { name: 'Offer mail sent → Offer', trigger: 'mail_sent', triggerKey: 'offer', targetStageKey: 'offer' },
];

/**
 * Decide who a rule moves. Same guards as a manual advance, but a candidate who
 * can't move is skipped quietly: automation must never undo or fight HR.
 *   rows:     { id, status, workflowTemplateId, currentStage: { id, orderIndex } | null }
 *   stageFor: templateId → that workflow's stage with the rule's stageKey, or null
 */
function planAutomation({ rows, stageFor }) {
  return rows.map((r) => {
    if (r.status !== 'active') return { id: r.id, skip: 'not active' };
    const stage = stageFor(r.workflowTemplateId);
    if (!stage) return { id: r.id, skip: 'no such stage in this workflow' };
    const cur = r.currentStage;
    if (cur && cur.id === stage.id) return { id: r.id, skip: 'already there' };
    if (cur && stage.orderIndex < cur.orderIndex) return { id: r.id, skip: 'already past it' };
    return { id: r.id, stageId: stage.id, stageName: stage.name };
  });
}

class AutomationService {
  /** What the rules screen offers: the triggers, the stages that really exist in this organisation, and one-tap starters. */
  async options(orgId) {
    const keys = await this._stageKeys(orgId);
    return { triggers: triggerOptions(), stages: [...keys.entries()].map(([key, name]) => ({ key, name })), suggested: SUGGESTED };
  }

  async list(orgId) {
    return db.select().from(schema.automationRule)
      .where(eq(schema.automationRule.organisationId, orgId)).orderBy(asc(schema.automationRule.createdAt));
  }

  /** The stage keys that exist in this organisation's workflows, so a rule can't point at nothing. */
  async _stageKeys(orgId) {
    const rows = await db.select({ key: schema.workflowStage.stageKey, name: schema.workflowStage.name })
      .from(schema.workflowStage)
      .innerJoin(schema.workflowTemplate, eq(schema.workflowStage.workflowTemplateId, schema.workflowTemplate.id))
      .where(eq(schema.workflowTemplate.organisationId, orgId));
    const byKey = new Map();
    for (const r of rows) if (!byKey.has(r.key)) byKey.set(r.key, r.name);
    return byKey;
  }

  async _assertStage(orgId, key) {
    const keys = await this._stageKeys(orgId);
    if (!keys.has(key)) {
      const have = [...keys.entries()].map(([k, n]) => `${n} (${k})`).join(', ') || 'none yet';
      throw new BadRequestError(`No stage "${key}" in your workflows. Available: ${have}`);
    }
  }

  async create(orgId, user, data) {
    if (!isKnownTrigger(data.trigger, data.triggerKey)) throw new BadRequestError('That trigger does not exist');
    await this._assertStage(orgId, data.targetStageKey);
    try {
      const [row] = await db.insert(schema.automationRule).values({
        organisationId: orgId, name: data.name, trigger: data.trigger, triggerKey: data.triggerKey,
        targetStageKey: data.targetStageKey, isEnabled: data.isEnabled ?? true, createdBy: user.userId,
      }).returning();
      await auditWrite(orgId, user.userId, 'create', 'automation_rule', row.id, null, row, 'pipeline');
      return row;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('There is already a rule for that trigger — edit it instead');
      throw err;
    }
  }

  async update(orgId, user, id, data) {
    const [before] = await db.select().from(schema.automationRule)
      .where(and(eq(schema.automationRule.id, id), eq(schema.automationRule.organisationId, orgId)));
    if (!before) throw new NotFoundError('Rule not found');
    if (data.targetStageKey) await this._assertStage(orgId, data.targetStageKey);
    const patch = { updatedAt: new Date() };
    for (const k of ['name', 'targetStageKey', 'isEnabled']) if (data[k] !== undefined) patch[k] = data[k];
    const [row] = await db.update(schema.automationRule).set(patch)
      .where(and(eq(schema.automationRule.id, id), eq(schema.automationRule.organisationId, orgId))).returning();
    await auditWrite(orgId, user.userId, 'update', 'automation_rule', id, before, row, 'pipeline');
    return row;
  }

  async remove(orgId, user, id) {
    const [before] = await db.select().from(schema.automationRule)
      .where(and(eq(schema.automationRule.id, id), eq(schema.automationRule.organisationId, orgId)));
    if (!before) throw new NotFoundError('Rule not found');
    await db.delete(schema.automationRule).where(eq(schema.automationRule.id, id));
    await auditWrite(orgId, user.userId, 'delete', 'automation_rule', id, before, null, 'pipeline');
  }

  /**
   * Fire the rule for a trigger on the given trackers. Best effort by design: the
   * action HR took (setting a date, marking a mail sent) has already succeeded, so
   * a problem here is reported in the result, never thrown back at them.
   * Returns { rule, moved: [{id, toStage}], skipped: n } or null when no rule is on.
   */
  async run(orgId, userId, trigger, triggerKey, trackerIds) {
    try {
      const ids = [...new Set(trackerIds || [])];
      if (ids.length === 0) return null;
      const [rule] = await db.select().from(schema.automationRule).where(and(
        eq(schema.automationRule.organisationId, orgId), eq(schema.automationRule.trigger, trigger),
        eq(schema.automationRule.triggerKey, triggerKey), eq(schema.automationRule.isEnabled, true)));
      if (!rule) return null;

      const CT = schema.candidateTracker;
      const trackers = await db.select().from(CT).where(and(eq(CT.organisationId, orgId), inArray(CT.id, ids)));
      const logs = trackers.length ? await db.select({ trackerId: schema.candidateTrackerStageLog.trackerId, stageId: schema.candidateTrackerStageLog.stageId })
        .from(schema.candidateTrackerStageLog)
        .where(and(inArray(schema.candidateTrackerStageLog.trackerId, trackers.map((t) => t.id)), isNull(schema.candidateTrackerStageLog.exitedAt))) : [];
      const templateIds = [...new Set(trackers.map((t) => t.workflowTemplateId))];
      const stages = templateIds.length ? await db.select().from(schema.workflowStage)
        .where(inArray(schema.workflowStage.workflowTemplateId, templateIds)) : [];
      const stageById = new Map(stages.map((s) => [s.id, s]));
      const target = new Map(stages.filter((s) => s.stageKey === rule.targetStageKey).map((s) => [s.workflowTemplateId, s]));
      const stageIdByTracker = new Map(logs.map((l) => [l.trackerId, l.stageId]));

      const rows = trackers.map((t) => {
        const cur = stageById.get(stageIdByTracker.get(t.id));
        return { id: t.id, status: t.status, workflowTemplateId: t.workflowTemplateId, currentStage: cur ? { id: cur.id, orderIndex: cur.orderIndex } : null };
      });
      const plan = planAutomation({ rows, stageFor: (tid) => target.get(tid) || null });

      const trackersService = require('../trackers/trackers.service'); // lazy: trackers.service also calls into here
      const moved = [];
      for (const p of plan.filter((x) => !x.skip)) {
        try {
          await trackersService.advanceStage(orgId, p.id, p.stageId, userId, `Auto: ${rule.name}`);
          moved.push({ id: p.id, toStage: p.stageName });
        } catch { /* someone moved them in the meantime — leave it */ }
      }
      return { rule: { id: rule.id, name: rule.name }, moved, skipped: plan.length - moved.length };
    } catch (err) {
      console.error('[automation] run failed:', err.message);
      return null;
    }
  }
}

module.exports = new AutomationService();
module.exports.planAutomation = planAutomation;
module.exports.triggerOptions = triggerOptions;
module.exports.isKnownTrigger = isKnownTrigger;
