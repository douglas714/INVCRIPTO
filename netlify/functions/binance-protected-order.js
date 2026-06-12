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

const allowedSymbols = new Set(['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT']);

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
  const symbol = String(body.symbol || '').trim().toUpperCase();
  const quoteOrderQty = Number(body.quoteOrderQty || body.valueUsdt || 0);
  const targetPrice = Number(body.targetPrice || body.recoveryTarget || 0);
  const timeframe = String(body.timeframe || '15m').trim();
  const score = Number(body.score || 0);
  const reason = String(body.reason || 'Entrada protegida INVCRIPTO').slice(0, 500);

  if (!manualUserId) return json(400, { error: 'Usuario nao informado.' });
  if (!allowedSymbols.has(symbol)) return json(400, { error: 'Par nao permitido para operacao real.' });
  if (!quoteOrderQty || quoteOrderQty <= 0) return json(400, { error: 'Valor da compra em USDT obrigatorio.' });
  if (!targetPrice || targetPrice <= 0) return json(400, { error: 'Preco alvo de venda obrigatorio.' });
  if (environment === 'live' && score < 78) return json(400, { error: 'Score insuficiente para conta real.' });

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id,email,status')
    .eq('id', manualUserId)
    .maybeSingle();

  if (profileError || !profile || profile.status !== 'active') return json(401, { error: 'Perfil manual invalido ou bloqueado.' });
  if (manualEmail && String(profile.email || '').toLowerCase() !== manualEmail) return json(401, { error: 'Perfil manual nao confere com o e-mail.' });

  const { data: credential, error: credentialError } = await supabase
    .from('binance_api_credentials')
    .select('id,can_trade,status,real_usdt_free')
    .eq('user_id', manualUserId)
    .eq('environment', environment)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (credentialError) return json(400, { error: credentialError.message });
  if (!credential) return json(404, { error: 'Nenhuma API Binance salva para este ambiente.' });
  if (!credential.can_trade) return json(400, { error: 'API Binance salva esta sem permissao de trading.' });

  const { data: command, error: commandError } = await supabase
    .from('connector_commands')
    .insert({
      user_id: manualUserId,
      command_type: 'EXECUTE_PROTECTED_SPOT_BUY',
      payload: {
        environment,
        credentialId: credential.id,
        symbol,
        quoteOrderQty,
        targetPrice,
        timeframe,
        score,
        reason
      },
      status: 'pending'
    })
    .select('id')
    .single();

  if (commandError) return json(400, { error: commandError.message });

  return json(200, {
    ok: true,
    connectorQueued: true,
    connectorCommandId: command.id,
    commandType: 'EXECUTE_PROTECTED_SPOT_BUY',
    environment,
    symbol,
    quoteOrderQty,
    targetPrice,
    message: 'Ordem protegida enviada ao conector local. A compra e a venda serao criadas pela Binance via conector.'
  });
}
