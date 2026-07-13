const state = {
  servers: [],
  selectedId: null,
  metrics: null,
  history: [],
  timer: null,
  collecting: false,
};

const $ = (selector) => document.querySelector(selector);
const list = $('#server-list');
const dialog = $('#server-dialog');
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
      <span><strong>${escapeHtml(server.name)}</strong><small>${escapeHtml(server.demo ? '可视化演示数据' : `${server.username}@${server.host}`)}</small></span>
      <span class="node-state"></span>
    </button>`).join('');
}

function setStatus(text, isError = false) {
  const status = $('#connection-status');
  status.lastChild.textContent = text;
  status.classList.toggle('error', isError);
}

function showError(message = '') {
  const banner = $('#error-banner');
  banner.textContent = message;
  banner.classList.toggle('hidden', !message);
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
  $('#system-os').textContent = metrics.os || '--';
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
  $('#process-count').textContent = `${processes.length} 个进程`;
  $('#process-table').innerHTML = processes.map((process) => `
    <tr><td><strong>${escapeHtml(process.name)}</strong><small>${escapeHtml(process.command)}</small></td><td>${process.pid}</td><td>${process.cpu.toFixed(1)}%</td><td>${bytes(process.memory)}</td><td><div class="usage-track"><span style="width:${Math.min(100, process.cpu * 3)}%"></span></div></td></tr>`).join('') || '<tr><td colspan="5">没有匹配的进程</td></tr>';
}

function drawChart() {
  const rect = chart.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  chart.width = rect.width * scale;
  chart.height = rect.height * scale;
  const ctx = chart.getContext('2d');
  ctx.scale(scale, scale);
  const width = rect.width;
  const height = rect.height;
  const padding = { top: 15, right: 8, bottom: 20, left: 30 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  ctx.font = '8px Consolas';
  ctx.fillStyle = '#53606a';
  ctx.strokeStyle = '#222b33';
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
  draw('cpu', '#9bea53');
  draw('memory', '#45d4ce');
}

async function collect() {
  if (!state.selectedId || state.collecting) return;
  state.collecting = true;
  setStatus('正在采集');
  try {
    const metrics = await window.monitor.collectMetrics(state.selectedId);
    renderMetrics(metrics);
    setStatus('连接正常');
    showError();
  } catch (error) {
    setStatus('连接异常', true);
    showError(error.message);
  } finally {
    state.collecting = false;
  }
}

function selectServer(id) {
  state.selectedId = id;
  state.metrics = null;
  state.history = [];
  renderServers();
  const server = state.servers.find((item) => item.id === id);
  $('#server-title').textContent = server?.name || '服务器概览';
  $('#edit-server').classList.toggle('hidden', server?.demo);
  clearInterval(state.timer);
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
$('#show-widget').addEventListener('click', () => window.monitor.windowAction('show-widget'));
$('#process-search').addEventListener('input', renderProcesses);
$('#auth-type').addEventListener('change', updateSecretLabel);
$('#close-dialog').addEventListener('click', () => dialog.close());
$('#cancel-dialog').addEventListener('click', () => dialog.close());
window.addEventListener('resize', drawChart);

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
  selectServer(state.servers[0].id);
});

async function init() {
  state.servers = await window.monitor.listServers();
  selectServer((state.servers.find((server) => !server.demo) || state.servers[0]).id);
}

init();
