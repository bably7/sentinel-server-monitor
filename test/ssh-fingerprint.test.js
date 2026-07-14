const test = require('node:test');
const assert = require('node:assert/strict');
const { hostKeyFingerprints, matchHostFingerprint, verifyHostKey } = require('../src/ssh-fingerprint');

test('derives standard and legacy SHA-256 host fingerprints', () => {
  const fingerprints = hostKeyFingerprints(Buffer.from('sentinel-test-host-key'));
  assert.match(fingerprints.standard, /^[A-Za-z0-9+/]+$/);
  assert.match(fingerprints.legacyHex, /^[0-9a-f]{64}$/);
});

test('accepts current and matching legacy fingerprint formats only', () => {
  const fingerprints = hostKeyFingerprints(Buffer.from('sentinel-test-host-key'));
  assert.equal(matchHostFingerprint('', fingerprints), 'missing');
  assert.equal(matchHostFingerprint(fingerprints.standard, fingerprints), 'current');
  assert.equal(matchHostFingerprint(`SHA256:${fingerprints.standard}`, fingerprints), 'current');
  assert.equal(matchHostFingerprint(`sha256:${fingerprints.standard}`, fingerprints), 'current');
  assert.equal(matchHostFingerprint(fingerprints.legacyHex.toUpperCase(), fingerprints), 'legacy');
  assert.equal(matchHostFingerprint(`SHA256:${fingerprints.legacyHex}`, fingerprints), 'legacy');
  assert.equal(matchHostFingerprint('0'.repeat(64), fingerprints), 'mismatch');
});

test('waits for legacy migration before accepting the host key', async () => {
  const hostKey = Buffer.from('sentinel-legacy-host-key');
  const fingerprints = hostKeyFingerprints(hostKey);
  let finishMigration;
  const migration = new Promise((resolve) => (finishMigration = resolve));
  const decisions = [];

  const returned = verifyHostKey(fingerprints.legacyHex, hostKey, {
    migrate: () => migration,
    confirm: () => Promise.resolve(false),
  }, (accepted) => decisions.push(accepted));

  assert.equal(returned, undefined);
  assert.deepEqual(decisions, []);
  finishMigration();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(decisions, [true]);
});

test('rejects the host key when legacy migration fails', async () => {
  const hostKey = Buffer.from('sentinel-failed-migration-key');
  const fingerprints = hostKeyFingerprints(hostKey);
  const decisions = [];
  let rejected = false;

  verifyHostKey(fingerprints.legacyHex, hostKey, {
    migrate: () => Promise.reject(new Error('cannot persist')),
    confirm: () => Promise.resolve(false),
    onRejected: () => (rejected = true),
  }, (accepted) => decisions.push(accepted));

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rejected, true);
  assert.deepEqual(decisions, [false]);
});
