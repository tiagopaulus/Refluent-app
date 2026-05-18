// SWAP THIS LINE TO CHANGE VIDEO MODEL
// const { MockVideoAdapter } = require('./adapters/video/mock.js');
const { SeedanceAdapter } = require('./adapters/video/seedance.js');

const videoProvider = SeedanceAdapter;
// To revert to mock: comment out SeedanceAdapter, uncomment MockVideoAdapter, swap the assignment.

module.exports = { videoProvider };
