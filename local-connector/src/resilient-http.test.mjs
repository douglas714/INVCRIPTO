import assert from 'node:assert/strict';
import { compactError, isNetworkError, isRetryableStatus } from './resilient-http.js';

assert.equal(isRetryableStatus(503), true);
assert.equal(isRetryableStatus(400), false);
assert.equal(isNetworkError(new TypeError('fetch failed')), true);
assert.equal(isNetworkError(Object.assign(new Error('socket'), { code: 'ECONNRESET' })), true);
assert.match(compactError(Object.assign(new Error('falha'), { code: 'EAI_AGAIN' })), /EAI_AGAIN/);
console.log('resilient-http tests: OK');
