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
const strategyScores = { conservative: 78, moderate: 70, aggressive: 62, leverage: 56 };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
  const symbol = String(body.symbol || '').trim().toUpperCase();
  const quoteOrderQty = Number(body.quoteOrderQty || body.valueUsdt || 0);
  const targetPrice = Number(body.targetPrice || body.recoveryTarget || 0);
  const timeframe = String(body.timeframe || '15m').trim();
  const score = Number(body.score || 0);
  const strategyMode = ['conservative', 'moderate', 'aggressive', 'leverage'].includes(body.strategyMode) ? body.strategyMode : 'moderate';
  const profitTargetPct = clamp(Number(body.profitTargetPct || 0.005), strategyMode === 'leverage' ? 0.0015 : 0.0018, 0.008);
  const reason = String(body.reason || 'Entrada protegida INVCRIPTO').slice(0, 500);

  if (!allowedSymbols.has(symbol)) return json(400, { error: 'Par nao permitido para operacao real.' });
  if (!quoteOrderQty || quoteOrderQty <= 0) return json(400, { error: 'Valor da compra em USDT obrigatorio.' });
  if (!targetPrice || targetPrice <= 0) return json(400, { error: 'Preco alvo de venda obrigatorio.' });
  if (environment === 'live' && score < strategyScores[strategyMode]) return json(400, { error: `Score insuficiente para conta real no perfil ${strategyMode}.` });

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  let userId = manualUserId;
  if (!userId && token) {
    const { data: authData } = await supabase.auth.getUser(token);
    userId = authData?.user?.id || '';
  }
  if (!userId) return json(400, { error: 'Usuario nao informado.' });

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id,email,status')
    .eq('id', userId)
    .maybeSingle();

  if (profileError || !profile || profile.status !== 'active') return json(401, { error: 'Perfil manual invalido ou bloqueado.' });
  if (manualEmail && String(profile.email || '').toLowerCase() !== manualEmail) return json(401, { error: 'Perfil manual nao confere com o e-mail.' });

  const { data: credential, error: credentialError } = await supabase
    .from('binance_api_credentials')
    .select('id,can_trade,status,real_usdt_free')
    .eq('user_id', userId)
    .eq('environment', environment)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (credentialError) return json(400, { error: credentialError.message });
  if (!credential) return json(404, { error: 'Nenhuma API Binance salva para este ambiente.' });
  if (!credential.can_trade) return json(400, { error: 'API Binance salva esta sem permissao de trading.' });

  const { data: recentCommands, error: recentError } = await supabase
    .from('connector_commands')
    .select('id,payload,status,created_at')
    .eq('user_id', userId)
    .eq('command_type', 'EXECUTE_PROTECTED_SPOT_BUY')
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: false })
    .limit(20);

  if (recentError) return json(400, { error: recentError.message });
  const duplicated = (recentCommands || []).find(command =>
    String(command.payload?.environment || 'live') === environment &&
    String(command.payload?.symbol || '').toUpperCase() === symbol
  );
  if (duplicated) {
    return json(200, {
      ok: true,
      skipped: true,
      reason: 'pending_command',
      connectorQueued: false,
      connectorCommandId: duplicated.id,
      message: 'Ja existe compra real pendente para este par. O robo vai aguardar a cesta atual antes de abrir outra.'
    });
  }

  const { data: command, error: commandError } = await supabase
    .from('connector_commands')
    .insert({
      user_id: userId,
      command_type: 'EXECUTE_PROTECTED_SPOT_BUY',
      payload: {
        environment,
        credentialId: credential.id,
        symbol,
        quoteOrderQty,
        targetPrice,
        profitTargetPct,
        timeframe,
        score,
        strategyMode,
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
    profitTargetPct,
    strategyMode,
    message: 'Ordem protegida enviada ao conector local. A compra e a venda serao criadas pela Binance via conector.'
  });
}
