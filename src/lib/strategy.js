export function ema(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev = values[0];
  for (const value of values) {
    prev = value * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function sma(values, period) {
  return values.map((_, index) => {
    const slice = values.slice(Math.max(0, index - period + 1), index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

export function rsi(values, period = 14) {
  if (values.length < period + 1) return [];
  const out = Array(values.length).fill(50);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    gain += Math.max(0, change);
    loss += Math.max(0, -change);
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - (100 / (1 + gain / loss));
  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    gain = ((gain * (period - 1)) + Math.max(0, change)) / period;
    loss = ((loss * (period - 1)) + Math.max(0, -change)) / period;
    out[i] = loss === 0 ? 100 : 100 - (100 / (1 + gain / loss));
  }
  return out;
}

export function atr(candles, period = 14) {
  if (candles.length < 2) return [];
  const trs = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const prevClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - prevClose),
      Math.abs(candle.low - prevClose)
    );
  });
  return ema(trs, period);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function candleShape(candle) {
  const range = Math.max(1e-9, Number(candle.high) - Number(candle.low));
  const body = Math.abs(Number(candle.close) - Number(candle.open));
  const lowerWick = Math.max(0, Math.min(Number(candle.open), Number(candle.close)) - Number(candle.low));
  const upperWick = Math.max(0, Number(candle.high) - Math.max(Number(candle.open), Number(candle.close)));
  return {
    range,
    body,
    bodyRatio: body / range,
    lowerWick,
    lowerWickRatio: lowerWick / range,
    upperWick,
    upperWickRatio: upperWick / range,
    closePosition: (Number(candle.close) - Number(candle.low)) / range,
    bullish: Number(candle.close) > Number(candle.open),
    bearish: Number(candle.close) < Number(candle.open)
  };
}

function clusterLevels(candidates, tolerance) {
  const sorted = [...candidates].sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const candidate of sorted) {
    let cluster = clusters.find(item => Math.abs(item.level - candidate.price) <= tolerance);
    if (!cluster) {
      cluster = { level: candidate.price, weight: 0, touches: 0, lastIndex: candidate.index, prices: [] };
      clusters.push(cluster);
    }
    const weight = Math.max(0.5, Number(candidate.weight || 1));
    cluster.prices.push(candidate.price);
    cluster.weight += weight;
    cluster.touches += 1;
    cluster.lastIndex = Math.max(cluster.lastIndex, candidate.index);
    cluster.level = cluster.prices.reduce((sum, value) => sum + value, 0) / cluster.prices.length;
  }
  return clusters;
}

function rejectionWeight(candle, side) {
  const shape = candleShape(candle);
  return side === 'support'
    ? 1 + shape.lowerWickRatio * 2 + shape.closePosition
    : 1 + shape.upperWickRatio * 2 + (1 - shape.closePosition);
}

/**
 * Suporte e resistencia por pivôs/zonas. A mesma saida alimenta o gráfico e a
 * estratégia para não existir uma linha visual diferente do nível operado.
 */
export function marketStructure(candles, options = {}) {
  const lookback = Math.max(48, Number(options.lookback || 160));
  const rows = (candles || []).slice(-lookback).map(row => ({
    ...row,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume || 0)
  })).filter(row => row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0);
  if (rows.length < 8) return { support: 0, resistance: 0, supports: [], resistances: [], atr: 0, atrPct: 0 };

  const currentPrice = Math.max(0, Number(options.currentPrice || rows.at(-1)?.close || 0));
  const atrSeries = atr(rows, 14);
  const atrValue = atrSeries.at(-1) || currentPrice * 0.002;
  const tolerance = Math.max(currentPrice * 0.0012, atrValue * 0.38);
  const pivotWindow = 2;
  const lows = [];
  const highs = [];
  const volumes = rows.map(row => row.volume);
  const volumeAvg = sma(volumes, 20);

  for (let index = pivotWindow; index < rows.length - pivotWindow; index += 1) {
    const row = rows[index];
    const neighbors = rows.slice(index - pivotWindow, index + pivotWindow + 1);
    const pivotLow = neighbors.every(item => row.low <= item.low + tolerance * 0.08);
    const pivotHigh = neighbors.every(item => row.high >= item.high - tolerance * 0.08);
    const recency = 1 + (index / rows.length) * 1.4;
    const volumeWeight = volumeAvg[index] > 0 ? clamp(row.volume / volumeAvg[index], 0.7, 2.2) : 1;
    if (pivotLow) lows.push({ price: row.low, index, weight: recency * volumeWeight * rejectionWeight(row, 'support') });
    if (pivotHigh) highs.push({ price: row.high, index, weight: recency * volumeWeight * rejectionWeight(row, 'resistance') });
  }

  // Uma vela esticada com reação cria suporte recente depois de confirmada por
  // pelo menos um candle posterior. Isso mantém visível o fundo que acabou de
  // ser defendido, em vez de continuar usando somente mínimos antigos.
  for (let index = Math.max(1, rows.length - 12); index < rows.length - 1; index += 1) {
    const row = rows[index];
    const next = rows[index + 1];
    const shape = candleShape(row);
    const stretched = shape.range >= atrValue * 1.10;
    const reacted = next.close > row.low + shape.range * 0.28;
    if ((shape.lowerWickRatio >= 0.22 || stretched) && reacted) {
      lows.push({ price: row.low, index, weight: 3.2 + shape.lowerWickRatio * 3 });
    }
  }

  const supports = clusterLevels(lows, tolerance)
    .filter(item => item.level <= currentPrice * 1.0025)
    .sort((a, b) => b.level - a.level);
  const resistances = clusterLevels(highs, tolerance)
    .filter(item => item.level >= currentPrice * 0.9975)
    .sort((a, b) => a.level - b.level);
  const fallback = rows.slice(-48);
  const fallbackSupport = Math.min(...fallback.map(row => row.low));
  const fallbackResistance = Math.max(...fallback.map(row => row.high));
  const support = supports[0]?.level || fallbackSupport;
  const resistance = resistances[0]?.level || fallbackResistance;
  return {
    support,
    resistance,
    supports,
    resistances,
    atr: atrValue,
    atrPct: currentPrice > 0 ? (atrValue / currentPrice) * 100 : 0,
    tolerance
  };
}

