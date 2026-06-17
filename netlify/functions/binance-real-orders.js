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

function isSchemaCacheColumnError(error) {
  return /schema cache|could not find .* column/i.test(String(error?.message || ''));
}

async function fetchRealOrders(supabase, userId, environment, limit) {
  const fullSelect = 'id,created_at,environment,symbol,side,order_type,status,protection_role,timeframe,quantity,price,quote_order_qty,executed_qty,cummulative_quote_qty,reason,binance_order_id,linked_order_id,basket_id,order_list_id,profile_name';
  const legacySelect = 'id,created_at,environment,symbol,side,order_type,status,quantity,price,quote_order_qty,executed_qty,cummulative_quote_qty,reason,binance_order_id';
  const query = select => supabase
    .from('real_orders')
    .select(select)
    .eq('user_id', userId)
    .eq('environment', environment)
    .order('created_at', { ascending: false })
    .limit(limit);
  const full = await query(fullSelect);
  if (!full.error || !isSchemaCacheColumnError(full.error)) return full;
  return query(legacySelect);
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
  const limit = Math.min(100, Math.max(1, Number(body.limit || 60)));

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

  const { data, error } = await fetchRealOrders(supabase, userId, environment, limit);

  if (error) return json(400, { error: error.message });

  return json(200, {
    ok: true,
    environment,
    orders: (data || []).map(order => ({
      id: order.id,
      at: order.created_at,
      accountMode: 'live',
      side: order.side === 'SELL' ? 'REAL_SELL' : 'REAL_BUY',
      rawSide: order.side,
      orderType: order.order_type,
      status: order.status,
      protectionRole: order.protection_role,
      timeframe: order.timeframe,
      symbol: order.symbol,
      qty: Number(order.executed_qty || order.quantity || 0),
      price: Number(order.price || 0),
      valueUsd: Number(order.cummulative_quote_qty || order.quote_order_qty || (Number(order.quantity || 0) * Number(order.price || 0)) || 0),
      reason: order.reason,
      binanceOrderId: order.binance_order_id,
      linkedOrderId: order.linked_order_id,
      basketId: order.basket_id,
      orderListId: order.order_list_id,
      profileName: order.profile_name
    }))
  });
}
