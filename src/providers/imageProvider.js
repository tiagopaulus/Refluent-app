// SWAP THIS IMPORT TO CHANGE IMAGE MODEL
const { NanobananaAdapter } = require('./adapters/image/nanobanana.js');
// const { MockImageAdapter } = require('./adapters/image/mock.js');

const imageProvider = NanobananaAdapter;

module.exports = { imageProvider };
