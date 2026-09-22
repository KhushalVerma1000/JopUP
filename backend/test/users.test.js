const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TEST_USER_ID = '99999999-9999-9999-9999-999999999999';
const OTHER_USER_ID = '88888888-8888-8888-8888-888888888888';

function token({ userId = TEST_USER_ID, roleName = 'hr', teamId = null } = {}) {
  return jwt.sign(
    {
      userId,
      organisationId: '11111111-1111-1111-1111-111111111111',
      email: 'test@example.com',
      roles: [{ teamId, roleName, permissions: {} }],
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

const auth = (opts) => ({ Authorization: `Bearer ${token(opts)}` });

test('GET /api/v1/users requires authentication', async () => {
  const response = await request(app).get('/api/v1/users');
  assert.equal(response.status, 401);
});

test('GET /api/v1/users is open to any authenticated staff (hr)', async () => {
  const response = await request(app).get('/api/v1/users').set(auth({ roleName: 'hr' }));
  // DB may be unavailable in CI — only assert it got past auth.
  assert.notEqual(response.status, 401);
  assert.notEqual(response.status, 403);
});

test('PATCH /api/v1/users/:id rejects editing someone else\'s profile without org_admin', async () => {
  const response = await request(app)
    .patch(`/api/v1/users/${OTHER_USER_ID}`)
    .set(auth({ userId: TEST_USER_ID, roleName: 'hr' }))
    .send({ firstName: 'Hacked' });
  assert.equal(response.status, 403);
});

test('PATCH /api/v1/users/:id allows editing your own profile', async () => {
  const response = await request(app)
    .patch(`/api/v1/users/${TEST_USER_ID}`)
    .set(auth({ userId: TEST_USER_ID, roleName: 'hr' }))
    .send({ firstName: 'Renamed' });
  assert.notEqual(response.status, 403);
});

test('PATCH /api/v1/users/:id/status rejects non-org_admin', async () => {
  const response = await request(app)
    .patch(`/api/v1/users/${OTHER_USER_ID}/status`)
    .set(auth({ roleName: 'manager', teamId: '22222222-2222-2222-2222-222222222222' }))
    .send({ status: 'suspended' });
  assert.equal(response.status, 403);
});

test('PATCH /api/v1/users/:id/status allows org_admin (scope=org, teamId=null)', async () => {
  const response = await request(app)
    .patch(`/api/v1/users/${OTHER_USER_ID}/status`)
    .set(auth({ roleName: 'org_admin', teamId: null }))
    .send({ status: 'suspended' });
  assert.notEqual(response.status, 403);
});

test('GET /api/v1/auth/me requires authentication', async () => {
  const response = await request(app).get('/api/v1/auth/me');
  assert.equal(response.status, 401);
});

test('GET /api/v1/auth/me returns past auth with a valid token', async () => {
  const response = await request(app).get('/api/v1/auth/me').set(auth());
  assert.notEqual(response.status, 401);
});

test('POST /api/v1/organizations rejects partial admin fields', async () => {
  const response = await request(app)
    .post('/api/v1/organizations')
    .send({
      name: 'Acme Recruiting',
      slug: 'acme-recruiting-partial',
      planId: '11111111-1111-4111-8111-111111111112',
      adminEmail: 'admin@acme.example',
      // adminPassword/adminFirstName/adminLastName deliberately omitted
    });
  assert.equal(response.status, 400);
});

test('POST /api/v1/organizations accepts a full admin bundle (validation-level)', async () => {
  const response = await request(app)
    .post('/api/v1/organizations')
    .send({
      name: 'Acme Recruiting',
      slug: 'acme-recruiting-full',
      planId: '11111111-1111-4111-8111-111111111112',
      adminEmail: 'admin@acme.example',
      adminPassword: 'password123',
      adminFirstName: 'Ada',
      adminLastName: 'Admin',
    });
  // Passes validation and the "all four or none" service-level check;
  // DB may be unavailable in CI.
  assert.ok([201, 500, 503].includes(response.status), `Unexpected status: ${response.status}`);
});

test('GET /api/v1/organizations/me is open to any authenticated staff', async () => {
  const response = await request(app).get('/api/v1/organizations/me').set(auth({ roleName: 'hr' }));
  assert.notEqual(response.status, 401);
  assert.notEqual(response.status, 403);
});

test('PATCH /api/v1/organizations/me rejects non-org_admin', async () => {
  const response = await request(app)
    .patch('/api/v1/organizations/me')
    .set(auth({ roleName: 'manager', teamId: '22222222-2222-2222-2222-222222222222' }))
    .send({ name: 'New Name' });
  assert.equal(response.status, 403);
});

test('PATCH /api/v1/organizations/me allows org_admin', async () => {
  const response = await request(app)
    .patch('/api/v1/organizations/me')
    .set(auth({ roleName: 'org_admin', teamId: null }))
    .send({ name: 'New Name' });
  assert.notEqual(response.status, 403);
});

test('GET /api/v1/organizations/by-slug/:slug requires no auth', async () => {
  const response = await request(app).get('/api/v1/organizations/by-slug/some-slug');
  // No DB in this test run — just confirm it never demands auth (401) for
  // this deliberately-public route.
  assert.notEqual(response.status, 401);
});

test('GET /api/v1/organizations/by-slug/:slug/teams requires no auth', async () => {
  const response = await request(app).get('/api/v1/organizations/by-slug/some-slug/teams');
  assert.notEqual(response.status, 401);
});
