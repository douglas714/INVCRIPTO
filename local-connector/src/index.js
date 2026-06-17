import fs from 'node:fs';
import crypto from 'node:crypto';

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
  const payload = text ? JSON.parse(text) : null;
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
  const { protection_role, linked_order_id, timeframe, ...legacy } = row;
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
    app_version: '1.0.0',
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

async function handleProtectedSpotBuy(command) {
  const payload = command.payload || {};
  const environment = payload.environment === 'testnet' ? 'testnet' : 'live';
  const symbol = String(payload.symbol || 'BTCUSDT').toUpperCase();
  const requestedQuote = Number(payload.quoteOrderQty || payload.valueUsdt || 0);
  const targetPriceRaw = Number(payload.targetPrice || payload.recoveryTarget || 0);
  const timeframe = String(payload.timeframe || '15m');
  const reason = String(payload.reason || 'Entrada protegida INVCRIPTO');

  if (!requestedQuote || requestedQuote <= 0) throw new Error('Valor USDT da compra nao informado.');
  if (!targetPriceRaw || targetPriceRaw <= 0) throw new Error('Preco de venda alvo nao informado.');

  const credential = await getCredential(command.user_id, environment);
  const apiKey = decryptSecret(credential.api_key_encrypted);
  const apiSecret = decryptSecret(credential.api_secret_encrypted);
  const account = await signedAccount({ apiKey, apiSecret, environment });
  if (!account.ok) throw new Error(`Binance rejeitou conta: ${JSON.stringify(account.payload)}`);
  if (!account.payload?.canTrade) throw new Error('API Binance esta sem permissao de trading.');

  const filters = await exchangeInfo(symbol, environment);
  if (filters.status !== 'TRADING') throw new Error(`Par ${symbol} nao esta liberado para trading.`);

  const openOrders = await signedOpenOrders({ apiKey, apiSecret, environment, symbol });
  const activeSellOrders = openOrders.ok ? openSellOrdersForSymbol(openOrders.payload, symbol) : [];
  let recoveryMode = false;
  let recoveryLevel = 1;
  if (activeSellOrders.length) {
    const referenceSell = activeSellOrders
      .slice()
      .sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0];
    const sellPrice = Number(referenceSell.price || 0);
    const pricePayload = await ticker(symbol);
    const lastPrice = Number(pricePayload.payload?.lastPrice || pricePayload.payload?.weightedAvgPrice || 0);
    const estimatedAverage = sellPrice > 0 ? sellPrice / 1.005 : 0;
    const martingaleTrigger = estimatedAverage > 0 ? estimatedAverage * 0.996 : 0;
    const buyCount = await recentBasketBuyCount(command.user_id, environment, symbol).catch(() => 1);
    recoveryLevel = buyCount + 1;

    if (!lastPrice || !martingaleTrigger || lastPrice > martingaleTrigger || recoveryLevel > 3) {
      const reason = recoveryLevel > 3 ? 'max_recovery_hands' : 'active_basket_waiting_trigger';
      const message = recoveryLevel > 3
        ? `Cesta ativa em ${symbol}. Limite de 3 maos atingido; aguardando venda protegida.`
        : `Cesta ativa em ${symbol}. Preco ${lastPrice || '-'} acima do gatilho ${martingaleTrigger ? martingaleTrigger.toFixed(8) : '-'}; aguardando venda protegida.`;
      dashboard.lastProtectedOrder = `${symbol} cesta ativa: aguardando`;
      dashboard.lastMessage = message;
      dashboard.lastSync = new Date().toLocaleString('pt-BR');
      await refreshCredentialBalance(credential, apiKey, apiSecret, environment).catch(() => null);
      await log('info', 'protected_buy_skipped', message, { symbol, environment, lastPrice, martingaleTrigger, recoveryLevel }, command);
      return {
        environment,
        symbol,
        skipped: true,
        reason,
        recoveryLevel,
        lastPrice,
        martingaleTrigger,
        protected: true,
        message
      };
    }

    for (const sellOrder of activeSellOrders) {
      const cancel = await signedCancelOrder({
        apiKey,
        apiSecret,
        environment,
        symbol,
        orderId: sellOrder.orderId
      });
      if (!cancel.ok) throw new Error(`Nao foi possivel cancelar venda antiga para recalcular cesta: ${JSON.stringify(cancel.payload)}`);
      await updateRows('real_orders', {
        status: 'canceled',
        raw_response: cancel.payload
      }, [eqFilter('binance_order_id', String(sellOrder.orderId))]).catch(() => null);
    }
    recoveryMode = true;
    await log('info', 'recovery_sell_cancelled', `Venda antiga cancelada em ${symbol}; preparando mao ${recoveryLevel}.`, { symbol, recoveryLevel }, command);
  }

  const usdt = (account.payload?.balances || []).find(item => item.asset === 'USDT');
  const availableUsdt = Number(usdt?.free || 0);
  const estimatedTarget = Math.max(targetPriceRaw, Number(payload.entryPrice || 0), 1);
  const roundingReserve = estimatedTarget * filters.stepSize * 1.35;
  const safeMinimum = Math.max(filters.minNotional * 1.12 + roundingReserve, 6.25);
  const recoveryMultiplier = recoveryMode ? (recoveryLevel === 2 ? 1.6 : 2.4) : 1;
  const quoteOrderQty = Math.max(requestedQuote * recoveryMultiplier, safeMinimum);
  if (quoteOrderQty > availableUsdt) {
    throw new Error(`Saldo USDT insuficiente. Necessario ${quoteOrderQty.toFixed(2)} USDT, disponivel ${availableUsdt.toFixed(8)} USDT.`);
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
      type: 'MARKET',
      quoteOrderQty: quoteOrderQty.toFixed(2),
      newClientOrderId: buyClientOrderId,
      newOrderRespType: 'FULL'
    }
  });
  if (!buy.ok) throw new Error(`Compra Binance rejeitada: ${JSON.stringify(buy.payload)}`);

  const executedQty = Number(buy.payload?.executedQty || 0);
  const cummulativeQuoteQty = Number(buy.payload?.cummulativeQuoteQty || quoteOrderQty);
  const avgPrice = executedQty > 0 ? cummulativeQuoteQty / executedQty : 0;
  const { data: buyRows, error: buyLogError } = await insertRealOrders([
    {
      user_id: command.user_id,
      environment,
      symbol,
      side: 'BUY',
      order_type: 'MARKET',
      status: String(buy.payload?.status || 'FILLED').toLowerCase(),
      protection_role: 'entry',
      timeframe,
      client_order_id: buyClientOrderId,
      binance_order_id: String(buy.payload?.orderId || ''),
      quote_order_qty: quoteOrderQty,
      quantity: executedQty,
      price: avgPrice,
      executed_qty: executedQty,
      cummulative_quote_qty: cummulativeQuoteQty,
      reason: recoveryMode ? `Martingale controlado M${recoveryLevel}: ${reason}` : reason,
      raw_response: buy.payload
    }
  ]);
  let auditWarning = '';
  if (buyLogError) {
    auditWarning = `Compra criada na Binance, mas falhou auditoria Supabase: ${buyLogError.message}`;
    await log('warn', 'real_buy_audit_failed', auditWarning, { symbol, buyOrderId: buy.payload?.orderId }, command);
  }
  const buyAuditId = buyLogError ? null : (Array.isArray(buyRows) ? buyRows[0]?.id : buyRows?.id);
  await refreshCredentialBalance(credential, apiKey, apiSecret, environment).catch(() => null);

  const sellReferenceQty = recoveryMode ? await currentFreeBalance({ apiKey, apiSecret, environment, asset: filters.baseAsset }) : executedQty;
  const basketAvgPrice = recoveryMode
    ? await estimateAverageBuyPrice({ apiKey, apiSecret, environment, symbol, neededQty: sellReferenceQty }).catch(() => avgPrice)
    : avgPrice;
  const sellPrice = ceilToStep(Math.max(targetPriceRaw, basketAvgPrice * 1.005), filters.tickSize);
  const freeBase = await currentFreeBalance({ apiKey, apiSecret, environment, asset: filters.baseAsset });
  const sellQty = floorToStep(Math.min(recoveryMode ? sellReferenceQty : executedQty, freeBase), filters.stepSize);
  const sellNotional = sellQty * sellPrice;

  if (sellQty < filters.minQty || sellNotional < filters.minNotional) {
    throw new Error(`Compra executada e auditada, mas a venda ficou abaixo do minimo Binance. Qtd ${sellQty}, notional ${sellNotional.toFixed(8)}. Aumente o tamanho minimo da entrada.`);
  }

  const sellClientOrderId = `INVSELL_${compactId.slice(0, 23)}`;
  const sell = await signedOrder({
    apiKey,
    apiSecret,
    environment,
    params: {
      symbol,
      side: 'SELL',
      type: 'LIMIT',
      timeInForce: 'GTC',
      quantity: formatDecimal(sellQty, filters.stepSize),
      price: formatDecimal(sellPrice, filters.tickSize),
      newClientOrderId: sellClientOrderId,
      newOrderRespType: 'FULL'
    }
  });
  if (!sell.ok) {
    await refreshCredentialBalance(credential, apiKey, apiSecret, environment).catch(() => null);
    throw new Error(`Venda protegida Binance rejeitada: ${JSON.stringify(sell.payload)}`);
  }

  const { error: sellLogError } = await insertRealOrders([
    {
      user_id: command.user_id,
      environment,
      symbol,
      side: 'SELL',
      order_type: 'LIMIT',
      status: String(sell.payload?.status || 'NEW').toLowerCase(),
      linked_order_id: buyAuditId || null,
      protection_role: recoveryMode ? `recovery_m${recoveryLevel}_take_profit` : 'take_profit',
      timeframe,
      client_order_id: sellClientOrderId,
      binance_order_id: String(sell.payload?.orderId || ''),
      quantity: sellQty,
      price: sellPrice,
      reason: recoveryMode ? `Venda unica recalculada para cesta M${recoveryLevel}. Media ${basketAvgPrice.toFixed(8)} + 0.5%.` : 'Venda protegida criada imediatamente apos compra',
      raw_response: sell.payload
    }
  ]);
  if (sellLogError) {
    auditWarning = [auditWarning, `Venda protegida criada na Binance, mas falhou auditoria Supabase: ${sellLogError.message}`].filter(Boolean).join(' | ');
    await log('warn', 'real_sell_audit_failed', auditWarning, { symbol, sellOrderId: sell.payload?.orderId }, command);
  }
  const refreshedAfterSell = await refreshCredentialBalance(credential, apiKey, apiSecret, environment).catch(() => null);

  dashboard.lastProtectedOrder = `${symbol} ${recoveryMode ? `M${recoveryLevel}` : 'M1'} BUY ${quoteOrderQty.toFixed(2)} -> SELL ${formatDecimal(sellQty, filters.stepSize)} @ ${formatDecimal(sellPrice, filters.tickSize)}`;
  dashboard.lastUsdt = refreshedAfterSell?.free ?? Math.max(0, availableUsdt - quoteOrderQty);
  dashboard.lastSync = new Date().toLocaleString('pt-BR');

  return {
    environment,
    symbol,
    buyOrderId: buy.payload?.orderId,
    sellOrderId: sell.payload?.orderId,
    quoteOrderQty,
    executedQty,
    avgPrice,
    sellQty,
    sellPrice,
    recoveryMode,
    recoveryLevel,
    basketAvgPrice,
    minNotional: filters.minNotional,
    stepSize: filters.stepSize,
    tickSize: filters.tickSize,
    protected: true,
    auditWarning: auditWarning || null
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

async function recoverFailedProtectedBuys() {
  const { data: failedCommands, error } = await selectRows('connector_commands', {
    select: '*',
    filters: [eqFilter('status', 'error'), eqFilter('command_type', 'EXECUTE_PROTECTED_SPOT_BUY')],
    order: 'updated_at.desc',
    limit: 10
  });
  if (error) return;
  for (const command of failedCommands || []) {
    const message = String(command.error_message || '');
    if (!message.includes('Compra executada') && !message.includes('Compra criada na Binance')) continue;
    if (command.result?.recoveryAttempted) continue;
    const payload = command.payload || {};
    const environment = payload.environment === 'testnet' ? 'testnet' : 'live';
    const symbol = String(payload.symbol || 'BTCUSDT').toUpperCase();
    try {
      const credential = await getCredential(command.user_id, environment);
      const apiKey = decryptSecret(credential.api_key_encrypted);
      const apiSecret = decryptSecret(credential.api_secret_encrypted);
      const filters = await exchangeInfo(symbol, environment);
      const freeBase = await currentFreeBalance({ apiKey, apiSecret, environment, asset: filters.baseAsset });
      const targetPrice = ceilToStep(Number(payload.targetPrice || payload.recoveryTarget || 0), filters.tickSize);
      const sellQty = floorToStep(freeBase, filters.stepSize);
      const sellNotional = sellQty * targetPrice;
      if (!targetPrice || sellQty < filters.minQty || sellNotional < filters.minNotional) {
        await updateRows('connector_commands', {
          result: {
            ...(command.result || {}),
            recoveryAttempted: true,
            recoveryStatus: 'not_enough_sell_notional',
            freeBase,
            sellQty,
            sellNotional,
            minNotional: filters.minNotional
          },
          error_message: `${message} Recuperacao: quantidade atual ainda nao permite venda limite Binance acima do minimo.`
        }, [eqFilter('id', command.id)]);
        continue;
      }

      const compactId = command.id.replaceAll('-', '');
      const sellClientOrderId = `INVREC_${compactId.slice(0, 24)}`;
      const sell = await signedOrder({
        apiKey,
        apiSecret,
        environment,
        params: {
          symbol,
          side: 'SELL',
          type: 'LIMIT',
          timeInForce: 'GTC',
          quantity: formatDecimal(sellQty, filters.stepSize),
          price: formatDecimal(targetPrice, filters.tickSize),
          newClientOrderId: sellClientOrderId,
          newOrderRespType: 'FULL'
        }
      });
      if (!sell.ok) throw new Error(`Venda de recuperacao rejeitada: ${JSON.stringify(sell.payload)}`);
      await insertRealOrders([{
        user_id: command.user_id,
        environment,
        symbol,
        side: 'SELL',
        order_type: 'LIMIT',
        status: String(sell.payload?.status || 'NEW').toLowerCase(),
        protection_role: 'recovery_take_profit',
        timeframe: String(payload.timeframe || '15m'),
        client_order_id: sellClientOrderId,
        binance_order_id: String(sell.payload?.orderId || ''),
        quantity: sellQty,
        price: targetPrice,
        reason: 'Venda protegida de recuperacao apos compra executada',
        raw_response: sell.payload
      }]);
      await refreshCredentialBalance(credential, apiKey, apiSecret, environment).catch(() => null);
      await updateRows('connector_commands', {
        status: 'done',
        result: {
          ...(command.result || {}),
          recoveryAttempted: true,
          recoveryStatus: 'sell_created',
          recoverySellOrderId: sell.payload?.orderId,
          sellQty,
          targetPrice
        },
        error_message: null,
        completed_at: new Date().toISOString()
      }, [eqFilter('id', command.id)]);
      await log('info', 'recovery_sell_created', `Venda de recuperacao criada para ${symbol}`, { sellQty, targetPrice }, command);
    } catch (error) {
      await updateRows('connector_commands', {
        result: { ...(command.result || {}), recoveryAttempted: true, recoveryStatus: 'error', recoveryError: String(error?.message || error) }
      }, [eqFilter('id', command.id)]).catch(() => null);
      await log('warn', 'recovery_sell_error', String(error?.message || error), { commandId: command.id }, command);
    }
  }
}

async function recoverUnprotectedBotBalances() {
  const { data: credentials, error } = await selectRows('binance_api_credentials', {
    select: '*',
    filters: ['environment=eq.live', 'can_trade=eq.true'],
    order: 'updated_at.desc',
    limit: 50
  });
  if (error) return;
  for (const credential of credentials || []) {
    const environment = credential.environment === 'testnet' ? 'testnet' : 'live';
    const userId = credential.user_id;
    if (!userId) continue;
    try {
      const symbols = await symbolsTouchedByBot(userId, environment);
      if (!symbols.length) continue;
      const apiKey = decryptSecret(credential.api_key_encrypted);
      const apiSecret = decryptSecret(credential.api_secret_encrypted);
      const account = await signedAccount({ apiKey, apiSecret, environment });
      if (!account.ok) continue;
      const balances = Array.isArray(account.payload?.balances) ? account.payload.balances : [];

      for (const symbol of symbols) {
        const filters = await exchangeInfo(symbol, environment).catch(() => null);
        if (!filters || filters.status !== 'TRADING') continue;
        const baseAsset = baseAssetFromSymbol(symbol);
        const balance = balances.find(item => item.asset === baseAsset);
        const freeBase = Number(balance?.free || 0);
        if (freeBase <= 0) continue;

        const openOrders = await signedOpenOrders({ apiKey, apiSecret, environment, symbol });
        if (openOrders.ok && hasOpenSellOrder(openOrders.payload, symbol)) continue;

        const pricePayload = await ticker(symbol);
        const lastPrice = Number(pricePayload.payload?.lastPrice || pricePayload.payload?.weightedAvgPrice || 0);
        if (!lastPrice || lastPrice <= 0) continue;

        const sellQty = floorToStep(freeBase, filters.stepSize);
        const avgBuy = await estimateAverageBuyPrice({ apiKey, apiSecret, environment, symbol, neededQty: sellQty }).catch(() => 0);
        const targetBase = Math.max(avgBuy || 0, lastPrice);
        const sellPrice = ceilToStep(targetBase * 1.006, filters.tickSize);
        const sellNotional = sellQty * sellPrice;
        if (sellQty < filters.minQty || sellNotional < filters.minNotional) continue;

        const clientOrderId = `INVPROTECT_${Date.now().toString(36)}_${symbol.slice(0, 5)}`;
        const sell = await signedOrder({
          apiKey,
          apiSecret,
          environment,
          params: {
            symbol,
            side: 'SELL',
            type: 'LIMIT',
            timeInForce: 'GTC',
            quantity: formatDecimal(sellQty, filters.stepSize),
            price: formatDecimal(sellPrice, filters.tickSize),
            newClientOrderId: clientOrderId.slice(0, 36),
            newOrderRespType: 'FULL'
          }
        });
        if (!sell.ok) {
          await log('warn', 'free_balance_sell_rejected', `Venda de protecao rejeitada para ${symbol}: ${JSON.stringify(sell.payload)}`, { sellQty, sellPrice }, { user_id: userId });
          continue;
        }
        await insertRealOrders([{
          user_id: userId,
          environment,
          symbol,
          side: 'SELL',
          order_type: 'LIMIT',
          status: String(sell.payload?.status || 'NEW').toLowerCase(),
          protection_role: 'recovery_take_profit',
          timeframe: 'auto',
          client_order_id: clientOrderId.slice(0, 36),
          binance_order_id: String(sell.payload?.orderId || ''),
          quantity: sellQty,
          price: sellPrice,
          reason: `Venda protegida automatica para saldo livre. Media ${avgBuy ? avgBuy.toFixed(8) : 'nao estimada'} + alvo 0.6%.`,
          raw_response: sell.payload
        }]);
        await refreshCredentialBalance(credential, apiKey, apiSecret, environment).catch(() => null);
        await log('info', 'free_balance_sell_created', `Venda protegida criada para saldo livre ${symbol}`, { sellQty, sellPrice, avgBuy, lastPrice }, { user_id: userId });
      }
    } catch (error) {
      await log('warn', 'free_balance_recovery_error', String(error?.message || error), { credentialId: credential.id }, { user_id: userId });
    }
  }
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
  await monitorProtectedSells();
  await recoverFailedProtectedBuys();
  await recoverUnprotectedBotBalances();
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
