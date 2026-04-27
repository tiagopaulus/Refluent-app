const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openModel: () => ipcRenderer.invoke('dialog:openModel'),
  convertWebmToMp4: (data) => ipcRenderer.invoke('ffmpeg:convertWebmToMp4', data),
  onProgress: (callback) => ipcRenderer.on('export-progress', callback),
  onSetLanguage: (callback) => ipcRenderer.on('set-language', (event, lang) => callback(lang)),
  openFileDialog: (options) => ipcRenderer.invoke('open-file-dialog', options),
  onFileSelected: (callback) => ipcRenderer.on('file-selected', (event, path) => callback(path)),
  selectMp4Folder: () => ipcRenderer.invoke('select-mp4-folder'),
  onMp4FolderChanged: (callback) => ipcRenderer.on('mp4-folder-changed', (event, folder) => callback(folder)),
  onOpenPreferences: (callback) => ipcRenderer.on('open-preferences', () => callback()),
  // Mission H - scene save/load
  saveSceneDialog: (name) => ipcRenderer.invoke('save-scene-dialog', name),
  openSceneDialog: () => ipcRenderer.invoke('open-scene-dialog'),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  readFileBase64: (filePath) => ipcRenderer.invoke('read-file-base64', filePath),
  onNewScene: (callback) => ipcRenderer.on('new-scene', () => callback()),
  onOpenScene: (callback) => ipcRenderer.on('open-scene', () => callback()),
  onSaveScene: (callback) => ipcRenderer.on('save-scene', () => callback()),
  onSaveSceneAs: (callback) => ipcRenderer.on('save-scene-as', () => callback()),
  openSceneFromPath: (filePath) => ipcRenderer.invoke('open-scene-from-path', filePath),
  onOpenSceneFile: (callback) => ipcRenderer.on('open-scene-file', (event, path) => callback(path)),
  // AI provider bridges (renderer never imports provider modules)
  aiVideoRender: (args) => ipcRenderer.invoke('ai-video-render', args),
  aiVideoStatus: (args) => ipcRenderer.invoke('ai-video-status', args),
  aiVideoCancel: (args) => ipcRenderer.invoke('ai-video-cancel', args),
  aiImageGenerate: (args) => ipcRenderer.invoke('ai-image-generate', args),
  aiImageStatus: (args) => ipcRenderer.invoke('ai-image-status', args),
  aiUpscale: (args) => ipcRenderer.invoke('ai-upscale', args),
  aiUpscaleStatus: (args) => ipcRenderer.invoke('ai-upscale-status', args),
  // Unsaved changes / quit flow
  setUnsavedChanges: (hasChanges) => ipcRenderer.invoke('set-unsaved-changes', hasChanges),
  onRequestSaveCheck: (callback) => ipcRenderer.on('request-save-check', callback),
  respondSaveCheck: (response) => ipcRenderer.invoke('respond-save-check', response),
  onSaveAndQuit: (callback) => ipcRenderer.on('save-and-quit', () => callback()),
  confirmQuit: () => ipcRenderer.invoke('confirm-quit'),
  showUnsavedDialog: (sceneName, action) => ipcRenderer.invoke('show-unsaved-dialog', sceneName, action),
  // Guided tour
  onStartTour: (callback) => ipcRenderer.on('start-tour', () => callback()),
  // Pipeline — frame extraction
  extractFrame: (args) => ipcRenderer.invoke('extract-frame', args),
  // Open a folder in OS file manager
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath)
});
