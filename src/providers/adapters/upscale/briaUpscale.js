// VIDEO UPSCALE ADAPTER CONTRACT (CommonJS) - Bria video resolution via fal.ai
//
// Endpoint: https://queue.fal.run/bria/video/increase-resolution
// Auth:     Authorization: Key <FAL_KEY>
// Pattern mirrors seedance.js — direct-fetch submit/status/result/cancel using
// the URLs fal returns at submit time. fal.storage.upload (SDK) for the video
// upload only. Promise-coalescing in checkStatus prevents duplicate downloads.

const path = require('path');
const fs = require('fs');
const os = require('os');

// Auto-incrementing filename helper, mirrors Seedance's getNextSDFilename.
function getNextUPFilename(folder) {
  let i = 1;
  while (true) {
    const name = `Refluent_UP_${String(i).padStart(3, '0')}.mp4`;
    if (!fs.existsSync(path.join(folder, name))) return name;
    i++;
  }
}

const BriaUpscaleAdapter = {
  _jobs: {},
  _configured: false,

  _ensureConfigured() {
    if (this._configured) return;
    const { fal } = require('@fal-ai/client');
    const key = process.env.FAL_KEY;
    if (!key) throw new Error('FAL_KEY not found in environment');
    fal.config({ credentials: key });
    this._configured = true;
  },

  async render(mp4Path, desiredIncrease, saveFolder) {
    console.log('[UP adapter.render called]', new Date().toISOString());
    this._ensureConfigured();
    const { fal } = require('@fal-ai/client');

    // Upload via fal.storage.upload (Blob path avoids Node 18 fetch duplex
    // issue that ReadStream uploads hit). The SDK handles signed-URL/multipart
    // logic so we keep it for upload only.
    let videoUrl;
    try {
      const fileName = mp4Path.split(/[\\/]/).pop();
      const buf = await fs.promises.readFile(mp4Path);
      const blob = new Blob([buf], { type: 'video/mp4' });
      videoUrl = await fal.storage.upload(blob, { fileName });
    } catch (err) {
      console.error('[Bria upload error]', err);
      throw new Error('Could not upload video file. Please try again.');
    }

    // Flat input — fal's queue endpoint expects top-level fields, not
    // { input: ... } wrapper. Same lesson as Seedance.
    // desired_increase: only "2" or "4" are valid (2x or 4x scale factor).
    // output_container_and_codec: fal default is webm_vp9; force mp4_h264 so
    // the result plays in Refluent's <video> tag and is broadly compatible.
    // preserve_audio: keep ambient audio from Seedance output through upscale.
    const input = {
      video_url: videoUrl,
      desired_increase: String(desiredIncrease || '2'),
      output_container_and_codec: 'mp4_h264',
      preserve_audio: true
    };

    console.log('[UP direct-fetch submit called]', new Date().toISOString());
    const response = await fetch('https://queue.fal.run/bria/video/increase-resolution', {
      method: 'POST',
      headers: {
        'Authorization': 'Key ' + process.env.FAL_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error('[UP submit error]', response.status, body);
      throw new Error(`Bria submit failed: HTTP ${response.status} ${body || ''}`.trim());
    }
    const submitResponse = await response.json();
    const { request_id, status_url, response_url, cancel_url } = submitResponse;

    // Stash fal's URLs so checkStatus / cancel hit the exact paths fal returned
    // (same approach as Seedance — avoids the SDK's variant-suffix URL bug).
    this._jobs[request_id] = {
      status: 'pending',
      saveFolder: saveFolder || null,
      status_url,
      response_url,
      cancel_url
    };
    return { jobId: request_id, status: 'pending' };
  },

  async checkStatus(jobId) {
    // Race guard #1: cached terminal state — return without touching network.
    const cached = this._jobs[jobId];
    if (cached && (cached.status === 'complete' || cached.status === 'error')) {
      return cached.status === 'complete'
        ? { status: 'complete', videoUrl: cached.videoUrl, videoPath: cached.videoPath }
        : { status: 'error', error: cached.error || 'Upscale failed.' };
    }
    // Race guard #2: download in flight — return the same promise so parallel
    // polls coalesce on one download instead of each writing their own file.
    if (cached && cached.downloadPromise) {
      return cached.downloadPromise;
    }

    const statusUrl = cached?.status_url;
    const responseUrl = cached?.response_url;
    if (!statusUrl || !responseUrl) {
      return { status: 'error', error: 'Job record missing fal URLs — submit may not have completed.' };
    }
    const authHeader = { 'Authorization': 'Key ' + process.env.FAL_KEY };

    try {
      const statusRes = await fetch(statusUrl, { headers: authHeader });
      if (!statusRes.ok) {
        const body = await statusRes.text().catch(() => '');
        console.error('[Bria status error]', statusRes.status, body);
        return { status: 'error', error: 'Could not check upscale status.' };
      }
      const statusJson = await statusRes.json();
      const status = statusJson?.status;

      if (status === 'COMPLETED') {
        // A later poll may have started the download while this poll was
        // awaiting status. Re-check the cache before kicking off our own.
        const cachedNow = this._jobs[jobId];
        if (cachedNow && (cachedNow.status === 'complete' || cachedNow.status === 'error')) {
          return cachedNow.status === 'complete'
            ? { status: 'complete', videoUrl: cachedNow.videoUrl, videoPath: cachedNow.videoPath }
            : { status: 'error', error: cachedNow.error || 'Upscale failed.' };
        }
        if (cachedNow && cachedNow.downloadPromise) {
          return cachedNow.downloadPromise;
        }

        const resultRes = await fetch(responseUrl, { headers: authHeader });
        if (!resultRes.ok) {
          const body = await resultRes.text().catch(() => '');
          console.error('[Bria result error]', resultRes.status, body);
          this._jobs[jobId] = { ...(this._jobs[jobId] || {}), status: 'error', error: 'Could not fetch result.' };
          return { status: 'error', error: 'Could not fetch result.' };
        }
        const resultJson = await resultRes.json();
        // Bria's result payload typically has the upscaled video at .video.url;
        // probe alternates in case the response shape varies.
        const videoUrl = resultJson?.video?.url || resultJson?.data?.video?.url || resultJson?.video_url || resultJson?.data?.video_url;

        // Promise-coalescing: stash the download promise BEFORE the multi-second
        // download. Parallel polls hit race guard #2 above and await this same
        // promise — one network download, one local file.
        const savedJob = this._jobs[jobId] || {};
        const saveFolder = savedJob.saveFolder;
        const downloadPromise = (async () => {
          let videoPath = null;
          try {
            if (videoUrl) {
              const resp = await fetch(videoUrl);
              if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching video`);
              const buf = Buffer.from(await resp.arrayBuffer());
              let outPath, filename;
              if (saveFolder && fs.existsSync(saveFolder)) {
                filename = getNextUPFilename(saveFolder);
                outPath = path.join(saveFolder, filename);
              } else {
                filename = `Refluent_UP_${Date.now()}.mp4`;
                outPath = path.join(os.tmpdir(), filename);
              }
              await fs.promises.writeFile(outPath, buf);
              videoPath = outPath;
            }
          } catch (err) {
            console.warn('[Bria] Could not save video locally, falling back to URL only:', err.message);
          }
          const finalResult = { status: 'complete', videoUrl, videoPath };
          this._jobs[jobId] = { ...(this._jobs[jobId] || {}), status: 'complete', videoUrl, videoPath };
          return finalResult;
        })();
        this._jobs[jobId] = { ...(this._jobs[jobId] || {}), status: 'downloading', downloadPromise };
        return downloadPromise;
      }
      if (status === 'FAILED') {
        const errMsg = statusJson?.error || 'Upscale failed. Please try again.';
        this._jobs[jobId] = { ...(this._jobs[jobId] || {}), status: 'error', error: errMsg };
        return { status: 'error', error: errMsg };
      }
      return { status: 'pending' };
    } catch (err) {
      console.error('[Bria status error]', err);
      console.error('[Bria status error] stack:', err?.stack);
      return { status: 'error', error: 'Could not check upscale status.' };
    }
  },

  async cancel(jobId) {
    // Direct PUT on the cancel_url fal returned at submit. Idempotent on
    // already-completed jobs; errors are non-fatal so we swallow.
    try {
      const cancelUrl = (this._jobs[jobId] || {}).cancel_url;
      if (!cancelUrl) return;
      await fetch(cancelUrl, {
        method: 'PUT',
        headers: { 'Authorization': 'Key ' + process.env.FAL_KEY }
      });
    } catch (err) { /* swallow */ }
  }
};

module.exports = { BriaUpscaleAdapter };
