// VIDEO ADAPTER CONTRACT (CommonJS) - Seedance 2.0 via Atlas Cloud
//
// Atlas Cloud's API surface is plain REST with Bearer auth:
//   - POST /api/v1/model/uploadMedia       (multipart, returns download_url)
//   - POST /api/v1/model/generateVideo     (JSON, returns prediction id)
//   - GET  /api/v1/model/prediction/{id}   (returns status + outputs)
//
// No SDK is used — direct fetch only. This avoids the @fal-ai/client retry
// bug entirely. The adapter contract matches src/providers/adapters/video/seedance.js
// so the videoProvider swap is a one-line change in videoProvider.js.

const fs = require('fs');
const path = require('path');
const os = require('os');

const ATLAS_BASE = 'https://api.atlascloud.ai';

const AtlasSeedanceAdapter = {
  _jobs: {},

  _getKey() {
    const key = process.env.ATLASCLOUD_API_KEY;
    if (!key) throw new Error('ATLASCLOUD_API_KEY not found in environment');
    return key;
  },

  // Upload a local file to Atlas's media store. Returns the download URL.
  async _uploadFile(filePath, mimeType) {
    const key = this._getKey();
    const fileName = filePath.split(/[\\/]/).pop();
    const fileBuf = fs.readFileSync(filePath);
    const blob = new Blob([fileBuf], { type: mimeType });
    const form = new FormData();
    form.append('file', blob, fileName);
    const res = await fetch(`${ATLAS_BASE}/api/v1/model/uploadMedia`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}` },
      body: form
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Atlas uploadMedia failed: HTTP ${res.status} ${body}`);
    }
    const json = await res.json();
    console.log('[AtlasSeedance upload response]', JSON.stringify(json, null, 2));
    const url = json?.data?.download_url;
    if (!url) throw new Error('Atlas uploadMedia returned no download_url');
    return url;
  },

  async render(mp4Path, prompt, referenceFramePath, aspectRatio, saveFolder, duration, resolution, generateAudio) {
    const key = this._getKey();

    // Upload MP4 (camera-motion reference video)
    let videoUrl;
    try {
      videoUrl = await this._uploadFile(mp4Path, 'video/mp4');
    } catch (err) {
      console.error('[AtlasSeedance upload-video error]', err);
      throw new Error('Could not upload video file. Please try again.');
    }

    // Upload reference still image if provided (Nanobanana output)
    let imageUrl = null;
    if (referenceFramePath) {
      try {
        const ext = (referenceFramePath.split('.').pop() || 'png').toLowerCase();
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
        imageUrl = await this._uploadFile(referenceFramePath, mime);
      } catch (err) {
        console.warn('[AtlasSeedance upload-image warn]', err.message);
        // Non-fatal — fall back to video-only generation.
      }
    }

    // Build the prompt with the same @Image1 / @Video1 reference tokens fal
    // used. ByteDance's Seedance 2.0 endpoint resolves these against
    // image_urls[0] and video_urls[0] regardless of which provider is in front.
    const tokens = [];
    if (imageUrl) tokens.push('@Image1');
    tokens.push('@Video1');

    const styleClause = tokens.length === 2
      ? `Apply the style, materials, and visual treatment from ${tokens[0]} onto the camera motion and composition from ${tokens[1]}. `
      : `Follow the camera motion and composition from ${tokens[0]}. `;

    const identityLock = imageUrl
      ? `SUBJECT IDENTITY LOCK: the product's physical form — bottle silhouette, cap design, label text, logo, color, materials, and proportions — must remain pixel-stable and identical to ${tokens[0]} at every frame of the video. Do NOT morph, soften, blur, or reinterpret any product detail during motion. Treat the subject as a rigid, photographed real-world object. `
      : '';

    const motionLock = `MOTION CONTINUITY LOCK: the camera motion from @Video1 must play exactly once across the entire output duration as a single continuous take. Do NOT loop the motion, do NOT restart from the beginning, do NOT cut, and do NOT repeat any segment. If the reference video's motion concludes before the output duration ends, hold the final camera position with subtle natural micro-movement rather than restarting the motion. The motion arc must feel like one uninterrupted take from start to finish. `;

    const audioClause = 'Audio should match the visual mood of the reference image — ambient, restrained, and matching the campaign tone. No music unless explicitly requested. ';

    const fullPrompt = styleClause + identityLock + motionLock + audioClause + (prompt || '').trim();

    // Field names per Atlas Cloud's documented schema for
    // bytedance/seedance-2.0/reference-to-video. Diagnosed via Atlas dashboard
    // "Request Body" view which showed our previous payload had video_urls /
    // image_urls / aspect_ratio silently dropped, causing the model to run
    // text-to-video and ignore all references. aspect_ratio is not a valid
    // field on reference-to-video — Atlas appears to inherit aspect from the
    // reference video.
    const flatPayload = {
      model: 'bytedance/seedance-2.0/reference-to-video',
      prompt: fullPrompt,
      reference_videos: [videoUrl],
      duration: parseInt(duration || 5, 10),
      resolution: '720p', // FORCED for diagnostic — Atlas's reference-to-video may reject 1080p
      generate_audio: generateAudio !== false
    };
    if (imageUrl) flatPayload.reference_images = [imageUrl];

    console.log('[AtlasSeedance direct-fetch submit called]', new Date().toISOString());
    console.log('[AtlasSeedance payload]', JSON.stringify(flatPayload, null, 2));
    console.log('[AtlasSeedance submit payload]', JSON.stringify(flatPayload, null, 2));
    const res = await fetch(`${ATLAS_BASE}/api/v1/model/generateVideo`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(flatPayload)
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[AtlasSeedance submit error]', res.status, body);
      throw new Error(`Atlas generateVideo failed: HTTP ${res.status} ${body || ''}`.trim());
    }

    const json = await res.json();
    const predictionId = json?.data?.id || json?.id;
    if (!predictionId) {
      throw new Error('Atlas generateVideo returned no prediction id: ' + JSON.stringify(json));
    }

    this._jobs[predictionId] = { status: 'pending', saveFolder };
    return { jobId: predictionId, status: 'pending' };
  },

  async checkStatus(jobId) {
    // Race guard #1: if we've already resolved this job (complete or error),
    // return the cached result instantly.
    const cached = this._jobs[jobId];
    if (cached && (cached.status === 'complete' || cached.status === 'error')) {
      return cached.status === 'complete'
        ? { status: 'complete', videoUrl: cached.videoUrl, videoPath: cached.videoPath }
        : { status: 'error', error: cached.error || 'Render failed.' };
    }
    // Race guard #2: if a download is already in flight from a prior poll,
    // return its in-flight promise so parallel polls coalesce on one download
    // instead of each entering _downloadVideo and writing their own file.
    if (cached && cached.downloadPromise) {
      return cached.downloadPromise;
    }
    const key = this._getKey();
    try {
      const res = await fetch(`${ATLAS_BASE}/api/v1/model/prediction/${jobId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${key}` }
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error('[AtlasSeedance status error]', res.status, body);
        return { status: 'error', error: 'Could not check render status.' };
      }
      const json = await res.json();
      const data = json?.data || json;
      const status = data?.status;

      if (status === 'completed' || status === 'succeeded') {
        // A LATER poll may have entered checkStatus and started the download
        // while this poll was awaiting the Atlas status fetch above. Re-check
        // the cache before kicking off a new download.
        const cachedNow = this._jobs[jobId];
        if (cachedNow && (cachedNow.status === 'complete' || cachedNow.status === 'error')) {
          return cachedNow.status === 'complete'
            ? { status: 'complete', videoUrl: cachedNow.videoUrl, videoPath: cachedNow.videoPath }
            : { status: 'error', error: cachedNow.error || 'Render failed.' };
        }
        if (cachedNow && cachedNow.downloadPromise) {
          return cachedNow.downloadPromise;
        }

        const outputs = data?.outputs || [];
        const videoUrl = outputs[0];
        if (!videoUrl) {
          this._jobs[jobId] = { ...(this._jobs[jobId] || {}), status: 'error' };
          return { status: 'error', error: 'No output URL returned.' };
        }

        // Promise-coalescing: stash the download promise on _jobs[jobId] BEFORE
        // starting the (multi-second) download. Any parallel poll that calls
        // checkStatus during this window hits race guard #2 above and returns
        // this same promise, so we get one network download and one local file
        // regardless of how many polls fire while Atlas is reporting completed.
        const downloadPromise = (async () => {
          let videoPath = null;
          try {
            const folder = (this._jobs[jobId] || {}).saveFolder;
            videoPath = await this._downloadVideo(videoUrl, folder);
          } catch (dlErr) {
            console.error('[AtlasSeedance download error]', dlErr);
            // Non-fatal — return the URL even if the local download failed.
          }
          const result = { status: 'complete', videoUrl, videoPath };
          this._jobs[jobId] = { ...(this._jobs[jobId] || {}), status: 'complete', videoUrl, videoPath };
          return result;
        })();
        this._jobs[jobId] = { ...(this._jobs[jobId] || {}), status: 'downloading', downloadPromise };
        return downloadPromise;
      }

      if (status === 'failed') {
        const errMsg = data?.error || 'Render failed. Please try again.';
        this._jobs[jobId] = { ...(this._jobs[jobId] || {}), status: 'error', error: errMsg };
        return { status: 'error', error: errMsg };
      }

      return { status: 'pending' };
    } catch (err) {
      console.error('[AtlasSeedance status fetch error]', err);
      return { status: 'error', error: 'Could not check render status.' };
    }
  },

  async _downloadVideo(videoUrl, saveFolder) {
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());

    const folder = (saveFolder && fs.existsSync(saveFolder)) ? saveFolder : os.tmpdir();
    const filename = this._nextSDFilename(folder);
    const outPath = path.join(folder, filename);
    fs.writeFileSync(outPath, buf);
    return outPath;
  },

  _nextSDFilename(folder) {
    // Auto-increment Refluent_SD_NNN.mp4 in the target folder.
    let max = 0;
    try {
      const files = fs.readdirSync(folder);
      for (const f of files) {
        const m = f.match(/^Refluent_SD_(\d{3})\.mp4$/i);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
    } catch { /* ignore */ }
    const next = String(max + 1).padStart(3, '0');
    return `Refluent_SD_${next}.mp4`;
  },

  async cancel(jobId) {
    // Atlas Cloud doesn't expose a documented cancel endpoint on this model
    // page. The closest equivalent is letting the job complete and discarding
    // the result; user is still billed. For now, just no-op locally. If Atlas
    // ships a cancel route later, wire it here.
    try {
      delete this._jobs[jobId];
    } catch { /* swallow */ }
  }
};

module.exports = { AtlasSeedanceAdapter };
