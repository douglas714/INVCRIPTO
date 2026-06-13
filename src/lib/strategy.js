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

function orderPlan({ action, price, support, resistance, atrValue, score }) {
  if (action === 'SELL' || !price || !support || !resistance) return null;
  const volatility = Math.max(price * 0.0025, atrValue || price * 0.004);
  const entry = Math.min(price, support + volatility * 0.35);
  const stopLoss = Math.max(0, entry - volatility * 1.4);
  const target1 = Math.max(entry + volatility * 1.35, Math.min(resistance, entry + volatility * 2));
  const target2 = Math.max(target1 + volatility * 0.9, resistance);
  const ladder = [
    { level: 1, label: 'MÃ£o 1', multiplier: 1, entry },
    { level: 2, label: 'MÃ£o 2', multiplier: 1.6, entry: Math.max(0, entry - volatility * 0.85) },
    { level: 3, label: 'MÃ£o 3', multiplier: 2.4, entry: Math.max(0, entry - volatility * 1.6) }
  ];
  const weightedCost = ladder.reduce((sum, item) => sum + item.entry * item.multiplier, 0);
  const totalWeight = ladder.reduce((sum, item) => sum + item.multiplier, 0);
  const fullBasketAvg = weightedCost / totalWeight;
  const recoveryTarget = fullBasketAvg * 1.005;
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
      profitTargetPct: 0.5,
      multipliers: ladder.map(item => item.multiplier)
    },
    risk,
    reward,
    riskReward: reward / risk,
    note: 'PrÃ©via paper. Envio real deve passar por backend, saldo USDT, permissÃµes e limite de risco.'
  };
}

export function analyzeMarket(candles) {
  if (!candles || candles.length < 80) {
    return { action: 'WAIT', score: 0, reason: 'Aguardando candles suficientes' };
  }

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
  const { support, resistance } = supportResistance(candles, 48);
  const longTrend = ema21[i] > ema50[i] && last.close > ema50[i];
  const macroTrend = ema200[i] ? last.close > ema200[i] : longTrend;
  const shortTrend = ema9[i] > ema21[i];
  const trendUp = shortTrend && longTrend && macroTrend;
  const trendDown = ema9[i] < ema21[i] && ema21[i] < ema50[i] && last.close < ema50[i];
  const range = Math.max(1e-9, last.high - last.low);
  const effectiveVolume = Math.max(volumes[i] || 0, volumes[i - 1] || 0);
  const volumeOk = effectiveVolume >= (volSma20[i] || effectiveVolume) * 0.85;
  const volumeModerate = effectiveVolume >= (volSma20[i] || effectiveVolume) * 0.45;
  const momentumOk = rsi14[i] >= 48 && rsi14[i] <= 68;
  const rsiRecovering = rsi14[i] > rsi14[i - 1] && rsi14[i - 1] < 55;
  const candleStrength = last.close > last.open && (last.close - last.low) / range > 0.58;
  const rejectionBuy = last.low < support * 1.0025 && last.close > support && candleStrength;
  const rejectionSell = last.high > resistance * 0.998 && last.close < resistance && (last.high - last.close) / range > 0.55;
  const pullbackBuy = trendUp && last.low <= ema21[i] && last.close > ema9[i] && momentumOk;
  const breakoutBuy = last.close > resistance * 1.001 && prev.close <= resistance && volumeOk && rsi14[i] < 74;
  const atrValue = atr14[i] || 0;
  const distanceFromEma21 = atrValue > 0 ? (last.close - ema21[i]) / atrValue : 0;
  const continuationBuy = trendUp &&
    last.close > ema9[i] &&
    last.close >= prev.close * 0.998 &&
    volumeModerate &&
    rsi14[i] >= 50 &&
    rsi14[i] <= 74 &&
    distanceFromEma21 <= 2.4 &&
    last.close < resistance * 1.006;
  const defensiveSell = trendDown || rejectionSell || rsi14[i] > 76;

  let score = 0;
  let action = 'WAIT';
  let reason = 'Sem setup';

  if (pullbackBuy || rejectionBuy || breakoutBuy || continuationBuy) {
    score = 58;
    if (trendUp) score += 12;
    if (macroTrend) score += 8;
    if (volumeOk) score += 7;
    if (momentumOk || rsiRecovering) score += 8;
    if (rejectionBuy) score += 8;
    if (breakoutBuy) score += 5;
    if (continuationBuy) score += 7;
    score = Math.min(96, score);
    action = 'BUY';
    reason = breakoutBuy ? 'Rompimento com volume' : rejectionBuy ? 'Varredura de suporte com reacao' : continuationBuy ? 'Tendencia de alta confirmada' : 'Tendencia + pullback EMA';
  }

  if (defensiveSell && action !== 'BUY') {
    score = Math.max(64, rsi14[i] > 76 ? 70 : 68);
    action = 'SELL';
    reason = rsi14[i] > 76 ? 'RSI esticado: proteger lucro' : rejectionSell ? 'RejeiÃ§Ã£o em resistÃªncia' : 'TendÃªncia defensiva';
  }

  const regime = trendUp ? 'TENDÃŠNCIA DE ALTA' : trendDown ? 'TENDÃŠNCIA DE BAIXA' : 'LATERAL/NEUTRO';
  const plan = orderPlan({ action, price: last.close, support, resistance, atrValue, score });

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
    price: last.close,
    orderPlan: plan
  };
}

