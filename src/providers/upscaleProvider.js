// SWAP THIS IMPORT TO CHANGE UPSCALE MODEL
const { BriaUpscaleAdapter } = require('./adapters/upscale/briaUpscale.js');
// const { MockUpscaleAdapter } = require('./adapters/upscale/mock.js');
// const { RealEsrganAdapter } = require('./adapters/upscale/realEsrgan.js');

const upscaleProvider = BriaUpscaleAdapter;
// Rollback: comment out BriaUpscaleAdapter, uncomment MockUpscaleAdapter, swap the assignment.

module.exports = { upscaleProvider };
