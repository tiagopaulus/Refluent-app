// SWAP THIS IMPORT TO CHANGE VIDEO MODEL
import { MockVideoAdapter } from './adapters/video/mock.js';
// import { SeedanceAdapter } from './adapters/video/seedance.js';

export const videoProvider = MockVideoAdapter;
// To switch: replace MockVideoAdapter with SeedanceAdapter
