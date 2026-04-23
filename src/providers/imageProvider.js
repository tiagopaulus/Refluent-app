// SWAP THIS IMPORT TO CHANGE IMAGE MODEL
const { MockImageAdapter } = require('./adapters/image/mock.js');
// const { NanobananaAdapter } = require('./adapters/image/nanobanana.js');

const imageProvider = MockImageAdapter;
// To switch: replace MockImageAdapter with NanobananaAdapter

module.exports = { imageProvider };
