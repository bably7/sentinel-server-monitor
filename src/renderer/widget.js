const $ = (selector) => document.querySelector(selector);
let serverId;
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

async function collect() {
  if (!serverId || collecting) return;
  collecting = true;
  try {
    const metrics = await window.monitor.collectMetrics(serverId);
    $('#status-dot').classList.remove('error');
    $('#server-name').textContent = metrics.hostname || '服务器在线';
    setMetric('cpu', metrics.cpu.percent);
    setMetric('memory', metrics.memory.percent);
  } catch (error) {
    setError(error.message);
  } finally {
    collecting = false;
  }
}

$('#refresh').addEventListener('click', collect);
$('#open-main').addEventListener('click', () => window.monitor.windowAction('show-main'));
$('#close').addEventListener('click', () => window.monitor.windowAction('close-widget'));
$('#collapse').addEventListener('click', async () => {
  collapsed = !collapsed;
  $('#widget').classList.toggle('collapsed', collapsed);
  $('#collapse').textContent = collapsed ? '+' : '−';
  await window.monitor.windowAction(collapsed ? 'collapse-widget' : 'expand-widget');
});

async function init() {
  const servers = await window.monitor.listServers();
  const server = servers.find((item) => !item.demo) || servers[0];
  serverId = server.id;
  $('#server-name').textContent = server.name;
  await collect();
  setInterval(collect, 5000);
}

init().catch((error) => setError(error.message));
