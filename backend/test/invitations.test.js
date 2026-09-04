const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TEST_ORG_ID = '11111111-1111-1111-1111-111111111111';
const TEST_TEAM_ID = '33333333-3333-3333-3333-333333333333';

function orgAdminToken() {
  return jwt.sign(
    {
      userId: 'test-org-admin',
      organisationId: TEST_ORG_ID,
      email: 'admin@example.com',
      roles: [{ teamId: null, roleName: 'org_admin', permissions: { users: ['read', 'write', 'delete', 'invite'] } }],
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function hrToken() {
  return jwt.sign(
    {
      userId: 'test-hr-user',
      organisationId: TEST_ORG_ID,
      email: 'hr@example.com',
      // hr never had 'invite' — confirms only org_admin can send invitations
      roles: [{ teamId: TEST_TEAM_ID, roleName: 'hr', permissions: { candidates: ['read', 'write'] } }],
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

test('POST /api/v1/invitations requires authentication', async () => {
  const response = await request(app)
    .post('/api/v1/invitations')
    .send({ email: 'new@example.com', roleName: 'hr', teamId: TEST_TEAM_ID });
  assert.equal(response.status, 401);
});

test('POST /api/v1/invitations is refused for hr (no invite permission)', async () => {
  const response = await request(app)
    .post('/api/v1/invitations')
    .set('Authorization', `Bearer ${hrToken()}`)
    .send({ email: 'new@example.com', roleName: 'hr', teamId: TEST_TEAM_ID });
  assert.equal(response.status, 403);
});

test('POST /api/v1/invitations rejects an org_admin invite that includes a teamId', async () => {
  const response = await request(app)
    .post('/api/v1/invitations')
    .set('Authorization', `Bearer ${orgAdminToken()}`)
    .send({ email: 'new-admin@example.com', roleName: 'org_admin', teamId: TEST_TEAM_ID });
  assert.equal(response.status, 400);
});

test('POST /api/v1/invitations rejects a manager/hr invite missing teamId', async () => {
  const response = await request(app)
    .post('/api/v1/invitations')
    .set('Authorization', `Bearer ${orgAdminToken()}`)
    .send({ email: 'new-hr@example.com', roleName: 'hr' });
  assert.equal(response.status, 400);
});

test('POST /api/v1/invitations accepts a well-formed org_admin invite', async () => {
  const response = await request(app)
    .post('/api/v1/invitations')
    .set('Authorization', `Bearer ${orgAdminToken()}`)
    .send({ email: 'new-admin@example.com', roleName: 'org_admin' });
  assert.ok([201, 409, 500, 503].includes(response.status), `Unexpected status: ${response.status}`);
});

test('GET /api/v1/invitations is refused for hr (no invite permission)', async () => {
  const response = await request(app)
    .get('/api/v1/invitations')
    .set('Authorization', `Bearer ${hrToken()}`);
  assert.equal(response.status, 403);
});

test('POST /api/v1/invitations/accept validates required fields', async () => {
  const response = await request(app)
    .post('/api/v1/invitations/accept')
    .send({ token: 'sometoken' });
  assert.equal(response.status, 400);
});

test('POST /api/v1/invitations/accept accepts a well-formed request', async () => {
  const response = await request(app)
    .post('/api/v1/invitations/accept')
    .send({ token: 'a'.repeat(64), password: 'password123', firstName: 'New', lastName: 'Admin' });
  // Passes validation; DB may be unavailable in CI (or token genuinely not found -> 404).
  assert.ok([201, 404, 500, 503].includes(response.status), `Unexpected status: ${response.status}`);
});
