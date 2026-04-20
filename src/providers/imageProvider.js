// SWAP THIS IMPORT TO CHANGE IMAGE MODEL
import { MockImageAdapter } from './adapters/image/mock.js';
// import { NanaBananaAdapter } from './adapters/image/nanaBanana.js';

export const imageProvider = MockImageAdapter;
// To switch: replace MockImageAdapter with NanaBananaAdapter
