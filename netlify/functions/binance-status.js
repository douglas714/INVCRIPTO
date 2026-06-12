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
  if (!credential) return json(200, { ok: true, connected: false, environment });

  return json(200, {
    ok: true,
    connected: Boolean(credential.can_read),
    environment: credential.environment,
    apiKeyMasked: credential.api_key_masked,
    credentialStatus: credential.status,
    canTrade: Boolean(credential.can_trade),
    canWithdraw: Boolean(credential.can_withdraw),
    usdtFree: Number(credential.real_usdt_free || 0),
    usdtLocked: Number(credential.real_usdt_locked || 0),
    lastTestAt: credential.last_test_at
  });
}
