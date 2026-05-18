// IMAGE ADAPTER CONTRACT (CommonJS)
// generate(prompt, referenceFramePath, referenceImages[], saveFolder?) → Promise<{ jobId, status, imageUrl?, imagePath?, filename? }>
// checkStatus(jobId) → Promise<{ status: 'pending'|'complete'|'error', imageUrl?, imagePath?, error? }>
// cancel(jobId) → Promise<void>

const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mission 2.7 follow-up: override undici's internal headers/body timeouts.
// Node's global fetch (used by @google/genai under the hood) defaults to
// ~5 min headersTimeout — Pro image generation can blow past that before
// the response starts streaming. SDK's httpOptions.timeout doesn't reach
// undici's internal timers, only the outer AbortSignal. The only way to
// extend the headers timer is via a custom undici Agent set globally.
try {
  const { setGlobalDispatcher, Agent } = require('undici');
  setGlobalDispatcher(new Agent({
    headersTimeout: 900_000,  // 15 min
    bodyTimeout: 900_000,
    connectTimeout: 30_000
  }));
} catch (e) {
  // undici is bundled with Node, but if for some reason it's not
  // accessible (e.g. very old runtime), the SDK keeps working with defaults.
  console.warn('[Nanobanana] undici not available — keeping default fetch timeouts');
}

let _client = null;

