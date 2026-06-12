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
  const prefix = level.toUpperCase().padEnd(5);
  console.log(`[${new Date().toISOString()}] ${prefix} ${event} - ${message}`);
}

async function heartbeat(status = 'online', metadata = {}) {
  const ip = await publicIp().catch(() => null);
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
    default:
      throw new Error(`Comando não suportado: ${command.command_type}`);
  }
}

async function claimNextCommand() {
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
  await heartbeat('online', { pid: process.pid });
  const command = await claimNextCommand();
  if (!command) return;

  await log('info', 'command_started', `Processando ${command.command_type}`, {}, command);
  try {
    const result = await executeCommand(command);
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
}

async function main() {
  console.log('==============================================');
  console.log(' INVCRIPTO CONNECTOR LOCAL');
  console.log('==============================================');
  console.log(`Node: ${cfg.nodeKey}`);
  console.log(`Intervalo: ${cfg.intervalMs}ms`);
  console.log('Pressione Ctrl+C para parar.');
  await log('info', 'connector_started', 'Conector local iniciado');
  await heartbeat('online');

  setInterval(() => {
    processLoop().catch(async error => {
      console.error('Erro no loop:', error);
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
