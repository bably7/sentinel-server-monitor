const { app, BrowserWindow, ipcMain, safeStorage, screen, nativeTheme, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const fs = require('node:fs/promises');
const { randomUUID, createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { Client } = require('ssh2');
const { METRICS_COMMAND, parseMetrics, clearCpuHistory } = require('./metrics');

const SAMPLE_SERVER = {
  id: 'local-demo',
  name: '本机演示环境',
  host: '127.0.0.1',
  port: 22,
  username: '',
  authType: 'password',
  demo: true,
};

let mainWindow;
let widgetWindow;
let mainRestoreBounds;
let selectedServerId;
let serverMutationQueue = Promise.resolve();
let serverSelectionQueue = Promise.resolve();
const regionQueues = new WeakMap();
const regionTimers = new WeakMap();
const fingerprintChecks = new Map();

function nativeWindowHandle(window) {
  const handle = window.getNativeWindowHandle();
  return handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
}

function applyWindowRegion(window, radius) {
  if (!window || window.isDestroyed() || process.platform !== 'win32') return Promise.resolve();
  const previous = regionQueues.get(window) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => new Promise((resolve) => {
    if (window.isDestroyed()) return resolve();
    const script = path.join(__dirname, 'window-region.ps1').replace('app.asar', 'app.asar.unpacked');
    const clear = radius === 0 ? '1' : '0';
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, nativeWindowHandle(window), String(radius), clear],
      { windowsHide: true, timeout: 5000 },
      (error) => {
        if (error) console.error('Cannot apply rounded window region:', error.message);
        resolve();
      },
    );
  }));
  regionQueues.set(window, next);
  return next;
}

function scheduleWindowRegion(window, radius) {
  clearTimeout(regionTimers.get(window));
  regionTimers.set(window, setTimeout(() => applyWindowRegion(window, radius), 120));
}

function windowOptions(preload = 'preload.js') {
  return {
    preload: path.join(__dirname, preload),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

function rendererUrl(file) {
  return pathToFileURL(path.join(__dirname, 'renderer', file)).href;
}

function hardenWindow(window, file) {
  const allowedUrl = rendererUrl(file);
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== allowedUrl) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function requireRenderer(event, allowedWindows) {
  const source = BrowserWindow.fromWebContents(event.sender);
  const allowed = allowedWindows.some(({ window, file }) => source === window && event.senderFrame?.url === rendererUrl(file));
  if (!allowed || event.senderFrame !== event.sender.mainFrame) throw new Error('不允许的应用调用来源');
  return source;
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(1440, workArea.width);
  const height = Math.min(900, workArea.height);
  mainWindow = new BrowserWindow({
    width,
    height,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    resizable: false,
    maximizable: false,
    show: false,
    frame: false,
    transparent: true,
    roundedCorners: true,
    hasShadow: false,
    backgroundMaterial: 'none',
    backgroundColor: '#00000000',
    webPreferences: windowOptions(),
  });

  hardenWindow(mainWindow, 'index.html');
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', async () => {
    await applyWindowRegion(mainWindow, 22);
    mainWindow.show();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    mainRestoreBounds = null;
  });
}

function createWidget() {
  const { workArea } = screen.getPrimaryDisplay();
  widgetWindow = new BrowserWindow({
    width: 318,
    height: 148,
    x: workArea.x + workArea.width - 338,
    y: workArea.y + 20,
    minWidth: 280,
    minHeight: 48,
    maxWidth: 420,
    maxHeight: 240,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundMaterial: 'none',
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: windowOptions('widget-preload.js'),
  });
  widgetWindow.setAlwaysOnTop(true, 'floating');
  widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hardenWindow(widgetWindow, 'widget.html');
  widgetWindow.loadFile(path.join(__dirname, 'renderer', 'widget.html'));
  widgetWindow.once('ready-to-show', async () => {
    await applyWindowRegion(widgetWindow, 20);
    widgetWindow.showInactive();
  });
  widgetWindow.on('resized', () => scheduleWindowRegion(widgetWindow, 20));
  widgetWindow.on('closed', () => (widgetWindow = null));
}

function configPath() {
  return path.join(app.getPath('userData'), 'servers.json');
}

