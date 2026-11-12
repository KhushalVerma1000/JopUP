const test = require('node:test');
const assert = require('node:assert/strict');
const { describeError } = require('../src/utils/describeError');

test('a wrapped database error shows its real cause, not just the SQL', () => {
  const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
  const err = new Error('Failed query: update "daily_tracker_run" set "status" = $1\nparams: failed');
  err.cause = cause;
  assert.equal(describeError(err), 'Failed query: update "daily_tracker_run" set "status" = $1 ← caused by: connect ECONNREFUSED 127.0.0.1:5432 [ECONNREFUSED]');
});

test('plain errors, strings and loops are safe', () => {
  assert.equal(describeError(new Error('boom')), 'boom');
  assert.equal(describeError('oops'), 'oops');
  const a = new Error('a'); a.cause = a;
  assert.equal(describeError(a), 'a');
});
