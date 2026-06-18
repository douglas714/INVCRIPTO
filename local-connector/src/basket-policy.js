export const PROFILE_RULES = Object.freeze({
  conservador: Object.freeze({ name: 'conservador', protectionGapPct: 1.0, maxConcurrentBaskets: 1, timeframe: '5m', handGrowthFactor: 1.20, minScore: 84, roomFloorPct: 1.05 }),
  moderado: Object.freeze({ name: 'moderado', protectionGapPct: 0.5, maxConcurrentBaskets: 1, timeframe: '5m', handGrowthFactor: 1.25, minScore: 80, roomFloorPct: 0.95 }),
  arrojado: Object.freeze({ name: 'arrojado', protectionGapPct: 0.3, maxConcurrentBaskets: 1, timeframe: '1m', handGrowthFactor: 1.30, minScore: 76, roomFloorPct: 0.88 }),
  alavancagem: Object.freeze({ name: 'alavancagem', protectionGapPct: 0.15, maxConcurrentBaskets: 5, timeframe: '1m', handGrowthFactor: 1.35, minScore: 74, roomFloorPct: 0.82 })
});

export const INITIAL_ENTRY_USDT = 10;
export const NORMAL_RESERVE_RATIO = 0.80;
export const EMERGENCY_RESERVE_RATIO = 0.20;
export const TARGET_NET_PCT = 0.5;
export const HAND_GROWTH_FACTOR = 1.35;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeProfileName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PROFILE_RULES[normalized] ? normalized : 'conservador';
}

export function profileRules(value) {
  return PROFILE_RULES[normalizeProfileName(value)];
}

export function allocateBasketBudget({ accountUsdt, profileName }) {
  const rules = profileRules(profileName);
  const total = Math.max(0, Number(accountUsdt || 0));
  const basketBudget = rules.maxConcurrentBaskets > 1 ? total / rules.maxConcurrentBaskets : total;
  return {
    basketBudget,
    normalBudget: basketBudget * NORMAL_RESERVE_RATIO,
    emergencyBudget: basketBudget * EMERGENCY_RESERVE_RATIO,
    maxConcurrentBaskets: rules.maxConcurrentBaskets
  };
}

export function nextProtectionPrice({ lastBuyPrice, gapPct, emergency = false }) {
  const price = Math.max(0, Number(lastBuyPrice || 0));
  const gap = Math.max(0, Number(gapPct || 0)) / 100;
  const multiplier = emergency ? 3 : 1;
  return price * Math.max(0, 1 - gap * multiplier);
}

export function nextProtectionQuote({ lastQuote, normalRemaining, emergencyRemaining, minimumOrder = INITIAL_ENTRY_USDT, growthFactor = HAND_GROWTH_FACTOR }) {
  const min = Math.max(0, Number(minimumOrder || INITIAL_ENTRY_USDT));
  const previous = Math.max(min, Number(lastQuote || min));
  const desired = Math.max(min, previous * Math.max(1, Number(growthFactor || HAND_GROWTH_FACTOR)));
  const normal = Math.max(0, Number(normalRemaining || 0));
  if (normal >= min) {
    return { quote: Math.min(desired, normal), bucket: 'normal', emergency: false };
  }
  const emergency = Math.max(0, Number(emergencyRemaining || 0));
  if (emergency >= min) {
    return { quote: Math.min(desired, emergency), bucket: 'emergency', emergency: true };
  }
  return { quote: 0, bucket: 'none', emergency: false };
}

export function normalizeKlineRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map(row => {
    if (Array.isArray(row)) {
      return {
        openTime: Number(row[0] || 0),
        open: Number(row[1] || 0),
        high: Number(row[2] || 0),
        low: Number(row[3] || 0),
        close: Number(row[4] || 0),
        volume: Number(row[5] || 0),
        closeTime: Number(row[6] || 0)
      };
    }
    return {
      openTime: Number(row.openTime || row.time || 0),
      open: Number(row.open || 0),
      high: Number(row.high || 0),
      low: Number(row.low || 0),
      close: Number(row.close || 0),
      volume: Number(row.volume || 0),
      closeTime: Number(row.closeTime || 0)
    };
  }).filter(row => row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0);
}

