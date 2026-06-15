import { getRiskProfile } from './riskProfiles.js';

export function ema(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev = values[0];
  for (const v of values) {
    prev = v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function sma(values, period) {
  return values.map((_, i) => {
    const start = Math.max(0, i - period + 1);
    const slice = values.slice(start, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

export function rsi(values, period = 14) {
  if (values.length < period + 1) return Array(values.length).fill(50);
  const out = Array(values.length).fill(50);
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    gains += Math.max(diff, 0);
    losses += Math.max(-diff, 0);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return out;
}

export function atr(candles, period = 14) {
  if (!candles.length) return [];
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  return ema(tr, period);
}

export function aggregateCandles(candles, frameMinutes = 5) {
  if (!candles?.length || frameMinutes <= 1) return candles || [];
  const buckets = new Map();
  for (const c of candles) {
    const key = Math.floor(c.time / (frameMinutes * 60)) * frameMinutes * 60;
    const current = buckets.get(key);
    if (!current) {
      buckets.set(key, { time: key, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 });
    } else {
      current.high = Math.max(current.high, c.high);
      current.low = Math.min(current.low, c.low);
      current.close = c.close;
      current.volume += c.volume || 0;
    }
  }
  return Array.from(buckets.values());
}

export function supportResistance(candles, lookback = 48) {
  const slice = candles.slice(-lookback);
  if (!slice.length) return { support: 0, resistance: 0, rangePct: 0 };
  const support = Math.min(...slice.map(c => c.low));
  const resistance = Math.max(...slice.map(c => c.high));
  const last = slice.at(-1)?.close || 0;
  const rangePct = last ? (resistance - support) / last : 0;
  return { support, resistance, rangePct };
}

function analyzeFrame(candles, lookback = 48) {
  if (!candles || candles.length < 55) {
    return { trend: 'NEUTRO', trendScore: 0, ema9: 0, ema21: 0, ema50: 0, ema200: 0, rsi: 50, atr: 0, atrPct: 0, support: 0, resistance: 0 };
  }
  const closes = candles.map(c => c.close);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, Math.min(200, Math.max(55, Math.floor(candles.length * 0.75))));
  const r = rsi(closes, 14);
  const a = atr(candles, 14);
  const i = candles.length - 1;
  const last = candles[i];
  const slope50 = e50[i] - e50[Math.max(0, i - 5)];
  const trendUp = e9[i] > e21[i] && e21[i] > e50[i] && last.close > e50[i] && slope50 >= 0;
  const trendDown = e9[i] < e21[i] && e21[i] < e50[i] && last.close < e50[i] && slope50 < 0;
  const trend = trendUp ? 'ALTA' : trendDown ? 'BAIXA' : 'LATERAL';
  const trendScore = trendUp ? 20 : trendDown ? -20 : 0;
  const { support, resistance, rangePct } = supportResistance(candles, lookback);
  const atrValue = a[i] || 0;
  return { trend, trendScore, ema9: e9[i], ema21: e21[i], ema50: e50[i], ema200: e200.at(-1), rsi: r[i], atr: atrValue, atrPct: last.close ? atrValue / last.close : 0, support, resistance, rangePct };
}

export function analyzeMarket(candles, options = {}) {
  const profile = getRiskProfile(options.profileId);
  if (!candles || candles.length < 80) {
    return { action: 'WAIT', score: 0, reason: 'Aguardando candles suficientes', state: 'SCANNING' };
  }

  const candles1m = candles;
  const candles5m = aggregateCandles(candles, 5);
  const candles15m = aggregateCandles(candles, 15);
  const last = candles1m.at(-1);
  const prev = candles1m.at(-2);
  const closes = candles1m.map(c => c.close);
  const volumes = candles1m.map(c => c.volume || 0);
  const avgVolume = sma(volumes, 20).at(-1) || 0;
  const volumeRatio = avgVolume > 0 ? (last.volume || 0) / avgVolume : 1;

  const frame1 = analyzeFrame(candles1m, 48);
  const frame5 = analyzeFrame(candles5m, 32);
  const frame15 = analyzeFrame(candles15m, 16);
  const { support, resistance, rangePct } = supportResistance(candles1m, 48);

  const price = last.close;
  const body = Math.abs(last.close - last.open);
  const range = Math.max(1e-9, last.high - last.low);
  const upperWick = last.high - Math.max(last.close, last.open);
  const lowerWick = Math.min(last.close, last.open) - last.low;
  const candleStrength = body / range;
  const bullishRejection = lowerWick / range > 0.45 && last.close > last.open;
  const bearishRejection = upperWick / range > 0.45 && last.close < last.open;
  const abnormalCandle = frame1.atr > 0 && range > frame1.atr * 2.4;

  const distToResistancePct = resistance > 0 ? (resistance - price) / price : 0;
  const distToSupportPct = support > 0 ? (price - support) / price : 0;
  const minRoomToResistance = profile.microTakeProfitPct + 0.003; // alvo + taxas + margem
  const tooCloseToResistance = distToResistancePct > 0 && distToResistancePct < minRoomToResistance;

  const trendAligned = frame1.trend === 'ALTA' && (frame5.trend === 'ALTA' || frame5.trend === 'LATERAL') && frame15.trend !== 'BAIXA';
  const cycleUp = frame1.trend === 'ALTA' && frame5.trend === 'ALTA' && frame15.trend !== 'BAIXA' && price > frame1.ema50 && frame1.rsi >= 48 && frame1.rsi <= 72;
  const strongDown = frame1.trend === 'BAIXA' && frame5.trend === 'BAIXA' && (frame1.rsi < 36 || price < frame1.ema50 * 0.995);
  const rangeMode = frame1.trend === 'LATERAL' && rangePct >= 0.006 && rangePct <= 0.05;

  const nearSupport = distToSupportPct >= 0 && distToSupportPct <= Math.max(0.006, frame1.atrPct * 1.2);
  const pullbackBuy = trendAligned && last.low <= frame1.ema21 * 1.002 && price > frame1.ema9 && !abnormalCandle;
  const supportBuy = (nearSupport || last.low <= support * 1.003) && bullishRejection && frame15.trend !== 'BAIXA';
  const lowerRangeBuy = rangeMode && support > 0 && ((price - support) / Math.max(1e-9, resistance - support)) <= 0.38 && bullishRejection;
  const breakout = resistance > 0 && prev.close <= resistance && price > resistance * 1.001 && volumeRatio >= 1.15 && frame5.trend !== 'BAIXA';
  const breakoutRetest = cycleUp && prev.low <= resistance * 1.002 && price > resistance && volumeRatio >= 0.85;

  let score = 0;
  let action = 'WAIT';
  let reason = 'Sem setup com vantagem';
  let state = 'SCANNING';

  if (strongDown || abnormalCandle) {
    reason = strongDown ? 'Mercado em baixa forte: aguardando estabilizacao' : 'Candle anormal: bloqueando entrada para evitar topo/fundo falso';
    state = 'DEFENSE_MODE';
  } else {
    if (cycleUp) score += 22;
    else if (trendAligned) score += 16;
    else if (rangeMode) score += 8;

    if (!tooCloseToResistance) score += 16;
    else if (cycleUp || breakout || breakoutRetest) score += 8;
    else score -= 25;

    if (nearSupport) score += 14;
    if (pullbackBuy) score += 18;
    if (supportBuy) score += 18;
    if (lowerRangeBuy) score += 16;
    if (breakoutRetest) score += 18;
    if (breakout) score += 14;
    if (volumeRatio >= 1.1) score += 8;
    if (frame1.rsi >= 42 && frame1.rsi <= 68) score += 8;
    if (bullishRejection) score += 8;
    if (bearishRejection && tooCloseToResistance) score -= 18;

    if (pullbackBuy) reason = 'Pullback de tendencia com EMAs alinhadas';
    if (supportBuy) reason = 'Rejeicao em suporte com espaco para micro lucro';
    if (lowerRangeBuy) reason = 'Compra no terco inferior da lateralidade';
    if (breakoutRetest) reason = 'Ciclo de alta com reteste de resistencia rompida';
    else if (breakout) reason = 'Rompimento com volume confirmado';

    const minScore = breakout || breakoutRetest ? profile.minBreakoutScore : profile.minEntryScore;
    if ((pullbackBuy || supportBuy || lowerRangeBuy || breakout || breakoutRetest) && score >= minScore) {
      action = 'BUY';
      state = breakout || breakoutRetest ? 'ENTRY_BREAKOUT' : 'ENTRY_READY';
    } else if (tooCloseToResistance && !(cycleUp || breakout || breakoutRetest)) {
      score = Math.max(0, score);
      action = 'WAIT';
      reason = 'Compra bloqueada: preco perto da resistencia sem ciclo de alta confirmado';
      state = 'SCANNING';
    }
  }

  const regime = strongDown ? 'BAIXA_FORTE' : cycleUp ? 'CICLO_ALTA' : trendAligned ? 'ALTA_FRACA' : rangeMode ? 'LATERAL' : frame5.trend === 'BAIXA' ? 'BAIXA_FRACA' : 'NEUTRO';

  return {
    action,
    score: Math.max(0, Math.min(100, Math.round(score))),
    reason,
    state,
    regime,
    support,
    resistance,
    price,
    ema9: frame1.ema9,
    ema21: frame1.ema21,
    ema50: frame1.ema50,
    ema200: frame1.ema200,
    rsi: frame1.rsi,
    atr: frame1.atr,
    atrPct: frame1.atrPct,
    volumeRatio,
    distToResistancePct,
    distToSupportPct,
    tooCloseToResistance,
    trend1m: frame1.trend,
    trend5m: frame5.trend,
    trend15m: frame15.trend,
    strongDown,
    cycleUp,
    lowerRangeBuy,
    pullbackBuy,
    supportBuy,
    breakout,
    breakoutRetest
  };
}

export function analyzeProtection({ candles, basket, profileId }) {
  const profile = getRiskProfile(profileId);
  const analysis = analyzeMarket(candles, { profileId });
  const price = analysis.price || candles.at(-1)?.close || 0;
  const protectionIndex = Math.max(0, (basket.entries?.length || 1) - 1);
  const dropTrigger = profile.protectionDropPct[Math.min(protectionIndex, profile.protectionDropPct.length - 1)] || 0.01;
  const referencePrice = basket.avgPrice || basket.entries?.[0]?.price || price;
  const dropFromAvg = referencePrice > 0 ? (referencePrice - price) / referencePrice : 0;

  let score = 0;
  if (dropFromAvg >= dropTrigger) score += 22;
  if (analysis.distToSupportPct >= 0 && analysis.distToSupportPct <= Math.max(0.008, analysis.atrPct * 1.5)) score += 18;
  if (analysis.rsi <= 48 && analysis.rsi >= 25) score += 14;
  if (analysis.supportBuy || analysis.lowerRangeBuy || analysis.pullbackBuy) score += 18;
  if (!analysis.strongDown) score += 18;
  if (analysis.volumeRatio < 2.2) score += 10;

  const allowed = score >= profile.minProtectionScore && dropFromAvg >= dropTrigger && !analysis.strongDown;
  return {
    ...analysis,
    action: allowed ? 'PROTECT' : 'WAIT',
    score: Math.max(0, Math.min(100, Math.round(score))),
    reason: allowed ? `Protecao liberada: queda ${(dropFromAvg * 100).toFixed(2)}% em zona tecnica` : 'Protecao aguardando zona tecnica ou estabilizacao',
    dropFromAvg,
    dropTrigger,
    state: allowed ? 'PROTECTION_READY' : (analysis.strongDown ? 'DEFENSE_MODE' : 'PROTECTION_WAITING')
  };
}