export function supportResistance(candles, lookback = 160) {
  const rows = candles || [];
  const currentPrice = Number(rows.at(-1)?.close || 0);
  const structure = marketStructure(rows, { lookback, currentPrice });
  return { support: structure.support, resistance: structure.resistance };
}

function orderPlan({ action, price, support, resistance, atrValue, score, setup, maxEntryPrice, maxEntryDistancePct }) {
  if (action !== 'BUY' || !price || !support || !resistance) return null;
  const volatility = Math.max(price * 0.0025, atrValue || price * 0.004);
  const entry = price;
  const stopLoss = Math.max(0, support - volatility * 0.55);
  const minimumGrossTarget = entry * 1.008;
  const target1 = Math.min(resistance * 0.998, Math.max(minimumGrossTarget, entry + volatility * 0.70));
  const target2 = Math.max(target1, resistance * 0.997);
  const previewGap = 0.01;
  const ladder = Array.from({ length: 5 }, (_, index) => ({
    level: index + 1,
    label: `Proteção ${index}`,
    multiplier: Number((1.35 ** index).toFixed(4)),
    entry: Math.max(0, entry * ((1 - previewGap) ** index))
  }));
  ladder[0].label = 'Entrada inicial';
  const weightedCost = ladder.reduce((sum, item) => sum + item.entry * item.multiplier, 0);
  const totalWeight = ladder.reduce((sum, item) => sum + item.multiplier, 0);
  const fullBasketAvg = weightedCost / totalWeight;
  const recoveryTarget = entry * 1.008;
  const risk = Math.max(0.00000001, entry - stopLoss);
  const reward = Math.max(0, target1 - entry);
  return {
    side: 'BUY',
    type: 'SUPPORT_CAPPED_ENTRY',
    setup,
    confidence: score,
    entry,
    maxEntryPrice,
    maxEntryDistancePct,
    supportZoneLow: support,
    supportZoneHigh: maxEntryPrice,
    stopLoss,
    target1,
    target2,
    recoveryTarget,
    fullBasketAvg,
    ladder,
    martingale: {
      enabled: true,
      maxHands: null,
      profitTargetPct: 0.5,
      multipliers: ladder.map(item => item.multiplier)
    },
    risk,
    reward,
    riskReward: reward / risk,
    note: 'Entrada limitada à zona de suporte. A execução real usa preço máximo, orçamento 80/20, suporte estrutural e filtros da Binance.'
  };
}

