// SWAP THIS LINE TO CHANGE VIDEO MODEL
const { MockVideoAdapter } = require('./adapters/video/mock.js');
// const { SeedanceAdapter } = require('./adapters/video/seedance.js');

const videoProvider = MockVideoAdapter;
// To switch: replace MockVideoAdapter with SeedanceAdapter

module.exports = { videoProvider };
