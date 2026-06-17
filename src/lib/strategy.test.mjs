import assert from 'node:assert/strict';
import { analyzeMarket } from './strategy.js';

function trendCandles(count = 140, start = 100, drift = 0.035) {
  const out = [];
  let price = start;
  for (let index = 0; index < count; index += 1) {
    const open = price;
    const close = open + drift + Math.sin(index / 7) * 0.01;
    out.push({
      open,
      high: Math.max(open, close) + 0.12,
      low: Math.min(open, close) - 0.12,
      close,
      volume: 100 + (index % 6) * 3
    });
    price = close;
  }
  return out;
}

function downtrendCandles(count = 140, start = 110, drift = -0.05) {
  const out = [];
  let price = start;
  for (let index = 0; index < count; index += 1) {
    const open = price;
    const close = open + drift + Math.sin(index / 7) * 0.005;
    out.push({
      open,
      high: Math.max(open, close) + 0.10,
      low: Math.min(open, close) - 0.10,
      close,
      volume: 110
    });
    price = close;
  }
  return out;
}

{
  const candles = trendCandles();
  const base = candles.slice(0, -2);
  const support = Math.min(...base.slice(-48).map(item => item.low));
  const previousClose = candles.at(-3).close;
  candles[candles.length - 2] = {
    open: previousClose,
    high: previousClose + 0.05,
    low: support * 1.0005,
    close: support * 1.004,
    volume: 220
  };
  candles[candles.length - 1] = {
    open: support * 1.0035,
    high: support * 1.010,
    low: support * 1.002,
    close: support * 1.008,
    volume: 180
  };
  const result = analyzeMarket(candles);
  assert.equal(result.action, 'BUY');
  assert.equal(result.setup, 'SUPPORT_BOUNCE');
  assert.match(result.reason, /Queda esticada.*suporte/);
  assert.ok(result.orderPlan.entry >= result.support);
  assert.ok(result.orderPlan.recoveryTarget > result.orderPlan.entry);
}

{
  const candles = trendCandles();
  const base = candles.slice(0, -2);
  const support = Math.min(...base.slice(-48).map(item => item.low));
  const previousClose = candles.at(-2).close;
  candles[candles.length - 1] = {
    open: support * 1.006,
    high: support * 1.010,
    low: support * 0.9995,
    close: support * 1.0085,
    volume: 190
  };
  candles[candles.length - 2] = {
    open: previousClose,
    high: previousClose + 0.10,
    low: previousClose - 0.10,
    close: previousClose + 0.03,
    volume: 100
  };
  const result = analyzeMarket(candles);
  assert.equal(result.action, 'BUY');
  assert.equal(result.setup, 'SUPPORT_BOUNCE');
  assert.match(result.reason, /suporte|reação/i);
}

{
  const candles = downtrendCandles();
  const base = candles.slice(0, -2);
  const support = Math.min(...base.slice(-48).map(item => item.low));
  candles[candles.length - 2] = {
    open: support * 1.012,
    high: support * 1.013,
    low: support * 0.999,
    close: support * 1.002,
    volume: 230
  };
  candles[candles.length - 1] = {
    open: support * 1.002,
    high: support * 1.009,
    low: support * 1.001,
    close: support * 1.008,
    volume: 220
  };
  const result = analyzeMarket(candles);
  assert.notEqual(result.action, 'BUY');
  assert.match(result.reason, /baixa|defensiva/i);
}

{
  const candles = trendCandles();
  const base = candles.slice(0, -2);
  const resistance = Math.max(...base.slice(-48).map(item => item.high));
  candles[candles.length - 2] = {
    open: resistance * 0.996,
    high: resistance * 0.999,
    low: resistance * 0.990,
    close: resistance * 0.992,
    volume: 200
  };
  candles[candles.length - 1] = {
    open: resistance * 0.992,
    high: resistance * 0.9995,
    low: resistance * 0.991,
    close: resistance * 0.9988,
    volume: 180
  };
  const result = analyzeMarket(candles);
  assert.notEqual(result.action, 'BUY');
  assert.ok(result.distanceToResistancePct < result.requiredRoomPct);
}

console.log('strategy support/resistance tests: OK');

import { analyzeMarketMultiTimeframe } from './strategy.js';

function scaledSeries(count, start, drift, target = 100) {
  const rows = [];
  let price = start;
  for (let index = 0; index < count; index += 1) {
    const open = price;
    const close = Math.max(1, open + drift + Math.sin(index / 11) * Math.abs(drift || 0.01) * 0.35);
    rows.push({
      time: index,
      open,
      high: Math.max(open, close) + Math.max(0.05, start * 0.001),
      low: Math.min(open, close) - Math.max(0.05, start * 0.001),
      close,
      volume: 100 + (index % 9) * 7
    });
    price = close;
  }
  const scale = target / rows.at(-1).close;
  return rows.map(row => ({ ...row, open: row.open * scale, high: row.high * scale, low: row.low * scale, close: row.close * scale }));
}

{
  const falling = {
    '1m': scaledSeries(260, 115, -0.045, 100),
    '5m': scaledSeries(300, 120, -0.055, 100),
    '15m': scaledSeries(300, 125, -0.065, 100),
    '1h': scaledSeries(280, 130, -0.08, 100),
    '4h': scaledSeries(260, 140, -0.10, 100)
  };
  const result = analyzeMarketMultiTimeframe(falling, { profileName: 'arrojado' });
  assert.equal(result.dataComplete, true);
  assert.equal(result.riskOff, true);
  assert.notEqual(result.action, 'BUY');
  assert.match(result.reason, /baixa|risco/i);
}

{
  const rising = {
    '1m': scaledSeries(260, 90, 0.025, 100),
    '5m': scaledSeries(300, 88, 0.035, 100),
    '15m': scaledSeries(300, 85, 0.045, 100),
    '1h': scaledSeries(280, 80, 0.065, 100),
    '4h': scaledSeries(260, 70, 0.09, 100)
  };
  const result = analyzeMarketMultiTimeframe(rising, { profileName: 'moderado' });
  assert.equal(result.dataComplete, true);
  assert.equal(result.riskOff, false);
  assert.ok(result.structuralSupport > 0);
  assert.ok(Array.isArray(result.supportSources));
  assert.ok(result.timeframeRegimes['4h']);
}

console.log('strategy multi-timeframe tests: OK');