export function analyzeMarket(candles) {
  if (!candles || candles.length < 80) {
    return { action: 'WAIT', score: 0, reason: 'Aguardando candles suficientes' };
  }

  const rows = candles.map(candle => ({
    ...candle,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: Number(candle.volume || 0)
  }));
  const closes = rows.map(candle => candle.close);
  const volumes = rows.map(candle => candle.volume);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(rows, 14);
  const volSma20 = sma(volumes, 20);
  const last = rows.at(-1);
  const i = rows.length - 1;
  const structure = marketStructure(rows, { lookback: 160, currentPrice: last.close });
  const support = structure.support;
  const majorStructure = marketStructure(rows, { lookback: 260, currentPrice: last.close });
  const preliminaryResistance = Math.max(structure.resistance || 0, majorStructure.resistance || structure.resistance || 0);
  const breakoutStructure = marketStructure(rows.slice(0, -2), {
    lookback: 160,
    currentPrice: Number(rows.at(-3)?.close || last.close)
  });
  const breakoutResistance = Number(breakoutStructure.resistance || preliminaryResistance);
  const atrValue = atr14[i] || structure.atr || Math.max(1e-9, last.close * 0.003);
  const atrPct = (atrValue / Math.max(1e-9, last.close)) * 100;
  const touchTolerancePct = clamp(atrPct * 0.55, 0.12, 0.45);
  const maxEntryDistancePct = clamp(atrPct * 2.2, 0.38, 0.95);
  const maxEntryPrice = support * (1 + maxEntryDistancePct / 100);
  const requiredRoomPct = clamp(0.78 + atrPct * 0.40, 0.90, 1.60);
  const resistance = pickTrendAlignedResistance(
    [...(structure.resistances || []), ...(majorStructure.resistances || [])],
    last.close,
    requiredRoomPct,
    preliminaryResistance
  );
  const majorResistance = Math.max(resistance, preliminaryResistance);

  const shortTrend = ema9[i] > ema21[i];
  const longTrend = ema21[i] > ema50[i] && last.close > ema50[i];
  const macroTrend = ema200[i] ? last.close > ema200[i] : longTrend;
  const ema50Rising = ema50[i] >= ema50[Math.max(0, i - 5)] * 0.999;
  const ema200Stable = ema200[i] >= ema200[Math.max(0, i - 8)] * 0.998;
  const macroStructureHealthy = macroTrend || (ema50[i] >= ema200[i] * 0.995 && ema50Rising && ema200Stable);
  const trendUp = shortTrend && longTrend && macroStructureHealthy;
  const severeTrendDown = ema9[i] < ema21[i] && ema21[i] < ema50[i] && ema50[i] < ema200[i] && !ema50Rising;
  const trendDown = ema9[i] < ema21[i] && ema21[i] < ema50[i] && last.close < ema50[i];

  const volumeOk = volumes[i] >= (volSma20[i] || volumes[i]) * 0.82;
  const momentumOk = rsi14[i] >= 40 && rsi14[i] <= 68;
  const rsiRecovering = rsi14[i] > rsi14[i - 1] && rsi14[i - 1] < 58;
  const distanceFromSupportPct = support > 0 ? ((last.close / support) - 1) * 100 : 999;
  const distanceToResistancePct = resistance > last.close ? ((resistance / last.close) - 1) * 100 : 0;
  const distanceToMajorResistancePct = majorResistance > last.close ? ((majorResistance / last.close) - 1) * 100 : 0;
  const nearSupport = last.close >= support * 0.997 && last.close <= maxEntryPrice;

  // Oportunidade de suporte permanece válida por até seis candles fechados.
  // Isso captura a vela esticada e a primeira recuperação, mas impede perseguir
  // o preço depois que ele já se afastou da região de compra.
  const opportunityWindow = rows.slice(-6);
  let touchIndex = -1;
  for (let index = opportunityWindow.length - 1; index >= 0; index -= 1) {
    if (opportunityWindow[index].low <= support * (1 + touchTolerancePct / 100)) {
      touchIndex = index;
      break;
    }
  }
  const touchCandle = touchIndex >= 0 ? opportunityWindow[touchIndex] : null;
  const touchShape = touchCandle ? candleShape(touchCandle) : null;
  const afterTouch = touchIndex >= 0 ? opportunityWindow.slice(touchIndex) : [];
  const bullishAfterTouch = afterTouch.some(candle => candle.close > candle.open);
  const recoveryConfirmed = Boolean(
    touchCandle &&
    bullishAfterTouch &&
    last.close >= touchCandle.low + touchShape.range * 0.28
  );
  const stretchedSupportSweep = Boolean(touchCandle && (
    touchShape.range >= atrValue * 1.10 ||
    touchShape.lowerWickRatio >= 0.22
  ));
  const supportSignal = Boolean(touchCandle && recoveryConfirmed);
  const barsSinceSupportTouch = touchIndex >= 0 ? opportunityWindow.length - 1 - touchIndex : null;

  const supportBounceBuy = macroStructureHealthy
    && !severeTrendDown
    && nearSupport
    && supportSignal
    && (volumeOk || rsiRecovering || stretchedSupportSweep);

  // Pullback só é aceito quando também acontece dentro da zona do suporte.
  // A EMA confirma a tendência, mas não autoriza compra no topo da faixa.
  const pullbackBuy = trendUp
    && nearSupport
    && last.low <= ema21[i]
    && last.close > ema9[i]
    && momentumOk;

  const breakoutRetestBuy = macroStructureHealthy
    && breakoutResistance > 0
    && rows.at(-2)?.close > breakoutResistance * 1.001
    && last.low <= breakoutResistance * 1.0025
    && last.close > breakoutResistance
    && candleShape(last).bullish
    && volumeOk
    && distanceToMajorResistancePct >= requiredRoomPct;

  const rejectionSell = last.high > resistance * 0.998
    && last.close < resistance
    && candleShape(last).upperWickRatio > 0.42;
  const defensiveSell = severeTrendDown || (trendDown && !nearSupport) || rejectionSell || rsi14[i] > 76;

  const setup = supportBounceBuy
    ? 'SUPPORT_BOUNCE'
    : pullbackBuy
      ? 'TREND_PULLBACK_SUPPORT'
      : breakoutRetestBuy
        ? 'BREAKOUT_RETEST'
        : '';
  const roomPct = setup === 'BREAKOUT_RETEST' ? distanceToMajorResistancePct : distanceToResistancePct;
  const blockedByResistance = Boolean(setup && roomPct < requiredRoomPct);
  const blockedBySupportDistance = Boolean(setup && setup !== 'BREAKOUT_RETEST' && !nearSupport);

  let score = 0;
  let action = 'WAIT';
  let reason = blockedByResistance
    ? 'Entrada bloqueada: resistência próxima'
    : distanceFromSupportPct > maxEntryDistancePct
      ? 'Aguardando retorno à zona de suporte'
      : 'Sem setup';

  if (setup && !blockedByResistance && !blockedBySupportDistance) {
    score = 56;
    if (macroStructureHealthy) score += 9;
    if (trendUp) score += 8;
    if (volumeOk) score += 7;
    if (momentumOk || rsiRecovering) score += 7;
    if (nearSupport) score += 10;
    if (supportBounceBuy) score += 12;
    if (stretchedSupportSweep) score += 5;
    if (barsSinceSupportTouch !== null && barsSinceSupportTouch <= 2) score += 4;
    if (breakoutRetestBuy) score += 8;
    if (roomPct >= requiredRoomPct * 1.6) score += 4;
    score = Math.min(96, score);
    action = 'BUY';
    reason = supportBounceBuy
      ? stretchedSupportSweep
        ? 'Queda esticada tocou o suporte e confirmou recuperação'
        : 'Reação compradora confirmada na zona de suporte'
      : breakoutRetestBuy
        ? 'Rompimento confirmado com reteste'
        : 'Tendência favorável com pullback dentro da zona de suporte';
  }

  if (defensiveSell && action !== 'BUY') {
    score = Math.max(64, rsi14[i] > 76 ? 70 : 68);
    action = 'SELL';
    reason = rsi14[i] > 76
      ? 'RSI esticado: proteger lucro'
      : rejectionSell
        ? 'Rejeição em resistência'
        : severeTrendDown
          ? 'Estrutura forte de baixa: novas compras bloqueadas'
          : 'Tendência defensiva';
  }

  const regime = trendUp ? 'TENDÊNCIA DE ALTA' : severeTrendDown ? 'TENDÊNCIA DE BAIXA' : 'LATERAL/NEUTRO';
  const plan = orderPlan({
    action,
    price: last.close,
    support,
    resistance,
    atrValue,
    score,
    setup,
    maxEntryPrice,
    maxEntryDistancePct
  });

  return {
    action,
    score,
    reason,
    setup,
    regime,
    support,
    resistance,
    majorResistance,
    supportStrength: structure.supports[0]?.weight || 0,
    resistanceStrength: structure.resistances[0]?.weight || 0,
    ema9: ema9[i],
    ema21: ema21[i],
    ema50: ema50[i],
    ema200: ema200[i],
    rsi14: rsi14[i],
    atr14: atrValue,
    atrPct,
    volumeOk,
    nearSupport,
    supportSignal,
    stretchedSupportSweep,
    barsSinceSupportTouch,
    distanceFromSupportPct,
    maxEntryDistancePct,
    maxEntryPrice,
    distanceToResistancePct,
    requiredRoomPct,
    blockedByResistance,
    blockedBySupportDistance,
    price: last.close,
    orderPlan: plan
  };
}

