// UPSCALE ADAPTER CONTRACT (CommonJS) - simulates Real-ESRGAN with a 4 second delay
const MockUpscaleAdapter = {
  _jobs: {},
  async upscale(inputPath, scale) {
    console.log('[MockUpscaleAdapter] upscale called', { inputPath, scale });
    const jobId = 'mock-up-' + Date.now();
    setTimeout(() => {
      MockUpscaleAdapter._jobs[jobId] = { status: 'complete', outputUrl: 'mock://upscaled-result.mp4' };
    }, 4000);
    MockUpscaleAdapter._jobs[jobId] = { status: 'pending' };
    return { jobId, status: 'pending' };
  },
  async checkStatus(jobId) {
    return MockUpscaleAdapter._jobs[jobId] || { status: 'error', error: 'Job not found' };
  },
  async cancel(jobId) {
    delete MockUpscaleAdapter._jobs[jobId];
  }
};

module.exports = { MockUpscaleAdapter };
