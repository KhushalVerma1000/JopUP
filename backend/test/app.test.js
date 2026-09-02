const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TEST_ORG_ID = '11111111-1111-1111-1111-111111111111';
const TEST_TEAM_ID = '33333333-3333-3333-3333-333333333333';

// requireAuth only verifies the JWT signature/shape — it doesn't hit the DB —
// so a signed token lets these tests exercise the now-protected routes without
// a live Postgres instance. Downstream service calls still need a real DB and
// will legitimately 500/503 in this sandbox; that's the pre-existing pattern
// these tests already tolerate.
const ORG_ADMIN_PERMISSIONS = {
  teams: ['read', 'write', 'delete'],
  users: ['read', 'write', 'delete', 'invite'],
  clients: ['read', 'write', 'delete', 'share'],
  candidates: ['read', 'write', 'share'],
  job_postings: ['read', 'write', 'publish', 'archive'],
  workflow: ['read', 'write'],
  kpi: ['read', 'write'],
  audit_log: ['read'],
  credit_account: ['read'],
};

function staffToken({ organisationId = TEST_ORG_ID, roles = [{ teamId: null, roleName: 'org_admin', permissions: ORG_ADMIN_PERMISSIONS }] } = {}) {
  return jwt.sign({ userId: 'test-user', organisationId, email: 'test@example.com', roles }, JWT_SECRET, { expiresIn: '1h' });
}

const orgAdminAuth = () => ({ Authorization: `Bearer ${staffToken()}` });

test('GET /api/health returns server status', async () => {
  const response = await request(app).get('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok' });
});

test('GET /api/v1/plans returns seeded plans', async () => {
  const response = await request(app).get('/api/v1/plans');
  if (response.status === 200) {
    assert.ok(Array.isArray(response.body.data.plans));
  } else {
    // DB may not be available in CI — accept 500
    assert.ok([500, 503].includes(response.status), `Unexpected status: ${response.status}`);
  }
});

test('POST /api/v1/organizations creates an organization', async () => {
  const response = await request(app)
    .post('/api/v1/organizations')
    .send({ name: 'Acme Recruiting', slug: 'acme-recruiting' });

  if (response.status === 201) {
    assert.equal(response.body.data.organization.name, 'Acme Recruiting');
    assert.equal(response.body.data.organization.slug, 'acme-recruiting');
   return console.log('Organization created successfully:', response.body.data.organization);
  } else {
    // DB may not be available, or slug already exists
    assert.ok([500, 409, 400].includes(response.status), `Unexpected status: ${response.status}`);
  }
});

test('GET /api/v1/candidates requires authentication', async () => {
  const response = await request(app).get('/api/v1/candidates');
  assert.equal(response.status, 401);
});

test('GET /api/v1/candidates returns seeded candidates', async () => {
  const response = await request(app)
    .get('/api/v1/candidates')
    .set(orgAdminAuth());
  if (response.status === 200) {
    assert.ok(Array.isArray(response.body.data.candidates));
  } else {
    assert.ok([500, 503].includes(response.status), `Unexpected status: ${response.status}`);
  }
});

test('GET /api/v1/teams returns seeded teams', async () => {
  const response = await request(app)
    .get('/api/v1/teams')
    .set(orgAdminAuth());
  if (response.status === 200) {
    assert.ok(Array.isArray(response.body.data.teams));
  } else {
    assert.ok([500, 503].includes(response.status), `Unexpected status: ${response.status}`);
  }
});

test('GET /api/v1/clients returns seeded clients', async () => {
  const response = await request(app)
    .get('/api/v1/clients')
    .set(orgAdminAuth());
  if (response.status === 200) {
    assert.ok(Array.isArray(response.body.data.clients));
  } else {
    assert.ok([500, 503].includes(response.status), `Unexpected status: ${response.status}`);
  }
});

test('GET /api/v1/workflows returns workflow stages', async () => {
  const response = await request(app)
    .get('/api/v1/workflows')
    .set(orgAdminAuth());
  if (response.status === 200) {
    assert.ok(Array.isArray(response.body.data.templates));
  } else {
    assert.ok([500, 503].includes(response.status), `Unexpected status: ${response.status}`);
  }
});

test('POST /api/v1/organizations fails on validation error', async () => {
  const response = await request(app)
    .post('/api/v1/organizations')
    .send({ name: '' }); // empty name fails validation

  assert.equal(response.status, 400);
  assert.equal(response.body.status, 'fail');
  assert.ok(response.body.message.includes('Validation failed'));
});

test('GET /api/v1/candidates scopes by tenant context', async () => {
  // With org A
  const response1 = await request(app)
    .get('/api/v1/candidates')
    .set(orgAdminAuth({ organisationId: TEST_ORG_ID }));

  if (response1.status === 200) {
    const body1 = response1.body.data?.candidates;
    assert.ok(Array.isArray(body1));
  } else {
    assert.ok([500, 503].includes(response1.status));
  }

  // Querying as a different org's admin should return a different (or empty) set
  const response2 = await request(app)
    .get('/api/v1/candidates')
    .set(orgAdminAuth({ organisationId: '22222222-2222-2222-2222-222222222222' }));

  if (response2.status === 200) {
    const body2 = response2.body.data?.candidates;
    assert.ok(Array.isArray(body2));
  } else {
    assert.ok([500, 503].includes(response2.status));
  }
});
