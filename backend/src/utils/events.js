/**
 * Event Bus Utility (Transactional Outbox Pattern)
 *
 * emitEvent — inserts into event_log so background workers can pick it up.
 * HR actions should be fast: they insert the event and return immediately.
 * Workers poll for processed=false rows and handle the side effects.
 *
 * Event Types:
 *   candidate.stage_changed      → SMS worker, KPI worker, notification worker
 *   job_posting.published        → job portal sync worker
 *   application.created          → assignment worker
 *   portal_application.submitted → portal processing worker
 *   credit.low_balance           → email alert worker
 *   user.invited                 → email worker
 */

const { db, schema } = require('./db');

/**
 * @param {string} orgId
 * @param {string|null} actorId
 * @param {string} eventType        e.g. 'candidate.stage_changed'
 * @param {string|null} entityType  e.g. 'application'
 * @param {string|null} entityId    UUID of the entity
 * @param {object} payload          Full event data needed by subscribers
 * @param {string} sourceModule     Which module emitted this event
 * @returns {Promise<object>}       The inserted event_log row
 */
async function emitEvent(orgId, actorId, eventType, entityType, entityId, payload, sourceModule) {
  const [event] = await db
    .insert(schema.eventLog)
    .values({
      organisationId: orgId,
      actorId: actorId || null,
      eventType,
      entityType: entityType || null,
      entityId: entityId || null,
      payload: payload || {},
      sourceModule,
    })
    .returning();

  return event;
}

module.exports = { emitEvent };
