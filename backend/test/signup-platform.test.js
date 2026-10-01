const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');

const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
const tokenFor = (roleName, permissions) =>
  jwt.sign(
    { userId: '00000000-0000-0000-0000-000000000001', organisationId: '00000000-0000-0000-0000-000000000002', email: 'x@y.z', roles: [{ teamId: null, roleName, permissions }] },
    secret,
    { expiresIn: '5m' }
  );

test('POST /api/v1/auth/signup rejects a short password and missing company', async () => {
  const res = await request(app).post('/api/v1/auth/signup').send({ email: 'a@b.co', password: 'short' });
  assert.equal(res.status, 400);
  assert.equal(res.body.status, 'fail');
});

test('POST /api/v1/auth/signup rejects an invalid email', async () => {
  const res = await request(app).post('/api/v1/auth/signup').send({
    companyName: 'Test Co', firstName: 'A', lastName: 'B', email: 'nope', password: 'password123',
  });
  assert.equal(res.status, 400);
});

test('GET /api/v1/platform/metrics requires authentication', async () => {
  const res = await request(app).get('/api/v1/platform/metrics');
  assert.equal(res.status, 401);
});

test('GET /api/v1/platform/metrics is forbidden for tenant roles', async () => {
  const token = tokenFor('org_admin', { teams: ['read'] });
  const res = await request(app).get('/api/v1/platform/metrics').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 403);
});

test('POST /api/v1/plans is no longer public', async () => {
  const res = await request(app).post('/api/v1/plans').send({ name: 'Free', slug: 'free' });
  assert.equal(res.status, 401);
});

test('POST /api/v1/plans is forbidden without plans:write', async () => {
  const token = tokenFor('org_admin', { teams: ['read'] });
  const res = await request(app).post('/api/v1/plans').set('Authorization', `Bearer ${token}`).send({ name: 'Free', slug: 'free' });
  assert.equal(res.status, 403);
});
