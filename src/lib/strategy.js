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

function orderPlan({ action, price, support, resistance, atrValue, score, setup }) {
  if (action !== 'BUY' || !price || !support || !resistance) return null;
  const volatility = Math.max(price * 0.0025, atrValue || price * 0.004);
  const supportEntry = support + volatility * (setup === 'SUPPORT_BOUNCE' ? 0.18 : 0.30);
  const entry = Math.min(price, supportEntry);
  const stopLoss = Math.max(0, support - volatility * 0.55);
  const minimumGrossTarget = entry * 1.008;
  const target1 = Math.min(resistance * 0.998, Math.max(minimumGrossTarget, entry + volatility * 0.70));
  const target2 = Math.max(target1, resistance * 0.997);
  // Apenas uma previa visual. A execucao real usa o perfil salvo,
  // crescimento dinamico de 1,35x e para somente quando o orcamento 80/20 da
  // cesta termina. Mostramos cinco niveis para nao sugerir limite de 3 maos.
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
  // Previa conservadora: 0,5% liquido + margem estimada para taxas/slippage.
  const recoveryTarget = entry * 1.008;
  const risk = Math.max(0.00000001, entry - stopLoss);
  const reward = Math.max(0, target1 - entry);
  return {
    side: 'BUY',
    type: setup === 'SUPPORT_BOUNCE' ? 'SUPPORT_ENTRY_PREVIEW' : 'LIMIT_PREVIEW',
    setup,
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
      maxHands: null,
      profitTargetPct: 0.5,
      multipliers: ladder.map(item => item.multiplier)
    },
    risk,
    reward,
    riskReward: reward / risk,
    note: setup === 'SUPPORT_BOUNCE'
      ? 'Entrada priorizada em suporte após varredura/rejeição confirmada. A execução real usa o orçamento 80/20 e os filtros da Binance.'
      : 'Prévia visual. A execução real usa o intervalo do perfil, orçamento 80/20, saldo e filtros da Binance.'
  };
}

