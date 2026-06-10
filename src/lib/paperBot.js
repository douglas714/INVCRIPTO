import { analyzeMarket } from './strategy.js';

export function initialPaperState(balanceBrl=1000) {
  return { balanceBrl, invBalance: 10, positions: [], orders: [], decisions: [], realizedProfitBrl: 0, feesInv: 0, active: false, symbol: 'BTCUSDT', mode: 'paper' };
}

export function runPaperDecision(state, candles, usdtBrl=5.2) {
  const analysis = analyzeMarket(candles);
  const next = structuredClone(state);
  const price = analysis.price || candles.at(-1)?.close || 0;
  const now = new Date().toISOString();
  next.decisions.unshift({ at: now, symbol: state.symbol, ...analysis });
  next.decisions = next.decisions.slice(0, 50);
  if (!state.active || state.invBalance <= 0) return next;
  if (analysis.action === 'BUY' && analysis.score >= 78 && next.positions.length === 0) {
    const valueBrl = Math.max(10, next.balanceBrl * 0.05);
    const qty = (valueBrl / usdtBrl) / price;
    next.positions.push({ id: crypto.randomUUID(), symbol: state.symbol, qty, avgPrice: price, investedBrl: valueBrl, openedAt: now });
    next.orders.unshift({ id: crypto.randomUUID(), at: now, side:'BUY', symbol:state.symbol, qty, price, valueBrl, reason: analysis.reason });
  } else if (next.positions.length > 0) {
    const p = next.positions[0];
    const grossBrl = ((price - p.avgPrice) * p.qty) * usdtBrl;
    const target = Math.max(0.25, next.balanceBrl * 0.001);
    if (grossBrl >= target) {
      const fee = grossBrl * 0.10;
      next.realizedProfitBrl += grossBrl;
      next.feesInv += fee;
      next.invBalance = Math.max(0, next.invBalance - fee);
      next.orders.unshift({ id: crypto.randomUUID(), at: now, side:'SELL', symbol:state.symbol, qty:p.qty, price, valueBrl:p.qty*price*usdtBrl, profitBrl:grossBrl, feeInv:fee, reason:'Micro lucro realizado' });
      next.positions = [];
      if (next.invBalance <= 0) next.active = false;
    }
  }
  return next;
}
