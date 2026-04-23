// IMAGE ADAPTER CONTRACT (CommonJS)
const API_KEY = process.env.NANOBANANA_API_KEY || '';
const API_URL = 'https://api.nanobanana.ai/v1';

const NanobananaAdapter = {
  async generate(prompt, referenceImagePath) {
    throw new Error('NanobananaAdapter: not yet implemented');
  },
  async checkStatus(jobId) {
    throw new Error('NanobananaAdapter: not yet implemented');
  },
  async cancel(jobId) {
    throw new Error('NanobananaAdapter: not yet implemented');
  }
};

module.exports = { NanobananaAdapter };
