import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const jsonHeaders = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'POST,OPTIONS'
};

function json(statusCode, body) {
  return { statusCode, headers: jsonHeaders, body: JSON.stringify(body) };
}

function maskKey(apiKey) {
  if (!apiKey || apiKey.length < 12) return '********';
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`;
}

function encryptionKey() {
  const source = process.env.APP_ENCRYPTION_KEY || '';
  if (source.length < 24) throw new Error('APP_ENCRYPTION_KEY is not configured');
  return crypto.createHash('sha256').update(source).digest();
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    value: encrypted.toString('base64')
  });
}

async function signedBinanceAccount({ apiKey, apiSecret, environment }) {
  const baseUrl = environment === 'testnet'
    ? (process.env.BINANCE_TESTNET_BASE_URL || 'https://testnet.binance.vision')
    : (process.env.BINANCE_SPOT_BASE_URL || 'https://api.binance.com');
  const query = `timestamp=${Date.now()}&recvWindow=5000`;
  const signature = crypto.createHmac('sha256', apiSecret).update(query).digest('hex');
  const response = await fetch(`${baseUrl}/api/v3/account?${query}&signature=${signature}`, {
    headers: { 'X-MBX-APIKEY': apiKey }
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  if (!response.ok) return { ok: false, status: response.status, payload };
  return { ok: true, status: response.status, payload };
}

function isRestrictedLocation(account) {
  const msg = String(account?.payload?.msg || account?.payload?.raw || '');
  return account?.status === 451 || /restricted location|eligibility|unavailable from a restricted/i.test(msg);
}

async function saveCredential({ supabase, userId, apiKey, apiSecret, environment, label, account = null, forcedStatus = null }) {
  const encryptedApiKey = encryptSecret(apiKey);
  const encryptedSecret = encryptSecret(apiSecret);

  await supabase
    .from('binance_api_credentials')
    .delete()
    .eq('user_id', userId)
    .eq('environment', environment);

  const balances = Array.isArray(account?.payload?.balances) ? account.payload.balances : [];
  const usdtBalance = balances.find(balance => balance.asset === 'USDT');
  const canTrade = Boolean(account?.payload?.canTrade);
  // account.canWithdraw descreve a conta, nao a permissao de saque da chave API.
  const accountCanWithdraw = Boolean(account?.payload?.canWithdraw);
  const canWithdraw = false;
  const permissions = Array.isArray(account?.payload?.permissions) ? account.payload.permissions : [];
  const hasSpot = account?.ok ? (permissions.length ? permissions.includes('SPOT') : true) : false;
  const credentialStatus = forcedStatus || (canTrade && hasSpot ? 'active' : 'review_required');

  const credentialRow = {
    user_id: userId,
    label,
    api_key_masked: maskKey(apiKey),
    api_key_encrypted: encryptedApiKey,
    api_secret_encrypted: encryptedSecret,
    can_read: Boolean(account?.ok),
    can_trade: canTrade,
    can_withdraw: canWithdraw,
    environment,
    status: credentialStatus,
    last_test_at: account?.ok ? new Date().toISOString() : null,
    real_usdt_free: Number(usdtBalance?.free || 0),
    real_usdt_locked: Number(usdtBalance?.locked || 0)
  };

  let { data, error } = await supabase
    .from('binance_api_credentials')
    .insert(credentialRow)
    .select('id')
    .single();

  if (error && /real_usdt/i.test(error.message || '')) {
    const { real_usdt_free, real_usdt_locked, ...fallbackRow } = credentialRow;
    const retry = await supabase
      .from('binance_api_credentials')
      .insert(fallbackRow)
      .select('id')
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) throw new Error(error.message);
  return { id: data?.id, canTrade, canWithdraw, accountCanWithdraw, hasSpot, credentialStatus, usdtBalance };
}

async function queueConnectorValidation({ supabase, userId, environment, credentialId, reason }) {
  const { data, error } = await supabase
    .from('connector_commands')
    .insert({
      user_id: userId,
      command_type: 'VALIDATE_BINANCE_API',
      payload: {
        environment,
        credentialId,
        reason,
        requestedBy: 'netlify-binance-test'
      },
      status: 'pending'
    })
    .select('id')
    .single();

  if (error) throw new Error(`API salva, mas não consegui criar comando para o conector local: ${error.message}`);
  return data?.id;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: jsonHeaders, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json(500, { error: 'Supabase service role not configured' });

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON body' }); }

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  let userId = null;
  if (token) {
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) return json(401, { error: 'Invalid Supabase session' });
    userId = authData.user.id;
  } else if (body.manualUserId) {
    const manualUserId = String(body.manualUserId || '').trim();
    const manualEmail = String(body.manualEmail || '').trim().toLowerCase();
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id,email,status')
      .eq('id', manualUserId)
      .maybeSingle();
    if (profileError || !profile || profile.status !== 'active') return json(401, { error: 'Perfil manual inválido ou bloqueado.' });
    if (manualEmail && String(profile.email || '').toLowerCase() !== manualEmail) return json(401, { error: 'Perfil manual não confere com o e-mail.' });
    userId = profile.id;
  } else {
    return json(401, { error: 'Sessão expirada. Faça login novamente.' });
  }

  const apiKey = String(body.apiKey || '').trim();
  const apiSecret = String(body.apiSecret || '').trim();
  const environment = body.environment === 'live' ? 'live' : 'testnet';
  const label = String(body.label || 'Principal').slice(0, 80);

  if (apiKey.length < 20 || apiSecret.length < 20) {
    return json(400, { error: 'API Key e Secret Key são obrigatórias.' });
  }

  let account;
  try {
    account = await signedBinanceAccount({ apiKey, apiSecret, environment });
  } catch (error) {
    return json(502, { error: 'Falha ao consultar Binance.', detail: String(error?.message || error) });
  }

  if (!account.ok && isRestrictedLocation(account)) {
    try {
      const saved = await saveCredential({
        supabase,
        userId,
        apiKey,
        apiSecret,
        environment,
        label,
        account: null,
        forcedStatus: 'pending_connector_validation'
      });
      const commandId = await queueConnectorValidation({
        supabase,
        userId,
        environment,
        credentialId: saved.id,
        reason: 'Netlify IP blocked by Binance. Validate through local connector.'
      });
      return json(200, {
        ok: true,
        environment,
        apiKeyMasked: maskKey(apiKey),
        connectorQueued: true,
        connectorCommandId: commandId,
        credentialStatus: 'pending_connector_validation',
        productionReady: false,
        canTrade: false,
        canWithdraw: false,
        hasSpot: false,
        usdtFree: 0,
        usdtLocked: 0,
        warning: 'API salva criptografada. A Binance bloqueou o IP da Netlify, então a validação foi enviada para o INVCRIPTO Connector Local usando o IP da sua máquina.'
      });
    } catch (error) {
      return json(400, { error: String(error?.message || error) });
    }
  }

  if (!account.ok) {
    return json(400, { error: 'A Binance rejeitou as credenciais.', status: account.status, detail: account.payload });
  }

  let saved;
  try {
    saved = await saveCredential({ supabase, userId, apiKey, apiSecret, environment, label, account });
  } catch (error) {
    return json(400, { error: String(error?.message || error) });
  }

  return json(200, {
    ok: true,
    environment,
    apiKeyMasked: maskKey(apiKey),
    connectorQueued: false,
    credentialStatus: saved.credentialStatus,
    productionReady: environment === 'live' && saved.credentialStatus === 'active',
    canTrade: saved.canTrade,
    canWithdraw: saved.canWithdraw,
    hasSpot: saved.hasSpot,
    usdtFree: Number(saved.usdtBalance?.free || 0),
    usdtLocked: Number(saved.usdtBalance?.locked || 0),
    withdrawPermissionVerified: false,
    withdrawPermissionStatus: 'manual_check_required',
    warning: !saved.canTrade
      ? 'Chave salva, mas marcada para revisão: Spot Trading não está habilitado.'
      : !saved.hasSpot
        ? 'Chave salva, mas marcada para revisão: permissão SPOT não identificada.'
        : null
  });
}