async function readServers() {
  try {
    const raw = await fs.readFile(configPath(), 'utf8');
    const servers = JSON.parse(raw);
    if (!Array.isArray(servers)) throw new Error('配置内容不是服务器列表');
    return [SAMPLE_SERVER, ...servers];
  } catch (error) {
    try {
      const backup = JSON.parse(await fs.readFile(`${configPath()}.bak`, 'utf8'));
      if (!Array.isArray(backup)) throw new Error('备份配置内容不是服务器列表');
      return [SAMPLE_SERVER, ...backup];
    } catch (backupError) {
      if (error.code === 'ENOENT' && backupError.code === 'ENOENT') return [SAMPLE_SERVER];
      throw new Error(`服务器配置损坏且无法恢复：${error.message}`);
    }
  }
}

async function writeServers(servers) {
  const persisted = servers.filter((server) => !server.demo);
  const target = configPath();
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(persisted, null, 2), 'utf8');
  await fs.rename(temporary, target);
  try {
    await fs.copyFile(target, `${target}.bak`);
  } catch (error) {
    console.error('Cannot update server configuration backup:', error);
  }
}

function mutateServers(mutator) {
  const operation = serverMutationQueue.then(async () => {
    const servers = await readServers();
    const result = await mutator(servers);
    await writeServers(servers);
    return result;
  });
  serverMutationQueue = operation.catch(() => {});
  return operation;
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
  const { secret, hostFingerprint, ...safe } = server;
  return { ...safe, hasSecret: Boolean(secret) };
}

function resolveSelectedServer(servers) {
  return servers.find((server) => server.id === selectedServerId)
    || servers.find((server) => !server.demo)
    || servers[0];
}

async function confirmFingerprint(server, fingerprint) {
  const key = `${server.id}:${fingerprint}`;
  if (fingerprintChecks.has(key)) return fingerprintChecks.get(key);
  const check = (async () => {
    const options = {
      type: 'warning',
      buttons: ['信任并连接', '取消'],
      defaultId: 1,
      cancelId: 1,
      title: '确认 SSH 主机密钥',
      message: `首次连接 ${server.name}`,
      detail: `请确认服务器 SSH SHA-256 指纹：\n\nSHA256:${fingerprint}\n\n确认后才会发送登录凭据。`,
      noLink: true,
    };
    const result = mainWindow?.isVisible()
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
    if (result.response !== 0) return false;
    await mutateServers((servers) => {
      const current = servers.find((item) => item.id === server.id);
      if (!current || current.host !== server.host || current.port !== server.port) {
        throw new Error('服务器配置已变化，请重新连接');
      }
      if (current.hostFingerprint && current.hostFingerprint !== fingerprint) {
        throw new Error('服务器主机密钥与已保存记录不一致');
      }
      current.hostFingerprint = fingerprint;
      server.hostFingerprint = fingerprint;
    });
    return true;
  })().finally(() => fingerprintChecks.delete(key));
  fingerprintChecks.set(key, check);
  return check;
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

function execSsh(server, command) {
  return new Promise((resolve, reject) => {
    const connection = new Client();
    let settled = false;
    let fingerprintMismatch = false;
    let fingerprintRejected = false;
    let timeout = setTimeout(() => finish(new Error('SSH 连接超时，请检查网络并重新连接')), 120000);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      connection.end();
      error ? reject(error) : resolve(value);
    };

    const options = {
      host: server.host,
      port: Number(server.port) || 22,
      username: server.username,
      readyTimeout: 120000,
      keepaliveInterval: 5000,
      hostVerifier: (hostKey, callback) => {
        const fingerprint = createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '');
        fingerprintMismatch = Boolean(server.hostFingerprint && server.hostFingerprint !== fingerprint);
        if (fingerprintMismatch) return callback(false);
        if (server.hostFingerprint) return callback(true);
        confirmFingerprint(server, fingerprint).then((trusted) => {
          fingerprintRejected = !trusted;
          callback(trusted);
        }, () => {
          fingerprintRejected = true;
          callback(false);
        });
      },
    };
    if (server.authType === 'key') options.privateKey = decryptSecret(server.secret);
    else options.password = decryptSecret(server.secret);

    connection
      .on('ready', () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => finish(new Error('SSH 采集超时，请检查服务器负载')), 20000);
        connection.exec(command, (error, stream) => {
          if (error) return finish(error);
          let output = '';
          let stderr = '';
          let outputBytes = 0;
          const append = (target, data) => {
            outputBytes += data.length;
            if (outputBytes > 2 * 1024 * 1024) {
              stream.close();
              finish(new Error('服务器返回的数据超过 2 MB，已中止采集'));
              return target;
            }
            return target + data.toString();
          };
          stream.on('data', (data) => (output = append(output, data)));
          stream.stderr.on('data', (data) => (stderr = append(stderr, data)));
          stream.on('close', (code) => {
            if (code !== 0) return finish(new Error(stderr.trim() || `远程命令退出码 ${code}`));
            finish(null, output);
          });
        });
      })
      .on('error', (error) => finish(new Error(fingerprintMismatch
        ? 'SSH 主机密钥已变化，已阻止连接。请确认服务器是否重装或存在中间人风险'
        : fingerprintRejected
          ? '未信任 SSH 主机密钥，连接已取消'
          : `SSH 连接失败：${error.message}`)))
      .connect(options);
  });
}

