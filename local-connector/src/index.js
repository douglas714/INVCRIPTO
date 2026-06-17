import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  INITIAL_ENTRY_USDT,
  TARGET_NET_PCT,
  allocateBasketBudget,
  netTargetPrice,
  nextProtectionQuote,
  normalizeKlineRows,
  normalizeProfileName,
  profileRules,
  roundTripRates,
  summarizeBasketOrders,
  supportAwareProtectionPrice,
  supportEntryContext,
  supportAwareProtectionPriceMtf,
  multiTimeframeEntryContext
} from './basket-policy.js';

process.stdout?.on?.('error', error => {
  if (error?.code === 'EPIPE') process.exit(0);
});

function loadLocalEnv() {
  if (!fs.existsSync('.env')) return;
  const lines = fs.readFileSync('.env', 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadLocalEnv();

if (String(process.env.CONNECTOR_ALLOW_INSECURE_TLS || '').toLowerCase() === 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const cfg = {
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  encryptionKey: process.env.APP_ENCRYPTION_KEY || '',
  nodeKey: process.env.CONNECTOR_NODE_KEY || 'pc-douglas-principal',
  nodeName: process.env.CONNECTOR_NAME || 'INVCRIPTO Connector Local',
  intervalMs: Number(process.env.CONNECTOR_INTERVAL_MS || 5000),
  spotUrl: process.env.BINANCE_SPOT_BASE_URL || 'https://api.binance.com',
  testnetUrl: process.env.BINANCE_TESTNET_BASE_URL || 'https://testnet.binance.vision'
};

const allowedSymbols = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT'];

function validateConfig() {
  const missing = [];
  if (!cfg.supabaseUrl) missing.push('SUPABASE_URL');
  if (!cfg.supabaseKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!cfg.encryptionKey) missing.push('APP_ENCRYPTION_KEY');
  if (cfg.encryptionKey && cfg.encryptionKey.length < 24) missing.push('APP_ENCRYPTION_KEY precisa ter no mínimo 24 caracteres');
  if (missing.length) throw new Error(`Configuração incompleta: ${missing.join(', ')}`);
}

validateConfig();

const restBaseUrl = `${cfg.supabaseUrl.replace(/\/$/, '')}/rest/v1`;

function restHeaders(extra = {}) {
  return {
    apikey: cfg.supabaseKey,
    authorization: `Bearer ${cfg.supabaseKey}`,
    'content-type': 'application/json',
    ...extra
  };
}

async function restRequest(path, options = {}) {
  const response = await fetch(`${restBaseUrl}${path}`, {
    method: options.method || 'GET',
    headers: restHeaders(options.headers),
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); }
    catch { payload = { raw: text }; }
  }
  if (!response.ok) {
    return { data: null, error: { message: payload?.message || payload?.error || text || `HTTP ${response.status}` }, count: null };
  }
  const countHeader = response.headers.get('content-range');
  const count = countHeader?.includes('/') ? Number(countHeader.split('/').pop()) : null;
  return { data: payload, error: null, count };
}

function eqFilter(column, value) {
  return `${encodeURIComponent(column)}=eq.${encodeURIComponent(String(value))}`;
}

async function selectRows(table, { select = '*', filters = [], order = '', limit = '', count = false } = {}) {
  const qs = new URLSearchParams({ select });
  for (const filter of filters) {
    const [key, ...rest] = filter.split('=');
    qs.append(key, rest.join('='));
  }
  if (order) qs.set('order', order);
  if (limit) qs.set('limit', String(limit));
  const headers = count ? { Prefer: 'count=exact' } : {};
  return restRequest(`/${table}?${qs.toString()}`, { headers });
}

async function maybeSingle(table, options) {
  const { data, error } = await selectRows(table, { ...options, limit: 1 });
  if (error) return { data: null, error };
  return { data: Array.isArray(data) ? data[0] || null : data || null, error: null };
}

async function insertRows(table, rows) {
  return restRequest(`/${table}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: rows
  });
}

function isSchemaCacheColumnError(error) {
  return /schema cache|could not find .* column/i.test(String(error?.message || ''));
}

function legacyRealOrderRow(row) {
  const {
    protection_role,
    linked_order_id,
    timeframe,
    basket_id,
    order_list_id,
    commission_quote,
    profile_name,
    ...legacy
  } = row;
  return legacy;
}

async function insertRealOrders(rows) {
  const result = await insertRows('real_orders', rows);
  if (!result.error || !isSchemaCacheColumnError(result.error)) return result;
  await log('warn', 'real_orders_schema_fallback', `Supabase sem colunas novas em cache: ${result.error.message}`);
  return insertRows('real_orders', rows.map(legacyRealOrderRow));
}

async function updateRows(table, values, filters = [], single = false) {
  const qs = filters.length ? `?${filters.join('&')}` : '';
  const result = await restRequest(`/${table}${qs}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: values
  });
  if (single && !result.error) {
    result.data = Array.isArray(result.data) ? result.data[0] || null : result.data;
  }
  return result;
}

async function upsertRow(table, row, onConflict) {
  const qs = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  return restRequest(`/${table}${qs}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: row
  });
}

const dashboard = {
  status: 'Iniciando',
  startedAt: new Date(),
  loopRunning: false,
  publicIp: '-',
  lastHeartbeat: null,
  pending: 0,
  processed: 0,
  errors: 0,
  lastCommand: 'Nenhum',
  lastMessage: 'Inicializando conector',
  lastUsdt: null,
  canTrade: null,
  canWithdraw: null,
  credentialStatus: null,
  lastProtectedOrder: null,
  lastSync: null,
  events: []
};

function money(value) {
  if (value === null || value === undefined) return '-';
  return `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })} USDT`;
}

function renderDashboard() {
  console.clear();
  console.log('============================================================');
  console.log(' INVCRIPTO CONNECTOR LOCAL');
  console.log('============================================================');
  console.log(` Status       : ${dashboard.status}`);
  console.log(` Node         : ${cfg.nodeKey}`);
  console.log(` IP publico   : ${dashboard.publicIp || '-'}`);
  console.log(` Iniciado em  : ${dashboard.startedAt.toLocaleString('pt-BR')}`);
  console.log(` Intervalo    : ${cfg.intervalMs}ms`);
  console.log('------------------------------------------------------------');
  console.log(` Fila pendente: ${dashboard.pending}`);
  console.log(` Processados  : ${dashboard.processed}`);
  console.log(` Erros        : ${dashboard.errors}`);
  console.log(` Ultimo cmd   : ${dashboard.lastCommand}`);
  console.log(` Ultima msg   : ${dashboard.lastMessage}`);
  console.log('------------------------------------------------------------');
  console.log(` Saldo USDT   : ${money(dashboard.lastUsdt)}`);
  console.log(` Trading      : ${dashboard.canTrade === null ? '-' : dashboard.canTrade ? 'habilitado' : 'somente leitura'}`);
  console.log(` Saque        : ${dashboard.canWithdraw === null ? '-' : dashboard.canWithdraw ? 'habilitado (revise)' : 'desativado'}`);
  console.log(` API status   : ${dashboard.credentialStatus || '-'}`);
  console.log(` Ordem real   : ${dashboard.lastProtectedOrder || '-'}`);
  console.log(` Ultimo sync  : ${dashboard.lastSync || '-'}`);
  console.log('------------------------------------------------------------');
  console.log(' Eventos recentes');
  if (!dashboard.events.length) {
    console.log('  - Aguardando primeiro evento');
  } else {
    for (const item of dashboard.events.slice(-6)) console.log(`  - ${item}`);
  }
  console.log('------------------------------------------------------------');
  console.log(' Deixe esta janela aberta. Ctrl+C para parar.');
  console.log('============================================================');
}

function pushEvent(level, event, message) {
  const prefix = `${new Date().toLocaleTimeString('pt-BR')} ${level.toUpperCase()} ${event}`;
  dashboard.events.push(`${prefix}: ${message}`);
  if (dashboard.events.length > 20) dashboard.events.shift();
}

function keyBuffer() {
  return crypto.createHash('sha256').update(cfg.encryptionKey).digest();
}

function decryptSecret(payload) {
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!parsed || parsed.alg !== 'aes-256-gcm') throw new Error('Credencial criptografada inválida.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer(), Buffer.from(parsed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.value, 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

function sign(query, secret) {
  return crypto.createHmac('sha256', secret).update(query).digest('hex');
}

function binanceBase(environment) {
  return environment === 'testnet' ? cfg.testnetUrl : cfg.spotUrl;
}

async function publicIp() {
  const services = ['https://api.ipify.org?format=json', 'https://ifconfig.me/all.json'];
  for (const url of services) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      if (data?.ip) return data.ip;
      if (data?.ip_addr) return data.ip_addr;
    } catch {}
  }
  return null;
}

async function log(level, event, message, data = {}, command = null) {
  try {
    await insertRows('connector_logs', {
      node_key: cfg.nodeKey,
      user_id: command?.user_id || null,
      command_id: command?.id || null,
      level,
      event,
      message,
      data
    });
  } catch {}
  dashboard.lastMessage = message;
  pushEvent(level, event, message);
  renderDashboard();
}

async function heartbeat(status = 'online', metadata = {}) {
  const ip = await publicIp().catch(() => null);
  dashboard.status = status;
  dashboard.publicIp = ip;
  dashboard.lastHeartbeat = new Date().toLocaleString('pt-BR');
  const row = {
    node_key: cfg.nodeKey,
    name: cfg.nodeName,
    status,
    public_ip: ip,
    app_version: '1.2.0-support-aware-baskets',
    last_seen_at: new Date().toISOString(),
    metadata
  };
  const { error } = await upsertRow('connector_nodes', row, 'node_key');
  if (error) console.error('Falha heartbeat:', error.message);
}

async function getCredential(userId, environment) {
  const { data, error } = await maybeSingle('binance_api_credentials', {
    filters: [eqFilter('user_id', userId), eqFilter('environment', environment)],
    order: 'updated_at.desc'
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Nenhuma API Binance salva para ${environment}.`);
  return data;
}

async function signedAccount({ apiKey, apiSecret, environment }) {
  const query = `timestamp=${Date.now()}&recvWindow=5000`;
  const signature = sign(query, apiSecret);
  const url = `${binanceBase(environment)}/api/v3/account?${query}&signature=${signature}`;
  const response = await fetch(url, { headers: { 'X-MBX-APIKEY': apiKey } });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  return { ok: response.ok, status: response.status, payload };
}

async function freeAssetBalanceWithRetry({ apiKey, apiSecret, environment, asset, minimum = 0, attempts = 5 }) {
  let lastAccount = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const account = await signedAccount({ apiKey, apiSecret, environment });
    lastAccount = account;
    if (!account.ok) break;
    const balance = (account.payload?.balances || []).find(item => item.asset === asset) || { free: '0', locked: '0' };
    const free = Math.max(0, Number(balance.free || 0));
    const locked = Math.max(0, Number(balance.locked || 0));
    if (free >= Number(minimum || 0) || attempt === attempts) return { ok: true, free, locked, account };
    await new Promise(resolve => setTimeout(resolve, attempt * 200));
  }
  return { ok: false, free: 0, locked: 0, account: lastAccount };
}

function decimalPlaces(value) {
  const text = String(value);
  if (!text.includes('.')) return 0;
  return text.replace(/0+$/, '').split('.')[1]?.length || 0;
}

