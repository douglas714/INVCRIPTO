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

export function roundTripRates(commissionPayload = null) {
  const groups = ['standardCommission', 'specialCommission', 'taxCommission'];
  const sumSide = (liquidity, direction) => groups.reduce((total, key) => {
    const group = commissionPayload?.[key] || {};
    return total + Number(group?.[liquidity] || 0) + Number(group?.[direction] || 0);
  }, 0);
  // Compra inicial pode ser MARKET; venda e proteções normalmente são LIMIT.
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
  // Para sobrar 0,5% depois da cobranca ENV de 10%, a cesta precisa gerar
  // aproximadamente 0,5556% antes dessa cobranca, alem das taxas Binance.
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
