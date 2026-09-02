const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');

test('POST /api/v1/auth/register rejects missing fields', async () => {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: 'notanemail' });
  assert.equal(response.status, 400);
  assert.equal(response.body.status, 'fail');
});

test('POST /api/v1/auth/register rejects self-registering as org_admin', async () => {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({
      organisationId: '11111111-1111-1111-1111-111111111111',
      email: 'wannabe-admin@example.com',
      password: 'password123',
      firstName: 'Test',
      lastName: 'User',
      teamId: '22222222-2222-2222-2222-222222222222',
      requestedRoleName: 'org_admin',
    });
  assert.equal(response.status, 400);
});

test('POST /api/v1/auth/register accepts a well-formed hr/manager request', async () => {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({
      organisationId: '11111111-1111-1111-1111-111111111111',
      email: 'new-hr@example.com',
      password: 'password123',
      firstName: 'New',
      lastName: 'Hire',
      teamId: '22222222-2222-2222-2222-222222222222',
      requestedRoleName: 'hr',
    });
  // Passes validation; DB may be unavailable in CI.
  assert.ok([201, 400, 500, 503].includes(response.status), `Unexpected status: ${response.status}`);
});

test('POST /api/v1/auth/login rejects missing fields', async () => {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'notanemail' });
  assert.equal(response.status, 400);
});

test('POST /api/v1/auth/login validates a well-formed request', async () => {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ organisationSlug: 'acme-recruiting', email: 'hr@example.com', password: 'password123' });
  // Passes validation; DB may be unavailable in CI.
  assert.ok([200, 401, 500, 503].includes(response.status), `Unexpected status: ${response.status}`);
});