// ---------------------------------------------------------------------------
// INVCRIPTO MTF-R V1.5
// Confirmação multitemporal para conta real. H4/H1 definem regime, M15 cria
// a zona operacional, M5 confirma a reação e M1 somente refina a execução.
// ---------------------------------------------------------------------------

export const MTF_PROFILE_RULES = Object.freeze({
  conservador: Object.freeze({ minScore: 78, maxEntryDistancePct: 0.70, roomFloorPct: 0.92, allowH4Neutral: false, m5Window: 4 }),
  moderado: Object.freeze({ minScore: 74, maxEntryDistancePct: 0.85, roomFloorPct: 0.84, allowH4Neutral: true, m5Window: 5 }),
  arrojado: Object.freeze({ minScore: 68, maxEntryDistancePct: 1.05, roomFloorPct: 0.72, allowH4Neutral: true, m5Window: 6 }),
  alavancagem: Object.freeze({ minScore: 64, maxEntryDistancePct: 1.20, roomFloorPct: 0.66, allowH4Neutral: true, m5Window: 7 })
});

function normalizeProfile(value) {
  const key = String(value || '').trim().toLowerCase();
  return MTF_PROFILE_RULES[key] ? key : 'conservador';
}

function numericRows(candles = []) {
  return (Array.isArray(candles) ? candles : []).map(row => ({
    ...row,
    open: Number(row.open || 0),
    high: Number(row.high || 0),
    low: Number(row.low || 0),
    close: Number(row.close || 0),
    volume: Number(row.volume || 0)
  })).filter(row => row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0);
}

