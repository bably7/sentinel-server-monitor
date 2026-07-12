const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monitor', {
  listServers: () => ipcRenderer.invoke('servers:list'),
  saveServer: (server) => ipcRenderer.invoke('servers:save', server),
  deleteServer: (id) => ipcRenderer.invoke('servers:delete', id),
  collectMetrics: (id) => ipcRenderer.invoke('metrics:collect', id),
  windowAction: (action) => ipcRenderer.invoke('window:action', action),
});
