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
const INITIAL_ENTRY_USDT = 10;
const PROFILE_LIMITS = { conservador: 1, moderado: 1, arrojado: 1, alavancagem: 5 };

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
  const quoteOrderQty = INITIAL_ENTRY_USDT;
  const targetPrice = Number(body.targetPrice || body.recoveryTarget || 0);
  const timeframe = String(body.timeframe || '5m').trim();
  const score = Number(body.score || 0);
  const reason = String(body.reason || 'Entrada protegida INVCRIPTO').slice(0, 500);
  const requestedProfileName = String(body.profileName || '').trim().toLowerCase();

  if (!allowedSymbols.has(symbol)) return json(400, { error: 'Par nao permitido para operacao real.' });
  if (environment === 'live' && score < 78) return json(400, { error: 'Score insuficiente para conta real.' });

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
  if (Number(credential.real_usdt_free || 0) < INITIAL_ENTRY_USDT) return json(400, { error: `Saldo minimo de ${INITIAL_ENTRY_USDT.toFixed(2)} USDT necessario para a entrada inicial.` });

  const { data: bot } = await supabase
    .from('bot_instances')
    .select('id,profile_name,config,updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const storedProfileName = PROFILE_LIMITS[String(bot?.profile_name || '').toLowerCase()]
    ? String(bot.profile_name).toLowerCase()
    : 'conservador';
  const profileName = PROFILE_LIMITS[requestedProfileName] ? requestedProfileName : storedProfileName;
  const maxConcurrentBaskets = PROFILE_LIMITS[profileName];
  if (bot?.id && profileName !== storedProfileName) {
    await supabase
      .from('bot_instances')
      .update({
        profile_name: profileName,
        config: {
          ...(bot.config && typeof bot.config === 'object' ? bot.config : {}),
          profileName,
          initialEntryUsdt: 10,
          targetNetPct: 0.5,
          normalReservePct: 80,
          emergencyReservePct: 20
        }
      })
      .eq('id', bot.id);
  }

  const { data: activeBaskets, error: basketError } = await supabase
    .from('real_baskets')
    .select('id,symbol,status')
    .eq('user_id', userId)
    .eq('environment', environment)
    .eq('status', 'active');
  if (basketError) return json(400, { error: `Execute o SQL 12_cestas_offline_binance.sql antes de operar: ${basketError.message}` });
  const sameSymbolBasket = (activeBaskets || []).find(item => String(item.symbol || '').toUpperCase() === symbol);
  if (sameSymbolBasket) {
    return json(200, {
      ok: true,
      skipped: true,
      reason: 'active_basket_managed_by_connector',
      basketId: sameSymbolBasket.id,
      message: `A cesta de ${symbol} ja esta ativa. O conector controla a venda e as proximas protecoes diretamente na Binance.`
    });
  }
  if ((activeBaskets || []).length >= maxConcurrentBaskets) {
    return json(200, {
      ok: true,
      skipped: true,
      reason: 'max_concurrent_baskets',
      profileName,
      maxConcurrentBaskets,
      message: profileName === 'alavancagem'
        ? `O limite de ${maxConcurrentBaskets} cestas simultaneas foi atingido.`
        : `O perfil ${profileName} opera somente uma moeda por vez.`
    });
  }

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
        timeframe,
        score,
        reason,
        profileName,
        targetNetPct: 0.5,
        normalReservePct: 80,
        emergencyReservePct: 20
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
    profileName,
    maxConcurrentBaskets,
    message: 'Ordem protegida enviada ao conector local. A compra e a venda serao criadas pela Binance via conector.'
  });
}