export function adx(candles = [], period = 14) {
  const rows = numericRows(candles);
  if (rows.length < period * 2 + 2) return Array(rows.length).fill(0);
  const tr = Array(rows.length).fill(0);
  const plusDm = Array(rows.length).fill(0);
  const minusDm = Array(rows.length).fill(0);
  for (let index = 1; index < rows.length; index += 1) {
    const upMove = rows[index].high - rows[index - 1].high;
    const downMove = rows[index - 1].low - rows[index].low;
    plusDm[index] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[index] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[index] = Math.max(
      rows[index].high - rows[index].low,
      Math.abs(rows[index].high - rows[index - 1].close),
      Math.abs(rows[index].low - rows[index - 1].close)
    );
  }
  const smoothTr = ema(tr, period);
  const smoothPlus = ema(plusDm, period);
  const smoothMinus = ema(minusDm, period);
  const dx = rows.map((_, index) => {
    const base = Math.max(1e-12, smoothTr[index] || 0);
    const plus = 100 * (smoothPlus[index] || 0) / base;
    const minus = 100 * (smoothMinus[index] || 0) / base;
    return 100 * Math.abs(plus - minus) / Math.max(1e-12, plus + minus);
  });
  return ema(dx, period);
}

export function timeframeSnapshot(candles = [], label = '') {
  const rows = numericRows(candles);
  if (rows.length < 40) {
    return { label, ready: false, regime: 'SEM DADOS', bullish: false, bearish: false, severeBear: false, score: 0 };
  }
  const closes = rows.map(row => row.close);
  const ema9Values = ema(closes, 9);
  const ema21Values = ema(closes, 21);
  const ema50Values = ema(closes, 50);
  const ema200Values = ema(closes, 200);
  const rsiValues = rsi(closes, 14);
  const atrValues = atr(rows, 14);
  const adxValues = adx(rows, 14);
  const index = rows.length - 1;
  const close = closes[index];
  const ema9Value = ema9Values[index];
  const ema21Value = ema21Values[index];
  const ema50Value = ema50Values[index];
  const ema200Value = ema200Values[index];
  const slopeIndex = Math.max(0, index - 8);
  const slope50Pct = ema50Values[slopeIndex] > 0 ? ((ema50Value / ema50Values[slopeIndex]) - 1) * 100 : 0;
  const bullish = close >= ema200Value * 0.995 && ema21Value > ema50Value && slope50Pct > -0.03;
  const bearish = close < ema200Value && ema21Value < ema50Value && slope50Pct < 0;
  const severeBear = bearish && ema9Value < ema21Value && slope50Pct < -0.05 && Number(adxValues[index] || 0) >= 18;
  const regime = severeBear ? 'BAIXA FORTE' : bullish ? 'ALTA' : bearish ? 'BAIXA' : 'NEUTRO';
  let trendScore = 50;
  if (close > ema200Value) trendScore += 10; else trendScore -= 10;
  if (ema21Value > ema50Value) trendScore += 12; else trendScore -= 12;
  if (ema9Value > ema21Value) trendScore += 8; else trendScore -= 8;
  trendScore += clamp(slope50Pct * 25, -12, 12);
  return {
    label,
    ready: true,
    rows,
    close,
    ema9: ema9Value,
    ema21: ema21Value,
    ema50: ema50Value,
    ema200: ema200Value,
    rsi14: Number(rsiValues[index] || 50),
    atr14: Number(atrValues[index] || close * 0.003),
    atrPct: close > 0 ? Number(atrValues[index] || 0) / close * 100 : 0,
    adx14: Number(adxValues[index] || 0),
    slope50Pct,
    bullish,
    bearish,
    severeBear,
    regime,
    score: clamp(Math.round(trendScore), 0, 100)
  };
}

function clusterStructuralLevels(candidates, tolerance) {
  const sorted = [...candidates].sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const candidate of sorted) {
    let cluster = clusters.find(item => Math.abs(item.level - candidate.price) <= tolerance);
    if (!cluster) {
      cluster = { level: candidate.price, weight: 0, touches: 0, sources: new Set(), members: [] };
      clusters.push(cluster);
    }
    const weight = Math.max(0.1, Number(candidate.weight || 1));
    const priorWeight = cluster.weight;
    cluster.weight += weight;
    cluster.level = ((cluster.level * priorWeight) + candidate.price * weight) / Math.max(1e-12, cluster.weight);
    cluster.touches += Number(candidate.touches || 1);
    cluster.sources.add(candidate.source);
    cluster.members.push(candidate);
  }
  return clusters.map(item => ({ ...item, sources: [...item.sources] }));
}

function sourcePriority(source) {
  const value = String(source || '');
  if (value.startsWith('4h')) return 3;
  if (value.startsWith('1h')) return 2;
  if (value.startsWith('15m')) return 1;
  return 0;
}

function pickTrendAlignedResistance(levels = [], currentPrice = 0, requiredRoomPct = 0, fallback = 0) {
  const valid = (levels || []).filter(item => Number(item?.level || 0) > Number(currentPrice || 0));
  if (!valid.length) return Number(fallback || 0);

  const structural = valid.filter(item => (item.sources || []).some(source => sourcePriority(source) > 0));
  const roomReady = structural.filter(item => Number(item.distancePct || 0) >= Number(requiredRoomPct || 0));
  const pool = roomReady.length ? roomReady : structural.length ? structural : valid;
  const ranked = [...pool].sort((a, b) => {
    const aPriority = Math.max(...(a.sources || []).map(sourcePriority), 0);
    const bPriority = Math.max(...(b.sources || []).map(sourcePriority), 0);
    if (aPriority !== bPriority) return bPriority - aPriority;
    if (a.distancePct !== b.distancePct) return a.distancePct - b.distancePct;
    return Number(b.weight || 0) - Number(a.weight || 0);
  });
  return Number(ranked[0]?.level || fallback || 0);
}

