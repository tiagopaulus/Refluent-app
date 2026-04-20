// UPSCALE ADAPTER CONTRACT
// upscale(inputPath, scale) → Promise<{ jobId, status, outputUrl? }>
// checkStatus(jobId) → Promise<{ status: 'pending'|'complete'|'error', outputUrl?, error? }>
// cancel(jobId) → Promise<void>

const API_KEY = process.env.UPSCALE_API_KEY || '';
const API_URL = 'https://queue.fal.run/fal-ai/esrgan';

export const RealEsrganAdapter = {
  async upscale(inputPath, scale) {
    throw new Error('RealEsrganAdapter: not yet implemented');
  },
  async checkStatus(jobId) {
    throw new Error('RealEsrganAdapter: not yet implemented');
  },
  async cancel(jobId) {
    throw new Error('RealEsrganAdapter: not yet implemented');
  }
};
