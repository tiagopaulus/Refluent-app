// IMAGE ADAPTER CONTRACT (CommonJS)
// generate(prompt, referenceFramePath, referenceImages[], saveFolder?) → Promise<{ jobId, status, imageUrl?, imagePath?, filename? }>
// checkStatus(jobId) → Promise<{ status: 'pending'|'complete'|'error', imageUrl?, imagePath?, error? }>
// cancel(jobId) → Promise<void>

const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const os = require('os');

let _client = null;

function getClient() {
  if (_client) return _client;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not found in environment');
  _client = new GoogleGenAI({ apiKey: key });
  return _client;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  return map[ext] || 'image/jpeg';
}

function getNextNBFilename(folder, ext) {
  let i = 1;
  while (true) {
    const name = `Refluent_NB_${String(i).padStart(3, '0')}${ext}`;
    if (!fs.existsSync(path.join(folder, name))) return name;
    i++;
  }
}

const NanobananaAdapter = {
  _jobs: {},

  async generate(prompt, referenceFramePath, referenceImages = [], saveFolder = null, aspectRatio = '16:9') {
    const jobId = 'nb-' + Date.now();
    this._jobs[jobId] = { status: 'pending' };
    this._runGeneration(jobId, prompt, referenceFramePath, referenceImages, saveFolder, aspectRatio)
      .catch(err => {
        const msg = (err && err.message) || '';
        console.error('[Nanobanana] generation error:', msg);
        if (msg.includes('limit: 0') || msg.includes('RESOURCE_EXHAUSTED')) {
          this._jobs[jobId] = {
            status: 'error',
            error: 'Image generation requires billing to be enabled on your Google AI Studio account. Visit aistudio.google.com to enable it.'
          };
        } else {
          this._jobs[jobId] = { status: 'error', error: 'Image generation failed. Please try again.' };
        }
      });
    return { jobId, status: 'pending' };
  },

  async _runGeneration(jobId, prompt, referenceFramePath, referenceImages, saveFolder, aspectRatio) {
    const ai = getClient();

    const ratioDescriptions = {
      '16:9': 'a 16:9 widescreen horizontal format',
      '1:1':  'a 1:1 square format',
      '4:5':  'a 4:5 vertical format',
      '3:4':  'a 3:4 vertical format',
      '9:16': 'a 9:16 vertical portrait format'
    };
    const ratioDesc = ratioDescriptions[aspectRatio] || ratioDescriptions['16:9'];
    const fullPrompt = `${prompt}\n\nIMPORTANT: Generate this image in ${ratioDesc} aspect ratio. The image must be composed and cropped to exactly this ratio.`;

    const contents = [];

    if (referenceFramePath && fs.existsSync(referenceFramePath)) {
      contents.push({ text: 'Reference frame (use for camera angle and proportions):' });
      contents.push({
        inlineData: {
          mimeType: getMimeType(referenceFramePath),
          data: fs.readFileSync(referenceFramePath).toString('base64')
        }
      });
    }

    const validRefs = (referenceImages || []).filter(p => p && fs.existsSync(p));
    if (validRefs.length > 0) {
      contents.push({ text: 'Style reference images:' });
      validRefs.forEach(p => {
        contents.push({
          inlineData: {
            mimeType: getMimeType(p),
            data: fs.readFileSync(p).toString('base64')
          }
        });
      });
    }

    contents.push({ text: fullPrompt });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{ role: 'user', parts: contents }],
      config: {
        responseModalities: ['TEXT', 'IMAGE']
      }
    });

    let imageData = null;
    let imageMime = 'image/png';

    const parts = (response && response.candidates && response.candidates[0] && response.candidates[0].content && response.candidates[0].content.parts) || [];
    for (const part of parts) {
      if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('image/')) {
        imageData = part.inlineData.data;
        imageMime = part.inlineData.mimeType;
        break;
      }
    }

    if (!imageData) {
      throw new Error('No image returned from Nanobanana.');
    }

    const ext = imageMime === 'image/png' ? '.png' : '.jpg';

    let outPath, filename;
    if (saveFolder && fs.existsSync(saveFolder)) {
      filename = getNextNBFilename(saveFolder, ext);
      outPath = path.join(saveFolder, filename);
    } else {
      filename = `Refluent_NB_${Date.now()}${ext}`;
      outPath = path.join(os.tmpdir(), filename);
    }

    fs.writeFileSync(outPath, Buffer.from(imageData, 'base64'));

    this._jobs[jobId] = {
      status: 'complete',
      imagePath: outPath,
      imageUrl: 'file:///' + outPath.replace(/\\/g, '/'),
      filename
    };
  },

  async checkStatus(jobId) {
    return this._jobs[jobId] || { status: 'error', error: 'Job not found' };
  },

  async cancel(jobId) {
    delete this._jobs[jobId];
  }
};

module.exports = { NanobananaAdapter };
