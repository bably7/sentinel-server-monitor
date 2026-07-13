const $ = (selector) => document.querySelector(selector);
let serverId;
let serverName = '服务器监控';
let collecting = false;
let collapsed = false;

function setMetric(name, value) {
  const safeValue = Math.min(100, Math.max(0, Number(value) || 0));
  $(`#${name}-value`).textContent = `${safeValue.toFixed(1)}%`;
  $(`#${name}-bar`).style.width = `${safeValue}%`;
}

function setError(message) {
  $('#status-dot').classList.add('error');
  $('#server-name').textContent = `连接异常：${message}`;
}

function resetMetrics() {
  $('#status-dot').classList.remove('error');
  setMetric('cpu', 0);
  setMetric('memory', 0);
  $('#cpu-value').textContent = '--%';
  $('#memory-value').textContent = '--%';
}

function applyBackground(background) {
  const value = background?.dataUrl
    ? `url("${background.dataUrl}")`
    : 'url("assets/background.jpg")';
  document.documentElement.style.setProperty('--widget-image', value);
}

async function collect() {
  if (!serverId || collecting) return;
  const requestedId = serverId;
  collecting = true;
  try {
    const metrics = await window.monitor.collectMetrics(requestedId);
    if (requestedId !== serverId) return;
    $('#status-dot').classList.remove('error');
    $('#server-name').textContent = serverName;
    setMetric('cpu', metrics.cpu.percent);
    setMetric('memory', metrics.memory.percent);
  } catch (error) {
    if (requestedId === serverId) setError(error.message);
  } finally {
    collecting = false;
    if (requestedId !== serverId) collect();
  }
}

$('#refresh').addEventListener('click', collect);
$('#open-main').addEventListener('click', () => window.monitor.windowAction('show-main'));
$('#close').addEventListener('click', () => window.monitor.windowAction('close-widget'));
$('#collapse').addEventListener('click', async () => {
  collapsed = !collapsed;
  $('#widget').classList.toggle('collapsed', collapsed);
  $('#collapse').textContent = collapsed ? '+' : '−';
  $('#collapse').setAttribute('aria-expanded', String(!collapsed));
  await window.monitor.windowAction(collapsed ? 'collapse-widget' : 'expand-widget');
});

async function init() {
  const [server, background] = await Promise.all([
    window.monitor.selectedServer(),
    window.monitor.getBackground(),
  ]);
  applyBackground(background);
  serverId = server.id;
  serverName = server.name;
  resetMetrics();
  $('#server-name').textContent = serverName;
  await collect();
  setInterval(collect, 5000);
}

window.monitor.onSelectedServer((server) => {
  serverId = server.id;
  serverName = server.name;
  resetMetrics();
  $('#server-name').textContent = serverName;
  collect();
});
window.monitor.onBackgroundChanged(applyBackground);

init().catch((error) => setError(error.message));