const metricsCache = new Map();

function serverSignature(server) {
  return [server.host, server.port, server.username, server.authType, server.secret, server.hostFingerprint].join('\0');
}

async function collectServerMetrics(server) {
  let signature = serverSignature(server);
  const cached = metricsCache.get(server.id);
  if (cached?.signature === signature && cached.data && Date.now() - cached.timestamp < 2000) return cached.data;
  if (cached?.signature === signature && cached.inflight) return cached.inflight;

  const token = Symbol(server.id);
  const entry = { data: cached?.data, timestamp: cached?.timestamp || 0, inflight: null, signature, token };
  metricsCache.set(server.id, entry);
  const inflight = (async () => {
    let data;
    if (server.demo) data = collectLocalMetrics();
    else {
      const output = await execSsh(server, METRICS_COMMAND);
      if (metricsCache.get(server.id)?.token !== token) throw new Error('服务器配置已变化，已丢弃旧采集结果');
      data = parseMetrics(output, server.id);
      signature = serverSignature(server);
    }
    if (metricsCache.get(server.id)?.token === token) {
      metricsCache.set(server.id, { data, timestamp: Date.now(), inflight: null, signature, token });
    }
    return data;
  })();
  entry.inflight = inflight;
  try {
    return await inflight;
  } catch (error) {
    if (metricsCache.get(server.id)?.token === token) metricsCache.delete(server.id);
    throw error;
  }
}

ipcMain.handle('servers:list', async (event) => {
  requireRenderer(event, [{ window: mainWindow, file: 'index.html' }, { window: widgetWindow, file: 'widget.html' }]);
  return (await readServers()).map(publicServer);
});

ipcMain.handle('servers:selected:get', async (event) => {
  requireRenderer(event, [{ window: widgetWindow, file: 'widget.html' }]);
  return publicServer(resolveSelectedServer(await readServers()));
});

ipcMain.handle('servers:selected', async (event, id) => {
  requireRenderer(event, [{ window: mainWindow, file: 'index.html' }]);
  const operation = serverSelectionQueue.then(async () => {
    const server = (await readServers()).find((item) => item.id === id);
    if (!server) throw new Error('服务器配置不存在');
    selectedServerId = server.id;
    widgetWindow?.webContents.send('server:selected', publicServer(server));
    return publicServer(server);
  });
  serverSelectionQueue = operation.catch(() => {});
  return operation;
});