function trueRange(candle, previousClose) {
  if (!Number.isFinite(previousClose)) return Math.max(0, candle.high - candle.low);
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previousClose),
    Math.abs(candle.low - previousClose)
  );
}

export function averageTrueRange(candles = [], period = 14) {
  const rows = normalizeKlineRows(candles);
  if (!rows.length) return 0;
  const ranges = rows.map((row, index) => trueRange(row, index ? rows[index - 1].close : NaN));
  const slice = ranges.slice(-Math.max(1, period));
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
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

function candleRejectionWeight(candle, side) {
  const range = Math.max(1e-12, candle.high - candle.low);
  const bodyLow = Math.min(candle.open, candle.close);
  const bodyHigh = Math.max(candle.open, candle.close);
  if (side === 'support') {
    const lowerWick = Math.max(0, bodyLow - candle.low);
    const closePosition = (candle.close - candle.low) / range;
    return 1 + (lowerWick / range) * 2 + closePosition;
  }
  const upperWick = Math.max(0, candle.high - bodyHigh);
  const closePosition = (candle.high - candle.close) / range;
  return 1 + (upperWick / range) * 2 + closePosition;
}

/**
 * Estrutura de mercado comum ao conector. O nivel escolhido e o suporte de
 * pivô mais proximo abaixo do preco, e nao simplesmente a menor minima do
 * periodo. Isso evita comprar mecanicamente no meio da queda.
 */
export function marketStructure(candles = [], options = {}) {
  const all = normalizeKlineRows(candles);
  const lookback = Math.max(48, Number(options.lookback || 160));
  const rows = all.slice(-lookback);
  if (rows.length < 8) return { support: 0, resistance: 0, supports: [], resistances: [], atr: 0, atrPct: 0 };
  const currentPrice = Math.max(0, Number(options.currentPrice || rows.at(-1)?.close || 0));
  const atr = averageTrueRange(rows, 14) || currentPrice * 0.002;
  const tolerance = Math.max(currentPrice * 0.0012, atr * 0.38);
  const pivotWindow = 2;
  const lowCandidates = [];
  const highCandidates = [];

  for (let index = pivotWindow; index < rows.length - pivotWindow; index += 1) {
    const row = rows[index];
    const neighbors = rows.slice(index - pivotWindow, index + pivotWindow + 1);
    const isPivotLow = neighbors.every(item => row.low <= item.low + tolerance * 0.08);
    const isPivotHigh = neighbors.every(item => row.high >= item.high - tolerance * 0.08);
    const recency = 1 + (index / rows.length) * 1.4;
    const volumeBase = rows.slice(Math.max(0, index - 20), index + 1).reduce((sum, item) => sum + item.volume, 0) / Math.min(21, index + 1);
    const volumeWeight = volumeBase > 0 ? clamp(row.volume / volumeBase, 0.7, 2.2) : 1;
    if (isPivotLow) lowCandidates.push({ price: row.low, index, weight: recency * volumeWeight * candleRejectionWeight(row, 'support') });
    if (isPivotHigh) highCandidates.push({ price: row.high, index, weight: recency * volumeWeight * candleRejectionWeight(row, 'resistance') });
  }

  // Mantem fundos recentes confirmados por pelo menos um candle posterior.
  for (let index = Math.max(1, rows.length - 12); index < rows.length - 1; index += 1) {
    const row = rows[index];
    const next = rows[index + 1];
    const range = Math.max(1e-12, row.high - row.low);
    const lowerWick = Math.max(0, Math.min(row.open, row.close) - row.low);
    const stretched = range >= atr * 1.10;
    const reacted = next.close > row.low + range * 0.28;
    if ((lowerWick / range >= 0.22 || stretched) && reacted) {
      lowCandidates.push({ price: row.low, index, weight: 3.2 + (lowerWick / range) * 3 });
    }
  }

  const supports = clusterLevels(lowCandidates, tolerance)
    .map(item => ({ ...item, distancePct: currentPrice > 0 ? ((currentPrice / item.level) - 1) * 100 : 0 }))
    .filter(item => item.level <= currentPrice * 1.0025)
    .sort((a, b) => b.level - a.level);
  const resistances = clusterLevels(highCandidates, tolerance)
    .map(item => ({ ...item, distancePct: currentPrice > 0 ? ((item.level / currentPrice) - 1) * 100 : 0 }))
    .filter(item => item.level >= currentPrice * 0.9975)
    .sort((a, b) => a.level - b.level);

  const fallbackSlice = rows.slice(-48);
  const fallbackSupport = Math.min(...fallbackSlice.map(item => item.low));
  const fallbackResistance = Math.max(...fallbackSlice.map(item => item.high));
  const support = supports[0]?.level || fallbackSupport;
  const resistance = resistances[0]?.level || fallbackResistance;
  return {
    support,
    resistance,
    supports,
    resistances,
    atr,
    atrPct: currentPrice > 0 ? (atr / currentPrice) * 100 : 0,
    tolerance
  };
}

export function supportEntryContext(candles = [], options = {}) {
  const rows = normalizeKlineRows(candles);
  if (rows.length < 20) return { valid: false, reason: 'insufficient_candles', support: 0, resistance: 0 };
  const currentPrice = Math.max(0, Number(options.currentPrice || rows.at(-1)?.close || 0));
  const structure = marketStructure(rows, { currentPrice, lookback: options.lookback || 160 });
  const maxEntryDistancePct = clamp(structure.atrPct * 2.2, 0.38, 0.95);
  const maxEntryPrice = structure.support * (1 + maxEntryDistancePct / 100);
  const touchTolerancePct = clamp(structure.atrPct * 0.55, 0.12, 0.45);
  const windowBars = Math.max(3, Number(options.windowBars || 6));
  const recent = rows.slice(-windowBars);
  let touchLocalIndex = -1;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (recent[index].low <= structure.support * (1 + touchTolerancePct / 100)) {
      touchLocalIndex = index;
      break;
    }
  }
  const touch = touchLocalIndex >= 0 ? recent[touchLocalIndex] : null;
  const afterTouch = touchLocalIndex >= 0 ? recent.slice(touchLocalIndex) : [];
  const bullishConfirmation = afterTouch.some(row => row.close > row.open)
    && Boolean(touch && currentPrice >= touch.low + Math.max(1e-12, touch.high - touch.low) * 0.28);
  const distanceFromSupportPct = structure.support > 0 ? ((currentPrice / structure.support) - 1) * 100 : 999;
  const distanceToResistancePct = structure.resistance > currentPrice ? ((structure.resistance / currentPrice) - 1) * 100 : 0;
  const requiredRoomPct = clamp(0.78 + structure.atrPct * 0.40, 0.90, 1.60);
  const valid = Boolean(
    touch &&
    bullishConfirmation &&
    currentPrice >= structure.support * 0.997 &&
    currentPrice <= maxEntryPrice &&
    distanceToResistancePct >= requiredRoomPct
  );
  return {
    ...structure,
    valid,
    reason: !touch
      ? 'support_not_touched_recently'
      : !bullishConfirmation
        ? 'support_reaction_not_confirmed'
        : currentPrice > maxEntryPrice
          ? 'price_above_support_entry_zone'
          : distanceToResistancePct < requiredRoomPct
            ? 'resistance_too_close'
            : 'support_entry_confirmed',
    maxEntryDistancePct,
    maxEntryPrice,
    touchTolerancePct,
    distanceFromSupportPct,
    distanceToResistancePct,
    requiredRoomPct,
    barsSinceTouch: touchLocalIndex >= 0 ? recent.length - 1 - touchLocalIndex : null
  };
}

