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
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    gain += Math.max(0, change);
    loss += Math.max(0, -change);
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - (100 / (1 + gain / loss));
  for (let i = period + 1; i < values.length; i++) {
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

export function supportResistance(candles, lookback = 40) {
  const slice = candles.slice(-lookback);
  if (!slice.length) return { support: 0, resistance: 0 };
  const support = Math.min(...slice.map(candle => candle.low));
  const resistance = Math.max(...slice.map(candle => candle.high));
  return { support, resistance };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const strategyProfiles = {
  conservative: {
    minScore: 78,
    allowMicroScalp: false,
    profitTargetMin: 0.005,
    profitTargetMax: 0.005,
    microVolumeFactor: 0.55,
    microRsiMin: 48,
    microRsiMax: 68,
    microDistanceAtr: 1.1,
    supportReclaimVolumeFactor: 1.05
  },
  moderate: {
    minScore: 70,
    allowMicroScalp: true,
    profitTargetMin: 0.0022,
    profitTargetMax: 0.0038,
    microVolumeFactor: 0.45,
    microRsiMin: 45,
    microRsiMax: 72,
    microDistanceAtr: 1.35,
    supportReclaimVolumeFactor: 0.95
  },
  aggressive: {
    minScore: 62,
    allowMicroScalp: true,
    profitTargetMin: 0.0018,
    profitTargetMax: 0.003,
    microVolumeFactor: 0.32,
    microRsiMin: 42,
    microRsiMax: 75,
    microDistanceAtr: 1.75,
    supportReclaimVolumeFactor: 0.82
  },
  leverage: {
    minScore: 56,
    allowMicroScalp: true,
    profitTargetMin: 0.0015,
    profitTargetMax: 0.0026,
    microVolumeFactor: 0.22,
    microRsiMin: 34,
    microRsiMax: 80,
    microDistanceAtr: 2.35,
    supportReclaimVolumeFactor: 0.65
  }
};

export function strategyProfile(mode = 'moderate') {
  return strategyProfiles[mode] || strategyProfiles.moderate;
}

function orderPlan({ action, price, support, resistance, atrValue, score, setup = 'support_reversal', fastEntry = false, profile = strategyProfiles.moderate }) {
  if (action === 'SELL' || !price || !support || !resistance) return null;
  const volatility = Math.max(price * 0.0025, atrValue || price * 0.004);
  const profitTargetPct = setup === 'micro_scalp' || setup === 'support_reclaim' || setup === 'support_exhaustion'
    ? clamp((atrValue || price * 0.002) / price * 0.38, profile.profitTargetMin, profile.profitTargetMax)
    : 0.005;
  const entry = fastEntry ? price : Math.min(price, support + volatility * 0.35);
  const structuralStop = setup === 'support_reclaim' || setup === 'support_exhaustion'
      ? Math.max(0, support - volatility * 0.55)
      : Math.max(0, entry - volatility * 1.4);
  const stopLoss = Math.min(structuralStop, entry * 0.998);
  const target1 = Math.max(entry * (1 + profitTargetPct), Math.min(resistance, entry + volatility * (fastEntry ? 0.7 : 2)));
  const target2 = Math.max(target1 + volatility * 0.9, resistance);
  const ladder = [
    { level: 1, label: 'MÃ£o 1', multiplier: 1, entry },
    { level: 2, label: 'MÃ£o 2', multiplier: 1.6, entry: Math.max(0, entry - volatility * 0.85) },
    { level: 3, label: 'MÃ£o 3', multiplier: 2.4, entry: Math.max(0, entry - volatility * 1.6) }
  ];
  const weightedCost = ladder.reduce((sum, item) => sum + item.entry * item.multiplier, 0);
  const totalWeight = ladder.reduce((sum, item) => sum + item.multiplier, 0);
  const fullBasketAvg = weightedCost / totalWeight;
  const recoveryTarget = fullBasketAvg * (1 + profitTargetPct);
  const risk = Math.max(0.00000001, entry - stopLoss);
  const reward = target1 - entry;
  return {
    side: 'BUY',
    type: 'LIMIT_PREVIEW',
    confidence: score,
    entry,
    stopLoss,
    target1,
    target2,
    recoveryTarget,
    fullBasketAvg,
    ladder,
    martingale: {
      enabled: true,
      maxHands: ladder.length,
      profitTargetPct: profitTargetPct * 100,
      multipliers: ladder.map(item => item.multiplier)
    },
    setup,
    fastEntry,
    profitTargetPct,
    risk,
    reward,
    riskReward: reward / risk,
    note: 'Previa paper. Envio real deve passar por backend, saldo USDT, permissoes e limite de risco.'
  };
}

export function analyzeMarket(candles, mode = 'moderate') {
  if (!candles || candles.length < 80) {
    return { action: 'WAIT', score: 0, reason: 'Aguardando candles suficientes' };
  }
  const profile = strategyProfile(mode);

  const closes = candles.map(candle => candle.close);
  const volumes = candles.map(candle => Number(candle.volume || 0));
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(candles, 14);
  const volSma20 = sma(volumes, 20);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const i = closes.length - 1;
  const previousCandles = candles.slice(0, -1);
  const { support, resistance } = supportResistance(previousCandles.length ? previousCandles : candles, 48);
  const longTrend = ema21[i] > ema50[i] && last.close > ema50[i];
  const macroTrend = ema200[i] ? last.close > ema200[i] : longTrend;
  const shortTrend = ema9[i] > ema21[i];
  const trendUp = shortTrend && longTrend && macroTrend;
  const trendDown = ema9[i] < ema21[i] && ema21[i] < ema50[i] && last.close < ema50[i];
  const range = Math.max(1e-9, last.high - last.low);
  const effectiveVolume = Math.max(volumes[i] || 0, volumes[i - 1] || 0);
  const volumeOk = effectiveVolume >= (volSma20[i] || effectiveVolume) * 0.85;
  const volumeModerate = effectiveVolume >= (volSma20[i] || effectiveVolume) * profile.microVolumeFactor;
  const supportReclaimVolumeOk = effectiveVolume >= (volSma20[i] || effectiveVolume) * profile.supportReclaimVolumeFactor;
  const momentumOk = rsi14[i] >= 48 && rsi14[i] <= 68;
  const rsiRecovering = rsi14[i] > rsi14[i - 1] && rsi14[i - 1] < 55;
  const candleStrength = last.close > last.open && (last.close - last.low) / range > 0.58;
  const lowerRecovery = (last.close - last.low) / range;
  const strongDowntrendReaction = rsiRecovering && volumeOk && lowerRecovery > 0.72;
  const rejectionBuy = last.low < support * 1.0025 && last.close > support && candleStrength && (!trendDown || strongDowntrendReaction);
  const rejectionSell = last.high > resistance * 0.998 && last.close < resistance && (last.high - last.close) / range > 0.55;
  const pullbackBuy = trendUp && last.low <= ema21[i] && last.close > ema9[i] && momentumOk;
  const atrValue = atr14[i] || 0;
  const nearResistance = resistance > 0 && atrValue > 0 && (resistance - last.close) <= atrValue * 0.35 && last.close < resistance;
  const stretchedDrop = atrValue > 0 && range >= atrValue * 1.15 && last.close < last.open;
  const supportSweep = support > 0 && last.low <= support * 1.0015 && last.close >= support * 0.9975;
  const exhaustionBuy = !nearResistance &&
    stretchedDrop &&
    supportSweep &&
    lowerRecovery >= 0.42 &&
    volumeModerate &&
    rsi14[i] <= 55 &&
    (rsi14[i] <= 42 || rsiRecovering || last.close > support);
  const supportReclaimBuy = !trendDown &&
    support > 0 &&
    prev.close < support &&
    last.close > support + Math.max(support * 0.0002, atrValue * 0.08) &&
    supportReclaimVolumeOk &&
    rsiRecovering &&
    candleStrength &&
    !nearResistance;
  const distanceFromEma21 = atrValue > 0 ? (last.close - ema21[i]) / atrValue : 0;
  const continuationBuy = trendUp &&
    last.close > ema9[i] &&
    last.close >= prev.close * 0.998 &&
    volumeModerate &&
    rsi14[i] >= 50 &&
    rsi14[i] <= 74 &&
    distanceFromEma21 <= 2.4 &&
    last.close < resistance * 1.006;
  const nearFastEma = atrValue > 0 ? Math.abs(last.close - ema9[i]) <= atrValue * profile.microDistanceAtr : last.close <= ema9[i] * 1.006;
  const microScalpBuy = profile.allowMicroScalp &&
    !trendDown &&
    (trendUp || (shortTrend && last.close > ema50[i])) &&
    nearFastEma &&
    volumeModerate &&
    rsi14[i] >= profile.microRsiMin &&
    rsi14[i] <= profile.microRsiMax &&
    last.close >= prev.close * 0.997 &&
    last.close < resistance * 1.004;
  const defensiveSell = trendDown || rejectionSell || rsi14[i] > 76;

  let score = 0;
  let action = 'WAIT';
  let reason = 'Sem setup';
  let setup = 'support_reversal';
  let fastEntry = false;

  if (pullbackBuy || rejectionBuy || supportReclaimBuy || exhaustionBuy || continuationBuy || microScalpBuy) {
    score = 58;
    if (trendUp) score += 12;
    if (macroTrend) score += 8;
    if (volumeOk) score += 7;
    if (supportReclaimVolumeOk && supportReclaimBuy) score += 5;
    if (volumeModerate && !volumeOk) score += 4;
    if (momentumOk || rsiRecovering) score += 8;
    if (rejectionBuy) score += 8;
    if (supportReclaimBuy) score += 8;
    if (exhaustionBuy) score += 9;
    if (continuationBuy) score += 7;
    if (microScalpBuy) score += 6;
    score = Math.min(96, score);
    action = 'BUY';
    setup = exhaustionBuy ? 'support_exhaustion' : supportReclaimBuy ? 'support_reclaim' : microScalpBuy && !rejectionBuy && !pullbackBuy ? 'micro_scalp' : 'support_reversal';
    fastEntry = setup === 'micro_scalp' || setup === 'support_reclaim' || setup === 'support_exhaustion';
    reason = exhaustionBuy ? 'Queda esticada com reacao no suporte' : supportReclaimBuy ? 'Retomada de suporte com volume' : rejectionBuy ? 'Varredura de suporte com reacao' : continuationBuy ? 'Tendencia de alta confirmada' : microScalpBuy ? 'Scalper de micro lucro' : 'Tendencia + pullback EMA';
  }

  if (defensiveSell && action !== 'BUY') {
    score = Math.max(64, rsi14[i] > 76 ? 70 : 68);
    action = 'SELL';
    reason = rsi14[i] > 76 ? 'RSI esticado: proteger lucro' : rejectionSell ? 'RejeiÃ§Ã£o em resistÃªncia' : 'TendÃªncia defensiva';
  }

  const regime = trendUp ? 'TENDÃŠNCIA DE ALTA' : trendDown ? 'TENDÃŠNCIA DE BAIXA' : 'LATERAL/NEUTRO';
  const plan = orderPlan({ action, price: last.close, support, resistance, atrValue, score, setup, fastEntry, profile });

  return {
    action,
    score,
    reason,
    regime,
    support,
    resistance,
    ema9: ema9[i],
    ema21: ema21[i],
    ema50: ema50[i],
    ema200: ema200[i],
    rsi14: rsi14[i],
    atr14: atrValue,
    volumeOk,
    setup,
    strategyMode: mode,
    minScore: profile.minScore,
    price: last.close,
    orderPlan: plan
  };
}

