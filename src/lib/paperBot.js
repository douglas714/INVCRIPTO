import { analyzeMarket, analyzeProtection } from './strategy.js';
import { DEFAULT_PROFILE_ID, getRiskProfile } from './riskProfiles.js';

const DEFAULT_USDT_BRL = 5.2;

function uid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeState(state = {}) {
  const balanceBrl = Number(state.balanceBrl || 1000);
  const balanceUsdt = Number(state.balanceUsdt || balanceBrl / DEFAULT_USDT_BRL);
  return {
    balanceBrl,
    balanceUsdt,
    availableUsdt: Number(state.availableUsdt ?? balanceUsdt),
    invBalance: Number(state.invBalance ?? 10),
    positions: Array.isArray(state.positions) ? state.positions : [],
    orders: Array.isArray(state.orders) ? state.orders : [],
    decisions: Array.isArray(state.decisions) ? state.decisions : [],
    realizedProfitBrl: Number(state.realizedProfitBrl || 0),
    realizedProfitUsdt: Number(state.realizedProfitUsdt || 0),
    feesInv: Number(state.feesInv || 0),
    active: Boolean(state.active),
    symbol: state.symbol || 'BTCUSDT',
    mode: state.mode || 'paper',
    riskProfile: state.riskProfile || DEFAULT_PROFILE_ID,
    dailyStartEquityUsdt: Number(state.dailyStartEquityUsdt || balanceUsdt),
    dailyRealizedProfitUsdt: Number(state.dailyRealizedProfitUsdt || 0),
    lastLossAt: state.lastLossAt || null,
    stoppedReason: state.stoppedReason || ''
  };
}

export function initialPaperState(balanceBrl = 1000, riskProfile = DEFAULT_PROFILE_ID) {
  const balanceUsdt = balanceBrl / DEFAULT_USDT_BRL;
  return normalizeState({ balanceBrl, balanceUsdt, availableUsdt: balanceUsdt, invBalance: 10, active: false, symbol: 'BTCUSDT', mode: 'paper', riskProfile });
}

function getBasket(state, symbol) {
  return state.positions.find(p => p.symbol === symbol && p.status !== 'closed');
}

function sumOpenExposure(state) {
  return state.positions.reduce((sum, p) => p.status === 'closed' ? sum : sum + Number(p.investedUsdt || 0), 0);
}

function calculateBasket(entries = []) {
  const totalQty = entries.reduce((s, e) => s + Number(e.qty || 0), 0);
  const investedUsdt = entries.reduce((s, e) => s + Number(e.valueUsdt || 0), 0);
  const avgPrice = totalQty > 0 ? investedUsdt / totalQty : 0;
  return { totalQty, investedUsdt, avgPrice };
}

function estimateExit(basket, price, usdtBrl, profile) {
  const grossUsdt = ((price - basket.avgPrice) * basket.qty);
  const tradeFeePct = 0.002; // spot ida/volta estimado 0,10% + 0,10%
  const tradeFeesUsdt = (basket.investedUsdt + basket.qty * price) * tradeFeePct / 2;
  const slippageUsdt = basket.investedUsdt * 0.0005;
  const netBeforeInvUsdt = grossUsdt - tradeFeesUsdt - slippageUsdt;
  const feeInvUsdt = Math.max(0, netBeforeInvUsdt * profile.invFeePct);
  const netAfterInvUsdt = netBeforeInvUsdt - feeInvUsdt;
  return {
    grossUsdt,
    tradeFeesUsdt,
    slippageUsdt,
    feeInvUsdt,
    netBeforeInvUsdt,
    netAfterInvUsdt,
    netAfterInvBrl: netAfterInvUsdt * usdtBrl
  };
}

function canOperateAfterCooldown(state, profile, nowMs) {
  if (!state.lastLossAt) return true;
  const lastLossMs = new Date(state.lastLossAt).getTime();
  if (!Number.isFinite(lastLossMs)) return true;
  return (nowMs - lastLossMs) / 60000 >= profile.cooldownAfterLossMinutes;
}

function applyDailyStops(next, profile) {
  const dailyPct = next.dailyStartEquityUsdt > 0 ? next.dailyRealizedProfitUsdt / next.dailyStartEquityUsdt : 0;
  if (dailyPct <= -profile.dailyStopLossPct) {
    next.active = false;
    next.stoppedReason = `Stop loss diario atingido (${(dailyPct * 100).toFixed(2)}%)`;
  }
  if (dailyPct >= profile.dailyStopWinPct) {
    next.active = false;
    next.stoppedReason = `Stop win diario atingido (${(dailyPct * 100).toFixed(2)}%)`;
  }
}

