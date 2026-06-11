import { analyzeMarket } from './strategy.js';

export function initialPaperState(balanceUsd=1000) {
  return {
    balanceUsd,
    envBalance: 10,
    positions: [],
    orders: [],
    targetOrders: [],
    decisions: [],
    realizedProfitUsd: 0,
    feesEnv: 0,
    active: false,
    symbol: 'BTCUSDT',
    mode: 'paper',
    accountMode: 'demo',
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
  if (!n.accountMode) n.accountMode = 'demo';
  if (!Array.isArray(n.targetOrders)) n.targetOrders = [];
  return n;
}

export function createTargetPreviewOrder(state, symbol, analysis, timeframe = '15m') {
  const next = structuredClone(normalizeState(state));
  const plan = analysis?.orderPlan;
  if (!plan || plan.side !== 'BUY') return next;

  const valueUsd = Math.min(next.balanceUsd, Math.max(10, next.balanceUsd * 0.05));
  if (valueUsd < 10 || plan.entry <= 0) return next;

  const qty = valueUsd / plan.entry;
  const order = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    status: 'PREVIEW',
    side: 'BUY_TARGET_1',
    type: plan.type,
    symbol,
    timeframe,
    qty,
    price: plan.entry,
    valueUsd,
    stopLoss: plan.stopLoss,
    target1: plan.target1,
    target2: plan.target2,
    recoveryTarget: plan.recoveryTarget,
    ladder: plan.ladder,
    riskUsd: (plan.entry - plan.stopLoss) * qty,
    potentialProfitUsd: (plan.target1 - plan.entry) * qty,
    riskReward: plan.riskReward,
    confidence: plan.confidence,
    reason: analysis.reason
  };

  next.targetOrders = [order, ...next.targetOrders.filter(item => item.symbol !== symbol)].slice(0, 8);
  return next;
}

export function runPaperDecision(state, candles) {
  const analysis = analyzeMarket(candles);
  const next = structuredClone(normalizeState(state));
  const price = analysis.price || candles.at(-1)?.close || 0;
  const now = new Date().toISOString();
  next.decisions.unshift({ at: now, symbol: state.symbol, ...analysis });
  next.decisions = next.decisions.slice(0, 50);
  if (!next.active || (next.accountMode === 'live' && next.envBalance <= 0) || price <= 0) return next;

  if (analysis.action === 'BUY' && analysis.score >= 78 && next.positions.length === 0) {
    const plan = analysis.orderPlan;
    const valueUsd = Math.min(next.balanceUsd, Math.max(10, next.balanceUsd * 0.05));
    if (valueUsd < 10) return next;
    const entryPrice = plan?.entry || price;
    const qty = valueUsd / entryPrice;
    next.balanceUsd -= valueUsd;
    next.positions.push({
      id: crypto.randomUUID(),
      symbol: state.symbol,
      qty,
      avgPrice: entryPrice,
      investedUsd: valueUsd,
      openedAt: now,
      ladderLevel: 1,
      baseHandUsd: valueUsd,
      recoveryTarget: entryPrice * 1.005,
      martingalePlan: plan?.ladder || []
    });
    next.orders.unshift({ id: crypto.randomUUID(), at: now, side:'BUY_M1', symbol:state.symbol, qty, price:entryPrice, valueUsd, reason: analysis.reason });
  } else if (next.positions.length > 0) {
    const p = next.positions[0];
    const plan = analysis.orderPlan?.ladder?.length ? analysis.orderPlan.ladder : p.martingalePlan || [];
    const ladderLevel = Number(p.ladderLevel || 1);
    const nextHand = plan.find(item => item.level === ladderLevel + 1);

    if (nextHand && price <= nextHand.entry && next.balanceUsd >= 10) {
      const valueUsd = Math.min(next.balanceUsd, Math.max(10, Number(p.baseHandUsd || 10) * nextHand.multiplier));
      const qty = valueUsd / price;
      const investedUsd = Number(p.investedUsd || 0) + valueUsd;
      const totalQty = Number(p.qty || 0) + qty;
      p.qty = totalQty;
      p.investedUsd = investedUsd;
      p.avgPrice = investedUsd / totalQty;
      p.ladderLevel = nextHand.level;
      p.recoveryTarget = p.avgPrice * 1.005;
      next.balanceUsd -= valueUsd;
      next.orders.unshift({ id: crypto.randomUUID(), at: now, side:`BUY_M${nextHand.level}`, symbol:state.symbol, qty, price, valueUsd, reason:`Martingale controlado: ${nextHand.label}` });
      return next;
    }

    const grossUsd = ((price - p.avgPrice) * p.qty);
    const target = Math.max(0.25, Number(p.investedUsd || 0) * 0.005);
    if (grossUsd >= target && price >= Number(p.recoveryTarget || p.avgPrice * 1.005)) {
      const fee = grossUsd * 0.10;
      next.realizedProfitUsd += grossUsd;
      next.feesEnv += fee;
      if (next.accountMode === 'live') next.envBalance = Math.max(0, next.envBalance - fee);
      const valueUsd = p.qty * price;
      next.balanceUsd += valueUsd;
      next.orders.unshift({ id: crypto.randomUUID(), at: now, side:'SELL_RECOVERY', symbol:state.symbol, qty:p.qty, price, valueUsd, profitUsd:grossUsd, feeEnv:fee, reason:'Saída da cesta com +0,5% sobre preço médio' });
      next.positions = [];
      if (next.accountMode === 'live' && next.envBalance <= 0) next.active = false;
    }
  }
  return next;
}