export function supportAwareProtectionPrice({ candles, lastBuyPrice, gapPct, emergency = false, entryBufferPct = 0.08, currentPrice = 0 }) {
  const rows = normalizeKlineRows(candles);
  const triggerPrice = nextProtectionPrice({ lastBuyPrice, gapPct, emergency });
  if (!rows.length || !triggerPrice) return { price: triggerPrice, triggerPrice, support: 0, reason: 'fallback_gap_only' };
  const structure = marketStructure(rows, {
    currentPrice: Number(rows.at(-1)?.close || lastBuyPrice),
    lookback: emergency ? 240 : 180
  });
  const buffer = Math.max(0, Number(entryBufferPct || 0)) / 100;
  const liveCeiling = Number(currentPrice || rows.at(-1)?.close || triggerPrice);
  // Se o mercado já rompeu o suporte planejado, nunca colocamos uma LIMIT BUY
  // acima do preço atual, pois isso executaria imediatamente no meio da queda.
  const executionCeiling = Math.min(triggerPrice, liveCeiling * 1.001);
  const maximumSupport = executionCeiling / Math.max(1, 1 + buffer);
  const candidate = structure.supports.find(item => item.level <= maximumSupport) || null;
  const fallbackLow = rows
    .slice(-(emergency ? 180 : 90))
    .map(row => row.low)
    .filter(value => value <= maximumSupport)
    .sort((a, b) => b - a)[0];
  const support = Number(candidate?.level || fallbackLow || 0);
  if (!support) {
    return { price: 0, triggerPrice, support: 0, structure, reason: 'no_support_below_trigger' };
  }
  const bufferedSupport = support * (1 + buffer);
  const price = Math.min(triggerPrice, executionCeiling, bufferedSupport);
  return {
    price,
    triggerPrice,
    executionCeiling,
    support,
    structure,
    reason: emergency ? 'major_support_emergency_reserve' : 'next_support_below_profile_gap'
  };
}

