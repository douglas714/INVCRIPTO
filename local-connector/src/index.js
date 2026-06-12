import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

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

function validateConfig() {
  const missing = [];
  if (!cfg.supabaseUrl) missing.push('SUPABASE_URL');
  if (!cfg.supabaseKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!cfg.encryptionKey) missing.push('APP_ENCRYPTION_KEY');
  if (cfg.encryptionKey && cfg.encryptionKey.length < 24) missing.push('APP_ENCRYPTION_KEY precisa ter no mínimo 24 caracteres');
  if (missing.length) throw new Error(`Configuração incompleta: ${missing.join(', ')}`);
}

validateConfig();

const supabase = createClient(cfg.supabaseUrl, cfg.supabaseKey, {
  auth: { persistSession: false }
});

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
    await supabase.from('connector_logs').insert({
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
  const { error } = await supabase
    .from('connector_nodes')
    .upsert(row, { onConflict: 'node_key' });
  if (error) console.error('Falha heartbeat:', error.message);
}

async function getCredential(userId, environment) {
  const { data, error } = await supabase
    .from('binance_api_credentials')
    .select('*')
    .eq('user_id', userId)
    .eq('environment', environment)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
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

  await supabase
    .from('binance_api_credentials')
    .update({
      can_read: true,
      can_trade: canTrade,
      can_withdraw: canWithdraw,
      status: credentialStatus,
      last_test_at: new Date().toISOString(),
      real_usdt_free: Number(usdt.free || 0),
      real_usdt_locked: Number(usdt.locked || 0)
    })
    .eq('id', credential.id);

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

async function handleProtectedSpotBuy(command) {
  const payload = command.payload || {};
  const environment = payload.environment === 'testnet' ? 'testnet' : 'live';
  const symbol = String(payload.symbol || 'BTCUSDT').toUpperCase();
  const requestedQuote = Number(payload.quoteOrderQty || payload.valueUsdt || 0);
  const targetPriceRaw = Number(payload.targetPrice || payload.recoveryTarget || 0);
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

  const usdt = (account.payload?.balances || []).find(item => item.asset === 'USDT');
  const availableUsdt = Number(usdt?.free || 0);
  const safeMinimum = Math.max(filters.minNotional * 1.02, 5);
  const quoteOrderQty = Math.max(requestedQuote, safeMinimum);
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
  const sellPrice = ceilToStep(Math.max(targetPriceRaw, avgPrice * 1.005), filters.tickSize);
  const freeBase = await currentFreeBalance({ apiKey, apiSecret, environment, asset: filters.baseAsset });
  const sellQty = floorToStep(Math.min(executedQty, freeBase), filters.stepSize);
  const sellNotional = sellQty * sellPrice;

  if (sellQty < filters.minQty || sellNotional < filters.minNotional) {
    throw new Error(`Compra executada, mas quantidade abaixo do minimo para venda. Qtd ${sellQty}, notional ${sellNotional.toFixed(8)}.`);
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
  if (!sell.ok) throw new Error(`Venda protegida Binance rejeitada: ${JSON.stringify(sell.payload)}`);

  const { error: orderLogError } = await supabase.from('real_orders').insert([
    {
      user_id: command.user_id,
      environment,
      symbol,
      side: 'BUY',
      order_type: 'MARKET',
      status: String(buy.payload?.status || 'FILLED').toLowerCase(),
      client_order_id: buyClientOrderId,
      binance_order_id: String(buy.payload?.orderId || ''),
      quote_order_qty: quoteOrderQty,
      quantity: executedQty,
      price: avgPrice,
      executed_qty: executedQty,
      cummulative_quote_qty: cummulativeQuoteQty,
      reason,
      raw_response: buy.payload
    },
    {
      user_id: command.user_id,
      environment,
      symbol,
      side: 'SELL',
      order_type: 'LIMIT',
      status: String(sell.payload?.status || 'NEW').toLowerCase(),
      client_order_id: sellClientOrderId,
      binance_order_id: String(sell.payload?.orderId || ''),
      quantity: sellQty,
      price: sellPrice,
      reason: 'Venda protegida criada imediatamente apos compra',
      raw_response: sell.payload
    }
  ]);
  if (orderLogError) throw new Error(`Ordens criadas na Binance, mas falhou auditoria Supabase: ${orderLogError.message}`);

  dashboard.lastProtectedOrder = `${symbol} BUY ${quoteOrderQty.toFixed(2)} -> SELL ${formatDecimal(sellQty, filters.stepSize)} @ ${formatDecimal(sellPrice, filters.tickSize)}`;
  dashboard.lastUsdt = Math.max(0, availableUsdt - quoteOrderQty);
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
    minNotional: filters.minNotional,
    stepSize: filters.stepSize,
    tickSize: filters.tickSize,
    protected: true
  };
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
  const pendingCount = await supabase
    .from('connector_commands')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (!pendingCount.error) dashboard.pending = Number(pendingCount.count || 0);

  const { data, error } = await supabase
    .from('connector_commands')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  const command = data?.[0];
  if (!command) return null;

  const { data: updated, error: updateError } = await supabase
    .from('connector_commands')
    .update({
      status: 'running',
      attempts: Number(command.attempts || 0) + 1,
      locked_by: cfg.nodeKey,
      locked_at: new Date().toISOString()
    })
    .eq('id', command.id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
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
    await supabase
      .from('connector_commands')
      .update({
        status: 'done',
        result,
        completed_at: new Date().toISOString(),
        error_message: null
      })
      .eq('id', command.id);
    await log('info', 'command_done', `Comando ${command.command_type} finalizado`, { result }, command);
  } catch (error) {
    dashboard.errors += 1;
    dashboard.lastCommand = command.command_type;
    dashboard.lastMessage = String(error?.message || error);
    await supabase
      .from('connector_commands')
      .update({
        status: 'error',
        error_message: String(error?.message || error),
        completed_at: new Date().toISOString()
      })
      .eq('id', command.id);
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
