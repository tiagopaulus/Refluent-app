// VIDEO ADAPTER CONTRACT (CommonJS) - Seedance 2.0 via fal.ai
// @fal-ai/client is required lazily inside methods so a missing key / missing
// network never blocks app startup.

const path = require('path');
const fs = require('fs');
const os = require('os');

// Auto-incrementing filename helper, mirrors Nanobanana's getNextNBFilename
function getNextSDFilename(folder) {
  let i = 1;
  while (true) {
    const name = `Refluent_SD_${String(i).padStart(3, '0')}.mp4`;
    if (!fs.existsSync(path.join(folder, name))) return name;
    i++;
  }
}

const SeedanceAdapter = {
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

  async render(mp4Path, prompt, referenceFramePath, aspectRatio, saveFolder, duration, resolution, generateAudio) {
    console.log('[SD adapter.render called]', new Date().toISOString());
    this._ensureConfigured();
    const { fal } = require('@fal-ai/client');

    // Upload the MP4 (camera-motion reference video).
    // Note: must use a Blob, not a ReadStream. Node 18+'s fetch (which
    // @fal-ai/client uses internally) rejects streaming bodies unless the
    // RequestInit sets `duplex: 'half'`, which the SDK doesn't. A Blob has
    // a known size and uses non-streaming upload — no duplex required.
    let videoUrl;
    try {
      const fileName = mp4Path.split(/[\\/]/).pop();
      const buf = await fs.promises.readFile(mp4Path);
      const blob = new Blob([buf], { type: 'video/mp4' });
      videoUrl = await fal.storage.upload(blob, { fileName });
    } catch (err) {
      console.error('[Seedance upload error]', err);
      throw new Error('Could not upload video file. Please try again.');
    }

    // Upload the reference still image (style/look-and-feel from Nanobanana)
    // This is the bug fix: previously referenceFramePath was accepted but
    // silently dropped. fal.ai's reference-to-video endpoint supports image_urls
    // in addition to video_urls — the Nanobanana-styled still gives the model
    // the visual style + identity to apply onto the camera motion.
    let imageUrl = null;
    if (referenceFramePath) {
      try {
        const imgName = referenceFramePath.split(/[\\/]/).pop();
        const imgBuf = await fs.promises.readFile(referenceFramePath);
        const ext = (imgName.split('.').pop() || '').toLowerCase();
        const mime = ext === 'png' ? 'image/png'
          : ext === 'webp' ? 'image/webp'
          : 'image/jpeg';
        const imgBlob = new Blob([imgBuf], { type: mime });
        imageUrl = await fal.storage.upload(imgBlob, { fileName: imgName });
      } catch (err) {
        // Non-fatal — fall back to video-only generation.
        console.warn('[Seedance] Could not upload reference image, proceeding without:', err.message);
      }
    }

    // Build the prompt with explicit reference tokens. fal.ai's Seedance 2.0
    // resolves @Image1 and @Video1 against image_urls[0] and video_urls[0].
    // Without these tokens the model treats the assets as loose context.
    const tokens = [];
    if (imageUrl) tokens.push('@Image1');
    tokens.push('@Video1');

    const styleClause = tokens.length === 2
      ? `Apply the style, materials, and visual treatment from ${tokens[0]} onto the camera motion and composition from ${tokens[1]}. `
      : `Follow the camera motion and composition from ${tokens[0]}. `;

    const identityLock = imageUrl
      ? `SUBJECT IDENTITY LOCK: the product's physical form — bottle silhouette, cap design, label text, logo, color, materials, and proportions — must remain pixel-stable and identical to ${tokens[0]} at every frame of the video. Do NOT morph, soften, blur, or reinterpret any product detail during motion. Treat the subject as a rigid, photographed real-world object. `
      : '';

    const motionLock = `MOTION CONTINUITY LOCK: the camera motion from @Video1 is the authoritative motion source. For the duration of the reference video, the output motion must match @Video1 frame-for-frame — same direction, same speed, same trajectory, no added rotation, no added drift, no creative reinterpretation. If the output duration exceeds the reference video's length, smoothly continue the SAME trajectory in the SAME direction at the SAME speed past where the reference ends — as if the reference camera kept moving. Do NOT introduce new motion axes (no rotation if the reference doesn't rotate, no orbit if the reference doesn't orbit). Do NOT loop, restart, or repeat any segment of the reference motion. Treat the reference as the first N seconds of a longer continuous take and extrapolate the trajectory naturally. `;

    const audioClause = 'Audio should match the visual mood of the reference image — ambient, restrained, and matching the campaign tone. No music unless explicitly requested. ';

    const fullPrompt = styleClause + identityLock + motionLock + audioClause + (prompt || '').trim();

    const input = {
      prompt: fullPrompt,
      video_urls: [videoUrl],
      duration: String(duration || 5),
      resolution: resolution || '1080p',
      aspect_ratio: aspectRatio || '16:9',
      generate_audio: true // hardcoded — UI toggle removed; audio always on per Phase 1.5 baseline
    };
    if (imageUrl) input.image_urls = [imageUrl];

    // Direct-fetch submit (bypasses @fal-ai/client's hardcoded 3-retry policy on
    // queue.submit, which silently created up to 4 duplicate jobs when fal's
    // queue endpoint returned a transient 504/502/503/429 even though the prior
    // attempt had already enqueued a job server-side. See queue.js:32-38 in the
    // SDK. Status/result/upload/cancel still use the SDK — only submit is direct.
    console.log('[SD direct-fetch submit called]', new Date().toISOString());
    const response = await fetch('https://queue.fal.run/bytedance/seedance-2.0/reference-to-video', {
      method: 'POST',
      headers: {
        'Authorization': 'Key ' + process.env.FAL_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error('[SD submit error]', response.status, body);
      throw new Error(`fal submit failed: HTTP ${response.status} ${body || ''}`.trim());
    }
    const submitResponse = await response.json();
    const { request_id, status_url, response_url, cancel_url } = submitResponse;

    // Stash fal's own URLs so checkStatus / cancel hit the exact paths fal
    // returned, instead of letting the SDK try to construct them from the
    // endpoint string (which appends the model variant /reference-to-video to
    // status/result/cancel paths where fal expects the parent namespace only —
    // causing 422 ValidationError). Also thread saveFolder so checkStatus can
    // write the finished MP4 to the user's chosen folder.
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
    // Race guard #1: if we've already resolved this job (complete or error),
    // return the cached result instantly. Parallel polls would otherwise
    // each re-enter the download path producing duplicate files.
    const cached = this._jobs[jobId];
    if (cached && (cached.status === 'complete' || cached.status === 'error')) {
      return cached.status === 'complete'
        ? { status: 'complete', videoUrl: cached.videoUrl, videoPath: cached.videoPath }
        : { status: 'error', error: cached.error || 'Render failed.' };
    }
    // Race guard #2: if a download is already in flight from a prior poll,
    // return its in-flight promise so parallel polls coalesce on one download
    // instead of each writing their own file. Ported from Atlas adapter.
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
      // Direct GET on the status_url fal handed us at submit. The SDK's
      // fal.queue.status was rejected (422) because it appended /reference-to-video
      // to the status path, but fal's status endpoint sits at the parent namespace.
      const statusRes = await fetch(statusUrl, { headers: authHeader });
      if (!statusRes.ok) {
        const body = await statusRes.text().catch(() => '');
        console.error('[Seedance status error]', statusRes.status, body);
        return { status: 'error', error: 'Could not check render status.' };
      }
      const statusJson = await statusRes.json();
      const status = statusJson?.status;

      if (status === 'COMPLETED') {
        // A LATER poll may have entered checkStatus and started the download
        // while this poll was awaiting the status fetch. Re-check the cache.
        const cachedNow = this._jobs[jobId];
        if (cachedNow && (cachedNow.status === 'complete' || cachedNow.status === 'error')) {
          return cachedNow.status === 'complete'
            ? { status: 'complete', videoUrl: cachedNow.videoUrl, videoPath: cachedNow.videoPath }
            : { status: 'error', error: cachedNow.error || 'Render failed.' };
        }
        if (cachedNow && cachedNow.downloadPromise) {
          return cachedNow.downloadPromise;
        }

        // Fetch the result payload directly from response_url. fal returns
        // the model output JSON (video, timings, etc.) at this URL.
        const resultRes = await fetch(responseUrl, { headers: authHeader });
        if (!resultRes.ok) {
          const body = await resultRes.text().catch(() => '');
          console.error('[Seedance result error]', resultRes.status, body);
          this._jobs[jobId] = { ...(this._jobs[jobId] || {}), status: 'error', error: 'Could not fetch result.' };
          return { status: 'error', error: 'Could not fetch result.' };
        }
        const resultJson = await resultRes.json();
        const videoUrl = resultJson?.video?.url || resultJson?.data?.video?.url || resultJson?.video_url || resultJson?.data?.video_url;

        // Promise-coalescing: stash the download promise on _jobs[jobId] BEFORE
        // starting the (multi-second) download. Any parallel poll that calls
        // checkStatus during this window hits race guard #2 above and returns
        // this same promise, so we get one network download and one local file
        // regardless of how many polls fire while fal is reporting COMPLETED.
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
                filename = getNextSDFilename(saveFolder);
                outPath = path.join(saveFolder, filename);
              } else {
                filename = `Refluent_SD_${Date.now()}.mp4`;
                outPath = path.join(os.tmpdir(), filename);
              }
              await fs.promises.writeFile(outPath, buf);
              videoPath = outPath;
            }
          } catch (err) {
            console.warn('[Seedance] Could not save video locally, falling back to URL only:', err.message);
          }
          const finalResult = { status: 'complete', videoUrl, videoPath };
          this._jobs[jobId] = { ...(this._jobs[jobId] || {}), status: 'complete', videoUrl, videoPath };
          return finalResult;
        })();
        this._jobs[jobId] = { ...(this._jobs[jobId] || {}), status: 'downloading', downloadPromise };
        return downloadPromise;
      }
      if (status === 'FAILED') {
        const errMsg = statusJson?.error || 'Render failed. Please try again.';
        this._jobs[jobId] = { ...(this._jobs[jobId] || {}), status: 'error', error: errMsg };
        return { status: 'error', error: errMsg };
      }
      return { status: 'pending' };
    } catch (err) {
      console.error('[Seedance status error]', err);
      console.error('[Seedance status error] stack:', err?.stack);
      return { status: 'error', error: 'Could not check render status.' };
    }
  },

  async cancel(jobId) {
    // Direct PUT on the cancel_url fal returned at submit. fal's queue cancel
    // endpoint accepts PUT and is idempotent on already-completed jobs.
    try {
      const cancelUrl = (this._jobs[jobId] || {}).cancel_url;
      if (!cancelUrl) return;
      await fetch(cancelUrl, {
        method: 'PUT',
        headers: { 'Authorization': 'Key ' + process.env.FAL_KEY }
      });
    } catch (err) { /* swallow — cancel failures are non-fatal */ }
  }
};

module.exports = { SeedanceAdapter };
