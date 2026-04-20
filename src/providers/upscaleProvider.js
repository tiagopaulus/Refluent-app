// SWAP THIS IMPORT TO CHANGE UPSCALE MODEL
import { MockUpscaleAdapter } from './adapters/upscale/mock.js';
// import { RealEsrganAdapter } from './adapters/upscale/realEsrgan.js';

export const upscaleProvider = MockUpscaleAdapter;
// To switch: replace MockUpscaleAdapter with RealEsrganAdapter
