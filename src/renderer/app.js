const state = {
  servers: [],
  selectedId: null,
  metrics: null,
  history: [],
  timer: null,
  collecting: false,
  backgroundCustom: false,
};

const $ = (selector) => document.querySelector(selector);
const list = $('#server-list');
const dialog = $('#server-dialog');
const backgroundDialog = $('#background-dialog');
const form = $('#server-form');
const chart = $('#history-chart');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function bytes(value) {
  if (!Number.isFinite(value)) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(size >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function duration(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}天 ${hours}小时` : `${hours}小时 ${minutes}分钟`;
}

function renderServers() {
  list.innerHTML = state.servers.map((server) => `
    <button class="server-item ${server.id === state.selectedId ? 'active' : ''}" data-id="${escapeHtml(server.id)}">
      <span class="node-icon">${server.demo ? 'PC' : 'SSH'}</span>
      <span><strong>${escapeHtml(server.name)}</strong></span>
      <span class="node-state"></span>
    </button>`).join('');
}

function setStatus(text, isError = false) {
  const status = $('#connection-status');
  status.lastChild.textContent = text;
  status.classList.toggle('error', isError);
  $('#monitor-state').textContent = isError ? '服务器连接异常' : text;
  $('#monitor-dot').classList.toggle('error', isError);
}

function showError(message = '') {
  const banner = $('#error-banner');
  banner.textContent = message;
  banner.classList.toggle('hidden', !message);
}

function applyBackground(background) {
  state.backgroundCustom = Boolean(background?.custom);
  const value = background?.dataUrl
    ? `url("${background.dataUrl}")`
    : 'url("assets/background.jpg")';
  document.documentElement.style.setProperty('--wallpaper-image', value);
  $('#reset-background').disabled = !background?.custom;
}

function setBackgroundBusy(busy) {
  $('#choose-background').disabled = busy;
  $('#reset-background').disabled = busy || !state.backgroundCustom;
}

function resetMetricsDisplay() {
  state.metrics = null;
  state.history = [];
  $('#cpu-value').textContent = '--';
  $('#cpu-cores').textContent = '-- 核心';
  $('#cpu-load').textContent = '负载 -- / -- / --';
  $('#cpu-gauge').style.setProperty('--value', 0);
  $('#memory-value').textContent = '--';
  $('#memory-detail').textContent = '-- / --';
  $('#memory-free').textContent = '剩余 --';
  $('#memory-gauge').style.setProperty('--value', 0);
  $('#uptime-value').textContent = '--';
  $('#last-update').textContent = '正在获取数据';
  $('#disk-count').textContent = '0 卷';
  $('#disk-list').innerHTML = '<div class="empty">正在获取存储数据</div>';
  $('#process-count').textContent = '0 个进程';
  $('#process-table').innerHTML = '<tr><td colspan="5">正在获取进程数据</td></tr>';
  drawChart();
}

function renderMetrics(metrics) {
  state.metrics = metrics;
  state.history.push({ cpu: metrics.cpu.percent, memory: metrics.memory.percent });
  if (state.history.length > 40) state.history.shift();

  $('#cpu-value').textContent = metrics.cpu.percent.toFixed(1);
  $('#cpu-cores').textContent = `${metrics.cpu.cores} 核心`;
  $('#cpu-load').textContent = `负载 ${metrics.cpu.load.map((v) => v.toFixed(2)).join(' / ')}`;
  $('#cpu-gauge').style.setProperty('--value', metrics.cpu.percent);
  $('#memory-value').textContent = metrics.memory.percent.toFixed(1);
  $('#memory-detail').textContent = `${bytes(metrics.memory.used)} / ${bytes(metrics.memory.total)}`;
  $('#memory-free').textContent = `剩余 ${bytes(metrics.memory.total - metrics.memory.used)}`;
  $('#memory-gauge').style.setProperty('--value', metrics.memory.percent);
  $('#uptime-value').textContent = duration(metrics.uptime);
  $('#server-title').textContent = state.servers.find((server) => server.id === state.selectedId)?.name || '服务器概览';
  $('#last-update').textContent = `最后更新 ${new Date(metrics.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}`;

  $('#disk-count').textContent = `${metrics.disks.length} 卷`;
  $('#disk-list').innerHTML = metrics.disks.map((disk) => `
    <div class="disk-item">
      <span class="disk-letter">${escapeHtml(disk.mount.slice(0, 3))}</span>
      <div class="disk-info"><strong>${escapeHtml(disk.filesystem)}</strong><small>${bytes(disk.used)} / ${bytes(disk.total)}</small><div class="disk-track"><div class="disk-fill" style="width:${Math.min(100, disk.percent)}%;background:${disk.percent > 85 ? '#ff6b61' : disk.percent > 70 ? '#ffb454' : ''}"></div></div></div>
      <span class="disk-percent">${disk.percent.toFixed(0)}%</span>
    </div>`).join('') || '<div class="empty">未发现持久化磁盘</div>';

  renderProcesses();
  drawChart();
}

function renderProcesses() {
  const search = $('#process-search').value.trim().toLowerCase();
  const processes = (state.metrics?.processes || []).filter((process) => `${process.name} ${process.command}`.toLowerCase().includes(search));
  const visibleProcesses = processes.slice(0, 4);
  $('#process-count').textContent = processes.length > 4 ? `${processes.length} 个 · 显示前 4` : `${processes.length} 个进程`;
  $('#process-table').innerHTML = visibleProcesses.map((process) => `
    <tr><td><strong>${escapeHtml(process.name)}</strong><small title="${escapeHtml(process.command)}">${escapeHtml(process.command)}</small></td><td>${process.pid}</td><td>${process.cpu.toFixed(1)}%</td><td>${bytes(process.memory)}</td><td><div class="usage-track"><span style="width:${Math.min(100, process.cpu * 3)}%"></span></div></td></tr>`).join('') || '<tr><td colspan="5">没有匹配的进程</td></tr>';
}

function drawChart() {
  const rect = chart.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  chart.width = rect.width * scale;
  chart.height = rect.height * scale;
  const ctx = chart.getContext('2d');
  const styles = getComputedStyle(document.documentElement);
  ctx.scale(scale, scale);
  const width = rect.width;
  const height = rect.height;
  const padding = { top: 15, right: 8, bottom: 20, left: 30 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  ctx.font = '8px Consolas';
  ctx.fillStyle = styles.getPropertyValue('--chart-label').trim();
  ctx.strokeStyle = styles.getPropertyValue('--chart-grid').trim();
  ctx.lineWidth = 1;
  for (let percent = 0; percent <= 100; percent += 25) {
    const y = padding.top + innerHeight - (percent / 100) * innerHeight;
    ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(width - padding.right, y); ctx.stroke();
    ctx.fillText(`${percent}%`, 1, y + 3);
  }

  const draw = (key, color) => {
    if (state.history.length < 2) return;
    ctx.beginPath();
    state.history.forEach((point, index) => {
      const x = padding.left + (index / Math.max(39, state.history.length - 1)) * innerWidth;
      const y = padding.top + innerHeight - (point[key] / 100) * innerHeight;
      index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 1.7; ctx.shadowColor = color; ctx.shadowBlur = 7; ctx.stroke(); ctx.shadowBlur = 0;
  };
  draw('cpu', styles.getPropertyValue('--green').trim());
  draw('memory', styles.getPropertyValue('--cyan').trim());
}

async function collect() {
  if (!state.selectedId || state.collecting) return;
  const requestedId = state.selectedId;
  state.collecting = true;
  setStatus('正在采集');
  try {
    const metrics = await window.monitor.collectMetrics(requestedId);
    if (requestedId !== state.selectedId) return;
    renderMetrics(metrics);
    setStatus('连接正常');
    showError();
  } catch (error) {
    if (requestedId === state.selectedId) {
      setStatus('连接异常', true);
      showError(error.message);
    }
  } finally {
    state.collecting = false;
    if (requestedId !== state.selectedId) collect();
  }
}

async function selectServer(id) {
  state.selectedId = id;
  resetMetricsDisplay();
  setStatus('正在切换');
  showError();
  renderServers();
  const server = state.servers.find((item) => item.id === id);
  $('#server-title').textContent = server?.name || '服务器概览';
  $('#edit-server').classList.toggle('hidden', server?.demo);
  clearInterval(state.timer);
  try {
    await window.monitor.selectServer(id);
  } catch (error) {
    showError(error.message);
    return;
  }
  if (id !== state.selectedId) return;
  collect();
  state.timer = setInterval(collect, 5000);
}

function openDialog(server = null) {
  form.reset();
  $('#server-port').value = server?.port || 22;
  $('#server-id').value = server?.id || '';
  $('#server-name').value = server?.name || '';
  $('#server-host').value = server?.host || '';
  $('#server-username').value = server?.username || '';
  $('#auth-type').value = server?.authType || 'password';
  $('#dialog-title').textContent = server ? '编辑服务器' : '添加服务器';
  $('#delete-server').classList.toggle('hidden', !server);
  $('#reset-fingerprint-row').classList.toggle('hidden', !server);
  $('#reset-fingerprint').checked = false;
  updateSecretLabel();
  dialog.showModal();
}

function updateSecretLabel() {
  const isKey = $('#auth-type').value === 'key';
  $('#secret-label').textContent = isKey ? 'OpenSSH 私钥内容' : 'SSH 密码';
  $('#server-secret').placeholder = isKey ? '粘贴 -----BEGIN OPENSSH PRIVATE KEY----- 内容' : '编辑时留空将保留原凭据';
}

list.addEventListener('click', (event) => {
  const button = event.target.closest('.server-item');
  if (button) selectServer(button.dataset.id);
});
$('#add-server').addEventListener('click', () => openDialog());
$('#edit-server').addEventListener('click', () => openDialog(state.servers.find((server) => server.id === state.selectedId)));
$('#refresh').addEventListener('click', collect);
$('#background-settings').addEventListener('click', () => backgroundDialog.showModal());
$('#show-widget').addEventListener('click', () => window.monitor.windowAction('show-widget'));
$('#window-minimize').addEventListener('click', () => window.monitor.windowAction('minimize-main'));
$('#window-maximize').addEventListener('click', () => window.monitor.windowAction('toggle-maximize-main'));
$('#window-close').addEventListener('click', () => window.monitor.windowAction('close-main'));
$('#process-search').addEventListener('input', renderProcesses);
$('#auth-type').addEventListener('change', updateSecretLabel);
$('#close-dialog').addEventListener('click', () => dialog.close());
$('#cancel-dialog').addEventListener('click', () => dialog.close());
$('#close-background-dialog').addEventListener('click', () => backgroundDialog.close());
$('#choose-background').addEventListener('click', async () => {
  setBackgroundBusy(true);
  try {
    const result = await window.monitor.chooseBackground();
    if (!result) return;
    backgroundDialog.close();
  } catch (error) {
    alert(error.message);
  } finally {
    setBackgroundBusy(false);
  }
});
$('#reset-background').addEventListener('click', async () => {
  setBackgroundBusy(true);
  try {
    await window.monitor.resetBackground();
    backgroundDialog.close();
  } catch (error) {
    alert(error.message);
  } finally {
    setBackgroundBusy(false);
  }
});
window.addEventListener('resize', drawChart);
window.monitor.onBackgroundChanged(applyBackground);
window.monitor.onWindowMaximized((maximized) => {
  document.body.classList.toggle('maximized', maximized);
  $('#window-maximize').textContent = maximized ? '❐' : '□';
  $('#window-maximize').title = maximized ? '还原' : '最大化';
  $('#window-maximize').setAttribute('aria-label', maximized ? '还原窗口' : '最大化窗口');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const server = await window.monitor.saveServer({
      id: $('#server-id').value || undefined,
      name: $('#server-name').value,
      host: $('#server-host').value,
      port: $('#server-port').value,
      username: $('#server-username').value,
      authType: $('#auth-type').value,
      secret: $('#server-secret').value,
      resetFingerprint: $('#reset-fingerprint').checked,
    });
    state.servers = await window.monitor.listServers();
    dialog.close();
    selectServer(server.id);
  } catch (error) {
    alert(error.message);
  }
});

$('#delete-server').addEventListener('click', async () => {
  const id = $('#server-id').value;
  if (!id || !confirm('确定删除这个服务器节点吗？')) return;
  await window.monitor.deleteServer(id);
  state.servers = await window.monitor.listServers();
  dialog.close();
  selectServer((state.servers.find((server) => !server.demo) || state.servers[0]).id);
});

async function init() {
  const [servers, background] = await Promise.all([
    window.monitor.listServers(),
    window.monitor.getBackground(),
  ]);
  state.servers = servers;
  applyBackground(background);
  selectServer((state.servers.find((server) => !server.demo) || state.servers[0]).id);
}

init();
