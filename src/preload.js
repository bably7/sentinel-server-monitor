const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monitor', {
  listServers: () => ipcRenderer.invoke('servers:list'),
  saveServer: (server) => ipcRenderer.invoke('servers:save', server),
  deleteServer: (id) => ipcRenderer.invoke('servers:delete', id),
  selectServer: (id) => ipcRenderer.invoke('servers:selected', id),
  collectMetrics: (id) => ipcRenderer.invoke('metrics:collect', id),
  windowAction: (action) => ipcRenderer.invoke('window:action', action),
  onWindowMaximized: (callback) => ipcRenderer.on('window:maximized', (_event, value) => callback(value)),
});
