import assert from 'node:assert/strict';
import {
  allocateBasketBudget,
  netTargetPrice,
  nextProtectionPrice,
  nextProtectionQuote,
  profileRules,
  summarizeBasketOrders,
  supportAwareProtectionPrice
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

// Protecao usa o percentual apenas como gatilho maximo e posiciona a compra
// no proximo suporte abaixo dele.
{
  const candles = [];
  for (let i = 0; i < 180; i += 1) {
    const center = 100 + Math.sin(i / 9) * 1.2;
    candles.push({
      open: center - 0.12,
      high: center + 0.35,
      low: center - 0.35,
      close: center + 0.12,
      volume: 100 + (i % 7) * 8
    });
  }
  const plan = supportAwareProtectionPrice({
    candles,
    lastBuyPrice: 102,
    gapPct: 0.5,
    currentPrice: 102
  });
  assert.ok(plan.price > 0);
  assert.ok(plan.price <= plan.triggerPrice);
  assert.ok(plan.support <= plan.triggerPrice);
  assert.equal(plan.reason, 'next_support_below_profile_gap');
}

// Se o mercado ja rompeu um suporte, a nova LIMIT nunca fica acima do preco
// atual, evitando execucao imediata no meio da queda.
{
  const candles = [];
  for (let i = 0; i < 180; i += 1) {
    const center = 100 + Math.sin(i / 8) * 1.5;
    candles.push({ open:center, high:center+0.3, low:center-0.3, close:center+0.05, volume:120 });
  }
  const plan = supportAwareProtectionPrice({
    candles,
    lastBuyPrice: 104,
    gapPct: 0.3,
    currentPrice: 99
  });
  assert.ok(plan.price === 0 || plan.price <= 99 * 1.001 + 1e-9);
}

import {
  multiTimeframeEntryContext,
  supportAwareProtectionPriceMtf
} from './basket-policy.js';

function mtfSeries(count, start, drift, target = 100) {
  const rows = [];
  let price = start;
  for (let index = 0; index < count; index += 1) {
    const open = price;
    const close = Math.max(1, open + drift + Math.sin(index / 10) * Math.abs(drift || 0.01) * 0.3);
    rows.push({
      openTime: index * 60000,
      closeTime: (index + 1) * 60000 - 1,
      open,
      high: Math.max(open, close) + 0.12,
      low: Math.min(open, close) - 0.12,
      close,
      volume: 100 + (index % 8) * 6
    });
    price = close;
  }
  const scale = target / rows.at(-1).close;
  return rows.map(row => ({ ...row, open: row.open * scale, high: row.high * scale, low: row.low * scale, close: row.close * scale }));
}

{
  const falling = {
    '1m': mtfSeries(260, 115, -0.04),
    '5m': mtfSeries(300, 120, -0.05),
    '15m': mtfSeries(300, 125, -0.06),
    '1h': mtfSeries(280, 130, -0.08),
    '4h': mtfSeries(260, 140, -0.10)
  };
  const entry = multiTimeframeEntryContext(falling, { profileName: 'arrojado', currentPrice: 100 });
  assert.equal(entry.riskOff, true);
  assert.equal(entry.valid, false);
  const protection = supportAwareProtectionPriceMtf({
    timeframes: falling,
    lastBuyPrice: 102,
    gapPct: 0.3,
    currentPrice: 100,
    profileName: 'arrojado'
  });
  assert.equal(protection.price, 0);
  assert.equal(protection.reason, 'risk_off_protection_paused');
}

assert.deepEqual(
  nextProtectionQuote({ lastQuote: 10, normalRemaining: 100, emergencyRemaining: 20, growthFactor: 1.2 }),
  { quote: 12, bucket: 'normal', emergency: false }
);

console.log('basket-policy multi-timeframe tests: OK');
