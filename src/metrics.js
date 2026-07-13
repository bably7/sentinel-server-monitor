const METRICS_COMMAND = String.raw`export LC_ALL=C; printf '%s\n' '---HOST---'; hostname; uname -sr; awk '{print $1}' /proc/uptime; printf '%s\n' '---CPU---'; awk '/^cpu / {t=$2+$3+$4+$5+$6+$7+$8+$9; a=t-$5-$6; print a,t}' /proc/stat; nproc; cat /proc/loadavg; printf '%s\n' '---MEM---'; awk '/MemTotal:/{t=$2} /MemAvailable:/{a=$2} END{print t,a}' /proc/meminfo; printf '%s\n' '---DISK---'; df -Pk -x tmpfs -x devtmpfs -x squashfs -x overlay | tail -n +2; printf '%s\n' '---PROC---'; ps -eo pid=,pcpu=,rss=,comm=,args= --sort=-pcpu | head -n 16`;

const previousCpu = new Map();

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseMetrics(output, serverId) {
  const sections = {};
  let current = '';
  for (const line of output.split(/\r?\n/)) {
    const marker = line.match(/^---(.+)---$/);
    if (marker) {
      current = marker[1];
      sections[current] = [];
    } else if (current && line.trim()) sections[current].push(line.trim());
  }

  const [hostname = '--', osName = '--', uptimeText = '0'] = sections.HOST || [];
  const [cpuTimes, coreText, loadText] = sections.CPU || [];
  const [active, total] = (cpuTimes || '').split(/\s+/).map(Number);
  const cores = Math.max(1, finiteNumber(coreText, 1));
  const rawLoad = (loadText || '').split(/\s+/).slice(0, 3);
  const load = Array.from({ length: 3 }, (_, index) => finiteNumber(rawLoad[index]));
  const previous = previousCpu.get(serverId);
  const countersValid = Number.isFinite(active) && Number.isFinite(total) && total > 0;
  let cpuPercent = (load[0] / cores) * 100;
  if (countersValid) {
    if (previous && total > previous.total && active >= previous.active) {
      cpuPercent = ((active - previous.active) / (total - previous.total)) * 100;
    }
    previousCpu.set(serverId, { active, total });
  }

  const memoryValues = (sections.MEM?.[0] || '').split(/\s+/);
  const memoryTotalKb = Math.max(0, finiteNumber(memoryValues[0]));
  const memoryAvailableKb = Math.min(memoryTotalKb, Math.max(0, finiteNumber(memoryValues[1])));
  const memoryUsedKb = memoryTotalKb - memoryAvailableKb;
  const disks = (sections.DISK || []).map((line) => {
    const parts = line.split(/\s+/);
    const totalBytes = finiteNumber(parts[1]) * 1024;
    const usedBytes = finiteNumber(parts[2]) * 1024;
    const percent = finiteNumber(parts[4]?.replace('%', ''));
    if (!parts[0] || totalBytes <= 0 || !parts[5]) return null;
    return {
      filesystem: parts[0],
      total: totalBytes,
      used: usedBytes,
      percent: Math.min(100, Math.max(0, percent)),
      mount: parts.slice(5).join(' '),
    };
  }).filter(Boolean);
  const processes = (sections.PROC || []).map((line) => {
    const match = line.match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s*(.*)$/);
    if (!match) return null;
    return {
      pid: Number(match[1]),
      cpu: finiteNumber(match[2]),
      memory: finiteNumber(match[3]) * 1024,
      name: match[4],
      command: match[5] || match[4],
    };
  }).filter(Boolean);

  return {
    timestamp: Date.now(),
    hostname,
    os: osName,
    uptime: Math.max(0, finiteNumber(uptimeText)),
    cpu: { percent: Number(Math.min(100, Math.max(0, cpuPercent)).toFixed(1)), cores, load },
    memory: {
      total: memoryTotalKb * 1024,
      used: memoryUsedKb * 1024,
      percent: memoryTotalKb ? Number(((memoryUsedKb / memoryTotalKb) * 100).toFixed(1)) : 0,
    },
    disks,
    processes,
  };
}

function clearCpuHistory(serverId) {
  previousCpu.delete(serverId);
}

module.exports = { METRICS_COMMAND, parseMetrics, clearCpuHistory };
