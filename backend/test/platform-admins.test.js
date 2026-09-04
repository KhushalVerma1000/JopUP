const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PLATFORM_ORG_ID = '44444444-4444-4444-4444-444444444444';

function ownerToken() {
  return jwt.sign(
    {
      userId: 'owner-user-id',
      organisationId: PLATFORM_ORG_ID,
      email: 'owner@jopup.io',
      roles: [{ teamId: null, roleName: 'platform_owner', permissions: { platform_admins: ['read', 'write', 'delete'] } }],
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function subAdminToken() {
  return jwt.sign(
    {
      userId: 'sub-admin-user-id',
      organisationId: PLATFORM_ORG_ID,
      email: 'admin@jopup.io',
      // platform_admin deliberately has no 'platform_admins' key (seed.ts, patch 6)
      roles: [{ teamId: null, roleName: 'platform_admin', permissions: { organisations: ['read'] } }],
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

test('GET /api/v1/platform-admins requires authentication', async () => {
  const response = await request(app).get('/api/v1/platform-admins');
  assert.equal(response.status, 401);
});

test('GET /api/v1/platform-admins is refused for a platform_admin sub-admin', async () => {
  const response = await request(app)
    .get('/api/v1/platform-admins')
    .set('Authorization', `Bearer ${subAdminToken()}`);
  assert.equal(response.status, 403);
});

test('GET /api/v1/platform-admins is allowed for platform_owner', async () => {
  const response = await request(app)
    .get('/api/v1/platform-admins')
    .set('Authorization', `Bearer ${ownerToken()}`);
  assert.ok([200, 500, 503].includes(response.status), `Unexpected status: ${response.status}`);
});

test('POST /api/v1/platform-admins is refused for a platform_admin sub-admin', async () => {
  const response = await request(app)
    .post('/api/v1/platform-admins')
    .set('Authorization', `Bearer ${subAdminToken()}`)
    .send({ email: 'new-admin@jopup.io', password: 'password123', firstName: 'New', lastName: 'Admin' });
  assert.equal(response.status, 403);
});

test('POST /api/v1/platform-admins validates required fields for platform_owner', async () => {
  const response = await request(app)
    .post('/api/v1/platform-admins')
    .set('Authorization', `Bearer ${ownerToken()}`)
    .send({ email: 'not-an-email' });
  assert.equal(response.status, 400);
});

test('POST /api/v1/platform-admins accepts a well-formed request from platform_owner', async () => {
  const response = await request(app)
    .post('/api/v1/platform-admins')
    .set('Authorization', `Bearer ${ownerToken()}`)
    .send({ email: 'new-admin@jopup.io', password: 'password123', firstName: 'New', lastName: 'Admin' });
  // Passes auth + permission + validation; DB may be unavailable in CI.
  assert.ok([201, 409, 500, 503].includes(response.status), `Unexpected status: ${response.status}`);
});

test('DELETE /api/v1/platform-admins/:userId is refused for a platform_admin sub-admin', async () => {
  const response = await request(app)
    .delete('/api/v1/platform-admins/55555555-5555-5555-5555-555555555555')
    .set('Authorization', `Bearer ${subAdminToken()}`);
  assert.equal(response.status, 403);
});
