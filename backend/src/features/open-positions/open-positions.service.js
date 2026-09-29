const { db, schema } = require('../../utils/db');
const { eq, and, inArray } = require('drizzle-orm');
const { NotFoundError } = require('../../utils/errors');
const { auditWrite } = require('../../utils/audit');

class OpenPositionsService {
  async getAllOpenPositions(orgId, filters = {}) {
    const conditions = [eq(schema.openPosition.organisationId, orgId)];

    if (filters.status) conditions.push(eq(schema.openPosition.status, filters.status));
    if (filters.teamId) conditions.push(eq(schema.openPosition.teamId, filters.teamId));
    if (filters.clientId) conditions.push(eq(schema.openPosition.clientId, filters.clientId));

    const rows = await db.select().from(schema.openPosition).where(and(...conditions));
    return this._enrichOpenPositions(rows);
  }

  /**
   * Resolves client name for display, same "resolve IDs server-side"
   * principle applications.service._enrichApplications documents. Filled
   * count is derived here rather than stored — see the module docstring's
   * "derive, don't cache" rule — by counting candidate_tracker rows with
   * status = 'placed' against this position.
   */
  async _enrichOpenPositions(rows) {
    if (rows.length === 0) return [];

    const clientIds = [...new Set(rows.map((r) => r.clientId).filter(Boolean))];
    const positionIds = rows.map((r) => r.id);

    const [clientRows, placedRows] = await Promise.all([
      clientIds.length
        ? db.select({ id: schema.client.id, companyName: schema.client.companyName })
            .from(schema.client).where(inArray(schema.client.id, clientIds))
        : [],
      db.select({ id: schema.candidateTracker.id, openPositionId: schema.candidateTracker.openPositionId })
        .from(schema.candidateTracker)
        .where(and(inArray(schema.candidateTracker.openPositionId, positionIds), eq(schema.candidateTracker.status, 'placed'))),
    ]);

    const clientById = new Map(clientRows.map((c) => [c.id, c]));
    const filledCountByPosition = new Map();
    for (const row of placedRows) {
      filledCountByPosition.set(row.openPositionId, (filledCountByPosition.get(row.openPositionId) || 0) + 1);
    }

    return rows.map((position) => ({
      ...position,
      clientName: position.clientId ? clientById.get(position.clientId)?.companyName || null : null,
      filledCount: filledCountByPosition.get(position.id) || 0,
    }));
  }

  async getOpenPositionById(orgId, id) {
    const position = await db.query.openPosition.findFirst({
      where: and(eq(schema.openPosition.id, id), eq(schema.openPosition.organisationId, orgId)),
    });

    if (!position) throw new NotFoundError('Open position not found');

    const [enriched] = await this._enrichOpenPositions([position]);
    return enriched;
  }

  async createOpenPosition(orgId, data, userId) {
    const [newPosition] = await db.insert(schema.openPosition).values({
      ...data,
      organisationId: orgId,
      createdBy: userId,
      status: 'open',
    }).returning();

    await auditWrite(orgId, userId, 'create', 'open_position', newPosition.id, null, newPosition, 'open_positions');

    return newPosition;
  }

  async updateOpenPosition(orgId, id, data, userId) {
    const oldPosition = await this.getOpenPositionById(orgId, id);

    const [updatedPosition] = await db
      .update(schema.openPosition)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(schema.openPosition.id, id), eq(schema.openPosition.organisationId, orgId)))
      .returning();

    await auditWrite(orgId, userId, 'update', 'open_position', id, oldPosition, updatedPosition, 'open_positions');

    return updatedPosition;
  }

  async deleteOpenPosition(orgId, id, userId) {
    const oldPosition = await this.getOpenPositionById(orgId, id);

    await db
      .delete(schema.openPosition)
      .where(and(eq(schema.openPosition.id, id), eq(schema.openPosition.organisationId, orgId)));

    await auditWrite(orgId, userId, 'delete', 'open_position', id, oldPosition, null, 'open_positions');
  }
}

module.exports = new OpenPositionsService();
