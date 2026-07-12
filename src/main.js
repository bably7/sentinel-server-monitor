const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { Client } = require('ssh2');

const SAMPLE_SERVER = {
  id: 'local-demo',
  name: '本机演示环境',
  host: '127.0.0.1',
  port: 22,
  username: '',
  authType: 'password',
  demo: true,
};

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#090d12',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#090d12', symbolColor: '#8a969f', height: 42 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function configPath() {
  return path.join(app.getPath('userData'), 'servers.json');
}

async function readServers() {
  try {
    const raw = await fs.readFile(configPath(), 'utf8');
    const servers = JSON.parse(raw);
    return [SAMPLE_SERVER, ...servers];
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Cannot read server configuration:', error);
    return [SAMPLE_SERVER];
  }
}

async function writeServers(servers) {
  const persisted = servers.filter((server) => !server.demo);
  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(persisted, null, 2), 'utf8');
}

function encryptSecret(value = '') {
  if (!value) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统无法安全保存凭据，请使用私钥文件认证');
  }
  return safeStorage.encryptString(value).toString('base64');
}

function decryptSecret(value = '') {
  if (!value) return '';
  return safeStorage.decryptString(Buffer.from(value, 'base64'));
}

function publicServer(server) {
  const { secret, ...safe } = server;
  return { ...safe, hasSecret: Boolean(secret) };
}

function collectLocalMetrics() {
  const cpus = os.cpus();
  const totals = cpus.reduce(
    (result, cpu) => {
      const times = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
      result.total += times;
      result.idle += cpu.times.idle;
      return result;
    },
    { total: 0, idle: 0 },
  );

  const totalMemory = os.totalmem();
  const usedMemory = totalMemory - os.freemem();
  const load = os.loadavg()[0];
  const cpuPercent = Math.min(100, (load / Math.max(1, cpus.length)) * 100);
  const now = Date.now();
  const wave = (offset, amplitude) => Math.max(0.1, Math.sin(now / 9000 + offset) * amplitude);

  return {
    timestamp: now,
    hostname: os.hostname(),
    os: `${os.type()} ${os.release()}`,
    uptime: os.uptime(),
    cpu: {
      percent: Number((cpuPercent || ((totals.total - totals.idle) / totals.total) * 100).toFixed(1)),
      cores: cpus.length,
      load: os.loadavg().map((value) => Number(value.toFixed(2))),
    },
    memory: {
      total: totalMemory,
      used: usedMemory,
      percent: Number(((usedMemory / totalMemory) * 100).toFixed(1)),
    },
    disks: [
      { mount: 'C:', filesystem: '本机系统盘', total: 512 * 1024 ** 3, used: 318 * 1024 ** 3, percent: 62.1 },
      { mount: 'D:', filesystem: '数据盘', total: 1024 * 1024 ** 3, used: 446 * 1024 ** 3, percent: 43.6 },
    ],
    processes: [
      { pid: 1842, name: 'api-gateway', command: 'node /apps/gateway/server.js', cpu: 12.4 + wave(0, 3), memory: 684 * 1024 ** 2 },
      { pid: 2091, name: 'postgres', command: 'postgres: writer process', cpu: 8.1 + wave(1, 2), memory: 1240 * 1024 ** 2 },
      { pid: 3320, name: 'redis-server', command: 'redis-server *:6379', cpu: 4.8 + wave(2, 1.2), memory: 426 * 1024 ** 2 },
      { pid: 4471, name: 'web-console', command: 'next-server (v15)', cpu: 3.2 + wave(3, 1), memory: 312 * 1024 ** 2 },
      { pid: 5104, name: 'worker', command: 'python /apps/tasks/worker.py', cpu: 2.1 + wave(4, 0.8), memory: 248 * 1024 ** 2 },
    ],
  };
}

const METRICS_COMMAND = String.raw`LC_ALL=C; printf '%s\n' '---HOST---'; hostname; uname -sr; awk '{print $1}' /proc/uptime; printf '%s\n' '---CPU---'; awk '/^cpu / {u=$2+$4; t=$2+$3+$4+$5+$6+$7+$8; print u,t}' /proc/stat; nproc; cat /proc/loadavg; printf '%s\n' '---MEM---'; awk '/MemTotal:/{t=$2} /MemAvailable:/{a=$2} END{print t,a}' /proc/meminfo; printf '%s\n' '---DISK---'; df -Pk -x tmpfs -x devtmpfs -x squashfs | tail -n +2; printf '%s\n' '---PROC---'; ps -eo pid=,pcpu=,rss=,comm=,args= --sort=-pcpu | head -n 16`;