function floorToStep(value, step) {
  const places = decimalPlaces(step);
  const stepped = Math.floor((Number(value) + Number.EPSILON) / Number(step)) * Number(step);
  return Number(stepped.toFixed(places));
}

function ceilToStep(value, step) {
  const places = decimalPlaces(step);
  const stepped = Math.ceil((Number(value) - Number.EPSILON) / Number(step)) * Number(step);
  return Number(stepped.toFixed(places));
}

function formatDecimal(value, step) {
  return Number(value).toFixed(decimalPlaces(step));
}

async function exchangeInfo(symbol, environment) {
  const response = await fetch(`${binanceBase(environment)}/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Falha exchangeInfo ${symbol}: ${JSON.stringify(payload)}`);
  const info = payload?.symbols?.[0];
  if (!info) throw new Error(`Par ${symbol} não encontrado na Binance.`);
  const filters = Object.fromEntries((info.filters || []).map(filter => [filter.filterType, filter]));
  return {
    symbol: info.symbol,
    status: info.status,
    baseAsset: info.baseAsset,
    quoteAsset: info.quoteAsset,
    stepSize: Number(filters.LOT_SIZE?.stepSize || '0.00000001'),
    minQty: Number(filters.LOT_SIZE?.minQty || '0'),
    tickSize: Number(filters.PRICE_FILTER?.tickSize || '0.00000001'),
    minPrice: Number(filters.PRICE_FILTER?.minPrice || '0'),
    minNotional: Number(filters.NOTIONAL?.minNotional || filters.MIN_NOTIONAL?.minNotional || '5')
  };
}

async function signedOrder({ apiKey, apiSecret, environment, params }) {
  const query = new URLSearchParams({
    ...params,
    timestamp: String(Date.now()),
    recvWindow: '5000'
  }).toString();
  const signature = sign(query, apiSecret);
  const url = `${binanceBase(environment)}/api/v3/order?${query}&signature=${signature}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': apiKey }
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  return { ok: response.ok, status: response.status, payload };
}

async function signedGetOrder({ apiKey, apiSecret, environment, symbol, orderId }) {
  const query = new URLSearchParams({
    symbol,
    orderId: String(orderId),
    timestamp: String(Date.now()),
    recvWindow: '5000'
  }).toString();
  const signature = sign(query, apiSecret);
  const url = `${binanceBase(environment)}/api/v3/order?${query}&signature=${signature}`;
  const response = await fetch(url, { headers: { 'X-MBX-APIKEY': apiKey } });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  return { ok: response.ok, status: response.status, payload };
}

async function signedCancelOrder({ apiKey, apiSecret, environment, symbol, orderId }) {
  const query = new URLSearchParams({
    symbol,
    orderId: String(orderId),
    timestamp: String(Date.now()),
    recvWindow: '5000'
  }).toString();
  const signature = sign(query, apiSecret);
  const url = `${binanceBase(environment)}/api/v3/order?${query}&signature=${signature}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { 'X-MBX-APIKEY': apiKey }
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  return { ok: response.ok, status: response.status, payload };
}

async function signedCancelOrderList({ apiKey, apiSecret, environment, symbol, orderListId }) {
  const query = new URLSearchParams({
    symbol,
    orderListId: String(orderListId),
    timestamp: String(Date.now()),
    recvWindow: '5000'
  }).toString();
  const signature = sign(query, apiSecret);
  const url = `${binanceBase(environment)}/api/v3/orderList?${query}&signature=${signature}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { 'X-MBX-APIKEY': apiKey }
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  return { ok: response.ok, status: response.status, payload };
}

async function signedOpenOrders({ apiKey, apiSecret, environment, symbol }) {
  const params = { timestamp: String(Date.now()), recvWindow: '5000' };
  if (symbol) params.symbol = symbol;
  const query = new URLSearchParams(params).toString();
  const signature = sign(query, apiSecret);
  const url = `${binanceBase(environment)}/api/v3/openOrders?${query}&signature=${signature}`;
  const response = await fetch(url, { headers: { 'X-MBX-APIKEY': apiKey } });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  return { ok: response.ok, status: response.status, payload };
}

async function signedMyTrades({ apiKey, apiSecret, environment, symbol, limit = 100 }) {
  const query = new URLSearchParams({
    symbol,
    limit: String(limit),
    timestamp: String(Date.now()),
    recvWindow: '5000'
  }).toString();
  const signature = sign(query, apiSecret);
  const url = `${binanceBase(environment)}/api/v3/myTrades?${query}&signature=${signature}`;
  const response = await fetch(url, { headers: { 'X-MBX-APIKEY': apiKey } });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  return { ok: response.ok, status: response.status, payload };
}

async function signedCommissionRates({ apiKey, apiSecret, environment, symbol }) {
  const query = new URLSearchParams({
    symbol,
    timestamp: String(Date.now()),
    recvWindow: '5000'
  }).toString();
  const signature = sign(query, apiSecret);
  const url = `${binanceBase(environment)}/api/v3/account/commission?${query}&signature=${signature}`;
  const response = await fetch(url, { headers: { 'X-MBX-APIKEY': apiKey } });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  return { ok: response.ok, status: response.status, payload };
}

async function signedOpoOrderList({ apiKey, apiSecret, environment, params }) {
  const query = new URLSearchParams({
    ...params,
    timestamp: String(Date.now()),
    recvWindow: '5000'
  }).toString();
  const signature = sign(query, apiSecret);
  const url = `${binanceBase(environment)}/api/v3/orderList/opo?${query}&signature=${signature}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': apiKey }
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  return { ok: response.ok, status: response.status, payload };
}

