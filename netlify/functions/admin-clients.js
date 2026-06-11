import { createClient } from '@supabase/supabase-js';

const headers = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,OPTIONS'
};

function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function byUserId(rows, key = 'user_id') {
  const map = new Map();
  for (const row of rows || []) map.set(row[key], row);
  return map;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json(500, { error: 'Supabase service role not configured' });

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Missing Supabase access token' });

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) return json(401, { error: 'Invalid Supabase session' });

  const { data: adminProfile } = await supabase
    .from('profiles')
    .select('id,role,status')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (adminProfile?.role !== 'admin' || adminProfile?.status === 'blocked') {
    return json(403, { error: 'Apenas administradores podem listar clientes.' });
  }

  const [{ data: authUsers, error: usersError }, profiles, docs, wallets, paperWallets, bots, creds] = await Promise.all([
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    supabase.from('profiles').select('*'),
    supabase.from('user_documents').select('*'),
    supabase.from('inv_wallets').select('*'),
    supabase.from('paper_wallets').select('*'),
    supabase.from('bot_instances').select('*').order('created_at', { ascending: false }),
    supabase.from('binance_api_credentials').select('*')
  ]);

  if (usersError) return json(400, { error: usersError.message });

  const profileMap = byUserId(profiles.data || [], 'id');
  const docMap = byUserId(docs.data || []);
  const walletMap = byUserId(wallets.data || []);
  const paperMap = byUserId(paperWallets.data || []);
  const botMap = new Map();
  for (const bot of bots.data || []) if (!botMap.has(bot.user_id)) botMap.set(bot.user_id, bot);
  const credMap = new Map();
  for (const cred of creds.data || []) if (!credMap.has(cred.user_id)) credMap.set(cred.user_id, cred);

  const clients = (authUsers.users || []).map(user => {
    const profile = profileMap.get(user.id) || {};
    const doc = docMap.get(user.id) || {};
    const wallet = walletMap.get(user.id) || {};
    const paper = paperMap.get(user.id) || {};
    const bot = botMap.get(user.id) || {};
    const cred = credMap.get(user.id) || {};
    return {
      user_id: user.id,
      email: profile.email || user.email,
      full_name: profile.full_name || user.user_metadata?.full_name || user.email || 'Usuário',
      phone: profile.phone || user.phone || '',
      cpf_masked: doc.cpf_masked || '',
      status: profile.status || (user.confirmed_at ? 'active' : 'pending_auth'),
      role: profile.role || 'client',
      created_at: profile.created_at || user.created_at,
      balance_inv: Number(wallet.balance_inv || 0),
      demo_usdt: Number(paper.balance_usdt || paper.balance_brl || 0),
      demo_profit_usdt: Number(paper.realized_profit_brl || 0),
      bot_mode: bot.mode || 'paper',
      bot_status: bot.status || 'inactive',
      binance_environment: cred.environment || null,
      binance_key: cred.api_key_masked || null,
      binance_can_trade: Boolean(cred.can_trade),
      binance_can_withdraw: Boolean(cred.can_withdraw),
      real_usdt_free: Number(cred.real_usdt_free || 0),
      real_usdt_locked: Number(cred.real_usdt_locked || 0)
    };
  });

  return json(200, { clients });
}
