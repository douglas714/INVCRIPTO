import { analyzeMarket } from './strategy.js';

export function initialPaperState(balanceUsd=1000) {
  return {
    balanceUsd,
    envBalance: 10,
    positions: [],
    orders: [],
    decisions: [],
    realizedProfitUsd: 0,
    feesEnv: 0,
    active: false,
    symbol: 'BTCUSDT',
    mode: 'paper',
    binanceUsdtBalance: 0,
    apiConnected: false
  };
}

function normalizeState(state){
  const n = { ...state };
  if (n.balanceUsd == null) n.balanceUsd = Number(n.balanceBrl || 1000);
  if (n.realizedProfitUsd == null) n.realizedProfitUsd = Number(n.realizedProfitBrl || 0);
  if (n.envBalance == null) n.envBalance = Number(n.invBalance || 10);
  if (n.feesEnv == null) n.feesEnv = Number(n.feesInv || 0);
  if (n.binanceUsdtBalance == null) n.binanceUsdtBalance = 0;
  return n;
}

export function runPaperDecision(state, candles) {
  const analysis = analyzeMarket(candles);
  const next = structuredClone(normalizeState(state));
  const price = analysis.price || candles.at(-1)?.close || 0;
  const now = new Date().toISOString();
  next.decisions.unshift({ at: now, symbol: state.symbol, ...analysis });
  next.decisions = next.decisions.slice(0, 50);
  if (!next.active || next.envBalance <= 0 || price <= 0) return next;

  if (analysis.action === 'BUY' && analysis.score >= 78 && next.positions.length === 0) {
    const valueUsd = Math.min(next.balanceUsd, Math.max(10, next.balanceUsd * 0.05));
    if (valueUsd < 10) return next;
    const qty = valueUsd / price;
    next.balanceUsd -= valueUsd;
    next.positions.push({ id: crypto.randomUUID(), symbol: state.symbol, qty, avgPrice: price, investedUsd: valueUsd, openedAt: now });
    next.orders.unshift({ id: crypto.randomUUID(), at: now, side:'BUY', symbol:state.symbol, qty, price, valueUsd, reason: analysis.reason });
  } else if (next.positions.length > 0) {
    const p = next.positions[0];
    const grossUsd = ((price - p.avgPrice) * p.qty);
    const target = Math.max(0.25, (next.balanceUsd + Number(p.investedUsd || 0)) * 0.001);
    if (grossUsd >= target) {
      const fee = grossUsd * 0.10;
      next.realizedProfitUsd += grossUsd;
      next.feesEnv += fee;
      next.envBalance = Math.max(0, next.envBalance - fee);
      const valueUsd = p.qty * price;
      next.balanceUsd += valueUsd;
      next.orders.unshift({ id: crypto.randomUUID(), at: now, side:'SELL', symbol:state.symbol, qty:p.qty, price, valueUsd, profitUsd:grossUsd, feeEnv:fee, reason:'Micro lucro realizado em USDT' });
      next.positions = [];
      if (next.envBalance <= 0) next.active = false;
    }
  }
  return next;
}
