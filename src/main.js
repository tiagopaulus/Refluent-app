const { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const fluentFfmpeg = require('fluent-ffmpeg');

// Custom scheme for loading local files (images, video, 3D models) without
// disabling webSecurity. Must be registered as privileged BEFORE app.whenReady().
// `standard: false` keeps refluent: out of Chromium's special URL parser, which
// would otherwise mangle URLs that have a Windows drive letter after the
// authority. We use a fake host segment ("local") so the URL has the form
// refluent://local/<path>, which any URL parser is happy with.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'refluent',
    privileges: {
      secure: true,
      standard: false,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
]);

// Cross-drive / cross-volume safe move (Windows C:↔D:, mac /tmp↔/Users).
async function moveFileSafe(src, dest) {
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    if (err.code === 'EXDEV' || err.code === 'EPERM') {
      try {
        await fsp.copyFile(src, dest);
        await fsp.unlink(src);
      } catch (copyErr) {
        try { await fsp.unlink(dest); } catch {}
        throw copyErr;
      }
    } else {
      throw err;
    }
  }
}

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
let unsavedChanges = false;
let allowClose = false;

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
        ...(app.isPackaged && process.env.REFLUENT_DEBUG !== '1'
          ? []
          : [{ role: 'toggleDevTools' }, { type: 'separator' }]),
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
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Start Guided Tour',
          click: () => { if (mainWindow) mainWindow.webContents.send('start-tour'); }
        }
      ]
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
      contextIsolation: true
    }
  });

  mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('close', async (e) => {
    if (allowClose || !unsavedChanges) return;
    e.preventDefault();
    const sceneName = await mainWindow.webContents.executeJavaScript(
      'window.currentSceneName || "Untitled"'
    );
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Unsaved Changes',
      message: `Do you want to save the changes to "${sceneName}" before quitting?`,
      detail: 'Your changes will be lost if you don\'t save them.',
      buttons: ['Save', 'Don\'t Save', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    });
    if (response === 0) {
      mainWindow.webContents.send('save-and-quit');
    } else if (response === 1) {
      allowClose = true;
      mainWindow.close();
    }
  });
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
  // Map refluent://local/<absolute-path> URLs to real files on disk so the
  // renderer can load user images / video / 3D models without webSecurity:false.
  protocol.registerFileProtocol('refluent', (request, callback) => {
    try {
      // Strip scheme and fake host: refluent://local/C:/path → C:/path
      let p = request.url
        .replace(/^refluent:\/\/local\//, '')
        .replace(/^refluent:\/+/, '');
      // Strip query and fragment
      p = p.split('?')[0].split('#')[0];
      // Decode percent-encoding (handles spaces and other encoded chars)
      try { p = decodeURI(p); } catch {}
      // Restore drive-letter colon if it came in encoded (e.g. C%3A → C:)
      p = p.replace(/^([A-Za-z])%3A/, '$1:');
      // Use OS-native separators (Node fs accepts both, but this is cleaner)
      if (process.platform === 'win32') {
        p = p.replace(/\//g, '\\');
      }
      callback({ path: p });
    } catch (err) {
      console.error('[refluent://] protocol error:', err);
      callback({ error: -2 }); // NET::ERR_FAILED
    }
  });

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
ipcMain.handle('set-unsaved-changes', (_event, hasChanges) => {
  unsavedChanges = hasChanges;
});

ipcMain.handle('confirm-quit', () => {
  allowClose = true;
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('show-unsaved-dialog', async (_event, sceneName, action) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Unsaved Changes',
    message: `Do you want to save "${sceneName}" before you ${action}?`,
    detail: 'Your changes will be lost if you don\'t save them.',
    buttons: ['Save', 'Don\'t Save', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  });
  return response;
});

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
ipcMain.handle('ai-video-render', async (_event, args) => {
  console.log('[SD main handler called]', new Date().toISOString(), args);
  try {
    return { success: true, ...(await videoProvider.render(
      args.mp4Path, args.prompt, args.referenceFrame, args.aspectRatio,
      args.saveFolder, args.duration, args.resolution, args.generateAudio,
      args.seed
    )) };
  } catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('ai-video-status', async (_event, { jobId }) => {
  try { return { success: true, ...(await videoProvider.checkStatus(jobId)) }; }
  catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('ai-video-cancel', async (_event, jobId) => {
  try {
    if (videoProvider.cancel) await videoProvider.cancel(jobId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
ipcMain.handle('extract-frame', async (_event, { mp4Path, timestamp, saveFolder }) => {
  if (!mp4Path || !fs.existsSync(mp4Path)) {
    return { success: false, error: 'MP4 not found.' };
  }
  // Skip encoder warmup — the first ~3 frames of any WebM/MP4 produced by
  // MediaRecorder are at lower quality while the encoder ramps up. Clamp
  // the seek to 0.1s minimum so we never extract from the warmup region.
  const MIN_OFFSET = 0.1;
  const ts = Math.max(MIN_OFFSET, parseFloat(timestamp) || 0);
  const os = require('os');

  // If a save folder is set, auto-increment Refluent_Frame_001.jpg, _002.jpg, …
  // Otherwise fall back to the OS temp dir.
  let outPath;
  if (saveFolder && fs.existsSync(saveFolder)) {
    let i = 1;
    while (true) {
      const name = `Refluent_Frame_${String(i).padStart(3, '0')}.jpg`;
      const full = path.join(saveFolder, name);
      if (!fs.existsSync(full)) { outPath = full; break; }
      i++;
    }
  } else {
    outPath = path.join(os.tmpdir(), `refluent_frame_${Date.now()}.jpg`);
  }

  return new Promise((resolve) => {
    fluentFfmpeg(mp4Path)
      .seekInput(ts)
      .frames(1)
      // -q:v 1 = highest JPG quality (was 2). The MP4 is already at the chosen
      // output resolution, so we don't add a scale filter — that would distort
      // anything other than 16:9 ratios.
      .outputOptions(['-q:v', '1'])
      .save(outPath)
      .on('end', () => resolve({ success: true, framePath: outPath }))
      .on('error', (err) => {
        console.error('[ExtractFrame] error:', err && err.message);
        resolve({ success: false, error: 'Could not extract frame.' });
      });
  });
});

ipcMain.handle('ai-image-generate', async (_event, args) => {
  try {
    // Back-compat: legacy callers passed a single `referenceImagePath`.
    const refs = args.referenceImages || (args.referenceImagePath ? [args.referenceImagePath] : []);
    // Mission 2.3 (v3.0): forward the renderer's measured subjectBox to the adapter.
    // Mission 2.4 (v3.0): also forward paddedCanvasDataUrl when present.
    return { success: true, ...(await imageProvider.generate(args.prompt, args.referenceFramePath, refs, args.saveFolder || null, args.aspectRatio || '16:9', args.subjectBox || null, args.paddedCanvasDataUrl || null)) };
  } catch (err) {
    console.error('[Nanobanana] Error:', err && err.message);
    return { success: false, error: 'Image generation failed. Please try again.' };
  }
});

ipcMain.handle('open-folder', async (_event, folderPath) => {
  if (!folderPath) return false;
  try {
    await shell.openPath(folderPath);
    return true;
  } catch (err) {
    console.error('[open-folder] error:', err && err.message);
    return false;
  }
});

// Diagnostic — pipe renderer log strings into the main-process terminal output
ipcMain.on('log-to-main', (_e, msg) => console.log(msg));

ipcMain.handle('ai-image-status', async (_event, { jobId }) => {
  try { return { success: true, ...(await imageProvider.checkStatus(jobId)) }; }
  catch (err) {
    console.error('[Nanobanana] Status error:', err);
    return { success: false, error: 'Could not check status.' };
  }
});
ipcMain.handle('ai-upscale-render', async (_event, { mp4Path, desiredIncrease, saveFolder }) => {
  console.log('[UP main handler called]', new Date().toISOString(), { mp4Path, desiredIncrease, saveFolder });
  try { return { success: true, ...(await upscaleProvider.render(mp4Path, desiredIncrease, saveFolder)) }; }
  catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('ai-upscale-status', async (_event, { jobId }) => {
  try { return { success: true, ...(await upscaleProvider.checkStatus(jobId)) }; }
  catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('ai-upscale-cancel', async (_event, jobId) => {
  try {
    if (upscaleProvider.cancel) await upscaleProvider.cancel(jobId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
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
// The renderer now resizes its GL buffer to these exact dimensions before
// captureStream(), so the WebM arrives already at the final aspect — ffmpeg
// only needs to enforce the resolution (lanczos for higher-quality scaling).
const RATIO_OUTPUT = {
  '16:9': { w: 1920, h: 1080 },
  '1:1':  { w: 1080, h: 1080 },
  '4:5':  { w: 1080, h: 1350 },
  '3:4':  { w: 1080, h: 1440 },
  '9:16': { w: 1080, h: 1920 }
};

ipcMain.handle('ffmpeg:convertWebmToMp4', async (event, { arrayBuffer, duration, outputFolder, outputFilename, ratio }) => {
  const tempBasePath = path.join(app.getPath('temp'), `viewport-recording-${Date.now()}`);
  const tempWebmPath = tempBasePath + '.webm';
  const tempMp4Path = tempBasePath + '.mp4';
  const safeUnlink = async (p) => { try { await fsp.unlink(p); } catch {} };

  try {
    await fsp.writeFile(tempWebmPath, Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('Failed to write buffer', err);
    return { success: false, message: 'Failed to write chunks to disk' };
  }

  try {
    const webmStats = await fsp.stat(tempWebmPath);
    console.log(`[Main] WebM temp file written successfully. Size: ${webmStats.size} bytes`);
    if (webmStats.size === 0) {
      await safeUnlink(tempWebmPath);
      return { success: false, message: 'Recording may have been too short (0 bytes written).' };
    }
  } catch (e) {
    return { success: false, message: 'Failed to verify temp webm file.' };
  }

  const useRatio = ratio && RATIO_OUTPUT[ratio] ? ratio : '16:9';
  const out = RATIO_OUTPUT[useRatio];
  // The renderer pre-resizes its GL buffer to these exact dimensions before
  // captureStream(), so the WebM is already at the final aspect. Just enforce
  // the resolution with high-quality lanczos scaling — no crop, no padding.
  const vfFilter = `scale=${out.w}:${out.h}:flags=lanczos`;
  console.log('[Main] FFmpeg conversion started, ratio=' + useRatio + ', vf=' + vfFilter);
  event.sender.send('export-progress', 0);

  try {
    await new Promise((resolve, reject) => {
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
        .on('end', () => resolve())
        .on('error', (err) => reject(err));
    });
  } catch (err) {
    await safeUnlink(tempWebmPath);
    await safeUnlink(tempMp4Path);
    return { success: false, message: err.message };
  }

  console.log('[Main] FFmpeg conversion finished');
  event.sender.send('export-progress', 100);
  await safeUnlink(tempWebmPath);

  try {
    const stats = await fsp.stat(tempMp4Path);
    if (stats.size === 0) {
      await safeUnlink(tempMp4Path);
      return { success: false, message: 'FFmpeg generated a 0-byte unplayable file. Conversion failed.' };
    }
  } catch (e) {
    return { success: false, message: 'Failed to find exported MP4.' };
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
      await safeUnlink(tempMp4Path);
      return { success: false, message: 'Canceled by user' };
    }
    outputMp4Path = saveResult.filePath;
  }

  try {
    await moveFileSafe(tempMp4Path, outputMp4Path);
  } catch (renameErr) {
    await safeUnlink(tempMp4Path);
    return { success: false, message: 'Failed to write MP4 to folder: ' + renameErr.message };
  }
  return { success: true, filePath: outputMp4Path };
});