ipcMain.handle('servers:save', async (event, input) => {
  requireRenderer(event, [{ window: mainWindow, file: 'index.html' }]);
  if (!input
    || typeof input.name !== 'string'
    || typeof input.host !== 'string'
    || typeof input.username !== 'string'
    || typeof input.secret !== 'string'
    || !input.name.trim()
    || !input.host.trim()
    || !input.username.trim()) {
    throw new Error('名称、主机地址和用户名不能为空');
  }
  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SSH 端口必须在 1 到 65535 之间');
  const authType = input.authType === 'key' ? 'key' : 'password';
  const server = await mutateServers((servers) => {
    const existing = servers.find((item) => item.id === input.id && !item.demo);
    if (!existing && !input.secret) throw new Error('新服务器必须填写密码或私钥');
    const identityUnchanged = existing
      && existing.host === input.host.trim()
      && existing.port === port
      && existing.username === input.username.trim()
      && existing.authType === authType;
    if (existing && !identityUnchanged && !input.secret) throw new Error('更改地址、用户或认证方式时必须填写新的凭据');
    const updated = {
      id: existing?.id || randomUUID(),
      name: input.name.trim(),
      host: input.host.trim(),
      port,
      username: input.username.trim(),
      authType,
      secret: input.secret ? encryptSecret(input.secret) : existing.secret,
      hostFingerprint: !input.resetFingerprint && existing && existing.host === input.host.trim() && existing.port === port
        ? existing.hostFingerprint || ''
        : '',
    };
    if (existing) Object.assign(existing, updated);
    else servers.push(updated);
    return updated;
  });
  metricsCache.delete(server.id);
  clearCpuHistory(server.id);
  return publicServer(server);
});

ipcMain.handle('servers:delete', async (event, id) => {
  requireRenderer(event, [{ window: mainWindow, file: 'index.html' }]);
  let nextSelected;
  await mutateServers((servers) => {
    const index = servers.findIndex((server) => server.id === id && !server.demo);
    if (index < 0) throw new Error('服务器配置不存在');
    servers.splice(index, 1);
    nextSelected = resolveSelectedServer(servers);
  });
  metricsCache.delete(id);
  clearCpuHistory(id);
  if (selectedServerId === id) {
    selectedServerId = nextSelected.id;
    widgetWindow?.webContents.send('server:selected', publicServer(nextSelected));
  }
});

ipcMain.handle('metrics:collect', async (event, id) => {
  const source = requireRenderer(event, [{ window: mainWindow, file: 'index.html' }, { window: widgetWindow, file: 'widget.html' }]);
  const servers = await readServers();
  const server = servers.find((item) => item.id === id);
  if (!server) throw new Error('服务器配置不存在');
  if (source === widgetWindow && server.id !== resolveSelectedServer(servers).id) {
    throw new Error('浮窗服务器已变化，请重试');
  }
  return collectServerMetrics(server);
});

ipcMain.handle('window:action', (event, action) => {
  const sourceWindow = requireRenderer(event, [{ window: mainWindow, file: 'index.html' }, { window: widgetWindow, file: 'widget.html' }]);
  if (action === 'show-main') {
    if (!mainWindow) createWindow();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  } else if (action === 'show-widget') {
    if (!widgetWindow) createWidget();
    else widgetWindow.show();
  } else if (action === 'minimize-main' && sourceWindow === mainWindow) {
    mainWindow.minimize();
  } else if (action === 'toggle-maximize-main' && sourceWindow === mainWindow) {
    if (mainRestoreBounds) {
      mainWindow.setBounds(mainRestoreBounds);
      mainRestoreBounds = null;
      applyWindowRegion(mainWindow, 22);
      mainWindow.webContents.send('window:maximized', false);
    } else {
      mainRestoreBounds = mainWindow.getBounds();
      const display = screen.getDisplayMatching(mainRestoreBounds);
      mainWindow.setBounds(display.workArea);
      applyWindowRegion(mainWindow, 0);
      mainWindow.webContents.send('window:maximized', true);
    }
  } else if (action === 'close-main' && sourceWindow === mainWindow) {
    mainWindow.close();
  } else if (action === 'collapse-widget' && sourceWindow === widgetWindow) {
    widgetWindow.setSize(widgetWindow.getSize()[0], 52, true);
  } else if (action === 'expand-widget' && sourceWindow === widgetWindow) {
    widgetWindow.setSize(widgetWindow.getSize()[0], 148, true);
  } else if (action === 'close-widget' && sourceWindow === widgetWindow) {
    widgetWindow.close();
  }
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) createWindow();
    else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    nativeTheme.themeSource = 'system';
    createWindow();
    createWidget();
    nativeTheme.on('updated', () => {
      if (mainWindow) applyWindowRegion(mainWindow, mainRestoreBounds ? 0 : 22);
      if (widgetWindow) applyWindowRegion(widgetWindow, 20);
    });
    app.on('activate', () => {
      if (!mainWindow) createWindow();
      if (!widgetWindow) createWidget();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
