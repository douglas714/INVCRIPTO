import { createClient } from '@supabase/supabase-js';

const jsonHeaders = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'POST,OPTIONS'
};

const PROFILE_RULES = Object.freeze({
  conservador: { label: 'Conservador', protectionGapPct: 1, maxConcurrentBaskets: 1, timeframe: '5m' },
  moderado: { label: 'Moderado', protectionGapPct: 0.5, maxConcurrentBaskets: 1, timeframe: '5m' },
  arrojado: { label: 'Arrojado', protectionGapPct: 0.3, maxConcurrentBaskets: 1, timeframe: '1m' },
  alavancagem: { label: 'Alavancagem', protectionGapPct: 0.15, maxConcurrentBaskets: 5, timeframe: '1m' }
});

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

  const requestedProfile = String(body.profileName || '').trim().toLowerCase();
  const rules = PROFILE_RULES[requestedProfile];
  if (!rules) return json(400, { error: 'Modalidade de operacao invalida.' });

  const manualUserId = String(body.manualUserId || '').trim();
  const manualEmail = String(body.manualEmail || '').trim().toLowerCase();
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

  if (profileError || !profile || profile.status !== 'active') return json(401, { error: 'Perfil invalido ou bloqueado.' });
  if (manualEmail && String(profile.email || '').toLowerCase() !== manualEmail) return json(401, { error: 'Perfil nao confere com o e-mail.' });

  const { data: bot, error: botReadError } = await supabase
    .from('bot_instances')
    .select('id,config')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (botReadError) return json(400, { error: botReadError.message });

  const profileConfig = {
    ...(bot?.config && typeof bot.config === 'object' ? bot.config : {}),
    profileName: requestedProfile,
    protectionGapPct: rules.protectionGapPct,
    maxConcurrentBaskets: rules.maxConcurrentBaskets,
    strategyTimeframe: rules.timeframe,
    initialEntryUsdt: 10,
    targetNetPct: 0.5,
    normalReservePct: 80,
    emergencyReservePct: 20
  };

  let saved;
  if (bot?.id) {
    const { data, error } = await supabase
      .from('bot_instances')
      .update({ profile_name: requestedProfile, config: profileConfig })
      .eq('id', bot.id)
      .select('id,profile_name,config,updated_at')
      .single();
    if (error) return json(400, { error: error.message });
    saved = data;
  } else {
    const { data, error } = await supabase
      .from('bot_instances')
      .insert({
        user_id: userId,
        mode: 'paper',
        status: 'inactive',
        active_symbol: 'BTCUSDT',
        profile_name: requestedProfile,
        config: profileConfig
      })
      .select('id,profile_name,config,updated_at')
      .single();
    if (error) return json(400, { error: error.message });
    saved = data;
  }

  return json(200, {
    ok: true,
    botId: saved.id,
    profileName: requestedProfile,
    label: rules.label,
    protectionGapPct: rules.protectionGapPct,
    maxConcurrentBaskets: rules.maxConcurrentBaskets,
    timeframe: rules.timeframe,
    normalReservePct: 80,
    emergencyReservePct: 20,
    targetNetPct: 0.5
  });
}
