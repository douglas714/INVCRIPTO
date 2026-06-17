import { analyzeMarket, marketStructure } from './strategy.js';

export function initialPaperState(balanceUsd=1000) {
  return {
    balanceUsd,
    envBalance: 10,
    positions: [],
    orders: [],
    targetOrders: [],
    decisions: [],
    realizedProfitUsd: 0,
    realizedRealProfitUsd: 0,
    feesEnv: 0,
    realFeesEnv: 0,
    active: false,
    symbol: 'BTCUSDT',
    mode: 'paper',
    accountMode: 'demo',
    profileName: 'conservador',
    binanceUsdtBalance: 0,
    apiConnected: false
  };
}

function normalizeState(state){
  const n = { ...state };
  if (n.balanceUsd == null) n.balanceUsd = Number(n.balanceBrl || 1000);
  if (n.realizedProfitUsd == null) n.realizedProfitUsd = Number(n.realizedProfitBrl || 0);
  if (n.realizedRealProfitUsd == null) n.realizedRealProfitUsd = Number(n.realizedRealProfitBrl || 0);
  if (n.envBalance == null) n.envBalance = Number(n.invBalance || 10);
  if (n.feesEnv == null) n.feesEnv = Number(n.feesInv || 0);
  if (n.realFeesEnv == null) n.realFeesEnv = Number(n.realFeesInv || 0);
  if (n.binanceUsdtBalance == null) n.binanceUsdtBalance = 0;
  if (!n.accountMode) n.accountMode = 'demo';
  if (!Array.isArray(n.targetOrders)) n.targetOrders = [];
  return n;
}

