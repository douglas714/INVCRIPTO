export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { statusCode: 500, body: JSON.stringify({ error: 'Supabase service role not configured' }) };

  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch (_) {}
  const user_id = payload.user_id;
  const amount_inv = Number(payload.amount_inv || payload.amount_env || 0);
  const description = payload.description || 'Crédito manual admin';
  if (!user_id || !Number.isFinite(amount_inv) || amount_inv <= 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'user_id e amount_inv são obrigatórios' }) };
  }

  const rpc = await fetch(`${url}/rest/v1/rpc/credit_inv`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      p_user_id: user_id,
      p_amount: amount_inv,
      p_type: 'admin_adjustment',
      p_description: description
    })
  });
  const text = await rpc.text();
  if (!rpc.ok) return { statusCode: rpc.status, body: text || JSON.stringify({ error: 'Falha ao creditar ENV' }) };
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
}
