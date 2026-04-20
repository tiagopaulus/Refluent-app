// VIDEO ADAPTER CONTRACT
// render(mp4Path, prompt, referenceFramePath) → Promise<{ jobId, status, videoUrl? }>
// checkStatus(jobId) → Promise<{ status: 'pending'|'complete'|'error', videoUrl?, error? }>
// cancel(jobId) → Promise<void>

const API_KEY = process.env.SEEDANCE_API_KEY || '';
const API_URL = 'https://queue.fal.run/fal-ai/seedance'; // fal.ai endpoint

export const SeedanceAdapter = {
  async render(mp4Path, prompt, referenceFramePath) {
    // TODO: implement when API key is available
    throw new Error('SeedanceAdapter: not yet implemented');
  },
  async checkStatus(jobId) {
    throw new Error('SeedanceAdapter: not yet implemented');
  },
  async cancel(jobId) {
    throw new Error('SeedanceAdapter: not yet implemented');
  }
};
