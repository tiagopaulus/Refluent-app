// UPSCALE ADAPTER CONTRACT (CommonJS)
const API_KEY = process.env.UPSCALE_API_KEY || '';
const API_URL = 'https://queue.fal.run/fal-ai/esrgan';

const RealEsrganAdapter = {
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

module.exports = { RealEsrganAdapter };
