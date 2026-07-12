const test = require('node:test');
const assert = require('node:assert/strict');

test('basic arithmetic used for memory percentages remains stable', () => {
  const totalKb = 8_000_000;
  const availableKb = 2_000_000;
  const percent = Number((((totalKb - availableKb) / totalKb) * 100).toFixed(1));
  assert.equal(percent, 75);
});
