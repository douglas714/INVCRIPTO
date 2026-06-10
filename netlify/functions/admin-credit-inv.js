export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { statusCode: 500, headers:{'content-type':'application/json'}, body: JSON.stringify({error:'Supabase service role not configured'}) };
  try {
    const { user_id, amount_inv, amount_env, description } = JSON.parse(event.body || '{}');
    const amount = Number(amount_env ?? amount_inv);
    if (!user_id || !Number.isFinite(amount) || amount <= 0) {
      return { statusCode: 400, headers:{'content-type':'application/json'}, body: JSON.stringify({error:'Informe user_id e amount_env válido'}) };
    }
    const rpc = await fetch(`${url}/rest/v1/rpc/credit_inv`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ p_user_id: user_id, p_amount: amount, p_type: 'admin_adjustment', p_description: description || 'Crédito manual admin' })
    });
    const body = await rpc.text();
    if (!rpc.ok) return { statusCode: rpc.status, headers:{'content-type':'application/json'}, body };
    return { statusCode: 200, headers:{'content-type':'application/json'}, body: JSON.stringify({ok:true}) };
  } catch (error) {
    return { statusCode: 500, headers:{'content-type':'application/json'}, body: JSON.stringify({error:error.message}) };
  }
}
