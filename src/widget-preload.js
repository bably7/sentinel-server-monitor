const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monitor', {
  selectedServer: () => ipcRenderer.invoke('servers:selected:get'),
  collectMetrics: (id) => ipcRenderer.invoke('metrics:collect', id),
  windowAction: (action) => ipcRenderer.invoke('window:action', action),
  onSelectedServer: (callback) => ipcRenderer.on('server:selected', (_event, server) => callback(server)),
});
