import { createClient } from '@supabase/supabase-js';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { statusCode: 500, body: JSON.stringify({error:'Supabase service role not configured'}) };
  const supabase = createClient(url, key);
  const { user_id, amount_inv, description } = JSON.parse(event.body || '{}');
  const { error } = await supabase.rpc('credit_inv', { p_user_id: user_id, p_amount: amount_inv, p_type: 'admin_adjustment', p_description: description || 'Crédito manual admin' });
  if (error) return { statusCode: 400, body: JSON.stringify({error:error.message}) };
  return { statusCode: 200, body: JSON.stringify({ok:true}) };
}