export function multiTimeframeStructure(timeframes = {}, currentPrice = 0) {
  const price = Math.max(0, Number(currentPrice || timeframes?.['1m']?.at?.(-1)?.close || timeframes?.['5m']?.at?.(-1)?.close || 0));
  const sourceRules = [
    ['4h', 5.5, 300],
    ['1h', 4.5, 300],
    ['15m', 3.2, 260],
    ['5m', 1.6, 220]
  ];
  const structures = {};
  const supportCandidates = [];
  const resistanceCandidates = [];
  for (const [timeframe, sourceWeight, lookback] of sourceRules) {
    const rows = numericRows(timeframes?.[timeframe] || []);
    if (rows.length < 40) continue;
    const structure = marketStructure(rows, { currentPrice: price || rows.at(-1).close, lookback });
    structures[timeframe] = structure;
    for (const item of structure.supports.slice(0, 8)) {
      supportCandidates.push({ price: item.level, weight: Math.max(1, item.weight) * sourceWeight, touches: item.touches, source: timeframe });
    }
    for (const item of structure.resistances.slice(0, 8)) {
      resistanceCandidates.push({ price: item.level, weight: Math.max(1, item.weight) * sourceWeight, touches: item.touches, source: timeframe });
    }
    const snapshot = timeframeSnapshot(rows, timeframe);
    if (snapshot.ready && snapshot.bullish) {
      if (snapshot.ema21 < price) supportCandidates.push({ price: snapshot.ema21, weight: sourceWeight * 2.4, touches: 2, source: `${timeframe}:EMA21` });
      if (snapshot.ema50 < price) supportCandidates.push({ price: snapshot.ema50, weight: sourceWeight * 2.0, touches: 2, source: `${timeframe}:EMA50` });
    }
  }
  const referenceAtr = Number(structures['15m']?.atr || structures['1h']?.atr || price * 0.003);
  const tolerance = Math.max(price * 0.0015, referenceAtr * 0.42);
  const structuralSource = source => String(source).startsWith('4h') || String(source).startsWith('1h') || String(source).startsWith('15m');
  const supports = clusterStructuralLevels(supportCandidates, tolerance)
    .filter(item => item.level <= price * 1.0025 && item.sources.some(structuralSource))
    .map(item => ({ ...item, distancePct: price > 0 ? ((price / item.level) - 1) * 100 : 0 }))
    .sort((a, b) => b.level - a.level);
  const resistances = clusterStructuralLevels(resistanceCandidates, tolerance)
    .filter(item => item.level >= price * 0.9975 && item.sources.some(structuralSource))
    .map(item => ({ ...item, distancePct: price > 0 ? ((item.level / price) - 1) * 100 : 0 }))
    .sort((a, b) => a.level - b.level);
  return {
    support: Number(supports[0]?.level || structures['15m']?.support || structures['1h']?.support || 0),
    resistance: Number(resistances[0]?.level || structures['15m']?.resistance || structures['1h']?.resistance || 0),
    supports,
    resistances,
    structures,
    tolerance,
    atr: referenceAtr,
    atrPct: price > 0 ? referenceAtr / price * 100 : 0
  };
}

function recentReaction(candles, support, tolerance, windowBars = 6) {
  const rows = numericRows(candles);
  const recent = rows.slice(-Math.max(3, windowBars));
  let touchIndex = -1;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (recent[index].low <= support + tolerance) {
      touchIndex = index;
      break;
    }
  }
  if (touchIndex < 0) return { touched: false, confirmed: false, stretched: false, barsSinceTouch: null };
  const touch = recent[touchIndex];
  const shape = candleShape(touch);
  const after = recent.slice(touchIndex);
  const last = recent.at(-1);
  const bullishAfter = after.some(row => row.close > row.open);
  const higherClose = last.close >= touch.low + shape.range * 0.32;
  const confirmed = bullishAfter && higherClose;
  return {
    touched: true,
    confirmed,
    stretched: shape.range >= Math.max(1e-9, tolerance * 2.4) || shape.lowerWickRatio >= 0.24,
    barsSinceTouch: recent.length - 1 - touchIndex,
    touch,
    last
  };
}

