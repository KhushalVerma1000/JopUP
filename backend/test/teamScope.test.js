const test = require('node:test');
const assert = require('node:assert/strict');
const { visibleTeamIds, canSeeTeam } = require('../src/utils/teamScope');

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';

test('org-level org_admin sees every team (null = unrestricted)', () => {
  const user = { roles: [{ roleName: 'org_admin', teamId: null }] };
  assert.equal(visibleTeamIds(user), null);
  assert.equal(canSeeTeam(user, T1), true);
});

test('hr and manager see only the teams they hold a role in, de-duplicated', () => {
  const user = { roles: [{ roleName: 'hr', teamId: T1 }, { roleName: 'manager', teamId: T1 }, { roleName: 'hr', teamId: T2 }] };
  assert.deepEqual(visibleTeamIds(user).sort(), [T1, T2].sort());
  assert.equal(canSeeTeam(user, T1), true);
  assert.equal(canSeeTeam(user, T3), false);
});

test('a team-scoped org_admin role is NOT org-wide', () => {
  const user = { roles: [{ roleName: 'org_admin', teamId: T1 }] };
  assert.deepEqual(visibleTeamIds(user), [T1]);
  assert.equal(canSeeTeam(user, T2), false);
});

test('no roles / no user fails closed', () => {
  assert.deepEqual(visibleTeamIds({ roles: [] }), []);
  assert.deepEqual(visibleTeamIds(undefined), []);
  assert.equal(canSeeTeam(undefined, T1), false);
});

test('a role with no team that is not org_admin grants nothing', () => {
  const user = { roles: [{ roleName: 'hr', teamId: null }] };
  assert.deepEqual(visibleTeamIds(user), []);
});
