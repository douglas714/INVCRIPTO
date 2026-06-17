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
  assert.match(result.reason, /Queda esticada no suporte/);
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
  assert.match(result.reason, /Varredura\/rejeição/);
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
