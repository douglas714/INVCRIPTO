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

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: jsonHeaders, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json(500, { error: 'Supabase service role not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON body' }); }

  const manualUserId = String(body.manualUserId || '').trim();
  const manualEmail = String(body.manualEmail || '').trim().toLowerCase();
  const environment = body.environment === 'testnet' ? 'testnet' : 'live';
  if (!manualUserId) return json(400, { error: 'Usuário não informado.' });

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id,email,status')
    .eq('id', manualUserId)
    .maybeSingle();

  if (profileError || !profile || profile.status !== 'active') return json(401, { error: 'Perfil manual inválido ou bloqueado.' });
  if (manualEmail && String(profile.email || '').toLowerCase() !== manualEmail) return json(401, { error: 'Perfil manual não confere com o e-mail.' });

  const { data: credential, error } = await supabase
    .from('binance_api_credentials')
    .select('api_key_masked,environment,status,can_read,can_trade,can_withdraw,real_usdt_free,real_usdt_locked,last_test_at')
    .eq('user_id', manualUserId)
    .eq('environment', environment)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return json(400, { error: error.message });
  const { data: wallet } = await supabase
    .from('inv_wallets')
    .select('balance_inv')
    .eq('user_id', manualUserId)
    .maybeSingle();
  const { data: connector } = await supabase
    .from('connector_nodes')
    .select('node_key,status,app_version,last_seen_at,metadata')
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const connectorSeenMs = Date.parse(connector?.last_seen_at || 0);
  const connectorOnline = Boolean(connector && connector.status === 'online' && Number.isFinite(connectorSeenMs) && Date.now() - connectorSeenMs <= 45_000);
  const connectorVersionOk = String(connector?.app_version || '').startsWith('1.6.');

  if (!credential) return json(200, {
    ok: true,
    connected: false,
    environment,
    envBalance: Number(wallet?.balance_inv || 0),
    connectorOnline,
    connectorVersion: connector?.app_version || null,
    connectorVersionOk
  });

  const lastTestMs = Date.parse(credential.last_test_at || 0);
  const credentialFresh = Number.isFinite(lastTestMs) && Date.now() - lastTestMs <= 90_000;
  const productionReady = Boolean(
    environment === 'live' && credential.status === 'active' && credential.can_trade &&
    credentialFresh && connectorOnline && connectorVersionOk
  );

  return json(200, {
    ok: true,
    connected: Boolean(credential.can_read),
    environment: credential.environment,
    envBalance: Number(wallet?.balance_inv || 0),
    apiKeyMasked: credential.api_key_masked,
    credentialStatus: credential.status,
    canTrade: Boolean(credential.can_trade),
    canWithdraw: false,
    withdrawPermissionVerified: false,
    withdrawPermissionStatus: 'manual_check_required',
    usdtFree: Number(credential.real_usdt_free || 0),
    usdtLocked: Number(credential.real_usdt_locked || 0),
    lastTestAt: credential.last_test_at,
    credentialFresh,
    connectorOnline,
    connectorVersion: connector?.app_version || null,
    connectorVersionOk,
    productionReady
  });
}
