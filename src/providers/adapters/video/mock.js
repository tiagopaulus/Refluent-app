// VIDEO ADAPTER CONTRACT (CommonJS)
// render(mp4Path, prompt, referenceFramePath) -> Promise<{ jobId, status, videoUrl? }>
// checkStatus(jobId) -> Promise<{ status: 'pending'|'complete'|'error', videoUrl?, error? }>
// cancel(jobId) -> Promise<void>

const MockVideoAdapter = {
  _jobs: {},
  async render(mp4Path, prompt, referenceFramePath) {
    console.log('[MockVideoAdapter] render called', { mp4Path, prompt, referenceFramePath });
    const jobId = 'mock-vid-' + Date.now();
    setTimeout(() => {
      MockVideoAdapter._jobs[jobId] = { status: 'complete', videoUrl: 'mock://video-result.mp4' };
    }, 5000);
    MockVideoAdapter._jobs[jobId] = { status: 'pending' };
    return { jobId, status: 'pending' };
  },
  async checkStatus(jobId) {
    return MockVideoAdapter._jobs[jobId] || { status: 'error', error: 'Job not found' };
  },
  async cancel(jobId) {
    delete MockVideoAdapter._jobs[jobId];
  }
};

module.exports = { MockVideoAdapter };
