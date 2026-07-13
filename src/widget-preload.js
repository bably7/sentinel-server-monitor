const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monitor', {
  selectedServer: () => ipcRenderer.invoke('servers:selected:get'),
  collectMetrics: (id) => ipcRenderer.invoke('metrics:collect', id),
  getBackground: () => ipcRenderer.invoke('background:get'),
  windowAction: (action) => ipcRenderer.invoke('window:action', action),
  onBackgroundChanged: (callback) => ipcRenderer.on('background:changed', (_event, background) => callback(background)),
  onSelectedServer: (callback) => ipcRenderer.on('server:selected', (_event, server) => callback(server)),
});