function execSsh(server, command) {
  return new Promise((resolve, reject) => {
    const connection = new Client();
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      connection.end();
      error ? reject(error) : resolve(value);
    };

    const options = {
      host: server.host,
      port: Number(server.port) || 22,
      username: server.username,
      readyTimeout: 10000,
      keepaliveInterval: 5000,
    };
    if (server.authType === 'key') options.privateKey = decryptSecret(server.secret);
    else options.password = decryptSecret(server.secret);

    connection
      .on('ready', () => {
        connection.exec(command, (error, stream) => {
          if (error) return finish(error);
          let output = '';
          let stderr = '';
          stream.on('data', (data) => (output += data.toString()));
          stream.stderr.on('data', (data) => (stderr += data.toString()));
          stream.on('close', (code) => {
            if (code !== 0) return finish(new Error(stderr.trim() || `远程命令退出码 ${code}`));
            finish(null, output);
          });
        });
      })
      .on('error', (error) => finish(new Error(`SSH 连接失败：${error.message}`)))
      .connect(options);
  });
}

const previousCpu = new Map();

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

  const [hostname, osName, uptime] = sections.HOST || [];
  const [cpuTimes, coreText, loadText] = sections.CPU || [];
  const [active = 0, total = 1] = (cpuTimes || '').split(/\s+/).map(Number);
  const previous = previousCpu.get(serverId);
  let cpuPercent = previous ? ((active - previous.active) / Math.max(1, total - previous.total)) * 100 : 0;
  previousCpu.set(serverId, { active, total });
  const load = (loadText || '').split(/\s+/).slice(0, 3).map(Number);
  if (!previous) cpuPercent = (load[0] / Math.max(1, Number(coreText))) * 100;

  const [memoryTotalKb = 1, memoryAvailableKb = 0] = (sections.MEM?.[0] || '').split(/\s+/).map(Number);
  const memoryUsedKb = memoryTotalKb - memoryAvailableKb;
  const disks = (sections.DISK || []).map((line) => {
    const parts = line.split(/\s+/);
    return {
      filesystem: parts[0],
      total: Number(parts[1]) * 1024,
      used: Number(parts[2]) * 1024,
      percent: Number(parts[4]?.replace('%', '')),
      mount: parts.slice(5).join(' '),
    };
  });
  const processes = (sections.PROC || []).map((line) => {
    const match = line.match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s*(.*)$/);
    if (!match) return null;
    return {
      pid: Number(match[1]),
      cpu: Number(match[2]),
      memory: Number(match[3]) * 1024,
      name: match[4],
      command: match[5] || match[4],
    };
  }).filter(Boolean);

  return {
    timestamp: Date.now(),
    hostname,
    os: osName,
    uptime: Number(uptime),
    cpu: { percent: Number(Math.min(100, Math.max(0, cpuPercent)).toFixed(1)), cores: Number(coreText), load },
    memory: {
      total: memoryTotalKb * 1024,
      used: memoryUsedKb * 1024,
      percent: Number(((memoryUsedKb / memoryTotalKb) * 100).toFixed(1)),
    },
    disks,
    processes,
  };
}

ipcMain.handle('servers:list', async () => (await readServers()).map(publicServer));

ipcMain.handle('servers:save', async (_event, input) => {
  if (!input.name?.trim() || !input.host?.trim() || !input.username?.trim()) {
    throw new Error('名称、主机地址和用户名不能为空');
  }
  const servers = await readServers();
  const existing = servers.find((server) => server.id === input.id && !server.demo);
  const server = {
    id: existing?.id || randomUUID(),
    name: input.name.trim(),
    host: input.host.trim(),
    port: Number(input.port) || 22,
    username: input.username.trim(),
    authType: input.authType === 'key' ? 'key' : 'password',
    secret: input.secret ? encryptSecret(input.secret) : existing?.secret || '',
  };
  const next = existing
    ? servers.map((item) => (item.id === existing.id ? server : item))
    : [...servers, server];
  await writeServers(next);
  return publicServer(server);
});

ipcMain.handle('servers:delete', async (_event, id) => {
  const servers = await readServers();
  await writeServers(servers.filter((server) => server.id !== id));
  previousCpu.delete(id);
});

ipcMain.handle('metrics:collect', async (_event, id) => {
  const server = (await readServers()).find((item) => item.id === id);
  if (!server) throw new Error('服务器配置不存在');
  if (server.demo) return collectLocalMetrics();
  return parseMetrics(await execSsh(server, METRICS_COMMAND), server.id);
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