export function createTargetPreviewOrder(state, symbol, analysis, timeframe = '15m') {
  const next = structuredClone(normalizeState(state));
  const plan = analysis?.orderPlan;
  if (!plan || plan.side !== 'BUY') return next;

  const valueUsd = next.balanceUsd >= 10 ? 10 : 0;
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
  const closedCandles = candles.length > 1 ? candles.slice(0, -1) : candles;
  const analysis = analyzeMarket(closedCandles);
  const next = structuredClone(normalizeState(state));
  const price = Number(candles.at(-1)?.close || analysis.price || 0);
  const now = new Date().toISOString();
  next.decisions.unshift({ at: now, symbol: state.symbol, ...analysis });
  next.decisions = next.decisions.slice(0, 50);
  if (!next.active || (next.accountMode === 'live' && next.envBalance <= 0) || price <= 0) return next;

  if (analysis.action === 'BUY' && analysis.score >= 78 && next.positions.length === 0 && price <= Number(analysis.maxEntryPrice || Infinity)) {
    const plan = analysis.orderPlan;
    const valueUsd = next.balanceUsd >= 10 ? 10 : 0;
    if (valueUsd < 10) return next;
    const entryPrice = plan?.entry || price;
    const qty = valueUsd / entryPrice;
    const profileGaps = { conservador:1, moderado:0.5, arrojado:0.3, alavancagem:0.15 };
    const profileName = profileGaps[next.profileName] ? next.profileName : 'conservador';
    const basketBudget = profileName === 'alavancagem' ? next.balanceUsd / 5 : next.balanceUsd;
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
      lastHandUsd: valueUsd,
      lastBuyPrice: entryPrice,
      profileName,
      protectionGapPct: profileGaps[profileName],
      normalBudgetUsd: basketBudget * 0.80,
      emergencyBudgetUsd: basketBudget * 0.20,
      normalUsedUsd: valueUsd,
      emergencyUsedUsd: 0,
      recoveryTarget: entryPrice * 1.008,
      martingalePlan: []
    });
    next.orders.unshift({ id: crypto.randomUUID(), at: now, side:'BUY_M1', symbol:state.symbol, qty, price:entryPrice, valueUsd, reason: analysis.reason });
  } else if (next.positions.length > 0) {
    const p = next.positions[0];
    const normalRemaining = Math.max(0, Number(p.normalBudgetUsd || 0) - Number(p.normalUsedUsd || 0));
    const emergencyRemaining = Math.max(0, Number(p.emergencyBudgetUsd || 0) - Number(p.emergencyUsedUsd || 0));
    const desiredHand = Math.max(10, Number(p.lastHandUsd || 10) * 1.35);
    const useNormal = normalRemaining >= 10;
    const useEmergency = !useNormal && emergencyRemaining >= 10;
    const gapMultiplier = useEmergency ? 3 : 1;
    const trigger = Number(p.lastBuyPrice || p.avgPrice) * (1 - (Number(p.protectionGapPct || 1) / 100) * gapMultiplier);
    const structure = marketStructure(closedCandles, { lookback: useEmergency ? 260 : 180, currentPrice: price });
    const supportCandidate = (structure.supports || []).find(level => Number(level.level || 0) <= trigger / 1.0008);
    const fallbackSupport = closedCandles
      .slice(-(useEmergency ? 180 : 90))
      .map(candle => Number(candle.low || 0))
      .filter(level => level > 0 && level <= trigger / 1.0008)
      .sort((a,b)=>b-a)[0];
    const supportPrice = Number(supportCandidate?.level || fallbackSupport || 0);
    const protectionPrice = supportPrice > 0 ? Math.min(trigger, supportPrice * 1.0008) : 0;
    p.nextProtectionPrice = protectionPrice || null;
    p.nextProtectionSupport = supportPrice || null;

    if ((useNormal || useEmergency) && protectionPrice > 0 && price <= protectionPrice && next.balanceUsd >= 10) {
      const remaining = useNormal ? normalRemaining : emergencyRemaining;
      const valueUsd = Math.min(next.balanceUsd, remaining, desiredHand);
      if (valueUsd < 10) return next;
      const qty = valueUsd / price;
      const investedUsd = Number(p.investedUsd || 0) + valueUsd;
      const totalQty = Number(p.qty || 0) + qty;
      p.qty = totalQty;
      p.investedUsd = investedUsd;
      p.avgPrice = investedUsd / totalQty;
      p.ladderLevel = Number(p.ladderLevel || 1) + 1;
      p.lastHandUsd = valueUsd;
      p.lastBuyPrice = price;
      if (useNormal) p.normalUsedUsd = Number(p.normalUsedUsd || 0) + valueUsd;
      else p.emergencyUsedUsd = Number(p.emergencyUsedUsd || 0) + valueUsd;
      p.recoveryTarget = p.avgPrice * 1.008;
      next.balanceUsd -= valueUsd;
      next.orders.unshift({ id: crypto.randomUUID(), at: now, side:`BUY_M${p.ladderLevel}`, symbol:state.symbol, qty, price, valueUsd, reason:`Proteção ${useNormal ? 'normal' : 'extraordinária'} executada no suporte ${supportPrice.toFixed(6)}` });
      return next;
    }

    const saleValue = price * p.qty;
    const estimatedBinanceCosts = Number(p.investedUsd || 0) * 0.001 + saleValue * 0.0015;
    const netProfitUsd = saleValue - Number(p.investedUsd || 0) - estimatedBinanceCosts;
    const target = Number(p.investedUsd || 0) * 0.005;
    if (netProfitUsd >= target && price >= Number(p.recoveryTarget || p.avgPrice * 1.008)) {
      const fee = netProfitUsd * 0.10;
      next.realizedProfitUsd += netProfitUsd;
      next.feesEnv += fee;
      if (next.accountMode === 'live') next.envBalance = Math.max(0, next.envBalance - fee);
      const valueUsd = p.qty * price;
      next.balanceUsd += valueUsd;
      next.orders.unshift({ id: crypto.randomUUID(), at: now, side:'SELL_RECOVERY', symbol:state.symbol, qty:p.qty, price, valueUsd, profitUsd:netProfitUsd, feeEnv:fee, reason:'Saída da cesta com +0,5% líquido estimado' });
      next.positions = [];
      if (next.accountMode === 'live' && next.envBalance <= 0) next.active = false;
    }
  }
  return next;
}
