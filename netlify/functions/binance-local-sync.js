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

function keyBuffer() {
  const source = process.env.APP_ENCRYPTION_KEY || '';
  if (source.length < 24) throw new Error('APP_ENCRYPTION_KEY is not configured');
  return crypto.createHash('sha256').update(source).digest();
}

function decryptSecret(payload) {
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer(), Buffer.from(parsed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.value, 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
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
  const apiKey = String(body.apiKey || '').trim();
  const apiSecret = String(body.apiSecret || '').trim();

  if (!manualUserId || !apiKey || !apiSecret) return json(400, { error: 'Dados locais incompletos.' });

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id,email,status')
    .eq('id', manualUserId)
    .maybeSingle();

  if (profileError || !profile || profile.status !== 'active') return json(401, { error: 'Perfil manual inválido ou bloqueado.' });
  if (manualEmail && String(profile.email || '').toLowerCase() !== manualEmail) return json(401, { error: 'Perfil manual não confere com o e-mail.' });

  const { data: credential, error: credentialError } = await supabase
    .from('binance_api_credentials')
    .select('*')
    .eq('user_id', manualUserId)
    .eq('environment', environment)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (credentialError || !credential) return json(404, { error: 'Credencial Binance salva não encontrada.' });

  let storedApiKey;
  let storedApiSecret;
  try {
    storedApiKey = decryptSecret(credential.api_key_encrypted);
    storedApiSecret = decryptSecret(credential.api_secret_encrypted);
  } catch (error) {
    return json(500, { error: `Falha ao abrir credencial criptografada: ${String(error?.message || error)}` });
  }

  if (storedApiKey !== apiKey || storedApiSecret !== apiSecret) {
    return json(401, { error: 'A chave enviada localmente não confere com a credencial salva no painel.' });
  }

  const canTrade = Boolean(body.canTrade);
  const canWithdraw = Boolean(body.canWithdraw);
  const permissions = Array.isArray(body.permissions) ? body.permissions : [];
  const hasSpot = permissions.length ? permissions.includes('SPOT') || permissions.some(item => String(item).startsWith('TRD_GRP_')) : true;
  const status = canTrade && hasSpot && !canWithdraw ? 'active' : 'review_required';
  const usdtFree = Number(body.usdtFree || 0);
  const usdtLocked = Number(body.usdtLocked || 0);

  const { error: updateError } = await supabase
    .from('binance_api_credentials')
    .update({
      api_key_masked: maskKey(apiKey),
      can_read: true,
      can_trade: canTrade,
      can_withdraw: canWithdraw,
      status,
      last_test_at: new Date().toISOString(),
      real_usdt_free: usdtFree,
      real_usdt_locked: usdtLocked
    })
    .eq('id', credential.id);

  if (updateError) return json(400, { error: updateError.message });

  const result = {
    environment,
    canTrade,
    canWithdraw,
    hasSpot,
    credentialStatus: status,
    productionReady: status === 'active',
    usdtFree,
    usdtLocked
  };

  await supabase
    .from('connector_commands')
    .update({
      status: 'done',
      result,
      completed_at: new Date().toISOString(),
      error_message: null
    })
    .eq('user_id', manualUserId)
    .eq('command_type', 'VALIDATE_BINANCE_API')
    .in('status', ['pending', 'running']);

  return json(200, { ok: true, apiKeyMasked: maskKey(apiKey), ...result });
}
