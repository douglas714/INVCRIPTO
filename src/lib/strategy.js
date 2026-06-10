export function ema(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev = values[0];
  for (const v of values) { prev = v * k + prev * (1-k); out.push(prev); }
  return out;
}

export function supportResistance(candles, lookback=40) {
  const slice = candles.slice(-lookback);
  const support = Math.min(...slice.map(c=>c.low));
  const resistance = Math.max(...slice.map(c=>c.high));
  return { support, resistance };
}

export function analyzeMarket(candles) {
  if (!candles || candles.length < 80) return { action:'WAIT', score:0, reason:'Aguardando candles suficientes' };
  const closes = candles.map(c=>c.close);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const last = candles[candles.length-1];
  const prev = candles[candles.length-2];
  const i = closes.length-1;
  const { support, resistance } = supportResistance(candles, 48);
  const trendUp = ema9[i] > ema21[i] && ema21[i] > ema50[i] && last.close > ema50[i];
  const trendDown = ema9[i] < ema21[i] && ema21[i] < ema50[i] && last.close < ema50[i];
  const body = Math.abs(last.close - last.open);
  const range = Math.max(1e-9, last.high - last.low);
  const rejectionBuy = last.low < support * 1.002 && last.close > support && (last.close-last.low)/range > 0.55;
  const rejectionSell = last.high > resistance * 0.998 && last.close < resistance && (last.high-last.close)/range > 0.55;
  const pullbackBuy = trendUp && last.low <= ema21[i] && last.close > ema9[i];
  const pullbackSell = trendDown && last.high >= ema21[i] && last.close < ema9[i];
  let score = 0, action = 'WAIT', reason = 'Sem setup';
  if (pullbackBuy || (trendUp && rejectionBuy)) {
    score = 72 + (rejectionBuy ? 12 : 0); action='BUY'; reason = rejectionBuy ? 'Alta + varredura de suporte' : 'Alta + pullback EMA';
  }
  if (pullbackSell || (trendDown && rejectionSell)) {
    score = 72 + (rejectionSell ? 12 : 0); action='SELL'; reason = rejectionSell ? 'Baixa + varredura de resistência' : 'Baixa + pullback EMA';
  }
  const regime = trendUp ? 'TENDÊNCIA DE ALTA' : trendDown ? 'TENDÊNCIA DE BAIXA' : 'LATERAL/NEUTRO';
  return { action, score, reason, regime, support, resistance, ema9: ema9[i], ema21: ema21[i], ema50: ema50[i], price: last.close };
}
