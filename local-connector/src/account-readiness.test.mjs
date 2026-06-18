import assert from 'node:assert/strict';
import { accountReadiness } from './account-readiness.js';

const live = accountReadiness({
  canTrade: true,
  canWithdraw: true,
  accountType: 'SPOT',
  permissions: ['SPOT'],
  balances: [{ asset: 'USDT', free: '102.63', locked: '1.20' }]
}, 'live');

assert.equal(live.credentialStatus, 'active');
assert.equal(live.productionReady, true);
assert.equal(live.canWithdraw, false);
assert.equal(live.accountCanWithdraw, true);
assert.equal(live.withdrawPermissionVerified, false);
assert.equal(live.usdtFree, 102.63);

const readOnly = accountReadiness({ canTrade: false, permissions: ['SPOT'] }, 'live');
assert.equal(readOnly.credentialStatus, 'review_required');
assert.equal(readOnly.productionReady, false);

const noSpot = accountReadiness({ canTrade: true, permissions: ['MARGIN'] }, 'live');
assert.equal(noSpot.credentialStatus, 'review_required');

console.log('account-readiness tests: OK');
