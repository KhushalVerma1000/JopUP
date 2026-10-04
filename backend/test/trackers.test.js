const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const schema = require('../src/features/trackers/trackers.schema');

const UUID = '11111111-1111-4111-8111-111111111111';

test('PATCH /api/v1/trackers/:id requires authentication', async () => {
  const res = await request(app).patch(`/api/v1/trackers/${UUID}`).send({ openPositionId: UUID });
  assert.equal(res.status, 401);
});

test('updateTrackerSchema rejects an empty body', () => {
  const r = schema.updateTrackerSchema.safeParse({ body: {}, params: { id: UUID } });
  assert.equal(r.success, false);
});

test('updateTrackerSchema accepts tagging and untagging a position', () => {
  assert.equal(schema.updateTrackerSchema.safeParse({ body: { openPositionId: UUID }, params: { id: UUID } }).success, true);
  assert.equal(schema.updateTrackerSchema.safeParse({ body: { openPositionId: null }, params: { id: UUID } }).success, true);
  assert.equal(schema.updateTrackerSchema.safeParse({ body: { openPositionId: 'nope' }, params: { id: UUID } }).success, false);
});

test('advanceStageSchema takes an optional status note, capped in length', () => {
  const ok = schema.advanceStageSchema.safeParse({ body: { nextStageId: UUID, note: 'Reached' }, params: { id: UUID } });
  assert.equal(ok.success, true);
  assert.equal(schema.advanceStageSchema.safeParse({ body: { nextStageId: UUID }, params: { id: UUID } }).success, true);
  assert.equal(schema.advanceStageSchema.safeParse({ body: { nextStageId: UUID, note: 'x'.repeat(501) }, params: { id: UUID } }).success, false);
});

test('quick-add candidate accepts an optional location', () => {
  const r = schema.createTrackerSchema.safeParse({ body: { teamId: UUID, candidate: { firstName: 'A', phone: '9123456780', phoneCountry: 'IN', location: 'Pune' } } });
  assert.equal(r.success, true);
});

test('tagCandidatesSchema requires 1–100 candidate ids and valid uuids', () => {
  const base = { teamId: UUID, openPositionId: UUID };
  assert.equal(schema.tagCandidatesSchema.safeParse({ body: { ...base, candidateIds: [UUID] } }).success, true);
  assert.equal(schema.tagCandidatesSchema.safeParse({ body: { ...base, candidateIds: [] } }).success, false);
  assert.equal(schema.tagCandidatesSchema.safeParse({ body: { ...base, candidateIds: ['nope'] } }).success, false);
  assert.equal(schema.tagCandidatesSchema.safeParse({ body: { ...base, candidateIds: Array(101).fill(UUID) } }).success, false);
  assert.equal(schema.tagCandidatesSchema.safeParse({ body: { teamId: UUID, candidateIds: [UUID] } }).success, false);
});

test('POST /api/v1/trackers/tag requires authentication', async () => {
  const res = await request(app).post('/api/v1/trackers/tag').send({});
  assert.equal(res.status, 401);
});
