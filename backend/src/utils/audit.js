/**
 * Audit Log Utility
 *
 * auditWrite — call this on every important mutation across all modules.
 * Creates an immutable record in audit_log of who did what to what.
 *
 * Rules:
 *   - before: null for CREATE operations
 *   - after:  null for DELETE operations
 *   - Never update or delete audit_log rows
 */

const { db, schema } = require('./db');

/**
 * @param {string} orgId
 * @param {string|null} actorId
 * @param {string} action           e.g. 'create' | 'update' | 'delete' | 'stage_advance'
 * @param {string} entityType       e.g. 'candidate' | 'application' | 'client'
 * @param {string|null} entityId
 * @param {object|null} before      State before the mutation (null for creates)
 * @param {object|null} after       State after the mutation (null for deletes)
 * @param {string} sourceModule     e.g. 'candidates' | 'pipeline' | 'clients'
 * @param {object} [meta]           Optional: { ipAddress, userAgent }
 */
async function auditWrite(
  orgIdOrObj,
  actorId,
  action,
  entityType,
  entityId,
  before,
  after,
  sourceModule,
  meta = {}
) {
  let orgId = orgIdOrObj;
  let ipAddress = meta.ipAddress || null;
  let userAgent = meta.userAgent || null;

  if (typeof orgIdOrObj === 'object' && orgIdOrObj !== null) {
    orgId = orgIdOrObj.organisationId || orgIdOrObj.orgId;
    actorId = orgIdOrObj.performedBy || orgIdOrObj.actorId;
    action = orgIdOrObj.action;
    entityType = orgIdOrObj.entityType;
    entityId = orgIdOrObj.entityId;
    before = orgIdOrObj.previousValues || orgIdOrObj.before || orgIdOrObj.beforeState;
    after = orgIdOrObj.newValues || orgIdOrObj.after || orgIdOrObj.afterState;
    sourceModule = orgIdOrObj.sourceModule;
    ipAddress = orgIdOrObj.ipAddress || null;
    userAgent = orgIdOrObj.userAgent || null;
  }

  await db.insert(schema.auditLog).values({
    organisationId: orgId,
    actorId: actorId || null,
    action,
    entityType,
    entityId: entityId || null,
    beforeState: before || null,
    afterState: after || null,
    sourceModule,
    ipAddress,
    userAgent,
  });
}

module.exports = { auditWrite };