export function roundTripRates(commissionPayload = null) {
  const groups = ['standardCommission', 'specialCommission', 'taxCommission'];
  const sumSide = (liquidity, direction) => groups.reduce((total, key) => {
    const group = commissionPayload?.[key] || {};
    return total + Number(group?.[liquidity] || 0) + Number(group?.[direction] || 0);
  }, 0);
  const buyRate = Math.max(sumSide('taker', 'buyer'), 0.001);
  const sellRate = Math.max(sumSide('maker', 'seller'), sumSide('taker', 'seller'), 0.001);
  return { buyRate, sellRate };
}

export function netTargetPrice({
  netCapitalUsdt,
  quantity,
  targetNetPct = TARGET_NET_PCT,
  buyRate = 0.001,
  sellRate = 0.001,
  slippageRate = 0.0005,
  profitFeeRate = 0.10
}) {
  const capital = Math.max(0, Number(netCapitalUsdt || 0));
  const qty = Math.max(0, Number(quantity || 0));
  if (!capital || !qty) return 0;
  const targetAfterProfitFee = Math.max(0, Number(targetNetPct || 0)) / 100;
  const feeOnProfit = Math.min(0.95, Math.max(0, Number(profitFeeRate || 0)));
  const requiredProfitBeforeFee = targetAfterProfitFee / Math.max(0.05, 1 - feeOnProfit);
  const effectiveCost = capital * (1 + Math.max(0, buyRate));
  const netSellFactor = Math.max(0.000001, 1 - Math.max(0, sellRate) - Math.max(0, slippageRate));
  return (effectiveCost * (1 + requiredProfitBeforeFee)) / (qty * netSellFactor);
}

export function summarizeBasketOrders(orders = []) {
  let boughtQty = 0;
  let soldQty = 0;
  let buyQuote = 0;
  let sellQuote = 0;
  let lastBuyPrice = 0;
  let lastBuyQuote = INITIAL_ENTRY_USDT;
  let recoveryLevel = 0;

  const sorted = [...orders].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  for (const order of sorted) {
    const status = String(order.status || '').toLowerCase();
    if (status !== 'filled') continue;
    const side = String(order.side || '').toUpperCase();
    const qty = Number(order.executed_qty || order.quantity || 0);
    const quote = Number(order.cummulative_quote_qty || order.quote_order_qty || (qty * Number(order.price || 0)) || 0);
    if (side === 'BUY') {
      boughtQty += qty;
      buyQuote += quote;
      if (qty > 0 && quote > 0) lastBuyPrice = quote / qty;
      else if (Number(order.price || 0) > 0) lastBuyPrice = Number(order.price);
      if (quote > 0) lastBuyQuote = quote;
      recoveryLevel += 1;
    } else if (side === 'SELL') {
      soldQty += qty;
      sellQuote += quote;
    }
  }

  const openQty = Math.max(0, boughtQty - soldQty);
  const netCapital = Math.max(0, buyQuote - sellQuote);
  return {
    boughtQty,
    soldQty,
    openQty,
    buyQuote,
    sellQuote,
    netCapital,
    avgBuyPrice: boughtQty > 0 ? buyQuote / boughtQty : 0,
    lastBuyPrice,
    lastBuyQuote,
    recoveryLevel
  };
}

