// IMAGE ADAPTER CONTRACT
// generate(prompt, referenceImagePath) → Promise<{ jobId, status, imageUrl? }>
// checkStatus(jobId) → Promise<{ status: 'pending'|'complete'|'error', imageUrl?, error? }>
// cancel(jobId) → Promise<void>

const API_KEY = process.env.NANOBANANA_API_KEY || '';
const API_URL = 'https://api.nanobanana.ai/v1'; // update when confirmed

export const NanobananaAdapter = {
  async generate(prompt, referenceImagePath) {
    // TODO: implement when API key is available
    throw new Error('NanobananaAdapter: not yet implemented');
  },
  async checkStatus(jobId) {
    throw new Error('NanobananaAdapter: not yet implemented');
  },
  async cancel(jobId) {
    throw new Error('NanobananaAdapter: not yet implemented');
  }
};