function pushDecision(next, decision) {
  next.decisions.unshift(decision);
  next.decisions = next.decisions.slice(0, 80);
}

export function runPaperDecision(rawState, candles, usdtBrl = DEFAULT_USDT_BRL) {
  const state = normalizeState(rawState);
  const profile = getRiskProfile(state.riskProfile);
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const symbol = state.symbol || 'BTCUSDT';
  const next = structuredClone(state);
  const basket = getBasket(next, symbol);
  const analysis = basket
    ? analyzeProtection({ candles, basket, profileId: state.riskProfile })
    : analyzeMarket(candles, { profileId: state.riskProfile });
  const price = analysis.price || candles.at(-1)?.close || 0;

  pushDecision(next, { at: now, symbol, profile: profile.label, leverage: profile.leverage, ...analysis });

  if (!state.active) return next;
  if (state.invBalance <= 0) {
    next.active = false;
    next.stoppedReason = 'Saldo INV zerado';
    return next;
  }

  applyDailyStops(next, profile);
  if (!next.active) return next;

  if (!canOperateAfterCooldown(state, profile, nowMs)) {
    pushDecision(next, { at: now, symbol, action: 'WAIT', score: 0, reason: 'Cooldown apos loss ativo', regime: analysis.regime, state: 'COOLDOWN', price });
    return next;
  }

  const openBaskets = next.positions.filter(p => p.status !== 'closed').length;
  const maxExposureUsdt = next.balanceUsdt * profile.maxBasketExposurePct;
  const openExposureUsdt = sumOpenExposure(next);
  const requiredReserveUsdt = next.balanceUsdt * profile.requiredReservePct;
  const availableForNewBasket = Math.max(0, next.balanceUsdt - requiredReserveUsdt - openExposureUsdt);

  if (!basket && analysis.action === 'BUY' && analysis.score >= profile.minEntryScore && openBaskets < profile.maxOpenBaskets) {
    const desiredValueUsdt = next.balanceUsdt * profile.initialEntryPct;
    const valueUsdt = Math.min(desiredValueUsdt, maxExposureUsdt, availableForNewBasket, next.availableUsdt);
    if (valueUsdt >= 5 && price > 0) {
      const qty = valueUsdt / price;
      const newBasket = {
        id: uid(),
        symbol,
        status: 'open',
        profileId: state.riskProfile,
        profileLabel: profile.label,
        entries: [{ id: uid(), type: 'ENTRY', qty, price, valueUsdt, score: analysis.score, reason: analysis.reason, at: now }],
        qty,
        avgPrice: price,
        investedUsdt: valueUsdt,
        realizedProtectionProfitUsdt: 0,
        protectionCount: 0,
        openedAt: now,
        lastActionAt: now
      };
      next.positions.push(newBasket);
      next.availableUsdt -= valueUsdt;
      next.orders.unshift({ id: uid(), at: now, side: 'BUY', symbol, qty, price, valueUsdt, valueBrl: valueUsdt * usdtBrl, profile: profile.label, basketId: newBasket.id, reason: analysis.reason });
      pushDecision(next, { at: now, symbol, action: 'BUY', score: analysis.score, reason: `Entrada inicial ${profile.label}: ${(profile.initialEntryPct * 100).toFixed(0)}% da banca`, regime: analysis.regime, state: 'IN_POSITION', price });
    } else {
      pushDecision(next, { at: now, symbol, action: 'WAIT', score: 0, reason: 'Entrada bloqueada: saldo/reserva insuficiente para nova cesta', regime: analysis.regime, state: 'SCANNING', price });
    }
  }

  const currentBasket = getBasket(next, symbol);
  if (!currentBasket || price <= 0) return next;

  const exit = estimateExit(currentBasket, price, usdtBrl, profile);
  const basketTargetUsdt = Math.max(0.05, currentBasket.investedUsdt * profile.basketTakeProfitPct);
  const microTargetUsdt = Math.max(0.05, currentBasket.investedUsdt * profile.microTakeProfitPct);
  const targetUsdt = currentBasket.protectionCount > 0 ? basketTargetUsdt : microTargetUsdt;

  if (exit.netAfterInvUsdt >= targetUsdt) {
    next.availableUsdt += currentBasket.qty * price;
    next.realizedProfitUsdt += exit.netBeforeInvUsdt;
    next.realizedProfitBrl += exit.netBeforeInvUsdt * usdtBrl;
    next.dailyRealizedProfitUsdt += exit.netBeforeInvUsdt;
    const feeInv = exit.feeInvUsdt * usdtBrl;
    next.feesInv += feeInv;
    next.invBalance = Math.max(0, next.invBalance - feeInv);
    next.orders.unshift({ id: uid(), at: now, side: 'SELL', symbol, qty: currentBasket.qty, price, valueUsdt: currentBasket.qty * price, valueBrl: currentBasket.qty * price * usdtBrl, profitBrl: exit.netBeforeInvUsdt * usdtBrl, profitUsdt: exit.netBeforeInvUsdt, feeInv, profile: profile.label, basketId: currentBasket.id, reason: 'Fechamento da cesta com lucro liquido' });
    currentBasket.status = 'closed';
    currentBasket.closedAt = now;
    currentBasket.closeReason = 'TAKE_PROFIT_BASKET';
    currentBasket.exitPrice = price;
    currentBasket.netProfitUsdt = exit.netBeforeInvUsdt;
    next.positions = next.positions.filter(p => p.status !== 'closed');
    pushDecision(next, { at: now, symbol, action: 'SELL', score: 100, reason: `Cesta fechada positiva: ${exit.netAfterInvBrl.toFixed(2)} BRL liquido apos INV`, regime: analysis.regime, state: 'TAKE_PROFIT_READY', price });
    if (next.invBalance <= 0) {
      next.active = false;
      next.stoppedReason = 'Saldo INV zerado apos taxa de lucro';
    }
    applyDailyStops(next, profile);
    return next;
  }

  const protectionLimit = profile.maxProtections;
  const basketExposureLimit = next.balanceUsdt * profile.maxBasketExposurePct;
  const canAddProtection = currentBasket.protectionCount < protectionLimit && currentBasket.investedUsdt < basketExposureLimit;
  const drawdownFromAvg = currentBasket.avgPrice > 0 ? (currentBasket.avgPrice - price) / currentBasket.avgPrice : 0;
  const tooFarFromAvg = drawdownFromAvg >= profile.maxDistanceFromAvgPct;

  if (canAddProtection && !tooFarFromAvg && analysis.action === 'PROTECT' && analysis.score >= profile.minProtectionScore) {
    const levelPct = profile.protectionLevels[Math.min(currentBasket.protectionCount, profile.protectionLevels.length - 1)] || 0.10;
    const desiredValueUsdt = next.balanceUsdt * levelPct;
    const remainingBasketCapacity = Math.max(0, basketExposureLimit - currentBasket.investedUsdt);
    const valueUsdt = Math.min(desiredValueUsdt, remainingBasketCapacity, next.availableUsdt - requiredReserveUsdt * 0.25);
    if (valueUsdt >= 5) {
      const qty = valueUsdt / price;
      currentBasket.entries.push({ id: uid(), type: 'PROTECTION', qty, price, valueUsdt, score: analysis.score, reason: analysis.reason, at: now });
      const calc = calculateBasket(currentBasket.entries);
      currentBasket.qty = calc.totalQty;
      currentBasket.investedUsdt = calc.investedUsdt;
      currentBasket.avgPrice = calc.avgPrice;
      currentBasket.protectionCount += 1;
      currentBasket.lastActionAt = now;
      next.availableUsdt -= valueUsdt;
      next.orders.unshift({ id: uid(), at: now, side: 'BUY', symbol, qty, price, valueUsdt, valueBrl: valueUsdt * usdtBrl, profile: profile.label, basketId: currentBasket.id, reason: analysis.reason });
      pushDecision(next, { at: now, symbol, action: 'PROTECT', score: analysis.score, reason: `Protecao ${currentBasket.protectionCount}/${profile.maxProtections} aberta. Novo preco medio: ${currentBasket.avgPrice.toFixed(2)}`, regime: analysis.regime, state: 'BASKET_RECOVERY', price });
    } else {
      pushDecision(next, { at: now, symbol, action: 'WAIT', score: analysis.score, reason: 'Protecao bloqueada: reserva de seguranca preservada', regime: analysis.regime, state: 'PROTECTION_WAITING', price });
    }
  } else if (tooFarFromAvg) {
    pushDecision(next, { at: now, symbol, action: 'WAIT', score: 0, reason: 'Modo defesa: queda excedeu limite da cesta, nao abrir nova protecao', regime: analysis.regime, state: 'DEFENSE_MODE', price });
  }

  return next;
}
