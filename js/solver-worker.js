// Web Worker for running the solver off the main thread
// We import solver modules directly since workers support ES modules

import { solve } from './solver.js';

self.onmessage = function (e) {
    const { type, state, timeout } = e.data;

    if (type === 'solve') {
        try {
            const result = solve(state, timeout || 30000);
            self.postMessage({ type: 'result', ...result });
        } catch (err) {
            self.postMessage({
                type: 'error',
                message: err.message
            });
        }
    }
};