export function analyzeMarketMultiTimeframe(timeframes = {}, options = {}) {
  const profileName = normalizeProfile(options.profileName);
  const rules = MTF_PROFILE_RULES[profileName];
  const rowsByTf = Object.fromEntries(['1m', '5m', '15m', '1h', '4h'].map(tf => [tf, numericRows(timeframes?.[tf] || [])]));
  const dataComplete = ['1m', '5m', '15m', '1h', '4h'].every(tf => rowsByTf[tf].length >= 60);
  if (!dataComplete) {
    return {
      action: 'WAIT', score: 0, minScore: rules.minScore, reason: 'Aguardando confirmação M1, M5, M15, H1 e H4',
      regime: 'SINCRONIZANDO MÚLTIPLOS TEMPOS', marketRegime: 'SYNC', dataComplete: false, mtfConfirmed: false
    };
  }

  const snapshots = Object.fromEntries(Object.entries(rowsByTf).map(([tf, rows]) => [tf, timeframeSnapshot(rows, tf)]));
  const currentPrice = Number(rowsByTf['1m'].at(-1)?.close || rowsByTf['5m'].at(-1)?.close || 0);
  const structure = multiTimeframeStructure(rowsByTf, currentPrice);
  const support = structure.support;
  const h4 = snapshots['4h'];
  const h1 = snapshots['1h'];
  const m15 = snapshots['15m'];
  const m5 = snapshots['5m'];
  const m1 = snapshots['1m'];

  const riskOff = Boolean((h4.severeBear && h1.bearish) || (h1.severeBear && m15.bearish));
  const directionAllowed = profileName === 'conservador'
    ? !riskOff && h4.bullish && h1.bullish && !m15.bearish
    : profileName === 'moderado'
      ? !riskOff && !h4.bearish && (h1.bullish || (!h1.bearish && m15.bullish))
      : !riskOff && !m15.severeBear && (h1.bullish || (!h1.bearish && m15.bullish));
  const marketRegime = riskOff
    ? 'RISCO / BAIXA FORTE'
    : h4.bullish && h1.bullish
      ? 'TENDÊNCIA DE ALTA'
      : h1.bullish || m15.bullish
        ? 'RECUPERAÇÃO / ALTA CURTA'
        : 'LATERAL / NEUTRO';

  const maxEntryDistancePct = clamp(
    Math.max(0.30, Number(m5.atrPct || 0) * 1.05),
    0.30,
    rules.maxEntryDistancePct
  );
  const supportTolerance = Math.max(structure.tolerance, Number(m5.atr14 || 0) * 0.38, currentPrice * 0.0012);
  const maxEntryPrice = support > 0 ? support * (1 + maxEntryDistancePct / 100) : 0;
  const distanceFromSupportPct = support > 0 ? ((currentPrice / support) - 1) * 100 : 999;
  const requiredRoomPct = clamp(rules.roomFloorPct + Number(m5.atrPct || 0) * 0.15, rules.roomFloorPct, 1.25);
  const resistance = pickTrendAlignedResistance(structure.resistances || [], currentPrice, requiredRoomPct, structure.resistance);
  const distanceToResistancePct = resistance > currentPrice ? ((resistance / currentPrice) - 1) * 100 : 0;
  const nearSupport = support > 0 && currentPrice >= support * 0.997 && currentPrice <= maxEntryPrice;

  const m5Reaction = recentReaction(rowsByTf['5m'], support, supportTolerance, rules.m5Window);
  const m1Reaction = recentReaction(rowsByTf['1m'], support, supportTolerance, 9);
  const m1Rows = rowsByTf['1m'];
  const m1Last = m1Rows.at(-1);
  const m1Previous = m1Rows.at(-2);
  const m1HigherLow = m1Rows.length >= 3 && m1Rows.at(-1).low >= Math.min(m1Rows.at(-2).low, m1Rows.at(-3).low) * 0.9995;
  const m1Confirm = Boolean(
    (m1Reaction.confirmed || m1HigherLow) &&
    m1Last.close >= m1.ema9 * 0.9995 &&
    (m1Last.close > m1Last.open || m1Last.close > m1Previous.close)
  );
  const volumeAverage = sma(rowsByTf['5m'].map(row => row.volume), 20).at(-1) || m5.rows.at(-1).volume;
  const volumeOk = m5.rows.at(-1).volume >= volumeAverage * 0.78;
  const momentumOk = m5.rsi14 >= 38 && m5.rsi14 <= 68 && m1.rsi14 <= 72;

  const supportBounce = directionAllowed && nearSupport && m5Reaction.confirmed && m1Confirm;
  const trendPullback = directionAllowed && h1.bullish && !m15.bearish && nearSupport
    && m5.close >= m5.ema21 * 0.998 && m5.close >= m5.ema9 * 0.997 && m1Confirm;

  // Rompimento só entra depois do reteste do nível estrutural anterior.
  const priorM15 = rowsByTf['15m'].slice(0, -2);
  const priorStructure = marketStructure(priorM15, { currentPrice: Number(priorM15.at(-1)?.close || currentPrice), lookback: 220 });
  const breakoutLevel = Number(priorStructure.resistance || 0);
  const breakoutRetest = directionAllowed && breakoutLevel > 0
    && rowsByTf['15m'].at(-2).close > breakoutLevel * 1.001
    && rowsByTf['5m'].slice(-4).some(row => row.low <= breakoutLevel * 1.0025 && row.close > breakoutLevel)
    && m1Confirm;

  const setup = supportBounce
    ? 'MTF_SUPPORT_BOUNCE'
    : trendPullback
      ? 'MTF_TREND_PULLBACK'
      : breakoutRetest
        ? 'MTF_BREAKOUT_RETEST'
        : '';
  const blockedByResistance = Boolean(setup && distanceToResistancePct < requiredRoomPct);
  const blockedBySupportDistance = Boolean(setup && setup !== 'MTF_BREAKOUT_RETEST' && !nearSupport);

  let score = 38;
  if (h4.bullish) score += 12; else if (!h4.bearish) score += 5;
  if (h1.bullish) score += 14; else if (!h1.severeBear) score += 5;
  if (m15.bullish) score += 9; else if (!m15.bearish) score += 3;
  if (m5Reaction.confirmed) score += 12;
  if (m1Confirm) score += 8;
  if (nearSupport) score += 9;
  if (volumeOk) score += 5;
  if (momentumOk) score += 4;
  if (m5Reaction.stretched) score += 4;
  if (distanceToResistancePct >= requiredRoomPct * 1.5) score += 4;
  if (riskOff) score -= 35;
  score = clamp(Math.round(score), 0, 97);

  let action = 'WAIT';
  let reason = riskOff
    ? 'Novas compras bloqueadas: H4/H1 confirmam risco de baixa'
    : !directionAllowed
      ? 'Aguardando alinhamento da tendência H4, H1 e M15'
      : distanceFromSupportPct > maxEntryDistancePct
        ? 'Aguardando retorno ao suporte estrutural M15/H1'
        : !m5Reaction.confirmed
          ? 'Suporte tocado: aguardando reação confirmada no M5'
          : !m1Confirm
            ? 'Reação M5 confirmada: aguardando execução no M1'
            : blockedByResistance
              ? 'Entrada bloqueada: resistência estrutural muito próxima'
              : 'Sem setup multitemporal completo';

  if (setup && !blockedByResistance && !blockedBySupportDistance && score >= rules.minScore) {
    action = 'BUY';
    reason = setup === 'MTF_SUPPORT_BOUNCE'
      ? m5Reaction.stretched
        ? 'Queda esticada varreu suporte M15/H1 e confirmou reação M5/M1'
        : 'Reação compradora confirmada no suporte estrutural M15/H1'
      : setup === 'MTF_BREAKOUT_RETEST'
        ? 'Rompimento estrutural confirmado com reteste M5/M1'
        : 'Tendência H4/H1 favorável com pullback no suporte e confirmação M5/M1';
  }

  const plan = orderPlan({
    action,
    price: currentPrice,
    support,
    resistance,
    atrValue: Number(m5.atr14 || structure.atr),
    score,
    setup,
    maxEntryPrice,
    maxEntryDistancePct
  });

  const radarScore = clamp(Math.round(
    score * 0.72 +
    (h4.bullish ? 8 : 0) +
    (h1.bullish ? 8 : 0) +
    Math.min(8, Math.max(0, distanceToResistancePct - requiredRoomPct) * 3) -
    (riskOff ? 30 : 0)
  ), 0, 99);

  return {
    action,
    score,
    minScore: rules.minScore,
    radarScore,
    reason,
    setup,
    regime: marketRegime,
    marketRegime,
    dataComplete: true,
    mtfConfirmed: Boolean(directionAllowed && setup && !blockedByResistance),
    riskOff,
    support,
    structuralSupport: support,
    resistance,
    structuralResistance: resistance,
    supportStrength: structure.supports[0]?.weight || 0,
    resistanceStrength: structure.resistances[0]?.weight || 0,
    supportSources: structure.supports[0]?.sources || [],
    resistanceSources: structure.resistances[0]?.sources || [],
    ema9: m1.ema9,
    ema21: m5.ema21,
    ema50: m15.ema50,
    ema200: h1.ema200,
    rsi14: m5.rsi14,
    atr14: m5.atr14,
    atrPct: m5.atrPct,
    volumeOk,
    nearSupport,
    supportSignal: Boolean(m5Reaction.confirmed && m1Confirm),
    stretchedSupportSweep: m5Reaction.stretched,
    barsSinceSupportTouch: m5Reaction.barsSinceTouch,
    distanceFromSupportPct,
    maxEntryDistancePct,
    maxEntryPrice,
    distanceToResistancePct,
    requiredRoomPct,
    blockedByResistance,
    blockedBySupportDistance,
    price: currentPrice,
    orderPlan: plan,
    timeframeRegimes: Object.fromEntries(Object.entries(snapshots).map(([tf, snapshot]) => [tf, {
      regime: snapshot.regime,
      score: snapshot.score,
      rsi14: snapshot.rsi14,
      adx14: snapshot.adx14,
      bullish: snapshot.bullish,
      bearish: snapshot.bearish
    }])),
    signalId: `${profileName}:${setup || 'WAIT'}:${Math.round(support * 1e6)}:${Math.round(resistance * 1e6)}:${rowsByTf['1m'].at(-1)?.time || rowsByTf['1m'].at(-1)?.openTime || 0}`
  };
}
