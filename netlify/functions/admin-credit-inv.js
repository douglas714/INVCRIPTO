import { createClient } from '@supabase/supabase-js';

const headers = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'POST,OPTIONS'
};

function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

async function getActiveAdminProfile(supabase, userId) {
  if (!userId) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('id,email,role,status')
    .eq('id', userId)
    .maybeSingle();
  return profile?.role === 'admin' && profile?.status === 'active' ? profile : null;
}

async function resolveAdminProfile({ supabase, token, manualAdminUserId, manualAdminEmail }) {
  if (token) {
    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data?.user) {
      const tokenAdmin = await getActiveAdminProfile(supabase, data.user.id);
      if (tokenAdmin) return tokenAdmin;
    }
  }

  if (!manualAdminUserId) return null;
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id,email,role,status')
    .eq('id', manualAdminUserId)
    .maybeSingle();

  if (error || !profile) return null;
  if (manualAdminEmail && String(profile.email || '').toLowerCase() !== manualAdminEmail) return null;
  return profile.role === 'admin' && profile.status === 'active' ? profile : null;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json(500, { error: 'Supabase service role not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON body' }); }

  const targetUserId = String(body.user_id || body.targetUserId || '').trim();
  const amount = Number(body.amount_inv || body.amount || 0);
  const description = String(body.description || 'Crédito manual pelo painel admin');
  const manualAdminUserId = String(body.manualAdminUserId || '').trim();
  const manualAdminEmail = String(body.manualAdminEmail || '').trim().toLowerCase();
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');

  if (!targetUserId) return json(400, { error: 'Cliente não informado.' });
  if (!amount || amount <= 0) return json(400, { error: 'Valor ENV precisa ser maior que zero.' });

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const adminProfile = await resolveAdminProfile({ supabase, token, manualAdminUserId, manualAdminEmail });
  if (!adminProfile) {
    return json(403, { error: 'Apenas admin pode adicionar ENV.' });
  }

  const { error } = await supabase.rpc('credit_inv', {
    p_user_id: targetUserId,
    p_amount: amount,
    p_type: 'admin_adjustment',
    p_description: description
  });
  if (error) return json(400, { error: error.message });

  await supabase.from('admin_actions').insert({
    admin_user_id: adminProfile.id,
    target_user_id: targetUserId,
    action: 'credit_inv',
    details: { amount, description }
  });

  const { data: wallet } = await supabase
    .from('inv_wallets')
    .select('balance_inv')
    .eq('user_id', targetUserId)
    .maybeSingle();

  return json(200, { ok: true, balance_inv: Number(wallet?.balance_inv || 0) });
}
