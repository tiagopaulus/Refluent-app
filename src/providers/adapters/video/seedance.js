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

  async render(mp4Path, prompt, referenceFramePath) {
    this._ensureConfigured();
    const { fal } = require('@fal-ai/client');
    const fs = require('fs');

    let videoUrl;
    try {
      const fileStream = fs.createReadStream(mp4Path);
      const fileName = mp4Path.split(/[\\/]/).pop();
      videoUrl = await fal.storage.upload(fileStream, { fileName });
    } catch (err) {
      throw new Error('Could not upload video file. Please try again.');
    }

    const { request_id } = await fal.queue.submit('bytedance/seedance-2.0/reference-to-video', {
      input: {
        prompt: prompt,
        reference_video_url: videoUrl,
        duration: 10,
        resolution: '720p',
        speed: 'fast'
      }
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
