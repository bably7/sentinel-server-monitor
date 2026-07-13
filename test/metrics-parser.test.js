const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMetrics, clearCpuHistory } = require('../src/metrics');

function sampleOutput(active, total) {
  return `---HOST---
server-01
Linux 6.8.0
86461.5
---CPU---
${active} ${total}
4
0.80 0.50 0.30 1/100 123
---MEM---
8000000 2000000
---DISK---
/dev/vda1 1000000 400000 600000 40% /
---PROC---
123 12.5 204800 node node /srv/api/server.js
456 3.2 102400 postgres postgres: writer process`;
}

test('parses Linux metrics into the renderer contract', () => {
  clearCpuHistory('test-server');
  const metrics = parseMetrics(sampleOutput(200, 1000), 'test-server');

  assert.equal(metrics.hostname, 'server-01');
  assert.equal(metrics.uptime, 86461.5);
  assert.deepEqual(metrics.cpu, { percent: 20, cores: 4, load: [0.8, 0.5, 0.3] });
  assert.equal(metrics.memory.percent, 75);
  assert.deepEqual(metrics.disks[0], {
    filesystem: '/dev/vda1',
    total: 1024000000,
    used: 409600000,
    percent: 40,
    mount: '/',
  });
  assert.equal(metrics.processes[0].name, 'node');
  assert.equal(metrics.processes[0].memory, 209715200);
});

test('uses CPU counter deltas after the first sample', () => {
  clearCpuHistory('delta-server');
  parseMetrics(sampleOutput(200, 1000), 'delta-server');
  const metrics = parseMetrics(sampleOutput(260, 1200), 'delta-server');

  assert.equal(metrics.cpu.percent, 30);
});

test('returns safe defaults for incomplete output', () => {
  clearCpuHistory('incomplete-server');
  const metrics = parseMetrics('---HOST---\nserver-02', 'incomplete-server');

  assert.equal(metrics.hostname, 'server-02');
  assert.equal(metrics.cpu.cores, 1);
  assert.deepEqual(metrics.cpu.load, [0, 0, 0]);
  assert.equal(metrics.memory.percent, 0);
  assert.deepEqual(metrics.disks, []);
  assert.deepEqual(metrics.processes, []);
});
