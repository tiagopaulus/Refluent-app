// VIDEO ADAPTER CONTRACT (CommonJS) - Seedance 2.0 via fal.ai
// @fal-ai/client is required lazily inside methods so a missing key / missing
// network never blocks app startup.

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

  async render(mp4Path, prompt, referenceFramePath, aspectRatio) {
    this._ensureConfigured();
    const { fal } = require('@fal-ai/client');
    const fs = require('fs');

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
    const referenceHint = tokens.length === 2
      ? `Apply the style, materials, and visual treatment from ${tokens[0]} onto the camera motion and composition from ${tokens[1]}. `
      : `Follow the camera motion and composition from ${tokens[0]}. `;
    const fullPrompt = referenceHint + (prompt || '').trim();

    const input = {
      prompt: fullPrompt,
      video_urls: [videoUrl],
      duration: '5',
      resolution: '720p',
      aspect_ratio: aspectRatio || '16:9',
      generate_audio: true
    };
    if (imageUrl) input.image_urls = [imageUrl];

    const { request_id } = await fal.queue.submit('bytedance/seedance-2.0/reference-to-video', {
      input
    });

    this._jobs[request_id] = { status: 'pending' };
    return { jobId: request_id, status: 'pending' };
  },

  async checkStatus(jobId) {
    this._ensureConfigured();
    const { fal } = require('@fal-ai/client');
    try {
      const status = await fal.queue.status('bytedance/seedance-2.0/reference-to-video', {
        requestId: jobId,
        logs: false
      });
      if (status.status === 'COMPLETED') {
        const result = await fal.queue.result('bytedance/seedance-2.0/reference-to-video', {
          requestId: jobId
        });
        const videoUrl = result?.data?.video?.url || result?.data?.video_url;
        this._jobs[jobId] = { status: 'complete', videoUrl };
        return { status: 'complete', videoUrl };
      }
      if (status.status === 'FAILED') {
        return { status: 'error', error: 'Render failed. Please try again.' };
      }
      return { status: 'pending' };
    } catch (err) {
      return { status: 'error', error: 'Could not check render status.' };
    }
  },

  async cancel(jobId) {
    try {
      this._ensureConfigured();
      const { fal } = require('@fal-ai/client');
      await fal.queue.cancel('bytedance/seedance-2.0/reference-to-video', {
        requestId: jobId
      });
    } catch (err) { /* swallow */ }
  }
};

module.exports = { SeedanceAdapter };