function getClient() {
  if (_client) return _client;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not found in environment');
  // Mission 2.7 (v3.0): bump HTTP timeout to 10 minutes — Pro image generation
  // can take long enough that the SDK's default headers-timeout window
  // (UND_ERR_HEADERS_TIMEOUT) trips before the response starts streaming.
  _client = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 600_000 } });
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

  async generate(prompt, referenceFramePath, referenceImages = [], saveFolder = null, aspectRatio = '16:9', subjectBox = null, paddedCanvasDataUrl = null) {
    const jobId = 'nb-' + Date.now();
    this._jobs[jobId] = { status: 'pending' };
    this._runGeneration(jobId, prompt, referenceFramePath, referenceImages, saveFolder, aspectRatio, subjectBox, paddedCanvasDataUrl)
      .catch(err => {
        console.error('[Nanobanana raw error]', err);
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

  async _runGeneration(jobId, prompt, referenceFramePath, referenceImages, saveFolder, aspectRatio, subjectBox, paddedCanvasDataUrl) {
    const ai = getClient();

    const ratioDescriptions = {
      '16:9': 'a 16:9 widescreen horizontal format',
      '1:1':  'a 1:1 square format',
      '4:5':  'a 4:5 vertical format',
      '3:4':  'a 3:4 vertical format',
      '9:16': 'a 9:16 vertical portrait format'
    };
    const ratioDesc = ratioDescriptions[aspectRatio] || ratioDescriptions['16:9'];
    // Mission 2 (v3.0, revised): the bug was structural, not prompt-weakness.
    // gemini-2.5-flash-image treats the LAST image in the parts array as the
    // primary edit target, and earlier images as ambient context. So if we
    // sent [frame, styleRef], the model treated the styleRef as the canvas
    // and only lightly modified it — returning the styleRef nearly verbatim.
    //
    // Fix: send style references FIRST (ambient context), MP4 frame LAST
    // (primary canvas → composition is locked), with directive text per image
    // and a final TASK block that dominates.
    const contents = [];
    const validRefs = (referenceImages || []).filter(p => p && fs.existsSync(p));
    const hasFrame = referenceFramePath && fs.existsSync(referenceFramePath);
    const hasStyleRefs = validRefs.length > 0;

    // ---- Style references FIRST (ambient context, not the canvas) ----
    if (hasStyleRefs) {
      contents.push({
        text:
          `IMAGE 1 — VISUAL STYLE, MATERIAL, AND LIGHTING LOCKED.\n` +
          `Match the hyperrealistic 3D rendering, material finishes, color grading, ` +
          `lighting, atmosphere, and overall aesthetic of the following ` +
          `image${validRefs.length > 1 ? 's' : ''} with precision. ` +
          `All visual style decisions derive exclusively from ${validRefs.length > 1 ? 'these images' : 'this image'}.`
      });
      validRefs.forEach(p => {
        contents.push({
          inlineData: {
            mimeType: getMimeType(p),
            data: fs.readFileSync(p).toString('base64')
          }
        });
      });
    }

    // ---- MP4 frame LAST (the canvas — composition source) ----
    if (hasFrame) {
      contents.push({
        text:
          `IMAGE 2 — CAMERA AND COMPOSITION LOCKED (STRICT).\n` +
          `The following image is a 3D clay blockout. The gray shapes are THE SUBJECT. ` +
          `Everything that is not gray (dark/black areas) is empty stage.\n\n` +
          `NON-NEGOTIABLE CONSTRAINTS — these must be matched 1:1, no exceptions:\n` +
          `1. SUBJECT POSITION: the subject must occupy the same X/Y location in the output frame ` +
          `as it does in this image. If the subject is in the upper-left third here, it must be ` +
          `in the upper-left third in the output. If it is centered, it must be centered. ` +
          `Do not recenter, do not reposition, do not "improve" the placement.\n` +
          `2. SUBJECT SIZE: the subject must occupy the same percentage of frame width and ` +
          `frame height as it does here. Do not zoom in, do not zoom out, do not resize.\n` +
          `3. SUBJECT ROTATION & TILT: rotation, tilt, and orientation must match exactly. ` +
          `Do not rotate, do not tilt, do not adjust the camera angle.\n` +
          `4. SUBJECT SILHOUETTE & PROPORTIONS: shape and proportions must match exactly. ` +
          `Do not stretch, squash, or alter the geometry.\n\n` +
          `The grayscale appearance is IRRELEVANT — pull all visual style (materials, lighting, ` +
          `color, atmosphere) from IMAGE 1 above. Do not derive any aesthetic from this image.\n\n` +
          `If you violate any of constraints 1-4, the output is a failure regardless of how ` +
          `beautiful the rendering is. Match this canvas first, then style.`
      });
      // Mission 2.4 (v3.0): prefer the padded canvas if the renderer built one.
      // Padding is only built when there are reference images present, so this
      // branch only kicks in for the case that was failing.
      if (paddedCanvasDataUrl && paddedCanvasDataUrl.startsWith('data:image/')) {
        const m = paddedCanvasDataUrl.match(/^data:(image\/[^;]+);base64,(.*)$/);
        if (m) {
          contents.push({
            inlineData: {
              mimeType: m[1],
              data: m[2]
            }
          });
        } else {
          // Malformed data URL — fall back to disk
          contents.push({
            inlineData: {
              mimeType: getMimeType(referenceFramePath),
              data: fs.readFileSync(referenceFramePath).toString('base64')
            }
          });
        }
      } else {
        contents.push({
          inlineData: {
            mimeType: getMimeType(referenceFramePath),
            data: fs.readFileSync(referenceFramePath).toString('base64')
          }
        });
      }
    }

    // ---- Final TASK directive ----
    let directive;
    if (hasFrame && hasStyleRefs) {
      directive =
        `TASK: Combine the two locks above into a single rendered image.\n` +
        `From IMAGE 1: every visual quality (style, material, lighting, color, atmosphere).\n` +
        `From IMAGE 2: every spatial quality (camera, composition, subject position, size, rotation).\n` +
        `Render at campaign quality — sharp, polished, and ready for commercial use.\n` +
        `The output must be visually distinct from both inputs.`;
    } else if (hasFrame) {
      directive =
        `TASK: Render IMAGE 2 (the camera and composition canvas) above as a finished image, ` +
        `applying the user's stylistic direction below. The CANVAS constraints (position, size, ` +
        `rotation, silhouette) are non-negotiable. Render a complete environment around the subject.`;
    } else if (hasStyleRefs) {
      directive =
        `TASK: Generate a NEW image inspired by the style reference${validRefs.length > 1 ? 's' : ''} ` +
        `but with original composition based on the user's instruction below. ` +
        `Do NOT return the reference${validRefs.length > 1 ? 's' : ''} unchanged.`;
    } else {
      directive = 'TASK: Generate the image described below.';
    }

    // Mission 2.2 (v3.0): opt-out — power users can suppress the subject lock
    // by including a recognized phrase in their prompt. Default = locked.
    const optOutPhrases = [
      'recompose freely',
      'free composition',
      'ignore canvas position',
      'ignore canvas',
      'recompose the subject',
      'free placement'
    ];
    const promptLower = (prompt || '').toLowerCase();
    const subjectLockOptOut = optOutPhrases.some(phrase => promptLower.includes(phrase));

    let optOutNote = '';
    if (subjectLockOptOut && hasFrame) {
      optOutNote =
        '\n\nOVERRIDE: The user has requested free composition. ' +
        'You may relax the subject position/size constraints from the canvas. ' +
        'Use the canvas for general subject identity and shape, but you may recompose the framing ' +
        'as you see fit to best match the requested style.';
    }

    const fullPrompt =
      directive + '\n\n' +
      `USER DIRECTION:\n${prompt}\n\n` +
      `OUTPUT FORMAT: ${ratioDesc} aspect ratio. The image must be composed and cropped exactly to this ratio.` +
      optOutNote;

    contents.push({ text: fullPrompt });

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
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
