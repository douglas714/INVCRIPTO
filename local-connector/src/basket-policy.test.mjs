import assert from 'node:assert/strict';
import {
  allocateBasketBudget,
  netTargetPrice,
  nextProtectionPrice,
  nextProtectionQuote,
  profileRules,
  summarizeBasketOrders
} from './basket-policy.js';

assert.equal(profileRules('conservador').protectionGapPct, 1);
assert.equal(profileRules('moderado').protectionGapPct, 0.5);
assert.equal(profileRules('arrojado').maxConcurrentBaskets, 1);
assert.equal(profileRules('alavancagem').maxConcurrentBaskets, 5);

const budget = allocateBasketBudget({ accountUsdt: 1000, profileName: 'alavancagem' });
assert.equal(budget.basketBudget, 200);
assert.equal(budget.normalBudget, 160);
assert.equal(budget.emergencyBudget, 40);
assert.equal(nextProtectionPrice({ lastBuyPrice: 100, gapPct: 0.5 }), 99.5);
assert.equal(nextProtectionPrice({ lastBuyPrice: 100, gapPct: 0.5, emergency: true }), 98.5);
assert.deepEqual(nextProtectionQuote({ lastQuote: 10, normalRemaining: 100, emergencyRemaining: 20 }), { quote: 13.5, bucket: 'normal', emergency: false });

const summary = summarizeBasketOrders([
  { side: 'BUY', status: 'filled', executed_qty: 0.1, cummulative_quote_qty: 10, created_at: '2026-01-01' },
  { side: 'BUY', status: 'filled', executed_qty: 0.2, cummulative_quote_qty: 19, created_at: '2026-01-02' },
  { side: 'SELL', status: 'filled', executed_qty: 0.05, cummulative_quote_qty: 5.1, created_at: '2026-01-03' }
]);
assert.ok(Math.abs(summary.openQty - 0.25) < 1e-12);
assert.equal(summary.netCapital, 23.9);
assert.equal(summary.recoveryLevel, 2);
assert.ok(netTargetPrice({ netCapitalUsdt: 100, quantity: 1 }) > 100.8);
console.log('basket-policy tests: OK');
