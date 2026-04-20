// IMAGE ADAPTER CONTRACT
// generate(prompt, referenceImagePath) → Promise<{ jobId, status, imageUrl? }>
// checkStatus(jobId) → Promise<{ status: 'pending'|'complete'|'error', imageUrl?, error? }>
// cancel(jobId) → Promise<void>

const API_KEY = process.env.NANA_BANANA_API_KEY || '';
const API_URL = 'https://api.nanabanana.ai/v1'; // update when confirmed

export const NanaBananaAdapter = {
  async generate(prompt, referenceImagePath) {
    // TODO: implement when API key is available
    throw new Error('NanaBananaAdapter: not yet implemented');
  },
  async checkStatus(jobId) {
    throw new Error('NanaBananaAdapter: not yet implemented');
  },
  async cancel(jobId) {
    throw new Error('NanaBananaAdapter: not yet implemented');
  }
};
