// SWAP THIS IMPORT TO CHANGE IMAGE MODEL
import { MockImageAdapter } from './adapters/image/mock.js';
// import { NanobananaAdapter } from './adapters/image/nanobanana.js';

export const imageProvider = MockImageAdapter;
// To switch: replace MockImageAdapter with NanobananaAdapter
