const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fluentFfmpeg = require('fluent-ffmpeg');
require('dotenv').config();

// Get the correct path for ffmpeg-static across development and production
let ffmpegPath = require('ffmpeg-static');
if (ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}
fluentFfmpeg.setFfmpegPath(ffmpegPath);

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

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Refluent',
    width: 1280,
    height: 720,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  mainWindow.maximize();
  mainWindow.loadFile('src/index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();

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

// IPC Handler: Pick the MP4 save folder
ipcMain.handle('select-mp4-folder', async () => {
  return await pickMp4Folder();
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
      { name: '3D Models', extensions: ['obj', 'gltf', 'glb'] }
    ]
  });
  
  if (result.canceled) return null;
  return result.filePaths[0]; // Returns array of paths, we want the first
});

// IPC Handler: Convert WebM to MP4
ipcMain.handle('ffmpeg:convertWebmToMp4', async (event, { arrayBuffer, duration, outputFolder, outputFilename }) => {
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

        console.log('[Main] FFmpeg conversion started');
        event.sender.send('export-progress', 0);
        fluentFfmpeg(tempWebmPath)
          .outputOptions([
            '-y',
            '-vcodec', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-crf', '18',
            '-preset', 'slow',
            '-movflags', '+faststart',
            '-vf', 'scale=1920:-2'
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