// ---------------------------------------------------------------------------
// Confirmação multitemporal da conta real (MTF-R V1.5)
// ---------------------------------------------------------------------------

function emaSeries(values = [], period = 14) {
  if (!values.length) return [];
  const alpha = 2 / (period + 1);
  const out = [];
  let previous = Number(values[0] || 0);
  for (const value of values) {
    previous = Number(value || 0) * alpha + previous * (1 - alpha);
    out.push(previous);
  }
  return out;
}

function rsiSeries(values = [], period = 14) {
  const rows = values.map(Number);
  const out = Array(rows.length).fill(50);
  if (rows.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = rows[index] - rows[index - 1];
    gain += Math.max(0, change);
    loss += Math.max(0, -change);
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let index = period + 1; index < rows.length; index += 1) {
    const change = rows[index] - rows[index - 1];
    gain = ((gain * (period - 1)) + Math.max(0, change)) / period;
    loss = ((loss * (period - 1)) + Math.max(0, -change)) / period;
    out[index] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function adxSeries(candles = [], period = 14) {
  const rows = normalizeKlineRows(candles);
  if (rows.length < period * 2 + 2) return Array(rows.length).fill(0);
  const tr = Array(rows.length).fill(0);
  const plusDm = Array(rows.length).fill(0);
  const minusDm = Array(rows.length).fill(0);
  for (let index = 1; index < rows.length; index += 1) {
    const upMove = rows[index].high - rows[index - 1].high;
    const downMove = rows[index - 1].low - rows[index].low;
    plusDm[index] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[index] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[index] = trueRange(rows[index], rows[index - 1].close);
  }
  const smoothTr = emaSeries(tr, period);
  const smoothPlus = emaSeries(plusDm, period);
  const smoothMinus = emaSeries(minusDm, period);
  const dx = rows.map((_, index) => {
    const base = Math.max(1e-12, smoothTr[index] || 0);
    const plus = 100 * (smoothPlus[index] || 0) / base;
    const minus = 100 * (smoothMinus[index] || 0) / base;
    return 100 * Math.abs(plus - minus) / Math.max(1e-12, plus + minus);
  });
  return emaSeries(dx, period);
}

export function timeframeTrendContext(candles = [], label = '') {
  const rows = normalizeKlineRows(candles);
  if (rows.length < 40) return { label, ready: false, regime: 'SEM DADOS', bullish: false, bearish: false, severeBear: false };
  const closes = rows.map(row => row.close);
  const e9 = emaSeries(closes, 9);
  const e21 = emaSeries(closes, 21);
  const e50 = emaSeries(closes, 50);
  const e200 = emaSeries(closes, 200);
  const rsi14 = rsiSeries(closes, 14);
  const adx14 = adxSeries(rows, 14);
  const index = rows.length - 1;
  const slopeIndex = Math.max(0, index - 8);
  const slope50Pct = e50[slopeIndex] > 0 ? ((e50[index] / e50[slopeIndex]) - 1) * 100 : 0;
  const bullish = closes[index] >= e200[index] * 0.995 && e21[index] > e50[index] && slope50Pct > -0.03;
  const bearish = closes[index] < e200[index] && e21[index] < e50[index] && slope50Pct < 0;
  const severeBear = bearish && e9[index] < e21[index] && slope50Pct < -0.05 && Number(adx14[index] || 0) >= 18;
  return {
    label,
    ready: true,
    rows,
    close: closes[index],
    ema9: e9[index],
    ema21: e21[index],
    ema50: e50[index],
    ema200: e200[index],
    rsi14: Number(rsi14[index] || 50),
    adx14: Number(adx14[index] || 0),
    atr14: averageTrueRange(rows, 14),
    slope50Pct,
    bullish,
    bearish,
    severeBear,
    regime: severeBear ? 'BAIXA FORTE' : bullish ? 'ALTA' : bearish ? 'BAIXA' : 'NEUTRO'
  };
}

function clusterMtfLevels(candidates = [], tolerance = 0) {
  const sorted = [...candidates].sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const candidate of sorted) {
    let cluster = clusters.find(item => Math.abs(item.level - candidate.price) <= tolerance);
    if (!cluster) {
      cluster = { level: candidate.price, weight: 0, sources: new Set(), touches: 0 };
      clusters.push(cluster);
    }
    const weight = Math.max(0.1, Number(candidate.weight || 1));
    const previousWeight = cluster.weight;
    cluster.weight += weight;
    cluster.level = ((cluster.level * previousWeight) + candidate.price * weight) / Math.max(1e-12, cluster.weight);
    cluster.sources.add(candidate.source);
    cluster.touches += Number(candidate.touches || 1);
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

export function multiTimeframeStructureContext(timeframes = {}, currentPrice = 0) {
  const price = Math.max(0, Number(currentPrice || normalizeKlineRows(timeframes?.['1m']).at(-1)?.close || normalizeKlineRows(timeframes?.['5m']).at(-1)?.close || 0));
  const rules = [['4h', 5.5, 300], ['1h', 4.5, 300], ['15m', 3.2, 260], ['5m', 1.6, 220]];
  const supports = [];
  const resistances = [];
  const structures = {};
  for (const [timeframe, weight, lookback] of rules) {
    const rows = normalizeKlineRows(timeframes?.[timeframe] || []);
    if (rows.length < 40) continue;
    const structure = marketStructure(rows, { currentPrice: price || rows.at(-1).close, lookback });
    structures[timeframe] = structure;
    for (const item of structure.supports.slice(0, 8)) supports.push({ price: item.level, weight: Math.max(1, item.weight) * weight, touches: item.touches, source: timeframe });
    for (const item of structure.resistances.slice(0, 8)) resistances.push({ price: item.level, weight: Math.max(1, item.weight) * weight, touches: item.touches, source: timeframe });
    const trend = timeframeTrendContext(rows, timeframe);
    if (trend.ready && trend.bullish) {
      if (trend.ema21 < price) supports.push({ price: trend.ema21, weight: weight * 2.4, touches: 2, source: `${timeframe}:EMA21` });
      if (trend.ema50 < price) supports.push({ price: trend.ema50, weight: weight * 2.0, touches: 2, source: `${timeframe}:EMA50` });
    }
  }
  const referenceAtr = Number(structures['15m']?.atr || structures['1h']?.atr || price * 0.003);
  const tolerance = Math.max(price * 0.0015, referenceAtr * 0.42);
  const structuralSource = source => String(source).startsWith('4h') || String(source).startsWith('1h') || String(source).startsWith('15m');
  const supportClusters = clusterMtfLevels(supports, tolerance)
    .filter(item => item.level <= price * 1.0025 && item.sources.some(structuralSource))
    .sort((a, b) => b.level - a.level);
  const resistanceClusters = clusterMtfLevels(resistances, tolerance)
    .filter(item => item.level >= price * 0.9975 && item.sources.some(structuralSource))
    .sort((a, b) => a.level - b.level);
  return {
    support: Number(supportClusters[0]?.level || structures['15m']?.support || structures['1h']?.support || 0),
    resistance: Number(resistanceClusters[0]?.level || structures['15m']?.resistance || structures['1h']?.resistance || 0),
    supports: supportClusters,
    resistances: resistanceClusters,
    structures,
    tolerance,
    atr: referenceAtr,
    atrPct: price > 0 ? referenceAtr / price * 100 : 0
  };
}

function reactionAtSupport(candles = [], support = 0, tolerance = 0, windowBars = 6) {
  const rows = normalizeKlineRows(candles);
  const recent = rows.slice(-Math.max(3, windowBars));
  let touchIndex = -1;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (recent[index].low <= support + tolerance) { touchIndex = index; break; }
  }
  if (touchIndex < 0) return { touched: false, confirmed: false, barsSinceTouch: null, stretched: false };
  const touch = recent[touchIndex];
  const range = Math.max(1e-12, touch.high - touch.low);
  const lowerWick = Math.max(0, Math.min(touch.open, touch.close) - touch.low);
  const last = recent.at(-1);
  const bullishAfter = recent.slice(touchIndex).some(row => row.close > row.open);
  const confirmed = bullishAfter && last.close >= touch.low + range * 0.32;
  return {
    touched: true,
    confirmed,
    barsSinceTouch: recent.length - 1 - touchIndex,
    stretched: lowerWick / range >= 0.24 || range >= Math.max(tolerance * 2.4, 1e-12),
    touch,
    last
  };
}

export function multiTimeframeEntryContext(timeframes = {}, options = {}) {
  const profileName = normalizeProfileName(options.profileName);
  const profile = profileRules(profileName);
  const rows = Object.fromEntries(['1m', '5m', '15m', '1h', '4h'].map(tf => [tf, normalizeKlineRows(timeframes?.[tf] || [])]));
  const complete = ['1m', '5m', '15m', '1h', '4h'].every(tf => rows[tf].length >= 60);
  if (!complete) return { valid: false, mtfConfirmed: false, reason: 'insufficient_multi_timeframe_candles', support: 0, resistance: 0 };
  const trends = Object.fromEntries(Object.entries(rows).map(([tf, candles]) => [tf, timeframeTrendContext(candles, tf)]));
  const currentPrice = Math.max(0, Number(options.currentPrice || rows['1m'].at(-1)?.close || 0));
  const structure = multiTimeframeStructureContext(rows, currentPrice);
  const h4 = trends['4h'];
  const h1 = trends['1h'];
  const m15 = trends['15m'];
  const m5 = trends['5m'];
  const riskOff = Boolean((h4.severeBear && h1.bearish) || (h1.severeBear && m15.bearish));
  const directionAllowed = profileName === 'conservador'
    ? !riskOff && h4.bullish && h1.bullish && !m15.bearish
    : profileName === 'moderado'
      ? !riskOff && !h4.bearish && (h1.bullish || (!h1.bearish && m15.bullish))
      : !riskOff && !m15.severeBear && (h1.bullish || (!h1.bearish && m15.bullish));
  const maxDistanceByProfile = { conservador: 0.55, moderado: 0.65, arrojado: 0.75, alavancagem: 0.85 }[profileName];
  const maxEntryDistancePct = clamp(Math.max(0.24, (m5.atr14 / Math.max(1e-12, m5.close)) * 100 * 0.9), 0.24, maxDistanceByProfile);
  const supportTolerance = Math.max(structure.tolerance, m5.atr14 * 0.38, currentPrice * 0.0012);
  const maxEntryPrice = structure.support * (1 + maxEntryDistancePct / 100);
  const requiredRoomPct = clamp(Number(profile.roomFloorPct || 0.95) + (m5.atr14 / Math.max(1e-12, m5.close)) * 100 * 0.18, Number(profile.roomFloorPct || 0.95), 1.45);
  const resistance = pickTrendAlignedResistance(structure.resistances || [], currentPrice, requiredRoomPct, structure.resistance);
  const distanceToResistancePct = resistance > currentPrice ? ((resistance / currentPrice) - 1) * 100 : 0;
  const nearSupport = structure.support > 0 && currentPrice >= structure.support * 0.997 && currentPrice <= maxEntryPrice;
  const m5Reaction = reactionAtSupport(rows['5m'], structure.support, supportTolerance, profileName === 'conservador' ? 4 : profileName === 'moderado' ? 5 : 7);
  const m1Reaction = reactionAtSupport(rows['1m'], structure.support, supportTolerance, 9);
  const m1Last = rows['1m'].at(-1);
  const m1Previous = rows['1m'].at(-2);
  const m1Trend = trends['1m'];
  const higherLow = rows['1m'].at(-1).low >= Math.min(rows['1m'].at(-2).low, rows['1m'].at(-3).low) * 0.9995;
  const m1Confirmed = Boolean((m1Reaction.confirmed || higherLow) && m1Last.close >= m1Trend.ema9 * 0.9995 && (m1Last.close > m1Last.open || m1Last.close > m1Previous.close));
  const valid = Boolean(directionAllowed && nearSupport && m5Reaction.confirmed && m1Confirmed && distanceToResistancePct >= requiredRoomPct);
  return {
    ...structure,
    valid,
    mtfConfirmed: valid,
    riskOff,
    directionAllowed,
    reason: riskOff
      ? 'multi_timeframe_risk_off'
      : !directionAllowed
        ? 'higher_timeframe_not_aligned'
        : !nearSupport
          ? 'price_outside_structural_support_zone'
          : !m5Reaction.confirmed
            ? 'm5_support_reaction_not_confirmed'
            : !m1Confirmed
              ? 'm1_execution_not_confirmed'
              : distanceToResistancePct < requiredRoomPct
                ? 'structural_resistance_too_close'
                : 'multi_timeframe_support_entry_confirmed',
    currentPrice,
    maxEntryDistancePct,
    maxEntryPrice,
    distanceFromSupportPct: structure.support > 0 ? ((currentPrice / structure.support) - 1) * 100 : 999,
    distanceToResistancePct,
    requiredRoomPct,
    supportSignal: Boolean(m5Reaction.confirmed && m1Confirmed),
    barsSinceTouch: m5Reaction.barsSinceTouch,
    marketRegime: riskOff ? 'RISCO / BAIXA FORTE' : h4.bullish && h1.bullish ? 'TENDENCIA DE ALTA' : h1.bullish || m15.bullish ? 'RECUPERACAO / ALTA CURTA' : 'LATERAL / NEUTRO',
    timeframeRegimes: Object.fromEntries(Object.entries(trends).map(([tf, trend]) => [tf, trend.regime]))
  };
}

export function supportAwareProtectionPriceMtf({ timeframes = {}, lastBuyPrice, gapPct, emergency = false, entryBufferPct = 0.08, currentPrice = 0, profileName = 'conservador' }) {
  const rows = Object.fromEntries(['1m', '5m', '15m', '1h', '4h'].map(tf => [tf, normalizeKlineRows(timeframes?.[tf] || [])]));
  const triggerPrice = nextProtectionPrice({ lastBuyPrice, gapPct, emergency });
  const livePrice = Math.max(0, Number(currentPrice || rows['1m'].at(-1)?.close || rows['5m'].at(-1)?.close || triggerPrice));
  const structure = multiTimeframeStructureContext(rows, livePrice);
  const trends = Object.fromEntries(['4h', '1h', '15m', '5m'].map(tf => [tf, timeframeTrendContext(rows[tf], tf)]));
  const riskOff = Boolean((trends['4h'].severeBear && trends['1h'].bearish) || (trends['1h'].severeBear && trends['15m'].bearish));
  if (riskOff) return { price: 0, triggerPrice, support: 0, structure, trends, riskOff, reason: 'risk_off_protection_paused' };
  const buffer = Math.max(0, Number(entryBufferPct || 0)) / 100;
  const executionCeiling = Math.min(triggerPrice, livePrice * 1.001);
  const maximumSupport = executionCeiling / Math.max(1, 1 + buffer);
  const preferredSources = emergency ? ['4h', '1h'] : ['1h', '15m'];
  const candidate = structure.supports.find(item => item.level <= maximumSupport && item.sources.some(source => preferredSources.some(prefix => String(source).startsWith(prefix))))
    || structure.supports.find(item => item.level <= maximumSupport)
    || null;
  const support = Number(candidate?.level || 0);
  if (!support) return { price: 0, triggerPrice, support: 0, structure, trends, riskOff, reason: 'no_structural_support_below_trigger' };
  if (emergency) {
    const m5Reaction = reactionAtSupport(rows['5m'], support, Math.max(structure.tolerance, trends['5m'].atr14 * 0.4), 5);
    if (!m5Reaction.confirmed) return { price: 0, triggerPrice, support, structure, trends, riskOff, reason: 'emergency_reserve_waiting_m5_reversal' };
  }
  const bufferedSupport = support * (1 + buffer);
  return {
    price: Math.min(triggerPrice, executionCeiling, bufferedSupport),
    triggerPrice,
    executionCeiling,
    support,
    structure,
    trends,
    riskOff,
    sources: candidate?.sources || [],
    reason: emergency ? 'mtf_major_support_emergency' : 'mtf_structural_support_below_profile_gap',
    profileName: normalizeProfileName(profileName)
  };
}
