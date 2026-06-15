import { createClient } from '@supabase/supabase-js';

function json(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return json(500, { error: 'Supabase service role not configured' });

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'Token de administrador ausente' });

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user?.id) return json(401, { error: 'Token invalido ou expirado' });

  const adminUserId = authData.user.id;
  const { data: adminProfile, error: profileError } = await supabase
    .from('profiles')
    .select('id,role,status')
    .eq('id', adminUserId)
    .maybeSingle();
  if (profileError) return json(500, { error: profileError.message });
  if (adminProfile?.role !== 'admin' || adminProfile?.status !== 'active') {
    return json(403, { error: 'Somente administrador ativo pode creditar INV' });
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON invalido' }); }
  const { user_id, amount_inv, description } = body;
  const amount = Number(amount_inv);
  if (!user_id || !Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    return json(400, { error: 'Informe user_id e amount_inv positivo' });
  }

  const { error } = await supabase.rpc('admin_credit_inv_service', {
    p_admin_user_id: adminUserId,
    p_user_id: user_id,
    p_amount: amount,
    p_description: description || 'Credito manual admin'
  });
  if (error) return json(400, { error: error.message });
  return json(200, { ok: true });
}
