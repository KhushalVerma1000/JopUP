const test = require('node:test');
const assert = require('node:assert');
const { envProblems, assertProductionEnv } = require('../src/utils/checkEnv');

test('non-production never reports problems', () => {
  assert.deepStrictEqual(envProblems({ NODE_ENV: 'development' }), []);
  assert.deepStrictEqual(envProblems({}), []);
});

test('production requires APP_URL', () => {
  assert.strictEqual(envProblems({ NODE_ENV: 'production' }).length, 1);
  assert.throws(() => assertProductionEnv({ NODE_ENV: 'production' }), /APP_URL is not set/);
});

test('production rejects localhost and malformed APP_URL', () => {
  assert.strictEqual(envProblems({ NODE_ENV: 'production', APP_URL: 'http://localhost:5173' }).length, 1);
  assert.strictEqual(envProblems({ NODE_ENV: 'production', APP_URL: 'app.example.com' }).length, 1);
});

test('production accepts a real https APP_URL', () => {
  assert.deepStrictEqual(envProblems({ NODE_ENV: 'production', APP_URL: 'https://app.example.com' }), []);
  assert.doesNotThrow(() => assertProductionEnv({ NODE_ENV: 'production', APP_URL: 'https://app.example.com' }));
});
