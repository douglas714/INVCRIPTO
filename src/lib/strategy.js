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
  const resistance = structure.resistance;
  const majorStructure = marketStructure(rows, { lookback: 260, currentPrice: last.close });
  const majorResistance = Math.max(resistance, majorStructure.resistance || resistance);
  const breakoutStructure = marketStructure(rows.slice(0, -2), {
    lookback: 160,
    currentPrice: Number(rows.at(-3)?.close || last.close)
  });
  const breakoutResistance = Number(breakoutStructure.resistance || resistance);
  const atrValue = atr14[i] || structure.atr || Math.max(1e-9, last.close * 0.003);
  const atrPct = (atrValue / Math.max(1e-9, last.close)) * 100;
  const touchTolerancePct = clamp(atrPct * 0.55, 0.12, 0.45);
  const maxEntryDistancePct = clamp(atrPct * 2.2, 0.38, 0.95);
  const maxEntryPrice = support * (1 + maxEntryDistancePct / 100);
  const requiredRoomPct = clamp(0.78 + atrPct * 0.40, 0.90, 1.60);

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
