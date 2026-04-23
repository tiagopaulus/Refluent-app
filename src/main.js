const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fluentFfmpeg = require('fluent-ffmpeg');

// AI providers - live in main process so they can use node_modules, fs, env
const { videoProvider } = require('./providers/videoProvider.js');
const { imageProvider } = require('./providers/imageProvider.js');
const { upscaleProvider } = require('./providers/upscaleProvider.js');

// dotenv path differs between dev (project root) and packaged (resourcesPath)
const dotenvPath = app.isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(__dirname, '..', '.env');
require('dotenv').config({ path: dotenvPath });

// Get the correct path for ffmpeg-static across development and production
let ffmpegPath = require('ffmpeg-static');
if (ffmpegPath && ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}
if (ffmpegPath) fluentFfmpeg.setFfmpegPath(ffmpegPath);

let mainWindow;
let currentLang = 'en';

async function pickMp4Folder() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select folder for MP4 recordings'
  });
  if (!result.canceled && result.filePaths.length > 0) return result.filePaths[0];
  return null;
}

function buildMenu() {
  const template = [
    {
      label: 'Refluent',
      submenu: [
        {
          label: 'Preferences',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('open-preferences');
          }
        },
        { type: 'separator' },
        {
          label: 'New Scene',
          accelerator: 'CmdOrCtrl+N',
          click: () => { if (mainWindow) mainWindow.webContents.send('new-scene'); }
        },
        {
          label: 'Open Scene...',
          accelerator: 'CmdOrCtrl+O',
          click: () => { if (mainWindow) mainWindow.webContents.send('open-scene'); }
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => { if (mainWindow) mainWindow.webContents.send('save-scene'); }
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => { if (mainWindow) mainWindow.webContents.send('save-scene-as'); }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' }
      ]
    },
    {
      label: 'Language',
      submenu: [
        {
          label: 'English',
          type: 'radio',
          checked: currentLang === 'en',
          click: () => {
            currentLang = 'en';
            if (mainWindow) mainWindow.webContents.send('set-language', 'en');
            buildMenu();
          }
        },
        {
          label: '한국어',
          type: 'radio',
          checked: currentLang === 'kr',
          click: () => {
            currentLang = 'kr';
            if (mainWindow) mainWindow.webContents.send('set-language', 'kr');
            buildMenu();
          }
        }
      ]
    },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'close' }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let splashWindow;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 854,
    height: 480,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    center: true,
    icon: path.join(__dirname, '..', 'assets', 'icon_with_bg.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.setMenuBarVisibility(false);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Refluent',
    width: 1280,
    height: 720,
    show: false,
    icon: path.join(__dirname, '..', 'assets', 'icon_with_bg.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  // Open DevTools only when explicitly requested via REFLUENT_DEBUG=1
  if (process.env.REFLUENT_DEBUG === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Drag & drop .ent files into window
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      document.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      document.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const files = Array.from(e.dataTransfer.files);
        const entFile = files.find(f => f.path && f.path.endsWith('.ent'));
        if (entFile) {
          window.electronAPI.openSceneFromPath(entFile.path);
        }
      });
    `);
  });
  // Splash sequence handles main window show; ready-to-show no longer auto-shows.
}

app.whenReady().then(() => {
  buildMenu();
  createSplashWindow();
  createWindow();

  // Show splash for the full 4s video, then close it and reveal the main window
  const splashStart = Date.now();
  mainWindow.webContents.once('did-finish-load', () => {
    const elapsed = Date.now() - splashStart;
    const wait = Math.max(0, 4000 - elapsed);
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    }, wait);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle .ent file opened from Windows Explorer (argv)
const fileArgPath = process.argv.find(arg => typeof arg === 'string' && arg.endsWith('.ent'));
if (fileArgPath) {
  app.whenReady().then(() => {
    if (mainWindow) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('open-scene-file', fileArgPath);
      });
    }
  });
}

// Handle file open on macOS (open-file event)
app.on('open-file', (event, openPath) => {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.webContents.send('open-scene-file', openPath);
  } else {
    app.whenReady().then(() => {
      if (mainWindow) {
        mainWindow.webContents.once('did-finish-load', () => {
          mainWindow.webContents.send('open-scene-file', openPath);
        });
      }
    });
  }
});

// IPC Handler: Pick the MP4 save folder
ipcMain.handle('select-mp4-folder', async () => {
  return await pickMp4Folder();
});

// Mission H - Scene save/load IPC
ipcMain.handle('save-scene-dialog', async (_event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: (defaultName || 'Untitled') + '.ent',
    filters: [{ name: 'Refluent Scene', extensions: ['ent'] }],
    title: 'Save Scene'
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('open-scene-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Refluent Scene', extensions: ['ent'] }],
    properties: ['openFile'],
    title: 'Open Scene'
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('open-scene-from-path', async (_event, filePath) => {
  if (mainWindow) mainWindow.webContents.send('open-scene-file', filePath);
  return true;
});

ipcMain.handle('write-file', async (_event, filePath, content) => {
  await fs.promises.writeFile(filePath, content, 'utf8');
  return true;
});

ipcMain.handle('read-file', async (_event, filePath) => {
  return await fs.promises.readFile(filePath, 'utf8');
});

ipcMain.handle('read-file-base64', async (_event, filePath) => {
  const buf = await fs.promises.readFile(filePath);
  return buf.toString('base64');
});

// AI provider IPC handlers (renderer has no direct access to @fal-ai/client)
ipcMain.handle('ai-video-render', async (_event, { mp4Path, prompt, referenceFrame }) => {
  try { return { success: true, ...(await videoProvider.render(mp4Path, prompt, referenceFrame)) }; }
  catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('ai-video-status', async (_event, { jobId }) => {
  try { return { success: true, ...(await videoProvider.checkStatus(jobId)) }; }
  catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('ai-video-cancel', async (_event, { jobId }) => {
  try { await videoProvider.cancel(jobId); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('ai-image-generate', async (_event, { prompt, referenceImagePath }) => {
  try { return { success: true, ...(await imageProvider.generate(prompt, referenceImagePath)) }; }
  catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('ai-image-status', async (_event, { jobId }) => {
  try { return { success: true, ...(await imageProvider.checkStatus(jobId)) }; }
  catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('ai-upscale', async (_event, { inputPath, scale }) => {
  try { return { success: true, ...(await upscaleProvider.upscale(inputPath, scale)) }; }
  catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('ai-upscale-status', async (_event, { jobId }) => {
  try { return { success: true, ...(await upscaleProvider.checkStatus(jobId)) }; }
  catch (err) { return { success: false, error: err.message }; }
});

// IPC Handler: Open File Dialog (images, etc.)
ipcMain.handle('open-file-dialog', async (_event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: options.filters || []
  });
  return result.canceled ? null : result.filePaths[0];
});

// IPC Handler: Open Model Dialog
ipcMain.handle('dialog:openModel', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: '3D Models', extensions: ['obj', 'gltf', 'glb', 'fbx', 'dae'] }
    ]
  });
  
  if (result.canceled) return null;
  return result.filePaths[0]; // Returns array of paths, we want the first
});

// IPC Handler: Convert WebM to MP4
// Aspect-ratio aware ffmpeg filters
const RATIO_CROP = {
  '16:9': null,
  '1:1':  'crop=ih:ih',
  '4:5':  'crop=ih*(4/5):ih',
  '3:4':  'crop=ih*(3/4):ih',
  '9:16': 'crop=ih*(9/16):ih'
};
const RATIO_OUTPUT = {
  '16:9': { w: 1920, h: 1080 },
  '1:1':  { w: 1080, h: 1080 },
  '4:5':  { w: 1080, h: 1350 },
  '3:4':  { w: 1080, h: 1440 },
  '9:16': { w: 1080, h: 1920 }
};

ipcMain.handle('ffmpeg:convertWebmToMp4', async (event, { arrayBuffer, duration, outputFolder, outputFilename, ratio }) => {
  return new Promise((resolve, reject) => {
    try {
      const tempBasePath = path.join(app.getPath('temp'), `viewport-recording-${Date.now()}`);
      const tempWebmPath = tempBasePath + '.webm';
      const tempMp4Path = tempBasePath + '.mp4';
      
      const buffer = Buffer.from(arrayBuffer);
      
      fs.writeFile(tempWebmPath, buffer, (err) => {
        if (err) {
          console.error("Failed to write buffer", err);
          return resolve({ success: false, message: 'Failed to write chunks to disk' });
        }
        
        try {
          const webmStats = fs.statSync(tempWebmPath);
          console.log(`[Main] WebM temp file written successfully. Size: ${webmStats.size} bytes`);
          if (webmStats.size === 0) {
            return resolve({ success: false, message: 'Recording may have been too short (0 bytes written).' });
          }
        } catch (e) {
          return resolve({ success: false, message: 'Failed to verify temp webm file.' });
        }

        const useRatio = ratio && RATIO_OUTPUT[ratio] ? ratio : '16:9';
        const cropFilter = RATIO_CROP[useRatio];
        const out = RATIO_OUTPUT[useRatio];
        const vfFilter = cropFilter
          ? `${cropFilter},scale=${out.w}:${out.h}`
          : `scale=${out.w}:${out.h}`;
        console.log('[Main] FFmpeg conversion started, ratio=' + useRatio + ', vf=' + vfFilter);
        event.sender.send('export-progress', 0);
        fluentFfmpeg(tempWebmPath)
          .outputOptions([
            '-y',
            '-vcodec', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-crf', '18',
            '-preset', 'slow',
            '-movflags', '+faststart',
            '-vf', vfFilter
          ])
          .save(tempMp4Path)
          .on('stderr', (stderrLine) => {
            console.log('[FFmpeg stderr] ' + stderrLine);
            const match = stderrLine.match(/time=(\d+):(\d+):(\d+\.\d+)/);
            if (match) {
              const hours = parseInt(match[1]);
              const minutes = parseInt(match[2]);
              const seconds = parseFloat(match[3]);
              const current = hours * 3600 + minutes * 60 + seconds;
              const percent = Math.min((current / duration) * 100, 100);
              event.sender.send('export-progress', percent);
            }
          })
          .on('end', async () => {
            console.log('[Main] FFmpeg conversion finished');
            event.sender.send('export-progress', 100);
            if (fs.existsSync(tempWebmPath)) fs.unlinkSync(tempWebmPath);
            
            try {
               const stats = fs.statSync(tempMp4Path);
               if (stats.size === 0) {
                 if (fs.existsSync(tempMp4Path)) fs.unlinkSync(tempMp4Path);
                 return resolve({ success: false, message: 'FFmpeg generated a 0-byte unplayable file. Conversion failed.' });
               }
            } catch (e) {
               return resolve({ success: false, message: 'Failed to find exported MP4.' });
            }

            let outputMp4Path;
            if (outputFolder && outputFilename) {
              outputMp4Path = path.join(outputFolder, outputFilename);
            } else {
              const saveResult = await dialog.showSaveDialog({
                title: 'Save MP4 Recording',
                defaultPath: path.join(app.getPath('documents'), 'viewport-recording.mp4'),
                filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
              });

              if (saveResult.canceled) {
                if (fs.existsSync(tempMp4Path)) fs.unlinkSync(tempMp4Path);
                return resolve({ success: false, message: 'Canceled by user' });
              }
              outputMp4Path = saveResult.filePath;
            }

            try {
              fs.renameSync(tempMp4Path, outputMp4Path);
            } catch (renameErr) {
              if (fs.existsSync(tempMp4Path)) fs.unlinkSync(tempMp4Path);
              return resolve({ success: false, message: 'Failed to write MP4 to folder: ' + renameErr.message });
            }
            resolve({ success: true, filePath: outputMp4Path });
          })
          .on('error', (err) => {
            if (fs.existsSync(tempWebmPath)) fs.unlinkSync(tempWebmPath);
            if (fs.existsSync(tempMp4Path)) fs.unlinkSync(tempMp4Path);
            resolve({ success: false, message: err.message });
          });
      });
    } catch (error) {
      return resolve({ success: false, message: error.message });
    }
  });
});
