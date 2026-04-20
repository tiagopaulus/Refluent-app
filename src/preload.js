const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openModel: () => ipcRenderer.invoke('dialog:openModel'),
  convertWebmToMp4: (data) => ipcRenderer.invoke('ffmpeg:convertWebmToMp4', data),
  onProgress: (callback) => ipcRenderer.on('export-progress', callback)
});
