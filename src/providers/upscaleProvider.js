// SWAP THIS IMPORT TO CHANGE UPSCALE MODEL
const { MockUpscaleAdapter } = require('./adapters/upscale/mock.js');
// const { RealEsrganAdapter } = require('./adapters/upscale/realEsrgan.js');

const upscaleProvider = MockUpscaleAdapter;
// To switch: replace MockUpscaleAdapter with RealEsrganAdapter

module.exports = { upscaleProvider };
