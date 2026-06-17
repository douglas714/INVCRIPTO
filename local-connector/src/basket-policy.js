export const PROFILE_RULES = Object.freeze({
  conservador: Object.freeze({ name: 'conservador', protectionGapPct: 1.0, maxConcurrentBaskets: 1, timeframe: '5m' }),
  moderado: Object.freeze({ name: 'moderado', protectionGapPct: 0.5, maxConcurrentBaskets: 1, timeframe: '5m' }),
  arrojado: Object.freeze({ name: 'arrojado', protectionGapPct: 0.3, maxConcurrentBaskets: 1, timeframe: '1m' }),
  alavancagem: Object.freeze({ name: 'alavancagem', protectionGapPct: 0.15, maxConcurrentBaskets: 5, timeframe: '1m' })
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

export function nextProtectionQuote({ lastQuote, normalRemaining, emergencyRemaining, minimumOrder = INITIAL_ENTRY_USDT }) {
  const min = Math.max(0, Number(minimumOrder || INITIAL_ENTRY_USDT));
  const previous = Math.max(min, Number(lastQuote || min));
  const desired = Math.max(min, previous * HAND_GROWTH_FACTOR);
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
