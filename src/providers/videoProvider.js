// SWAP THIS LINE TO CHANGE VIDEO MODEL
// Atlas Cloud Seedance kept commented for quick rollback — its reference-to-video
// endpoint accepts only 720p, while we need 1080p output, so we're back on fal.
const { SeedanceAdapter } = require('./adapters/video/seedance.js');
// const { AtlasSeedanceAdapter } = require('./adapters/video/atlasSeedance.js');
// const { MockVideoAdapter } = require('./adapters/video/mock.js');
const videoProvider = SeedanceAdapter;
module.exports = { videoProvider };