async function signedOtoOrderList({ apiKey, apiSecret, environment, params }) {
  const query = new URLSearchParams({
    ...params,
    timestamp: String(Date.now()),
    recvWindow: '5000'
  }).toString();
  const signature = sign(query, apiSecret);
  const url = `${binanceBase(environment)}/api/v3/orderList/oto?${query}&signature=${signature}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': apiKey }
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  return { ok: response.ok, status: response.status, payload };
}

async function currentFreeBalance({ apiKey, apiSecret, environment, asset }) {
  const account = await signedAccount({ apiKey, apiSecret, environment });
  if (!account.ok) throw new Error(`Falha ao consultar saldo: ${JSON.stringify(account.payload)}`);
  const row = (account.payload?.balances || []).find(item => item.asset === asset);
  return Number(row?.free || 0);
}

async function ticker(symbol) {
  const response = await fetch(`${cfg.spotUrl}/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`);
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload };
}

async function klines(symbol, interval = '15m', limit = 320) {
  const response = await fetch(`${cfg.spotUrl}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${Number(limit || 320)}`);
  const payload = await response.json().catch(() => []);
  return { ok: response.ok, status: response.status, payload };
}

async function closedMarketCandles(symbol, interval = '5m', limit = 320) {
  const response = await klines(symbol, interval, limit);
  if (!response.ok || !Array.isArray(response.payload)) {
    throw new Error(`Falha ao ler candles ${symbol}/${interval}: ${JSON.stringify(response.payload)}`);
  }
  const rows = normalizeKlineRows(response.payload);
  if (!rows.length) throw new Error(`Nenhum candle valido para ${symbol}/${interval}.`);
  const now = Date.now();
  const last = rows.at(-1);
  return last?.closeTime && last.closeTime > now ? rows.slice(0, -1) : rows;
}

async function closedMultiTimeframeCandles(symbol) {
  const settings = [['1m', 260], ['5m', 320], ['15m', 320], ['1h', 300], ['4h', 260]];
  const entries = await Promise.all(settings.map(async ([interval, limit]) => [interval, await closedMarketCandles(symbol, interval, limit)]));
  return Object.fromEntries(entries);
}

function baseAssetFromSymbol(symbol) {
  return String(symbol || '').replace(/USDT$/i, '');
}

function hasOpenSellOrder(openOrdersPayload, symbol) {
  const rows = Array.isArray(openOrdersPayload) ? openOrdersPayload : [];
  return rows.some(order =>
    String(order.symbol || '').toUpperCase() === symbol &&
    String(order.side || '').toUpperCase() === 'SELL' &&
    Number(order.origQty || 0) > Number(order.executedQty || 0)
  );
}

function openSellOrdersForSymbol(openOrdersPayload, symbol) {
  const rows = Array.isArray(openOrdersPayload) ? openOrdersPayload : [];
  return rows.filter(order =>
    String(order.symbol || '').toUpperCase() === symbol &&
    String(order.side || '').toUpperCase() === 'SELL' &&
    Number(order.origQty || 0) > Number(order.executedQty || 0)
  );
}

async function recentBasketBuyCount(userId, environment, symbol) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await selectRows('real_orders', {
    select: 'id,side,status,created_at',
    filters: [
      eqFilter('user_id', userId),
      eqFilter('environment', environment),
      eqFilter('symbol', symbol),
      'side=eq.BUY',
      `created_at=gte.${since}`
    ],
    order: 'created_at.desc',
    limit: 10
  });
  return Math.max(1, Array.isArray(data) ? data.length : 1);
}

async function estimateAverageBuyPrice({ apiKey, apiSecret, environment, symbol, neededQty }) {
  const trades = await signedMyTrades({ apiKey, apiSecret, environment, symbol, limit: 100 });
  if (!trades.ok || !Array.isArray(trades.payload)) return 0;
  let qty = 0;
  let quote = 0;
  const sorted = [...trades.payload].sort((a,b)=>Number(b.time || 0) - Number(a.time || 0));
  for (const trade of sorted) {
    if (!trade.isBuyer) continue;
    const tradeQty = Number(trade.qty || 0);
    const tradeQuote = Number(trade.quoteQty || 0) || tradeQty * Number(trade.price || 0);
    if (tradeQty <= 0 || tradeQuote <= 0) continue;
    const remaining = Math.max(0, Number(neededQty || 0) - qty);
    const usedQty = remaining > 0 ? Math.min(tradeQty, remaining) : tradeQty;
    const ratio = usedQty / tradeQty;
    qty += usedQty;
    quote += tradeQuote * ratio;
    if (neededQty && qty >= Number(neededQty)) break;
  }
  return qty > 0 ? quote / qty : 0;
}

async function symbolsTouchedByBot(userId, environment) {
  const touched = new Set();
  const { data: orders } = await selectRows('real_orders', {
    select: 'symbol',
    filters: [eqFilter('user_id', userId), eqFilter('environment', environment), 'side=eq.BUY'],
    order: 'created_at.desc',
    limit: 100
  });
  for (const row of orders || []) {
    const symbol = String(row.symbol || '').toUpperCase();
    if (allowedSymbols.includes(symbol)) touched.add(symbol);
  }
  const { data: commands } = await selectRows('connector_commands', {
    select: 'payload,command_type,status',
    filters: [eqFilter('user_id', userId), eqFilter('command_type', 'EXECUTE_PROTECTED_SPOT_BUY')],
    order: 'created_at.desc',
    limit: 100
  });
  for (const command of commands || []) {
    const symbol = String(command.payload?.symbol || '').toUpperCase();
    if (allowedSymbols.includes(symbol)) touched.add(symbol);
  }
  return [...touched];
}

async function getBotProfileName(userId) {
  const { data } = await maybeSingle('bot_instances', {
    select: 'profile_name,updated_at,created_at',
    filters: [eqFilter('user_id', userId)],
    order: 'updated_at.desc,created_at.desc'
  });
  return normalizeProfileName(data?.profile_name || 'conservador');
}

async function activeBasketsForUser(userId, environment) {
  const { data, error } = await selectRows('real_baskets', {
    select: '*',
    filters: [eqFilter('user_id', userId), eqFilter('environment', environment), eqFilter('status', 'active')],
    order: 'opened_at.asc',
    limit: 20
  });
  if (error) {
    if (isSchemaCacheColumnError(error) || /real_baskets/i.test(error.message || '')) return [];
    throw new Error(error.message);
  }
  return Array.isArray(data) ? data : [];
}

async function activeBasketForSymbol(userId, environment, symbol) {
  const { data, error } = await maybeSingle('real_baskets', {
    select: '*',
    filters: [
      eqFilter('user_id', userId),
      eqFilter('environment', environment),
      eqFilter('symbol', symbol),
      eqFilter('status', 'active')
    ],
    order: 'opened_at.desc'
  });
  if (error) return null;
  return data || null;
}

async function createRealBasket({ userId, environment, symbol, profileName, accountUsdt }) {
  const rules = profileRules(profileName);
  const allocation = allocateBasketBudget({ accountUsdt, profileName });
  if (allocation.normalBudget < INITIAL_ENTRY_USDT) {
    throw new Error(`Saldo insuficiente para reservar a cesta. Minimo ${INITIAL_ENTRY_USDT.toFixed(2)} USDT.`);
  }
  const { data, error } = await insertRows('real_baskets', [{
    user_id: userId,
    environment,
    symbol,
    profile_name: rules.name,
    status: 'active',
    initial_order_usdt: INITIAL_ENTRY_USDT,
    target_net_pct: TARGET_NET_PCT,
    protection_gap_pct: rules.protectionGapPct,
    max_concurrent_baskets: rules.maxConcurrentBaskets,
    normal_budget_usdt: allocation.normalBudget,
    emergency_budget_usdt: allocation.emergencyBudget,
    last_buy_quote: INITIAL_ENTRY_USDT,
    metadata: {
      created_by: 'connector_v1_1',
      allocation_total_usdt: allocation.basketBudget
    }
  }]);
  if (error) throw new Error(`Falha ao criar cesta persistente: ${error.message}`);
  return Array.isArray(data) ? data[0] : data;
}

async function basketOrders(basketId) {
  const { data, error } = await selectRows('real_orders', {
    select: '*',
    filters: [eqFilter('basket_id', basketId)],
    order: 'created_at.asc',
    limit: 500
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

async function recoverBasketOrdersFromMetadata({ basket, apiKey, apiSecret, environment }) {
  const buy = basket.metadata?.buy_payload;
  const emergency = basket.metadata?.emergency_sell;
  if (!buy || !emergency?.orderId) return false;

  const executedQty = Number(buy.executedQty || 0);
  const quoteQty = Number(buy.cummulativeQuoteQty || 0);
  const avgPrice = executedQty > 0 ? quoteQty / executedQty : Number(basket.avg_price || 0);
  await insertBasketOrder({
    user_id: basket.user_id,
    environment,
    symbol: basket.symbol,
    basket_id: basket.id,
    profile_name: basket.profile_name,
    side: 'BUY',
    order_type: 'MARKET',
    status: String(buy.status || 'FILLED').toLowerCase(),
    protection_role: 'entry',
    timeframe: 'auto',
    client_order_id: String(buy.clientOrderId || buy.origClientOrderId || ''),
    binance_order_id: String(buy.orderId || ''),
    quote_order_qty: quoteQty,
    quantity: executedQty,
    price: avgPrice,
    executed_qty: executedQty,
    cummulative_quote_qty: quoteQty,
    reason: 'Entrada reconstruida depois de falha temporaria de auditoria.',
    raw_response: { ...buy, invcripto: { basket_id: basket.id, bucket: 'normal', recovered_from_metadata: true } }
  });

  const remoteSell = await signedGetOrder({
    apiKey,
    apiSecret,
    environment,
    symbol: basket.symbol,
    orderId: emergency.orderId
  });
  if (!remoteSell.ok) throw new Error(`Falha ao reconstruir venda emergencial: ${JSON.stringify(remoteSell.payload)}`);
  await insertBasketOrder({
    user_id: basket.user_id,
    environment,
    symbol: basket.symbol,
    basket_id: basket.id,
    profile_name: basket.profile_name,
    side: 'SELL',
    order_type: 'LIMIT',
    status: String(remoteSell.payload?.status || 'NEW').toLowerCase(),
    protection_role: 'take_profit',
    timeframe: 'auto',
    client_order_id: String(remoteSell.payload?.clientOrderId || emergency.clientOrderId || ''),
    binance_order_id: String(remoteSell.payload?.orderId || emergency.orderId),
    quantity: Number(remoteSell.payload?.origQty || emergency.quantity || 0),
    price: Number(remoteSell.payload?.price || emergency.price || 0),
    executed_qty: Number(remoteSell.payload?.executedQty || 0),
    cummulative_quote_qty: Number(remoteSell.payload?.cummulativeQuoteQty || 0),
    reason: 'Venda emergencial reconstruida depois de falha temporaria de auditoria.',
    raw_response: { ...remoteSell.payload, invcripto: { basket_id: basket.id, recovered_from_metadata: true } }
  });
  const {
    buy_payload,
    emergency_sell,
    audit_error,
    ...restMetadata
  } = basket.metadata || {};
  const cleanedMetadata = {
    ...restMetadata,
    manual_reconciliation_required: false,
    metadata_orders_recovered_at: new Date().toISOString()
  };
  await updateRows('real_baskets', { metadata: cleanedMetadata }, [eqFilter('id', basket.id)]).catch(() => null);
  return cleanedMetadata;
}

async function recoverUntrackedMetadataRows({ basket, existingOrders }) {
  const candidates = [
    basket.metadata?.untracked_take_profit?.row,
    ...(Array.isArray(basket.metadata?.untracked_order_list?.rows) ? basket.metadata.untracked_order_list.rows : [])
  ].filter(Boolean);
  if (!candidates.length) return false;

  const existingOrderIds = new Set((existingOrders || []).map(row => String(row.binance_order_id || '')).filter(Boolean));
  const existingClientIds = new Set((existingOrders || []).map(row => String(row.client_order_id || '')).filter(Boolean));
  const missing = candidates.filter(row => {
    const orderId = String(row.binance_order_id || '');
    const clientId = String(row.client_order_id || '');
    return !(orderId && existingOrderIds.has(orderId)) && !(clientId && existingClientIds.has(clientId));
  });
  if (missing.length) await insertBasketOrders(missing);

  const {
    untracked_take_profit,
    untracked_order_list,
    audit_error,
    ...restMetadata
  } = basket.metadata || {};
  const cleanedMetadata = {
    ...restMetadata,
    untracked_orders_recovered_at: new Date().toISOString()
  };
  await updateRows('real_baskets', { metadata: cleanedMetadata }, [eqFilter('id', basket.id)]).catch(() => null);
  return cleanedMetadata;
}

function botOpenOrdersForBasket(openOrdersPayload, basketOrderRows) {
  const ids = new Set(
    (basketOrderRows || [])
      .map(row => String(row.binance_order_id || ''))
      .filter(Boolean)
  );
  return (Array.isArray(openOrdersPayload) ? openOrdersPayload : [])
    .filter(order => ids.has(String(order.orderId || '')));
}

function pendingOrderReport(payload, side) {
  const reports = Array.isArray(payload?.orderReports) ? payload.orderReports : [];
  return reports.find(report => String(report.side || '').toUpperCase() === side) || null;
}

async function commissionRatesOrDefault({ apiKey, apiSecret, environment, symbol }) {
  const response = await signedCommissionRates({ apiKey, apiSecret, environment, symbol }).catch(() => null);
  return roundTripRates(response?.ok ? response.payload : null);
}

async function insertBasketOrders(rows) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // Cestas exigem o schema novo; nao aplicamos fallback que removeria basket_id.
    const result = await insertRows('real_orders', rows);
    if (!result.error) return Array.isArray(result.data) ? result.data : [result.data].filter(Boolean);
    lastError = result.error;
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 400));
  }
  throw new Error(lastError?.message || 'Falha ao registrar ordens da cesta.');
}

async function insertBasketOrder(row) {
  const rows = await insertBasketOrders([row]);
  return rows[0] || null;
}

async function placeEmergencyStandaloneSell({ basket, executedQty, costQuote, apiKey, apiSecret, environment, filters }) {
  const balanceResult = await freeAssetBalanceWithRetry({
    apiKey,
    apiSecret,
    environment,
    asset: filters.baseAsset,
    minimum: Math.max(filters.minQty, Number(executedQty || 0) * 0.995),
    attempts: 5
  });
  if (!balanceResult.ok) throw new Error(`Falha ao conferir saldo para venda emergencial: ${JSON.stringify(balanceResult.account?.payload)}`);
  const safeQty = floorToStep(Math.min(Number(executedQty || 0), Number(balanceResult.free || 0)), filters.stepSize);
  if (safeQty < filters.minQty) throw new Error('Quantidade insuficiente para venda emergencial.');
  const rates = await commissionRatesOrDefault({ apiKey, apiSecret, environment, symbol: basket.symbol });
  const target = ceilToStep(netTargetPrice({
    netCapitalUsdt: Number(costQuote || 0),
    quantity: safeQty,
    targetNetPct: Number(basket.target_net_pct || TARGET_NET_PCT),
    buyRate: rates.buyRate,
    sellRate: rates.sellRate
  }), filters.tickSize);
  const clientOrderId = `INVE${String(basket.id || '').replaceAll('-', '').slice(0, 12)}${Date.now().toString(36)}`.slice(0, 36);
  const sell = await signedOrder({
    apiKey,
    apiSecret,
    environment,
    params: {
      symbol: basket.symbol,
      side: 'SELL',
      type: 'LIMIT',
      timeInForce: 'GTC',
      quantity: formatDecimal(safeQty, filters.stepSize),
      price: formatDecimal(target, filters.tickSize),
      newClientOrderId: clientOrderId,
      newOrderRespType: 'FULL'
    }
  });
  if (!sell.ok) throw new Error(`Venda emergencial rejeitada: ${JSON.stringify(sell.payload)}`);
  return { orderId: sell.payload?.orderId, clientOrderId, quantity: safeQty, price: target };
}

async function handleValidateApi(command) {
  const environment = command.payload?.environment === 'testnet' ? 'testnet' : 'live';
  const credential = await getCredential(command.user_id, environment);
  const apiKey = decryptSecret(credential.api_key_encrypted);
  const apiSecret = decryptSecret(credential.api_secret_encrypted);
  const account = await signedAccount({ apiKey, apiSecret, environment });

  if (!account.ok) {
    throw new Error(`Binance rejeitou consulta: ${JSON.stringify(account.payload)}`);
  }

  const balances = Array.isArray(account.payload?.balances) ? account.payload.balances : [];
  const usdt = balances.find(item => item.asset === 'USDT') || { free: '0', locked: '0' };
  const canTrade = Boolean(account.payload?.canTrade);
  const canWithdraw = Boolean(account.payload?.canWithdraw);
  const permissions = Array.isArray(account.payload?.permissions) ? account.payload.permissions : [];
  const hasSpot = permissions.length ? permissions.includes('SPOT') : true;
  const credentialStatus = canTrade && hasSpot && !canWithdraw ? 'active' : 'review_required';

  await updateRows('binance_api_credentials', {
      can_read: true,
      can_trade: canTrade,
      can_withdraw: canWithdraw,
      status: credentialStatus,
      last_test_at: new Date().toISOString(),
      real_usdt_free: Number(usdt.free || 0),
      real_usdt_locked: Number(usdt.locked || 0)
    }, [eqFilter('id', credential.id)]);

  return {
    environment,
    canTrade,
    canWithdraw,
    hasSpot,
    credentialStatus,
    productionReady: credentialStatus === 'active',
    usdtFree: Number(usdt.free || 0),
    usdtLocked: Number(usdt.locked || 0)
  };
}

async function refreshCredentialBalance(credential, apiKey, apiSecret, environment) {
  const account = await signedAccount({ apiKey, apiSecret, environment });
  if (!account.ok) return null;
  const usdt = (account.payload?.balances || []).find(item => item.asset === 'USDT') || { free: '0', locked: '0' };
  await updateRows('binance_api_credentials', {
    real_usdt_free: Number(usdt.free || 0),
    real_usdt_locked: Number(usdt.locked || 0),
    last_test_at: new Date().toISOString()
  }, [eqFilter('id', credential.id)]);
  dashboard.lastUsdt = Number(usdt.free || 0);
  dashboard.lastSync = new Date().toLocaleString('pt-BR');
  return { free: Number(usdt.free || 0), locked: Number(usdt.locked || 0) };
}

function basketBucketUsage(orders) {
  let normalUsed = 0;
  let emergencyUsed = 0;
  for (const order of orders || []) {
    if (String(order.side || '').toUpperCase() !== 'BUY' || String(order.status || '').toLowerCase() !== 'filled') continue;
    const quote = Number(order.cummulative_quote_qty || order.quote_order_qty || 0);
    const bucket = String(order.raw_response?.invcripto?.bucket || 'normal');
    if (bucket === 'emergency') emergencyUsed += quote;
    else normalUsed += quote;
  }
  return { normalUsed, emergencyUsed };
}

async function placeBasketTakeProfit({ basket, summary, orders, credential, apiKey, apiSecret, environment, filters, command = null }) {
  // Nunca usa o saldo total da moeda como tamanho da venda. O limite superior
  // vem exclusivamente das compras rastreadas nesta cesta; o saldo livre da
  // Binance serve apenas para descontar comissao cobrada no ativo-base.
  const botOwnedOpenQty = Math.max(0, Number(summary.openQty || 0));
  const balanceResult = await freeAssetBalanceWithRetry({
    apiKey,
    apiSecret,
    environment,
    asset: filters.baseAsset,
    minimum: Math.max(filters.minQty, botOwnedOpenQty * 0.995),
    attempts: 5
  });
  if (!balanceResult.ok) throw new Error(`Falha ao conferir saldo-base antes da venda: ${JSON.stringify(balanceResult.account?.payload)}`);
  const freeBaseQty = Math.max(0, Number(balanceResult.free || 0));
  const openQty = floorToStep(Math.min(botOwnedOpenQty, freeBaseQty), filters.stepSize);
  if (openQty < filters.minQty) {
    await log('warn', 'basket_take_profit_waiting_balance', `Quantidade livre insuficiente para proteger ${basket.symbol}.`, {
      basketId: basket.id,
      botOwnedOpenQty,
      freeBaseQty,
      minQty: filters.minQty
    }, command || { user_id: basket.user_id });
    throw new Error(`Quantidade livre insuficiente para criar a venda da cesta ${basket.symbol}.`);
  }
  const { buyRate, sellRate } = await commissionRatesOrDefault({ apiKey, apiSecret, environment, symbol: basket.symbol });
  const rawTarget = netTargetPrice({
    netCapitalUsdt: Math.max(0, summary.netCapital),
    quantity: openQty,
    targetNetPct: Number(basket.target_net_pct || TARGET_NET_PCT),
    buyRate,
    sellRate
  });
  const sellPrice = ceilToStep(rawTarget, filters.tickSize);
  if (!sellPrice || openQty * sellPrice < filters.minNotional) return null;

  const token = String(basket.id || '').replaceAll('-', '').slice(0, 12);
  const clientOrderId = `INVB${token}S${Date.now().toString(36)}`.slice(0, 36);
  const sell = await signedOrder({
    apiKey,
    apiSecret,
    environment,
    params: {
      symbol: basket.symbol,
      side: 'SELL',
      type: 'LIMIT',
      timeInForce: 'GTC',
      quantity: formatDecimal(openQty, filters.stepSize),
      price: formatDecimal(sellPrice, filters.tickSize),
      newClientOrderId: clientOrderId,
      newOrderRespType: 'FULL'
    }
  });
  if (!sell.ok) throw new Error(`Venda da cesta rejeitada pela Binance: ${JSON.stringify(sell.payload)}`);

  const sellRow = {
    user_id: basket.user_id,
    environment,
    symbol: basket.symbol,
    basket_id: basket.id,
    profile_name: basket.profile_name,
    side: 'SELL',
    order_type: 'LIMIT',
    status: String(sell.payload?.status || 'NEW').toLowerCase(),
    protection_role: 'take_profit',
    timeframe: 'auto',
    client_order_id: clientOrderId,
    binance_order_id: String(sell.payload?.orderId || ''),
    quantity: openQty,
    price: sellPrice,
    reason: `Venda consolidada da cesta com meta liquida de ${Number(basket.target_net_pct || TARGET_NET_PCT).toFixed(2)}%.`,
    raw_response: {
      ...sell.payload,
      invcripto: { basket_id: basket.id, target_net_pct: Number(basket.target_net_pct || TARGET_NET_PCT), buyRate, sellRate }
    }
  };
  try {
    await insertBasketOrder(sellRow);
  } catch (auditError) {
    await updateRows('real_baskets', {
      metadata: {
        ...(basket.metadata || {}),
        untracked_take_profit: { row: sellRow, saved_at: new Date().toISOString() },
        audit_error: String(auditError?.message || auditError)
      }
    }, [eqFilter('id', basket.id)]).catch(() => null);
    throw auditError;
  }

  await updateRows('real_baskets', {
    current_take_profit_price: sellPrice,
    open_qty: openQty,
    avg_price: summary.avgBuyPrice,
    total_buy_quote: summary.buyQuote,
    total_sell_quote: summary.sellQuote,
    total_bought_qty: summary.boughtQty,
    total_sold_qty: summary.soldQty,
    last_buy_price: summary.lastBuyPrice,
    last_buy_quote: summary.lastBuyQuote,
    recovery_level: summary.recoveryLevel
  }, [eqFilter('id', basket.id)]);
  await log('info', 'basket_take_profit_created', `Venda da cesta ${basket.symbol} posicionada na Binance.`, { basketId: basket.id, openQty, sellPrice }, command || { user_id: basket.user_id });
  return { sellOrderId: sell.payload?.orderId, sellPrice, sellQty: openQty };
}

async function cancelOpenProtectionOrderList({ basket, activeProtection, orders, apiKey, apiSecret, environment }) {
  const listId = String(activeProtection?.order_list_id || '');
  let response;
  if (listId) {
    response = await signedCancelOrderList({
      apiKey,
      apiSecret,
      environment,
      symbol: basket.symbol,
      orderListId: listId
    });
  } else {
    response = await signedCancelOrder({
      apiKey,
      apiSecret,
      environment,
      symbol: basket.symbol,
      orderId: activeProtection.binance_order_id
    });
  }
  if (!response.ok && ![-2011, -2026].includes(Number(response.payload?.code))) {
    throw new Error(`Falha ao reposicionar protecao antiga: ${JSON.stringify(response.payload)}`);
  }
  if (listId) {
    for (const row of (orders || []).filter(item => String(item.order_list_id || '') === listId)) {
      await updateRows('real_orders', {
        status: 'canceled',
        raw_response: {
          ...(row.raw_response || {}),
          cancel_response: response.payload,
          invcripto: {
            ...(row.raw_response?.invcripto || {}),
            canceled_for_lower_support: true,
            canceled_at: new Date().toISOString()
          }
        }
      }, [eqFilter('id', row.id)]).catch(() => null);
    }
  } else if (activeProtection?.id) {
    await updateRows('real_orders', {
      status: 'canceled',
      raw_response: {
        ...(activeProtection.raw_response || {}),
        cancel_response: response.payload,
        invcripto: {
          ...(activeProtection.raw_response?.invcripto || {}),
          canceled_for_lower_support: true,
          canceled_at: new Date().toISOString()
        }
      }
    }, [eqFilter('id', activeProtection.id)]).catch(() => null);
  }
  return response;
}

async function placeNextOfflineProtection({ basket, orders, credential, apiKey, apiSecret, environment, filters, command = null }) {
  const usage = basketBucketUsage(orders);
  const normalRemaining = Math.max(0, Number(basket.normal_budget_usdt || 0) - usage.normalUsed);
  const emergencyRemaining = Math.max(0, Number(basket.emergency_budget_usdt || 0) - usage.emergencyUsed);
  const rules = profileRules(basket.profile_name);
  const next = nextProtectionQuote({
    lastQuote: Number(basket.last_buy_quote || INITIAL_ENTRY_USDT),
    normalRemaining,
    emergencyRemaining,
    minimumOrder: Math.max(INITIAL_ENTRY_USDT, filters.minNotional * 1.02),
    growthFactor: Number(rules.handGrowthFactor || 1.35)
  });
  if (!next.quote) {
    await updateRows('real_baskets', {
      next_protection_price: null,
      next_protection_quote: null,
      next_protection_bucket: null,
      normal_used_usdt: usage.normalUsed,
      emergency_used_usdt: usage.emergencyUsed
    }, [eqFilter('id', basket.id)]);
    return { skipped: true, reason: 'basket_budget_exhausted' };
  }

  const basePrice = Number(basket.last_buy_price || 0);
  if (!basePrice) return { skipped: true, reason: 'missing_last_buy_price' };
  const marketInterval = 'MTF';
  const marketTimeframes = await closedMultiTimeframeCandles(basket.symbol);
  const liveTicker = await ticker(basket.symbol).catch(() => null);
  const currentPrice = Number(liveTicker?.payload?.lastPrice || marketTimeframes['1m']?.at(-1)?.close || 0);
  const supportPlan = supportAwareProtectionPriceMtf({
    timeframes: marketTimeframes,
    lastBuyPrice: basePrice,
    gapPct: Number(basket.protection_gap_pct || rules.protectionGapPct),
    emergency: next.emergency,
    entryBufferPct: next.emergency ? 0.03 : 0.08,
    currentPrice,
    profileName: basket.profile_name
  });
  const activeProtection = (orders || []).find(order =>
    String(order.side || '').toUpperCase() === 'BUY' &&
    String(order.protection_role || '') === 'protection_buy' &&
    ['new', 'open', 'pending_new', 'partially_filled'].includes(String(order.status || '').toLowerCase())
  );
  if (!supportPlan.price || !supportPlan.support) {
    if (activeProtection && ['risk_off_protection_paused', 'emergency_reserve_waiting_m5_reversal'].includes(String(supportPlan.reason || ''))) {
      await cancelOpenProtectionOrderList({ basket, activeProtection, orders, apiKey, apiSecret, environment }).catch(() => null);
      await log('warn', 'offline_protection_paused_by_mtf', `Protecao de ${basket.symbol} pausada pela leitura H4/H1/M15.`, {
        basketId: basket.id,
        reason: supportPlan.reason,
        currentPrice
      }, command || { user_id: basket.user_id });
    }
    await updateRows('real_baskets', {
      next_protection_price: null,
      next_protection_quote: next.quote,
      next_protection_bucket: next.bucket,
      metadata: {
        ...(basket.metadata || {}),
        protection_waiting_for_support: {
          reason: supportPlan.reason,
          triggerPrice: supportPlan.triggerPrice,
          currentPrice,
          interval: marketInterval,
          checkedAt: new Date().toISOString()
        }
      }
    }, [eqFilter('id', basket.id)]).catch(() => null);
    return { skipped: true, reason: supportPlan.reason, triggerPrice: supportPlan.triggerPrice };
  }

  const protectionPrice = floorToStep(supportPlan.price, filters.tickSize);
  if (!protectionPrice || protectionPrice >= basePrice) {
    return { skipped: true, reason: 'invalid_support_protection_price', protectionPrice, basePrice };
  }

  if (activeProtection) {
    const activePrice = Number(activeProtection.price || 0);
    const partiallyFilled = Number(activeProtection.executed_qty || 0) > 0
      || String(activeProtection.status || '').toLowerCase() === 'partially_filled';
    // Nunca movemos uma protecao para cima. Reposicionamos somente quando o
    // suporte novo exige uma compra materialmente mais baixa.
    if (partiallyFilled || activePrice <= protectionPrice * 1.0012) {
      return {
        skipped: true,
        reason: 'protection_already_open_at_support_or_lower',
        orderId: activeProtection.binance_order_id,
        activePrice,
        desiredPrice: protectionPrice,
        support: supportPlan.support
      };
    }
    await cancelOpenProtectionOrderList({
      basket,
      activeProtection,
      orders,
      apiKey,
      apiSecret,
      environment
    });
    await log('info', 'offline_protection_repriced', `Protecao de ${basket.symbol} foi movida para suporte mais baixo.`, {
      basketId: basket.id,
      oldPrice: activePrice,
      newPrice: protectionPrice,
      support: supportPlan.support,
      triggerPrice: supportPlan.triggerPrice
    }, command || { user_id: basket.user_id });
  }

  const quantity = floorToStep(next.quote / protectionPrice, filters.stepSize);
  if (quantity < filters.minQty || quantity * protectionPrice < filters.minNotional) {
    return { skipped: true, reason: 'protection_below_binance_minimum', quantity, protectionPrice };
  }

  const rates = await commissionRatesOrDefault({ apiKey, apiSecret, environment, symbol: basket.symbol });
  const handTargetRaw = netTargetPrice({
    netCapitalUsdt: next.quote,
    quantity,
    targetNetPct: Number(basket.target_net_pct || TARGET_NET_PCT),
    buyRate: rates.buyRate,
    sellRate: rates.sellRate
  });
  const handTargetPrice = ceilToStep(handTargetRaw, filters.tickSize);
  const token = String(basket.id || '').replaceAll('-', '').slice(0, 10);
  const nonce = Date.now().toString(36).slice(-7);
  const listClientOrderId = `INVOP${token}${nonce}`.slice(0, 36);
  const buyClientOrderId = `INVPB${token}${nonce}`.slice(0, 36);
  const sellClientOrderId = `INVPS${token}${nonce}`.slice(0, 36);

  let orderList = await signedOpoOrderList({
    apiKey,
    apiSecret,
    environment,
    params: {
      symbol: basket.symbol,
      listClientOrderId,
      workingType: 'LIMIT',
      workingSide: 'BUY',
      workingClientOrderId: buyClientOrderId,
      workingPrice: formatDecimal(protectionPrice, filters.tickSize),
      workingQuantity: formatDecimal(quantity, filters.stepSize),
      workingTimeInForce: 'GTC',
      pendingType: 'LIMIT',
      pendingSide: 'SELL',
      pendingClientOrderId: sellClientOrderId,
      pendingPrice: formatDecimal(handTargetPrice, filters.tickSize),
      pendingTimeInForce: 'GTC',
      newOrderRespType: 'FULL'
    }
  });
  let listType = 'OPO';
  if (!orderList.ok) {
    orderList = await signedOtoOrderList({
      apiKey,
      apiSecret,
      environment,
      params: {
        symbol: basket.symbol,
        listClientOrderId,
        workingType: 'LIMIT',
        workingSide: 'BUY',
        workingClientOrderId: buyClientOrderId,
        workingPrice: formatDecimal(protectionPrice, filters.tickSize),
        workingQuantity: formatDecimal(quantity, filters.stepSize),
        workingTimeInForce: 'GTC',
        pendingType: 'LIMIT',
        pendingSide: 'SELL',
        pendingClientOrderId: sellClientOrderId,
        pendingPrice: formatDecimal(handTargetPrice, filters.tickSize),
        pendingQuantity: formatDecimal(
          floorToStep(quantity * Math.max(0.995, 1 - rates.buyRate - 0.0002), filters.stepSize),
          filters.stepSize
        ),
        pendingTimeInForce: 'GTC',
        newOrderRespType: 'FULL'
      }
    });
    listType = 'OTO';
  }
  if (!orderList.ok) {
    throw new Error(`Protecao offline rejeitada pela Binance: ${JSON.stringify(orderList.payload)}`);
  }

  const buyReport = pendingOrderReport(orderList.payload, 'BUY') || orderList.payload?.orderReports?.[0] || {};
  const sellReport = pendingOrderReport(orderList.payload, 'SELL') || orderList.payload?.orderReports?.[1] || {};
  const orderListId = String(orderList.payload?.orderListId ?? '');
  const commonMeta = {
    basket_id: basket.id,
    bucket: next.bucket,
    list_type: listType,
    quote_planned: next.quote,
    rates,
    support: supportPlan.support,
    trigger_price: supportPlan.triggerPrice,
    current_price_when_planned: currentPrice,
    market_interval: marketInterval,
    support_reason: supportPlan.reason
  };

  const protectionRows = [{
    user_id: basket.user_id,
    environment,
    symbol: basket.symbol,
    basket_id: basket.id,
    order_list_id: orderListId,
    profile_name: basket.profile_name,
    side: 'BUY',
    order_type: 'LIMIT',
    status: String(buyReport.status || 'NEW').toLowerCase(),
    protection_role: 'protection_buy',
    timeframe: marketInterval,
    client_order_id: String(buyReport.clientOrderId || buyClientOrderId),
    binance_order_id: String(buyReport.orderId || orderList.payload?.orders?.[0]?.orderId || ''),
    quote_order_qty: next.quote,
    quantity,
    price: protectionPrice,
    executed_qty: Number(buyReport.executedQty || 0),
    cummulative_quote_qty: Number(buyReport.cummulativeQuoteQty || 0),
    reason: `Protecao ${next.bucket}: intervalo minimo ${Number(basket.protection_gap_pct || 0).toFixed(2)}%, posicionada no suporte ${Number(supportPlan.support).toFixed(8)}.`,
    raw_response: { ...buyReport, invcripto: commonMeta }
  }, {
    user_id: basket.user_id,
    environment,
    symbol: basket.symbol,
    basket_id: basket.id,
    order_list_id: orderListId,
    profile_name: basket.profile_name,
    side: 'SELL',
    order_type: 'LIMIT',
    status: String(sellReport.status || 'PENDING_NEW').toLowerCase(),
    protection_role: 'protection_hand_take_profit',
    timeframe: marketInterval,
    client_order_id: String(sellReport.clientOrderId || sellClientOrderId),
    binance_order_id: String(sellReport.orderId || orderList.payload?.orders?.[1]?.orderId || ''),
    quantity: listType === 'OTO'
      ? floorToStep(quantity * Math.max(0.995, 1 - rates.buyRate - 0.0002), filters.stepSize)
      : quantity,
    price: handTargetPrice,
    reason: 'Venda automatica da nova mao, ativada pela Binance mesmo sem internet local.',
    raw_response: { ...sellReport, invcripto: commonMeta }
  }];
  try {
    await insertBasketOrders(protectionRows);
  } catch (auditError) {
    await updateRows('real_baskets', {
      metadata: {
        ...(basket.metadata || {}),
        untracked_order_list: { rows: protectionRows, payload: orderList.payload, saved_at: new Date().toISOString() },
        audit_error: String(auditError?.message || auditError)
      }
    }, [eqFilter('id', basket.id)]).catch(() => null);
    throw auditError;
  }

  await updateRows('real_baskets', {
    next_protection_price: protectionPrice,
    next_protection_quote: next.quote,
    next_protection_bucket: next.bucket,
    normal_used_usdt: usage.normalUsed,
    emergency_used_usdt: usage.emergencyUsed,
    metadata: {
      ...(basket.metadata || {}),
      next_support_plan: {
        support: supportPlan.support,
        triggerPrice: supportPlan.triggerPrice,
        protectionPrice,
        currentPrice,
        interval: marketInterval,
        reason: supportPlan.reason,
        plannedAt: new Date().toISOString()
      },
      last_offline_protection: {
        listType,
        orderListId,
        buyOrderId: buyReport.orderId || orderList.payload?.orders?.[0]?.orderId,
        sellOrderId: sellReport.orderId || orderList.payload?.orders?.[1]?.orderId,
        createdAt: new Date().toISOString()
      }
    }
  }, [eqFilter('id', basket.id)]);
  await log('info', 'offline_protection_created', `Proxima protecao de ${basket.symbol} ficou posicionada no suporte da Binance.`, {
    basketId: basket.id,
    listType,
    protectionPrice,
    support: supportPlan.support,
    triggerPrice: supportPlan.triggerPrice,
    quote: next.quote,
    bucket: next.bucket,
    handTargetPrice,
    marketInterval
  }, command || { user_id: basket.user_id });
  return {
    listType,
    orderListId,
    protectionPrice,
    support: supportPlan.support,
    triggerPrice: supportPlan.triggerPrice,
    quote: next.quote,
    bucket: next.bucket,
    handTargetPrice,
    marketInterval
  };
}

async function handleProtectedSpotBuy(command) {
  const payload = command.payload || {};
  const environment = payload.environment === 'testnet' ? 'testnet' : 'live';
  const symbol = String(payload.symbol || 'BTCUSDT').toUpperCase();
  const timeframe = String(payload.timeframe || '5m');
  const reason = String(payload.reason || 'Entrada protegida INVCRIPTO');
  if (!allowedSymbols.includes(symbol)) throw new Error(`Par ${symbol} nao autorizado.`);

  const credential = await getCredential(command.user_id, environment);
  const apiKey = decryptSecret(credential.api_key_encrypted);
  const apiSecret = decryptSecret(credential.api_secret_encrypted);
  const account = await signedAccount({ apiKey, apiSecret, environment });
  if (!account.ok) throw new Error(`Binance rejeitou conta: ${JSON.stringify(account.payload)}`);
  if (!account.payload?.canTrade) throw new Error('API Binance esta sem permissao de trading.');

  const filters = await exchangeInfo(symbol, environment);
  if (filters.status !== 'TRADING') throw new Error(`Par ${symbol} nao esta liberado para trading.`);

  const profileName = normalizeProfileName(payload.profileName || await getBotProfileName(command.user_id));
  const rules = profileRules(profileName);
  const existing = await activeBasketForSymbol(command.user_id, environment, symbol);
  if (existing) {
    const orders = await basketOrders(existing.id).catch(() => []);
    const protection = await placeNextOfflineProtection({ basket: existing, orders, credential, apiKey, apiSecret, environment, filters, command }).catch(error => ({ error: String(error?.message || error) }));
    await refreshCredentialBalance(credential, apiKey, apiSecret, environment).catch(() => null);
    return {
      environment,
      symbol,
      skipped: true,
      reason: 'active_basket_managed_by_connector',
      basketId: existing.id,
      profileName,
      protection,
      protected: true,
      message: `Cesta ativa em ${symbol}. As protecoes sao administradas diretamente pelo conector e pela Binance.`
    };
  }

  const activeBaskets = await activeBasketsForUser(command.user_id, environment);
  if (activeBaskets.length >= rules.maxConcurrentBaskets) {
    return {
      environment,
      symbol,
      skipped: true,
      reason: 'max_concurrent_baskets',
      profileName,
      maxConcurrentBaskets: rules.maxConcurrentBaskets,
      message: profileName === 'alavancagem'
        ? `Limite de ${rules.maxConcurrentBaskets} cestas simultaneas atingido.`
        : `O perfil ${profileName} opera somente uma moeda por vez.`
    };
  }

  const usdt = (account.payload?.balances || []).find(item => item.asset === 'USDT') || { free: '0', locked: '0' };
  const availableUsdt = Number(usdt.free || 0);
  const accountUsdt = availableUsdt + Number(usdt.locked || 0);
  const quoteOrderQty = INITIAL_ENTRY_USDT;
  if (availableUsdt < quoteOrderQty) {
    throw new Error(`Saldo USDT insuficiente. Necessario ${quoteOrderQty.toFixed(2)} USDT, disponivel ${availableUsdt.toFixed(8)} USDT.`);
  }

  // Revalida a oportunidade no conector imediatamente antes da ordem. O
  // navegador pode estar com alguns segundos de atraso; a Binance não recebe
  // compra se o preço já saiu da zona de suporte ou encostou na resistência.
  const marketContextFromPanel = payload.marketContext && typeof payload.marketContext === 'object'
    ? payload.marketContext
    : {};
  const entryTimeframes = await closedMultiTimeframeCandles(symbol);
  const liveTicker = await ticker(symbol);
  if (!liveTicker.ok) throw new Error(`Falha ao confirmar preco atual de ${symbol}: ${JSON.stringify(liveTicker.payload)}`);
  const currentPrice = Number(liveTicker.payload?.lastPrice || entryTimeframes['1m']?.at(-1)?.close || 0);
  const liveEntry = multiTimeframeEntryContext(entryTimeframes, {
    currentPrice,
    profileName
  });
  const panelMaxEntry = Number(marketContextFromPanel.maxEntryPrice || 0);
  const liveMaxEntry = Number(liveEntry.maxEntryPrice || 0);
  const entryCeiling = Math.min(
    liveMaxEntry || Number.POSITIVE_INFINITY,
    panelMaxEntry || Number.POSITIVE_INFINITY
  );
  const resistanceRoom = Math.min(
    Number(liveEntry.distanceToResistancePct || 0),
    Number(marketContextFromPanel.distanceToResistancePct || liveEntry.distanceToResistancePct || 0)
  );
  const requiredRoom = Math.max(
    Number(liveEntry.requiredRoomPct || 0),
    Number(marketContextFromPanel.requiredRoomPct || 0)
  );
  if (!liveEntry.valid || !liveEntry.mtfConfirmed || liveEntry.riskOff || !Number.isFinite(entryCeiling) || currentPrice > entryCeiling || resistanceRoom < requiredRoom) {
    return {
      environment,
      symbol,
      skipped: true,
      reason: liveEntry.reason || 'entry_outside_support_zone',
      currentPrice,
      support: liveEntry.support,
      maxEntryPrice: Number.isFinite(entryCeiling) ? entryCeiling : liveMaxEntry,
      resistance: liveEntry.resistance,
      distanceToResistancePct: resistanceRoom,
      requiredRoomPct: requiredRoom,
      message: 'Compra cancelada antes de chegar à Binance: H4/H1/M15/M5/M1 não confirmaram, o preço saiu do suporte ou a resistência ficou próxima.'
    };
  }

  let basket = await createRealBasket({ userId: command.user_id, environment, symbol, profileName, accountUsdt });
  basket = {
    ...basket,
    metadata: {
      ...(basket.metadata || {}),
      entry_market_context: {
        panel: marketContextFromPanel,
        connector: liveEntry,
        currentPrice,
        entryCeiling,
        checkedAt: new Date().toISOString()
      }
    }
  };
  await updateRows('real_baskets', { metadata: basket.metadata }, [eqFilter('id', basket.id)]).catch(() => null);

  const buyLimitPrice = floorToStep(entryCeiling, filters.tickSize);
  const buyQuantity = floorToStep(quoteOrderQty / buyLimitPrice, filters.stepSize);
  if (buyQuantity < filters.minQty || buyQuantity * buyLimitPrice < filters.minNotional) {
    await updateRows('real_baskets', {
      status: 'error',
      metadata: { ...(basket.metadata || {}), entry_error: 'below_binance_minimum', buyLimitPrice, buyQuantity }
    }, [eqFilter('id', basket.id)]).catch(() => null);
    throw new Error('Entrada de US$ 10 ficou abaixo do mínimo permitido pela Binance após o arredondamento.');
  }

  const compactId = command.id.replaceAll('-', '');
  const buyClientOrderId = `INVBUY_${compactId.slice(0, 24)}`;
  const buy = await signedOrder({
    apiKey,
    apiSecret,
    environment,
    params: {
      symbol,
      side: 'BUY',
      type: 'LIMIT',
      timeInForce: 'FOK',
      quantity: formatDecimal(buyQuantity, filters.stepSize),
      price: formatDecimal(buyLimitPrice, filters.tickSize),
      newClientOrderId: buyClientOrderId,
      newOrderRespType: 'FULL'
    }
  });
  const buyStatus = String(buy.payload?.status || '').toUpperCase();
  if (!buy.ok || buyStatus !== 'FILLED') {
    await updateRows('real_baskets', {
      status: 'closed',
      closed_at: new Date().toISOString(),
      metadata: {
        ...(basket.metadata || {}),
        entry_not_filled: true,
        buy_error: buy.payload,
        buyLimitPrice,
        currentPrice
      }
    }, [eqFilter('id', basket.id)]).catch(() => null);
    return {
      environment,
      symbol,
      skipped: true,
      reason: 'support_limit_not_filled',
      currentPrice,
      buyLimitPrice,
      message: 'A compra limitada ao suporte não encontrou execução completa e foi cancelada sem perseguir o preço.'
    };
  }

  const executedQty = Number(buy.payload?.executedQty || 0);
  const cummulativeQuoteQty = Number(buy.payload?.cummulativeQuoteQty || (executedQty * buyLimitPrice));
  const avgPrice = executedQty > 0 ? cummulativeQuoteQty / executedQty : 0;
  try {
    await insertBasketOrder({
      user_id: command.user_id,
      environment,
      symbol,
      basket_id: basket.id,
      profile_name: profileName,
      side: 'BUY',
      order_type: 'LIMIT',
      status: String(buy.payload?.status || 'FILLED').toLowerCase(),
      protection_role: 'entry',
      timeframe,
      client_order_id: buyClientOrderId,
      binance_order_id: String(buy.payload?.orderId || ''),
      quote_order_qty: cummulativeQuoteQty,
      quantity: executedQty,
      price: avgPrice,
      executed_qty: executedQty,
      cummulative_quote_qty: cummulativeQuoteQty,
      reason,
      raw_response: { ...buy.payload, invcripto: {
        basket_id: basket.id,
        bucket: 'normal',
        profile_name: profileName,
        support: liveEntry.support,
        max_entry_price: entryCeiling,
        resistance: liveEntry.resistance,
        current_price_before_order: currentPrice,
        support_entry_capped: true
      } }
    });
  } catch (auditError) {
    // A compra ja aconteceu na Binance. Mesmo sem conseguir gravar no banco,
    // posicionamos uma venda GTC para nunca deixar a moeda sem saida.
    const emergencySell = await placeEmergencyStandaloneSell({
      basket,
      executedQty,
      costQuote: cummulativeQuoteQty,
      apiKey,
      apiSecret,
      environment,
      filters
    });
    await updateRows('real_baskets', {
      status: 'active',
      metadata: {
        ...(basket.metadata || {}),
        manual_reconciliation_required: true,
        audit_error: String(auditError?.message || auditError),
        emergency_sell: emergencySell,
        buy_payload: buy.payload
      }
    }, [eqFilter('id', basket.id)]).catch(() => null);
    throw new Error(`Compra executada, mas o registro no Supabase falhou. Venda emergencial ${emergencySell.orderId} ficou posicionada na Binance.`);
  }

  basket = {
    ...basket,
    last_buy_price: avgPrice,
    last_buy_quote: cummulativeQuoteQty,
    normal_used_usdt: cummulativeQuoteQty,
    total_buy_quote: cummulativeQuoteQty,
    total_bought_qty: executedQty,
    open_qty: executedQty,
    avg_price: avgPrice,
    recovery_level: 1
  };
  await updateRows('real_baskets', {
    last_buy_price: avgPrice,
    last_buy_quote: cummulativeQuoteQty,
    normal_used_usdt: cummulativeQuoteQty,
    total_buy_quote: cummulativeQuoteQty,
    total_bought_qty: executedQty,
    open_qty: executedQty,
    avg_price: avgPrice,
    recovery_level: 1
  }, [eqFilter('id', basket.id)]);

  const ordersAfterBuy = await basketOrders(basket.id);
  const summary = summarizeBasketOrders(ordersAfterBuy);
  const takeProfit = await placeBasketTakeProfit({ basket, summary, orders: ordersAfterBuy, credential, apiKey, apiSecret, environment, filters, command });
  const refreshedBasket = { ...basket, current_take_profit_price: takeProfit?.sellPrice || null };
  const ordersAfterSell = await basketOrders(basket.id);
  const protection = await placeNextOfflineProtection({ basket: refreshedBasket, orders: ordersAfterSell, credential, apiKey, apiSecret, environment, filters, command });
  const refreshed = await refreshCredentialBalance(credential, apiKey, apiSecret, environment).catch(() => null);

  dashboard.lastProtectedOrder = `${symbol} SUPORTE BUY ${avgPrice || buyLimitPrice} -> SELL ${takeProfit?.sellPrice || '-'} | PROTECAO ${protection?.protectionPrice || '-'}`;
  dashboard.lastUsdt = refreshed?.free ?? Math.max(0, availableUsdt - quoteOrderQty);
  dashboard.lastSync = new Date().toLocaleString('pt-BR');

  return {
    environment,
    symbol,
    basketId: basket.id,
    profileName,
    protectionGapPct: rules.protectionGapPct,
    maxConcurrentBaskets: rules.maxConcurrentBaskets,
    quoteOrderQty: cummulativeQuoteQty,
    requestedQuoteOrderQty: quoteOrderQty,
    buyLimitPrice,
    support: liveEntry.support,
    maxEntryPrice: entryCeiling,
    buyOrderId: buy.payload?.orderId,
    executedQty,
    avgPrice,
    sellOrderId: takeProfit?.sellOrderId,
    sellPrice: takeProfit?.sellPrice,
    offlineProtection: protection,
    normalBudgetUsdt: Number(basket.normal_budget_usdt || 0),
    emergencyBudgetUsdt: Number(basket.emergency_budget_usdt || 0),
    targetNetPct: Number(basket.target_net_pct || TARGET_NET_PCT),
    protected: true
  };
}

async function monitorProtectedSells() {
  const { data: sellOrders, error } = await selectRows('real_orders', {
    select: '*',
    filters: ['side=eq.SELL', 'status=in.(new,open,partially_filled)'],
    order: 'created_at.asc',
    limit: 20
  });
  if (error) {
    await log('warn', 'monitor_real_orders_skip', `Monitor de ordens reais aguardando schema: ${error.message}`);
    return;
  }
  for (const sellOrder of sellOrders || []) {
    if (sellOrder.basket_id) continue;
    try {
      const environment = sellOrder.environment === 'testnet' ? 'testnet' : 'live';
      const credential = await getCredential(sellOrder.user_id, environment);
      const apiKey = decryptSecret(credential.api_key_encrypted);
      const apiSecret = decryptSecret(credential.api_secret_encrypted);
      const remote = await signedGetOrder({
        apiKey,
        apiSecret,
        environment,
        symbol: sellOrder.symbol,
        orderId: sellOrder.binance_order_id
      });
      if (!remote.ok) throw new Error(`Consulta ordem Binance falhou: ${JSON.stringify(remote.payload)}`);
      const status = String(remote.payload?.status || sellOrder.status || '').toLowerCase();
      const executedQty = Number(remote.payload?.executedQty || sellOrder.executed_qty || 0);
      const quoteFilled = Number(remote.payload?.cummulativeQuoteQty || 0);
      await updateRows('real_orders', {
        status,
        executed_qty: executedQty,
        cummulative_quote_qty: quoteFilled,
        raw_response: remote.payload
      }, [eqFilter('id', sellOrder.id)]);

      if (status !== 'filled') continue;
      let entry = null;
      if (sellOrder.linked_order_id) {
        const found = await maybeSingle('real_orders', { filters: [eqFilter('id', sellOrder.linked_order_id)] });
        entry = found.data;
      }
      const cost = Number(entry?.cummulative_quote_qty || entry?.quote_order_qty || 0);
      const profitUsdt = quoteFilled - cost;
      const feeEnv = Math.max(0, profitUsdt * 0.10);
      if (profitUsdt > 0) {
        const wallet = await maybeSingle('inv_wallets', { filters: [eqFilter('user_id', sellOrder.user_id)] });
        const currentEnv = Number(wallet.data?.balance_inv || 0);
        await insertRows('profit_events', [{
          user_id: sellOrder.user_id,
          symbol: sellOrder.symbol,
          profit_usdt: profitUsdt,
          profit_brl: profitUsdt,
          fee_percent: 10,
          fee_inv: feeEnv,
          inv_charged: true
        }]);
        await updateRows('inv_wallets', {
          balance_inv: Math.max(0, currentEnv - feeEnv)
        }, [eqFilter('user_id', sellOrder.user_id)]).catch(() => null);
      }
      dashboard.lastMessage = `Venda fechada ${sellOrder.symbol}: lucro ${profitUsdt.toFixed(4)} USDT`;
      dashboard.lastSync = new Date().toLocaleString('pt-BR');
      pushEvent('info', 'real_order_closed', dashboard.lastMessage);
    } catch (error) {
      await log('warn', 'monitor_real_order_error', String(error?.message || error), { orderId: sellOrder.id });
    }
  }
}

async function refreshBasketRemoteOrders({ basket, orders, apiKey, apiSecret, environment }) {
  for (const order of orders || []) {
    const currentStatus = String(order.status || '').toLowerCase();
    if (!order.binance_order_id || ['filled', 'canceled', 'cancelled', 'rejected', 'expired'].includes(currentStatus)) continue;
    const remote = await signedGetOrder({
      apiKey,
      apiSecret,
      environment,
      symbol: basket.symbol,
      orderId: order.binance_order_id
    }).catch(() => null);
    if (!remote?.ok) continue;
    const status = String(remote.payload?.status || currentStatus).toLowerCase();
    const executedQty = Number(remote.payload?.executedQty || order.executed_qty || 0);
    const quoteFilled = Number(remote.payload?.cummulativeQuoteQty || order.cummulative_quote_qty || 0);
    await updateRows('real_orders', {
      status,
      executed_qty: executedQty,
      cummulative_quote_qty: quoteFilled,
      raw_response: {
        ...remote.payload,
        invcripto: order.raw_response?.invcripto || { basket_id: basket.id }
      }
    }, [eqFilter('id', order.id)]).catch(() => null);
  }
}

async function cancelTrackedBasketOrders({ basket, orders, openOrdersPayload, apiKey, apiSecret, environment, sides = ['SELL'] }) {
  const allowedSides = new Set(sides.map(side => String(side).toUpperCase()));
  const tracked = botOpenOrdersForBasket(openOrdersPayload, orders)
    .filter(order => allowedSides.has(String(order.side || '').toUpperCase()));
  for (const remoteOrder of tracked) {
    const cancel = await signedCancelOrder({
      apiKey,
      apiSecret,
      environment,
      symbol: basket.symbol,
      orderId: remoteOrder.orderId
    }).catch(() => null);
    if (!cancel?.ok) continue;
    const trackedRow = (orders || []).find(row => String(row.binance_order_id) === String(remoteOrder.orderId));
    await updateRows('real_orders', {
      status: 'canceled',
      raw_response: {
        ...cancel.payload,
        invcripto: trackedRow?.raw_response?.invcripto || { basket_id: basket.id }
      }
    }, trackedRow?.id ? [eqFilter('id', trackedRow.id)] : [eqFilter('basket_id', basket.id), eqFilter('binance_order_id', String(remoteOrder.orderId))]).catch(() => null);
  }
  return tracked.length;
}

async function closeBasketAndRecordProfit({ basket, summary, orders, credential, apiKey, apiSecret, environment, openOrdersPayload }) {
  await cancelTrackedBasketOrders({
    basket,
    orders,
    openOrdersPayload,
    apiKey,
    apiSecret,
    environment,
    sides: ['BUY', 'SELL']
  }).catch(() => null);

  const rates = await commissionRatesOrDefault({ apiKey, apiSecret, environment, symbol: basket.symbol });
  const estimatedFees = summary.buyQuote * rates.buyRate + summary.sellQuote * rates.sellRate;
  const profitUsdt = summary.sellQuote - summary.buyQuote - estimatedFees;
  const feeEnv = Math.max(0, profitUsdt * 0.10);

  if (!basket.profit_recorded && profitUsdt > 0) {
    const wallet = await maybeSingle('inv_wallets', { filters: [eqFilter('user_id', basket.user_id)] });
    const currentEnv = Number(wallet.data?.balance_inv || 0);
    await insertRows('profit_events', [{
      user_id: basket.user_id,
      symbol: basket.symbol,
      profit_usdt: profitUsdt,
      profit_brl: profitUsdt,
      fee_percent: 10,
      fee_inv: feeEnv,
      inv_charged: true
    }]).catch(() => null);
    await updateRows('inv_wallets', {
      balance_inv: Math.max(0, currentEnv - feeEnv)
    }, [eqFilter('user_id', basket.user_id)]).catch(() => null);
  }

  await updateRows('real_baskets', {
    status: 'closed',
    closed_at: new Date().toISOString(),
    profit_recorded: true,
    total_buy_quote: summary.buyQuote,
    total_sell_quote: summary.sellQuote,
    total_bought_qty: summary.boughtQty,
    total_sold_qty: summary.soldQty,
    open_qty: 0,
    metadata: {
      ...(basket.metadata || {}),
      closed_profit_usdt: profitUsdt,
      estimated_binance_fees_usdt: estimatedFees,
      closed_by_reconciliation: true
    }
  }, [eqFilter('id', basket.id)]);
  await refreshCredentialBalance(credential, apiKey, apiSecret, environment).catch(() => null);
  await log('info', 'basket_closed', `Cesta ${basket.symbol} encerrada e conciliada. Lucro liquido estimado ${profitUsdt.toFixed(6)} USDT.`, {
    basketId: basket.id,
    profitUsdt,
    estimatedFees
  }, { user_id: basket.user_id });
}

async function adoptLegacyBotBaskets() {
  const { data: credentials, error } = await selectRows('binance_api_credentials', {
    select: '*',
    filters: ['can_trade=eq.true'],
    order: 'updated_at.desc',
    limit: 50
  });
  if (error) return;

  for (const credential of credentials || []) {
    const environment = credential.environment === 'testnet' ? 'testnet' : 'live';
    const userId = credential.user_id;
    if (!userId) continue;
    const apiKey = decryptSecret(credential.api_key_encrypted);
    const apiSecret = decryptSecret(credential.api_secret_encrypted);
    const account = await signedAccount({ apiKey, apiSecret, environment }).catch(() => null);
    if (!account?.ok) continue;
    const usdt = (account.payload?.balances || []).find(item => item.asset === 'USDT') || { free: 0, locked: 0 };
    const symbols = await symbolsTouchedByBot(userId, environment).catch(() => []);

    for (const symbol of symbols) {
      const already = await activeBasketForSymbol(userId, environment, symbol);
      if (already) continue;
      const openOrders = await signedOpenOrders({ apiKey, apiSecret, environment, symbol }).catch(() => null);
      const botOpenOrders = (Array.isArray(openOrders?.payload) ? openOrders.payload : [])
        .filter(order => /^INV/i.test(String(order.clientOrderId || '')));
      if (!botOpenOrders.length) continue;

      const { data: rows } = await selectRows('real_orders', {
        select: '*',
        filters: [eqFilter('user_id', userId), eqFilter('environment', environment), eqFilter('symbol', symbol)],
        order: 'created_at.asc',
        limit: 300
      });
      const allRows = Array.isArray(rows) ? rows : [];
      let startIndex = 0;
      for (let i = allRows.length - 1; i >= 0; i -= 1) {
        if (String(allRows[i].side || '').toUpperCase() === 'SELL' && String(allRows[i].status || '').toLowerCase() === 'filled') {
          startIndex = i + 1;
          break;
        }
      }
      const candidates = allRows.slice(startIndex).filter(row => !row.basket_id);
      const summary = summarizeBasketOrders(candidates);
      if (!summary.boughtQty || summary.openQty <= 0) continue;

      const profileName = await getBotProfileName(userId);
      let basket;
      try {
        basket = await createRealBasket({
          userId,
          environment,
          symbol,
          profileName,
          accountUsdt: Number(usdt.free || 0) + Number(usdt.locked || 0) + summary.netCapital
        });
      } catch {
        continue;
      }
      for (const row of candidates) {
        await updateRows('real_orders', {
          basket_id: basket.id,
          profile_name: profileName,
          protection_role: row.protection_role || (String(row.side).toUpperCase() === 'BUY' ? 'entry' : 'take_profit')
        }, [eqFilter('id', row.id)]).catch(() => null);
      }
      const usage = basketBucketUsage(candidates.map(row => ({
        ...row,
        raw_response: { ...(row.raw_response || {}), invcripto: { ...(row.raw_response?.invcripto || {}), bucket: 'normal' } }
      })));
      await updateRows('real_baskets', {
        total_buy_quote: summary.buyQuote,
        total_sell_quote: summary.sellQuote,
        total_bought_qty: summary.boughtQty,
        total_sold_qty: summary.soldQty,
        open_qty: summary.openQty,
        avg_price: summary.avgBuyPrice,
        last_buy_price: summary.lastBuyPrice,
        last_buy_quote: summary.lastBuyQuote,
        recovery_level: summary.recoveryLevel,
        normal_used_usdt: Math.max(usage.normalUsed, summary.buyQuote),
        metadata: { ...(basket.metadata || {}), adopted_legacy_orders: true, adopted_at: new Date().toISOString() }
      }, [eqFilter('id', basket.id)]).catch(() => null);
      await log('info', 'legacy_basket_adopted', `Cesta existente de ${symbol} foi assumida pelo controle persistente.`, {
        basketId: basket.id,
        openQty: summary.openQty,
        buyQuote: summary.buyQuote
      }, { user_id: userId });
    }
  }
}

async function reconcilePersistentBaskets() {
  const { data: baskets, error } = await selectRows('real_baskets', {
    select: '*',
    filters: [eqFilter('status', 'active')],
    order: 'opened_at.asc',
    limit: 100
  });
  if (error) return;

  for (let basket of baskets || []) {
    try {
      const environment = basket.environment === 'testnet' ? 'testnet' : 'live';
      const credential = await getCredential(basket.user_id, environment);
      const apiKey = decryptSecret(credential.api_key_encrypted);
      const apiSecret = decryptSecret(credential.api_secret_encrypted);
      const filters = await exchangeInfo(basket.symbol, environment);
      let orders = await basketOrders(basket.id);
      if (!orders.length && basket.metadata?.manual_reconciliation_required) {
        const recoveredMetadata = await recoverBasketOrdersFromMetadata({ basket, apiKey, apiSecret, environment });
        if (recoveredMetadata) basket = { ...basket, metadata: recoveredMetadata };
        orders = await basketOrders(basket.id);
      }
      if (basket.metadata?.untracked_take_profit || basket.metadata?.untracked_order_list) {
        const recoveredMetadata = await recoverUntrackedMetadataRows({ basket, existingOrders: orders });
        if (recoveredMetadata) basket = { ...basket, metadata: recoveredMetadata };
        orders = await basketOrders(basket.id);
      }
      await refreshBasketRemoteOrders({ basket, orders, apiKey, apiSecret, environment });
      orders = await basketOrders(basket.id);
      let summary = summarizeBasketOrders(orders);
      const usage = basketBucketUsage(orders);
      const openOrders = await signedOpenOrders({ apiKey, apiSecret, environment, symbol: basket.symbol });
      if (!openOrders.ok) throw new Error(`Falha ao ler ordens abertas: ${JSON.stringify(openOrders.payload)}`);

      if (summary.openQty < filters.minQty) {
        if (summary.boughtQty > 0 && summary.soldQty >= summary.boughtQty - filters.stepSize) {
          await closeBasketAndRecordProfit({ basket, summary, orders, credential, apiKey, apiSecret, environment, openOrdersPayload: openOrders.payload });
        }
        continue;
      }

      const reconciledIds = new Set(Array.isArray(basket.metadata?.reconciled_protection_buys) ? basket.metadata.reconciled_protection_buys : []);
      const newFilledProtectionBuys = orders.filter(order =>
        String(order.side || '').toUpperCase() === 'BUY' &&
        String(order.protection_role || '') === 'protection_buy' &&
        String(order.status || '').toLowerCase() === 'filled' &&
        !reconciledIds.has(String(order.binance_order_id || order.id))
      );

      const trackedOpen = botOpenOrdersForBasket(openOrders.payload, orders);
      const sellCoverage = trackedOpen
        .filter(order => String(order.side || '').toUpperCase() === 'SELL')
        .reduce((sum, order) => sum + Math.max(0, Number(order.origQty || 0) - Number(order.executedQty || 0)), 0);
      const coverageMismatch = Math.abs(sellCoverage - summary.openQty) > filters.stepSize * 1.5;

      if (newFilledProtectionBuys.length || coverageMismatch) {
        await cancelTrackedBasketOrders({
          basket,
          orders,
          openOrdersPayload: openOrders.payload,
          apiKey,
          apiSecret,
          environment,
          sides: ['SELL']
        });
        orders = await basketOrders(basket.id);
        summary = summarizeBasketOrders(orders);
        const newIds = newFilledProtectionBuys.map(order => String(order.binance_order_id || order.id));
        basket = {
          ...basket,
          metadata: {
            ...(basket.metadata || {}),
            reconciled_protection_buys: [...new Set([...reconciledIds, ...newIds])],
            last_reconciled_at: new Date().toISOString()
          }
        };
        await updateRows('real_baskets', { metadata: basket.metadata }, [eqFilter('id', basket.id)]);
        await placeBasketTakeProfit({ basket, summary, orders, credential, apiKey, apiSecret, environment, filters });
        orders = await basketOrders(basket.id);
      }

      basket = {
        ...basket,
        normal_used_usdt: usage.normalUsed,
        emergency_used_usdt: usage.emergencyUsed,
        total_buy_quote: summary.buyQuote,
        total_sell_quote: summary.sellQuote,
        total_bought_qty: summary.boughtQty,
        total_sold_qty: summary.soldQty,
        open_qty: summary.openQty,
        avg_price: summary.avgBuyPrice,
        last_buy_price: summary.lastBuyPrice || basket.last_buy_price,
        last_buy_quote: summary.lastBuyQuote || basket.last_buy_quote,
        recovery_level: summary.recoveryLevel
      };
      await updateRows('real_baskets', {
        normal_used_usdt: usage.normalUsed,
        emergency_used_usdt: usage.emergencyUsed,
        total_buy_quote: summary.buyQuote,
        total_sell_quote: summary.sellQuote,
        total_bought_qty: summary.boughtQty,
        total_sold_qty: summary.soldQty,
        open_qty: summary.openQty,
        avg_price: summary.avgBuyPrice,
        last_buy_price: basket.last_buy_price,
        last_buy_quote: basket.last_buy_quote,
        recovery_level: summary.recoveryLevel
      }, [eqFilter('id', basket.id)]);

      await placeNextOfflineProtection({ basket, orders, credential, apiKey, apiSecret, environment, filters }).catch(async error => {
        await log('warn', 'offline_protection_reconcile_error', String(error?.message || error), { basketId: basket.id }, { user_id: basket.user_id });
      });
      await refreshCredentialBalance(credential, apiKey, apiSecret, environment).catch(() => null);
    } catch (error) {
      await log('warn', 'basket_reconciliation_error', String(error?.message || error), { basketId: basket.id, symbol: basket.symbol }, { user_id: basket.user_id });
    }
  }
}

async function recoverFailedProtectedBuys() {
  // Fluxo legado desativado: a reconciliacao por basket_id protege apenas quantidades do robo.
  return;
}

async function recoverUnprotectedBotBalances() {
  // Fluxo legado desativado para impedir venda de saldo manual da conta.
  return;
}

async function executeCommand(command) {
  switch (String(command.command_type || '').toUpperCase()) {
    case 'VALIDATE_BINANCE_API':
      return handleValidateApi(command);
    case 'BINANCE_TICKER': {
      const symbol = String(command.payload?.symbol || 'BTCUSDT').toUpperCase();
      return ticker(symbol);
    }
    case 'BINANCE_KLINES': {
      const symbol = String(command.payload?.symbol || 'BTCUSDT').toUpperCase();
      const interval = String(command.payload?.interval || '15m');
      const limit = Number(command.payload?.limit || 320);
      return klines(symbol, interval, limit);
    }
    case 'EXECUTE_PROTECTED_SPOT_BUY':
      return handleProtectedSpotBuy(command);
    default:
      throw new Error(`Comando não suportado: ${command.command_type}`);
  }
}

async function claimNextCommand() {
  const pendingCount = await selectRows('connector_commands', {
    select: 'id',
    filters: [eqFilter('status', 'pending')],
    count: true
  });
  if (!pendingCount.error) dashboard.pending = Number(pendingCount.count || 0);

  const { data, error } = await selectRows('connector_commands', {
    filters: [eqFilter('status', 'pending')],
    order: 'created_at.asc',
    limit: 1
  });
  if (error) throw new Error(error.message);
  const command = data?.[0];
  if (!command) return null;

  const { data: updated, error: updateError } = await updateRows('connector_commands', {
      status: 'running',
      attempts: Number(command.attempts || 0) + 1,
      locked_by: cfg.nodeKey,
      locked_at: new Date().toISOString()
    }, [eqFilter('id', command.id), eqFilter('status', 'pending')], true);
  if (updateError) throw new Error(updateError.message);
  return updated;
}

async function processLoop() {
  if (dashboard.loopRunning) return;
  dashboard.loopRunning = true;
  dashboard.status = 'Sincronizando';
  renderDashboard();

  try {
  await heartbeat('online', { pid: process.pid });
  await adoptLegacyBotBaskets();
  await reconcilePersistentBaskets();
  await monitorProtectedSells();
  const command = await claimNextCommand();
  if (!command) {
    dashboard.lastCommand = 'Aguardando comandos';
    dashboard.lastMessage = 'Conector online, sem comandos pendentes';
    dashboard.status = 'Online';
    renderDashboard();
    return;
  }

  dashboard.status = 'Processando comando';
  dashboard.lastCommand = command.command_type;
  dashboard.lastMessage = `Processando ${command.command_type}`;
  renderDashboard();
  await log('info', 'command_started', `Processando ${command.command_type}`, {}, command);
  try {
    const result = await executeCommand(command);
    dashboard.processed += 1;
    dashboard.lastCommand = command.command_type;
    dashboard.lastMessage = `Comando ${command.command_type} finalizado`;
    if (Object.prototype.hasOwnProperty.call(result || {}, 'usdtFree')) {
      dashboard.lastUsdt = Number(result.usdtFree || 0);
      dashboard.canTrade = Boolean(result.canTrade);
      dashboard.canWithdraw = Boolean(result.canWithdraw);
      dashboard.credentialStatus = result.credentialStatus || null;
      dashboard.lastSync = new Date().toLocaleString('pt-BR');
    }
    await updateRows('connector_commands', {
        status: 'done',
        result,
        completed_at: new Date().toISOString(),
        error_message: null
      }, [eqFilter('id', command.id)]);
    await log('info', 'command_done', `Comando ${command.command_type} finalizado`, { result }, command);
  } catch (error) {
    dashboard.errors += 1;
    dashboard.lastCommand = command.command_type;
    dashboard.lastMessage = String(error?.message || error);
    await updateRows('connector_commands', {
        status: 'error',
        error_message: String(error?.message || error),
        completed_at: new Date().toISOString()
      }, [eqFilter('id', command.id)]);
    await log('error', 'command_error', String(error?.message || error), {}, command);
  }
  dashboard.status = 'Online';
  renderDashboard();
  } finally {
    dashboard.loopRunning = false;
  }
}

async function main() {
  renderDashboard();
  await log('info', 'connector_started', 'Conector local iniciado');
  await heartbeat('online');
  renderDashboard();

  processLoop().catch(async error => {
    dashboard.errors += 1;
    dashboard.status = 'Erro';
    dashboard.lastMessage = String(error?.message || error);
    pushEvent('error', 'loop_error', dashboard.lastMessage);
    renderDashboard();
    await heartbeat('error', { error: String(error?.message || error) }).catch(() => null);
  });

  setInterval(() => {
    processLoop().catch(async error => {
      dashboard.errors += 1;
      dashboard.status = 'Erro';
      dashboard.lastMessage = String(error?.message || error);
      pushEvent('error', 'loop_error', dashboard.lastMessage);
      renderDashboard();
      await heartbeat('error', { error: String(error?.message || error) }).catch(() => null);
    });
  }, cfg.intervalMs);
}

process.on('SIGINT', async () => {
  await heartbeat('offline').catch(() => null);
  console.log('\nConector finalizado.');
  process.exit(0);
});

main().catch(error => {
  console.error(error);
  process.exit(1);
});
