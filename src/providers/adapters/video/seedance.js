// VIDEO ADAPTER CONTRACT
// render(mp4Path, prompt, referenceFramePath) → Promise<{ jobId, status, videoUrl? }>
// checkStatus(jobId) → Promise<{ status: 'pending'|'complete'|'error', videoUrl?, error? }>
// cancel(jobId) → Promise<void>

import { fal } from '@fal-ai/client';

// API key loaded from main process via IPC — never hardcoded
let _configured = false;

function ensureConfigured() {
  if (_configured) return;
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY not found in environment');
  fal.config({ credentials: key });
  _configured = true;
}

export const SeedanceAdapter = {
  _jobs: {},

  async render(mp4Path, prompt, referenceFramePath) {
    ensureConfigured();

    // Upload the MP4 file to fal storage first
    const { createReadStream } = await import('fs');
    const { upload } = await import('@fal-ai/client');

    let videoUrl;
    try {
      const fileStream = createReadStream(mp4Path);
      const fileName = mp4Path.split(/[\\/]/).pop();
      videoUrl = await fal.storage.upload(fileStream, { fileName });
    } catch (err) {
      throw new Error('Could not upload video file. Please try again.');
    }

    // Submit to Seedance 2.0 reference-to-video queue
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
    ensureConfigured();
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
    ensureConfigured();
    try {
      await fal.queue.cancel('bytedance/seedance-2.0/reference-to-video', {
        requestId: jobId
      });
    } catch (err) {
      // Silently ignore cancel errors
    }
  }
};
