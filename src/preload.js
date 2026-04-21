const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openModel: () => ipcRenderer.invoke('dialog:openModel'),
  convertWebmToMp4: (data) => ipcRenderer.invoke('ffmpeg:convertWebmToMp4', data),
  onProgress: (callback) => ipcRenderer.on('export-progress', callback),
  onSetLanguage: (callback) => ipcRenderer.on('set-language', (event, lang) => callback(lang)),
  openFileDialog: (options) => ipcRenderer.invoke('open-file-dialog', options),
  onFileSelected: (callback) => ipcRenderer.on('file-selected', (event, path) => callback(path)),
  selectMp4Folder: () => ipcRenderer.invoke('select-mp4-folder'),
  onMp4FolderChanged: (callback) => ipcRenderer.on('mp4-folder-changed', (event, folder) => callback(folder))
});