export function analyzeMarket(candles) {
  if (!candles || candles.length < 80) {
    return { action: 'WAIT', score: 0, reason: 'Aguardando candles suficientes' };
  }

  const closes = candles.map(candle => Number(candle.close));
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

  // Os dois ultimos candles ficam fora da formacao dos niveis. Assim uma vela
  // esticada pode varrer o suporte e a vela seguinte confirmar a recuperacao
  // sem mover artificialmente a propria linha de suporte/resistencia.
  const levelBase = candles.slice(0, -2);
  const localLevels = supportResistance(levelBase, 48);
  const majorLevels = supportResistance(levelBase, 120);
  const support = localLevels.support;
  const resistance = localLevels.resistance;
  const majorResistance = Math.max(resistance, majorLevels.resistance || resistance);

  const lastShape = candleShape(last);
  const prevShape = candleShape(prev);
  const atrValue = atr14[i] || Math.max(1e-9, last.close * 0.003);
  const prevAtrValue = atr14[i - 1] || atrValue;
  const atrPct = (atrValue / Math.max(1e-9, last.close)) * 100;
  const touchTolerancePct = clamp(atrPct * 0.35, 0.12, 0.45);
  const supportZonePct = clamp(atrPct * 2.20, 0.65, 1.60);
  const requiredRoomPct = clamp(0.70 + atrPct * 0.45, 0.90, 1.60);

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
  const prevVolumeExpansion = volumes[i - 1] >= (volSma20[i - 1] || volumes[i - 1]) * 1.05;
  const momentumOk = rsi14[i] >= 42 && rsi14[i] <= 68;
  const rsiRecovering = rsi14[i] > rsi14[i - 1] && rsi14[i - 1] < 58;

  const touchesSupport = candle => Number(candle.low) <= support * (1 + touchTolerancePct / 100)
    && Number(candle.close) >= support * 0.994;
  const lastTouchesSupport = touchesSupport(last);
  const prevTouchesSupport = touchesSupport(prev);
  const distanceFromSupportPct = support > 0 ? ((last.close / support) - 1) * 100 : 999;
  const distanceToResistancePct = resistance > last.close ? ((resistance / last.close) - 1) * 100 : 0;
  const distanceToMajorResistancePct = majorResistance > last.close ? ((majorResistance / last.close) - 1) * 100 : 0;
  const rangeSpan = Math.max(1e-9, resistance - support);
  const rangePosition = clamp((last.close - support) / rangeSpan, 0, 1);
  const nearSupport = distanceFromSupportPct >= -0.20 && distanceFromSupportPct <= supportZonePct;

  // Rejeicao no proprio candle: pavio inferior importante ou fechamento forte
  // depois de tocar/varrer o suporte.
  const sameCandleSupportRejection = lastTouchesSupport
    && last.close > support
    && (
      lastShape.lowerWickRatio >= 0.28
      || (lastShape.bullish && lastShape.closePosition >= 0.58)
      || (lastShape.bearish && lastShape.closePosition >= 0.62 && lastShape.range >= atrValue * 1.25)
    );

  // Padrao da imagem reportada: vela de queda muito esticada toca o suporte e
  // a vela seguinte recupera. A compra ocorre na confirmacao do M1/M5, ainda
  // dentro da zona de suporte, e nao no topo da faixa.
  const stretchedSupportSweep = prevTouchesSupport
    && prevShape.bearish
    && prevShape.range >= Math.max(prevAtrValue * 1.25, prev.close * 0.0035)
    && prev.close >= support * 0.994;
  const twoCandleSupportRecovery = stretchedSupportSweep
    && lastShape.bullish
    && last.close > prev.close
    && last.close >= prev.low + prevShape.range * 0.32
    && last.low >= support * 0.992;

  const supportBounceBuy = macroStructureHealthy
    && !severeTrendDown
    && nearSupport
    && (sameCandleSupportRejection || twoCandleSupportRecovery)
    && (volumeOk || prevVolumeExpansion || rsiRecovering);

  const pullbackBuy = trendUp
    && last.low <= ema21[i]
    && last.close > ema9[i]
    && momentumOk
    && rangePosition <= 0.58;

  // Rompimento somente apos reteste. O robo nao compra a primeira esticada em
  // cima da resistencia; precisa romper, voltar ao nivel e fechar novamente acima.
  const breakoutRetestBuy = macroStructureHealthy
    && prev.close > resistance * 1.001
    && last.low <= resistance * 1.0025
    && last.close > resistance
    && lastShape.bullish
    && volumeOk
    && distanceToMajorResistancePct >= requiredRoomPct;

  const rejectionSell = last.high > resistance * 0.998
    && last.close < resistance
    && lastShape.upperWickRatio > 0.42;
  const defensiveSell = severeTrendDown || (trendDown && !nearSupport) || rejectionSell || rsi14[i] > 76;

  const setup = supportBounceBuy
    ? 'SUPPORT_BOUNCE'
    : pullbackBuy
      ? 'TREND_PULLBACK'
      : breakoutRetestBuy
        ? 'BREAKOUT_RETEST'
        : '';

  const roomPct = setup === 'BREAKOUT_RETEST' ? distanceToMajorResistancePct : distanceToResistancePct;
  const blockedByResistance = Boolean(setup && setup !== 'BREAKOUT_RETEST' && (roomPct < requiredRoomPct || rangePosition > 0.70));
  const enoughRoomToResistance = Boolean(setup && !blockedByResistance);

  let score = 0;
  let action = 'WAIT';
  let reason = blockedByResistance ? 'Entrada bloqueada: resistência próxima' : 'Sem setup';

  if (setup && enoughRoomToResistance) {
    score = 54;
    if (macroStructureHealthy) score += 9;
    if (trendUp) score += 10;
    if (volumeOk || prevVolumeExpansion) score += 7;
    if (momentumOk || rsiRecovering) score += 7;
    if (nearSupport) score += 7;
    if (supportBounceBuy) score += 14;
    if (twoCandleSupportRecovery) score += 5;
    if (breakoutRetestBuy) score += 8;
    if (roomPct >= requiredRoomPct * 1.6) score += 4;
    score = Math.min(96, score);
    action = 'BUY';
    reason = supportBounceBuy
      ? twoCandleSupportRecovery
        ? 'Queda esticada no suporte + recuperação confirmada'
        : 'Varredura/rejeição confirmada no suporte'
      : breakoutRetestBuy
        ? 'Rompimento confirmado com reteste'
        : 'Tendência + pullback na metade inferior da faixa';
  }

  if (defensiveSell && action !== 'BUY') {
    score = Math.max(64, rsi14[i] > 76 ? 70 : 68);
    action = 'SELL';
    reason = rsi14[i] > 76
      ? 'RSI esticado: proteger lucro'
      : rejectionSell
        ? 'Rejeição em resistência'
        : severeTrendDown
          ? 'Estrutura forte de baixa: não comprar suporte'
          : 'Tendência defensiva';
  }

  const regime = trendUp ? 'TENDÊNCIA DE ALTA' : severeTrendDown ? 'TENDÊNCIA DE BAIXA' : 'LATERAL/NEUTRO';
  const plan = orderPlan({ action, price: last.close, support, resistance, atrValue, score, setup });

  return {
    action,
    score,
    reason,
    setup,
    regime,
    support,
    resistance,
    majorResistance,
    ema9: ema9[i],
    ema21: ema21[i],
    ema50: ema50[i],
    ema200: ema200[i],
    rsi14: rsi14[i],
    atr14: atrValue,
    atrPct,
    volumeOk,
    nearSupport,
    supportSignal: sameCandleSupportRejection || twoCandleSupportRecovery,
    distanceFromSupportPct,
    distanceToResistancePct,
    requiredRoomPct,
    rangePositionPct: rangePosition * 100,
    blockedByResistance,
    price: last.close,
    orderPlan: plan
  };
}
