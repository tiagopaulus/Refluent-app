// IMAGE ADAPTER CONTRACT (CommonJS) - simulates Nanobanana with a 3 second delay
const MockImageAdapter = {
  _jobs: {},
  async generate(prompt, referenceImagePath) {
    console.log('[MockImageAdapter] generate called', { prompt, referenceImagePath });
    const jobId = 'mock-img-' + Date.now();
    setTimeout(() => {
      MockImageAdapter._jobs[jobId] = { status: 'complete', imageUrl: 'mock://image-result.jpg' };
    }, 3000);
    MockImageAdapter._jobs[jobId] = { status: 'pending' };
    return { jobId, status: 'pending' };
  },
  async checkStatus(jobId) {
    return MockImageAdapter._jobs[jobId] || { status: 'error', error: 'Job not found' };
  },
  async cancel(jobId) {
    delete MockImageAdapter._jobs[jobId];
  }
};

module.exports = { MockImageAdapter };
