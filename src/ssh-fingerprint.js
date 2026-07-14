const { createHash } = require('node:crypto');

function hostKeyFingerprints(hostKey) {
  const digest = createHash('sha256').update(hostKey).digest();
  return {
    standard: digest.toString('base64').replace(/=+$/, ''),
    legacyHex: digest.toString('hex'),
  };
}

function matchHostFingerprint(savedFingerprint, fingerprints) {
  if (!savedFingerprint) return 'missing';
  const saved = /^sha256:/i.test(savedFingerprint)
    ? savedFingerprint.slice('SHA256:'.length)
    : savedFingerprint;
  if (saved === fingerprints.standard) return 'current';
  if (/^[0-9a-f]{64}$/i.test(saved) && saved.toLowerCase() === fingerprints.legacyHex) return 'legacy';
  return 'mismatch';
}

function verifyHostKey(savedFingerprint, hostKey, handlers, callback) {
  const fingerprints = hostKeyFingerprints(hostKey);
  const match = matchHostFingerprint(savedFingerprint, fingerprints);
  if (match === 'mismatch') {
    handlers.onMismatch?.();
    callback(false);
    return;
  }
  if (match === 'current') {
    callback(true);
    return;
  }

  const reject = () => {
    handlers.onRejected?.();
    callback(false);
  };
  if (match === 'legacy') {
    Promise.resolve()
      .then(() => handlers.migrate(savedFingerprint, fingerprints.standard))
      .then(() => callback(true), reject);
    return;
  }
  Promise.resolve()
    .then(() => handlers.confirm(fingerprints.standard))
    .then((trusted) => {
      if (!trusted) handlers.onRejected?.();
      callback(Boolean(trusted));
    }, reject);
}

module.exports = { hostKeyFingerprints, matchHostFingerprint, verifyHostKey };
